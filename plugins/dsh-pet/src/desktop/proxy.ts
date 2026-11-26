/**
 * 主进程内嵌桌宠的受鉴权本地环回代理服务器。
 *
 * 1. 在 `127.0.0.1:0` 监听，所有请求必须携带主进程私密随机令牌 `X-DSH-Pet-Token`（常量时间比对）。
 * 2. `/__pet_helper__/<rel>` 直接从经过路径守卫的 `helperDir` 读取静态渲染页与脚本（支持 ASAR 路径）。
 * 3. `/dsh-pet-7340/...` 通过回调转发给宿主进程 `handlePetRoute`；若应答为本地文件路径，则由主进程直接读盘并支持单段 HTTP Range（206/416），避免视频二进制经 IPC 拷贝。
 * @module dsh-pet/src/desktop/proxy
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import type { BridgeResponse } from '../host/helper/bridge.ts';
import { MAX_BODY_BYTES, parseRange, readBody } from '../host/http.ts';
import { ROUTE_SEGMENT } from '../shared/constants.ts';
import type { DesktopPetBridgeRequestPayload } from './protocol.ts';

/** 渲染端静态资源路由前缀。 */
export const HELPER_MOUNT_PREFIX = '/__pet_helper__/';

/** 令牌请求头名（小写）。 */
export const PET_TOKEN_HEADER = 'x-dsh-pet-token';

/** 单次 bridge 请求超时（ms），覆盖长轮询与模型调用。 */
const BRIDGE_TIMEOUT_MS = 45_000;

/** 静态辅助资源白名单扩展名与 MIME。 */
const HELPER_MIME: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
};

/** 代理服务器的外部依赖。 */
export interface DesktopPetProxyOptions {
  /** 把一次 `/dsh-pet-7340/...` 请求发往宿主进程。 */
  readonly sendBridgeRequest: (req: DesktopPetBridgeRequestPayload) => void;
  /** 可选文件读取器（测试可注入）。 */
  readonly readFileBytes?: (filePath: string) => Promise<Buffer>;
  /** 可选超时（ms，测试可调短）。 */
  readonly bridgeTimeoutMs?: number;
}

/** 代理服务器控制句柄。 */
export interface DesktopPetProxy {
  /** 启动监听并返回 `http://127.0.0.1:<port>`。 */
  start(): Promise<string>;
  /** 当前监听 origin（未启动时为空串）。 */
  origin(): string;
  /** 本实例私密请求令牌。 */
  token(): string;
  /** 更新静态助手目录（`runtime/electron-helper`）。 */
  setHelperDir(dir: string): void;
  /** 向宿主发一次内部请求（供主进程托盘读写配置）。 */
  requestHost(method: string, url: string, body?: string): Promise<BridgeResponse>;
  /** 唤醒等待中的 bridge 请求。 */
  resolveBridge(resp: BridgeResponse): void;
  /** 立即中止所有挂起的 bridge 请求（停机或重载前调用）。 */
  cancelPending(reason?: string): void;
  /** 停止监听并释放所有挂起请求。 */
  stop(): Promise<void>;
}

/**
 * 常量时间校验令牌，避免时序侧信道。
 * @param actual - 请求头里的令牌。
 * @param expected - 服务端持有的令牌。
 * @returns 完全一致时为 true。
 */
function tokenMatches(actual: string | string[] | undefined, expected: string): boolean {
  if (typeof actual !== 'string' || actual.length === 0) return false;
  const a = Buffer.from(actual, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * 在给定根目录下安全解析静态文件路径（拒绝目录穿越、空字节与未列入白名单的扩展名）。
 * @param root - 静态资源根目录。
 * @param rawRel - URL 解码后的相对路径。
 * @returns 绝对路径与 MIME；非法时返回 undefined。
 */
export function resolveHelperStaticFile(
  root: string,
  rawRel: string,
): { readonly file: string; readonly contentType: string } | undefined {
  if (!root || !rawRel || rawRel.includes('\0') || rawRel.startsWith('/') || rawRel.startsWith('\\')) {
    return undefined;
  }
  const normalizedRoot = normalize(root);
  const candidate = normalize(join(normalizedRoot, rawRel));
  const rootWithSep = normalizedRoot.endsWith(sep) ? normalizedRoot : normalizedRoot + sep;
  if (candidate !== normalizedRoot && !candidate.startsWith(rootWithSep)) return undefined;
  const ext = extname(candidate).toLowerCase();
  const contentType = HELPER_MIME[ext];
  if (contentType === undefined) return undefined;
  return { file: candidate, contentType };
}

/**
 * 创建主进程内嵌桌宠的本地受鉴权环回代理服务器。
 * @param options - 请求转发回调与可选文件读取器。
 * @returns 代理服务器控制句柄。
 */
export function createDesktopPetProxy(options: DesktopPetProxyOptions): DesktopPetProxy {
  const secretToken = randomBytes(32).toString('hex');
  const readBytes = options.readFileBytes ?? ((filePath: string) => readFile(filePath));
  const timeoutMs = options.bridgeTimeoutMs ?? BRIDGE_TIMEOUT_MS;

  let server: Server | undefined;
  let listenOrigin = '';
  let helperDir = '';
  let nextSeq = 0;
  const pending = new Map<
    number,
    {
      resolve: (resp: BridgeResponse) => void;
      reject: (error: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();

  const requestHost = (method: string, url: string, body?: string): Promise<BridgeResponse> => {
    return new Promise<BridgeResponse>((resolve, reject) => {
      const id = ++nextSeq;
      const timer = setTimeout(() => {
        const entry = pending.get(id);
        if (!entry) return;
        pending.delete(id);
        entry.reject(new Error('desktop pet bridge request timed out'));
      }, timeoutMs);
      timer.unref?.();
      pending.set(id, { resolve, reject, timer });
      try {
        options.sendBridgeRequest({ id, method, url, ...(body === undefined ? {} : { body }) });
      } catch (error) {
        pending.delete(id);
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  };

  const resolveBridge = (resp: BridgeResponse): void => {
    const entry = pending.get(resp.id);
    if (!entry) return;
    pending.delete(resp.id);
    clearTimeout(entry.timer);
    entry.resolve(resp);
  };

  const cancelPending = (reason = 'desktop pet proxy closed'): void => {
    const error = new Error(reason);
    for (const [id, entry] of pending) {
      pending.delete(id);
      clearTimeout(entry.timer);
      entry.reject(error);
    }
  };

  const writePlain = (res: ServerResponse, status: number, body: string): void => {
    if (res.destroyed || res.writableEnded) return;
    res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
    res.end(body);
  };

  const serveFileWithRange = async (
    req: IncomingMessage,
    res: ServerResponse,
    file: string,
    contentType: string,
    status: number,
  ): Promise<void> => {
    let data: Buffer;
    try {
      data = await readBytes(file);
    } catch {
      writePlain(res, 500, 'dsh-pet: asset read failed');
      return;
    }
    if (res.destroyed || res.writableEnded) return;
    const rangeHeader = typeof req.headers.range === 'string' ? req.headers.range : undefined;
    const decision = parseRange(rangeHeader, data.length);
    if (decision === 'unsatisfiable') {
      res.writeHead(416, {
        'content-type': contentType,
        'content-range': `bytes */${data.length}`,
        'accept-ranges': 'bytes',
      });
      res.end();
      return;
    }
    if (decision !== null) {
      const slice = data.subarray(decision.start, decision.end + 1);
      res.writeHead(206, {
        'content-type': contentType,
        'content-length': String(slice.length),
        'content-range': `bytes ${decision.start}-${decision.end}/${data.length}`,
        'accept-ranges': 'bytes',
      });
      res.end(slice);
      return;
    }
    res.writeHead(status || 200, {
      'content-type': contentType,
      'content-length': String(data.length),
      'accept-ranges': 'bytes',
    });
    res.end(data);
  };

  const handleRequest = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (!tokenMatches(req.headers[PET_TOKEN_HEADER], secretToken)) {
      writePlain(res, 403, 'dsh-pet: forbidden');
      return;
    }
    const rawUrl = req.url ?? '/';
    const parsed = new URL(rawUrl, 'http://127.0.0.1');
    const method = (req.method ?? 'GET').toUpperCase();

    if (parsed.pathname.startsWith(HELPER_MOUNT_PREFIX)) {
      if (method !== 'GET' && method !== 'HEAD') {
        writePlain(res, 405, 'dsh-pet: method not allowed');
        return;
      }
      let rel: string;
      try {
        rel = decodeURIComponent(parsed.pathname.slice(HELPER_MOUNT_PREFIX.length));
      } catch {
        writePlain(res, 400, 'dsh-pet: bad path');
        return;
      }
      const target = resolveHelperStaticFile(helperDir, rel);
      if (target === undefined) {
        writePlain(res, 404, 'dsh-pet: helper asset not found');
        return;
      }
      try {
        const bytes = await readBytes(target.file);
        if (res.destroyed || res.writableEnded) return;
        res.writeHead(200, {
          'content-type': target.contentType,
          'content-length': String(bytes.length),
          'cache-control': 'no-store',
        });
        res.end(method === 'HEAD' ? undefined : bytes);
      } catch {
        writePlain(res, 404, 'dsh-pet: helper asset not found');
      }
      return;
    }

    if (parsed.pathname === ROUTE_SEGMENT || parsed.pathname.startsWith(ROUTE_SEGMENT + '/')) {
      let body: string | undefined;
      if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
        try {
          body = await readBody(req);
        } catch (error) {
          const code = (error as { code?: string }).code;
          if (code === 'body-too-large') {
            writePlain(res, 413, `dsh-pet: body exceeds ${MAX_BODY_BYTES} bytes`);
          }
          return;
        }
      }
      let resp: BridgeResponse;
      try {
        resp = await requestHost(method, parsed.pathname + parsed.search, body);
      } catch {
        writePlain(res, 502, 'dsh-pet: bridge error');
        return;
      }
      if (res.destroyed || res.writableEnded) return;
      if (resp.file) {
        await serveFileWithRange(
          req,
          res,
          resp.file,
          resp.contentType || 'application/octet-stream',
          resp.status || 200,
        );
        return;
      }
      const headers: Record<string, string> = { 'cache-control': 'no-store' };
      if (resp.contentType) headers['content-type'] = resp.contentType;
      const payload = resp.body ?? '';
      headers['content-length'] = String(Buffer.byteLength(payload));
      res.writeHead(resp.status || 200, headers);
      res.end(payload);
      return;
    }

    writePlain(res, 404, 'dsh-pet: not found');
  };

  const start = async (): Promise<string> => {
    if (server !== undefined && listenOrigin !== '') return listenOrigin;
    const nextServer = createServer((req, res) => {
      void handleRequest(req, res).catch(() => {
        writePlain(res, 500, 'dsh-pet: internal proxy error');
      });
    });
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => {
        nextServer.off('listening', onListening);
        reject(error);
      };
      const onListening = (): void => {
        nextServer.off('error', onError);
        const addr = nextServer.address();
        if (!addr || typeof addr === 'string') {
          reject(new Error('desktop pet proxy failed to resolve address'));
          return;
        }
        listenOrigin = `http://127.0.0.1:${addr.port}`;
        server = nextServer;
        resolve();
      };
      nextServer.once('error', onError);
      nextServer.once('listening', onListening);
      nextServer.listen(0, '127.0.0.1');
    });
    return listenOrigin;
  };

  const stop = async (): Promise<void> => {
    cancelPending('desktop pet proxy stopped');
    const active = server;
    server = undefined;
    listenOrigin = '';
    if (!active) return;
    active.closeAllConnections?.();
    await new Promise<void>((resolve) => {
      active.close(() => resolve());
    });
  };

  return {
    start,
    origin: () => listenOrigin,
    token: () => secretToken,
    setHelperDir: (dir: string) => {
      helperDir = dir;
    },
    requestHost,
    resolveBridge,
    cancelPending,
    stop,
  };
}
