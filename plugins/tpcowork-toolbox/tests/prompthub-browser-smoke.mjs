/** Compiled Desktop and Host authenticate through the built PromptHub website in a separate Chrome process. */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, join, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { artifactPeers } from './artifact-peers.mjs'

const harness = fileURLToPath(new URL('../../../../deepseek-harness/', import.meta.url))
const webDist = resolve(process.env.DSH_PROMPTHUB_WEB_DIST || fileURLToPath(new URL('../../../../prompthub/web/dist/', import.meta.url)))
const index = await readFile(join(webDist, 'index.html'))
const browserRequire = createRequire(new URL('../../tpcowork-browser/package.json', import.meta.url))
const { _electron: electron, chromium } = browserRequire('playwright-core')
const executablePath = createRequire(join(harness, 'apps/desktop/package.json'))('electron')
const hook = await artifactPeers()
const [{ Context }, { default: Typert }, { default: Gateway }, { default: Skills }, { default: Credentials }, skills, hub] = await Promise.all([
  import('@deepseek-ai/cordis'), import('@deepseek-ai/dsh-typert-registry'), import('@deepseek-ai/dsh-api-gateway'), import('@deepseek-ai/dsh-skill'),
  import('@deepseek-ai/dsh-credentials-local'), import(new URL('../lib/skills.js', import.meta.url)), import(new URL('../lib/prompthub.js', import.meta.url)),
])
const home = await mkdtemp(join(tmpdir(), 'prompthub-system-browser-'))
const credentialFile = join(home, 'credentials.yaml')
const secret = 'native-fixture-website-token'
const user = { _id: 'native-user', username: 'fixture-user', name: 'Browser account', role: 'user' }
const ctx = new Context()
let loginCount = 0
let rejectSession = false
const server = createServer(async (request, response) => {
  const json = value => { response.setHeader('content-type', 'application/json'); response.end(JSON.stringify(value)) }
  try {
    const chunks = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined
    if (request.url.startsWith('/api/toolboxPromptHub/')) {
      assert.match(request.headers.cookie ?? '', /desktop-test=authenticated/)
      const method = request.url.split('/').at(-1)
      try {
        const value = await ctx.typertGateway.invoke({ namespace: 'toolboxPromptHub', method, args: body.payload.args })
        json({ type: 'server-response', rpcId: body.rpcId, result: { ok: true, value } })
      } catch (_error) { json({ type: 'server-response', rpcId: body.rpcId, result: { ok: false, error: { code: 'fixture/rejected' } } }) }
      return
    }
    if (request.url === '/api/users/login') {
      loginCount++
      if (body.username !== 'fixture-user' || body.passwordHash !== 'fixture-password') {
        response.statusCode = 401; json({ code: 401, message: 'Invalid credentials' }); return
      }
      json({ code: 200, data: { token: secret, user } }); return
    }
    if (request.url === '/api/convex/query') {
      if (request.headers.authorization !== `Bearer ${secret}` || rejectSession) {
        response.statusCode = 401; json({ code: 401 }); return
      }
      assert.equal(body.path, 'users:me')
      json(user); return
    }
    const pathname = new URL(request.url, 'http://fixture').pathname
    if (pathname.startsWith('/assets/')) {
      const file = resolve(webDist, '.' + pathname)
      assert.equal(file.startsWith(webDist + sep), true)
      const mime = { '.js': 'text/javascript', '.css': 'text/css', '.woff': 'font/woff', '.woff2': 'font/woff2' }
      response.setHeader('content-type', mime[extname(file)] || 'application/octet-stream')
      response.end(await readFile(file)); return
    }
    response.setHeader('content-type', 'text/html'); response.end(index)
  } catch (_error) { response.statusCode = 500; response.end('Fixture request failed') }
})
let app
let browser
try {
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const endpoint = `http://127.0.0.1:${server.address().port}`
  ctx.provide('profileContext', { dir: home, cwd: home, home })
  ctx.provide('settings', { describe: () => [], mutate: async () => {} })
  await ctx.plugin(Typert); await ctx.plugin(Gateway); await ctx.plugin(Skills)
  await ctx.plugin(Credentials, { path: credentialFile, watch: false })
  await ctx.plugin(skills, { userRoot: join(home, 'user-skills') })
  await ctx.plugin(hub, { endpoint })
  const mainFile = join(home, 'main.mjs')
  await writeFile(mainFile, `import {app,BrowserWindow,net,session} from 'electron';
    import {DesktopPromptHub,createPromptHubHostClient} from ${JSON.stringify(pathToFileURL(join(harness, 'apps/desktop/lib/types/prompt-hub.js')).href)};
    app.setPath('userData',${JSON.stringify(join(home, 'native-home'))});
    void app.whenReady().then(async()=>{
    await session.defaultSession.cookies.set({url:${JSON.stringify(endpoint)},name:'desktop-test',value:'authenticated'});
    const owner=new BrowserWindow({show:false,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}});
    await owner.loadURL('data:text/html,<h1>Desktop account fixture</h1>');
    globalThis.accountChanges=[];globalThis.openedUrls=[];
    globalThis.promptHub=new DesktopPromptHub(()=>owner,createPromptHubHostClient(()=>${JSON.stringify(endpoint)},(url,init)=>net.fetch(url,init)),
      state=>globalThis.accountChanges.push(state),async url=>{globalThis.openedUrls.push(url)});
    });
  `)
  const launch = async () => {
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
    app = await electron.launch({ executablePath, args: [mainFile], env, timeout: 20000 })
    await app.firstWindow()
    await app.evaluate(async () => {
      for (let count = 0; count < 100 && !globalThis.promptHub; count++) await new Promise(resolve => setTimeout(resolve, 20))
      if (!globalThis.promptHub) throw new Error('Native account did not initialize')
    })
  }
  browser = await chromium.launchPersistentContext(join(home, 'chrome-profile'), {
    channel: process.env.DSH_PROMPTHUB_BROWSER_CHANNEL || 'chrome', headless: true,
  })
  const website = await browser.newPage()
  const openAuthorization = async () => {
    await app.evaluate(() => { globalThis.openedUrls=[];globalThis.loginResult=globalThis.promptHub.start(); return true })
    let url
    for (let count = 0; count < 100 && !url; count++) {
      url = await app.evaluate(() => globalThis.openedUrls[0])
      if (!url) await new Promise(resolve => setTimeout(resolve, 20))
    }
    assert.ok(url, 'System-browser authorization URL was not published')
    assert.equal(url.includes(secret), false)
    await website.goto(url)
    assert.equal(app.windows().length, 1, 'Authentication must not create a website window inside Electron')
  }
  const confirm = async () => {
    await website.getByRole('button', { name: '确认登录', exact: true }).click()
    await website.getByRole('status').filter({ hasText: '登录成功' }).waitFor()
    return app.evaluate(() => globalThis.loginResult)
  }
  await launch()
  await openAuthorization()
  await website.getByRole('heading', { name: '登录如意Hub', exact: true }).waitFor()
  await website.getByRole('textbox', { name: '用户名' }).fill('fixture-user')
  await website.getByLabel('密码', { exact: true }).fill('fixture-password')
  await website.getByRole('button', { name: '登录', exact: true }).click()
  await website.getByRole('button', { name: '确认登录', exact: true }).waitFor()
  assert.equal(await ctx.credentials.readRecord(hub.sessionKey), undefined)
  assert.equal((await confirm()).status, 'signed_in')
  assert.equal(loginCount, 1)
  assert.equal((await ctx.toolboxPromptHub.account()).user.username, user.username)
  assert.match(await readFile(credentialFile, 'utf8'), /toolbox-prompthub\/session/)
  assert.equal(JSON.stringify(await app.evaluate(() => globalThis.accountChanges)).includes(secret), false)
  await app.close(); app = undefined
  await launch()
  assert.equal((await app.evaluate(() => globalThis.promptHub.state())).user.name, user.name)
  assert.equal((await app.evaluate(() => globalThis.promptHub.signOut())).status, 'signed_out')
  assert.equal(await ctx.credentials.readRecord(hub.sessionKey), undefined)
  assert.equal(await website.evaluate(() => localStorage.getItem('prompthub.token')), secret)
  await openAuthorization()
  await website.getByRole('button', { name: '确认登录', exact: true }).waitFor()
  assert.equal(await website.getByLabel('密码', { exact: true }).count(), 0)
  assert.equal((await confirm()).status, 'signed_in')
  assert.equal(loginCount, 1, 'Existing browser authentication must not require another password')
  await app.evaluate(() => globalThis.promptHub.signOut())
  await openAuthorization()
  await website.getByRole('button', { name: '确认登录', exact: true }).waitFor()
  await website.getByRole('button', { name: '取消', exact: true }).click()
  await website.getByRole('status').filter({ hasText: '已取消登录' }).waitFor()
  assert.equal((await app.evaluate(() => globalThis.loginResult)).status, 'signed_out')
  await openAuthorization()
  await website.getByRole('button', { name: '确认登录', exact: true }).waitFor()
  rejectSession = true
  await website.getByRole('button', { name: '确认登录', exact: true }).click()
  await website.getByRole('alert').filter({ hasText: '登录未完成' }).waitFor()
  assert.equal((await app.evaluate(() => globalThis.loginResult)).error, 'failed')
  assert.equal(await ctx.credentials.readRecord(hub.sessionKey), undefined)
  rejectSession = false
  await website.goto(`${endpoint}/desktop/authorize?redirect_uri=https://invalid.example/callback&state=${'x'.repeat(43)}`)
  await website.getByRole('alert').filter({ hasText: '登录请求无效' }).waitFor()
  assert.equal(await website.getByRole('button', { name: '确认登录', exact: true }).count(), 0)
  console.log('System-browser password login, existing-session confirmation, shared account, restart, cancellation and rejected sessions passed with real Chrome, Vue and Electron.')
} finally {
  await app?.close()
  await browser?.close()
  await ctx.fiber.dispose()
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve))
  hook.deregister(); await rm(home, { recursive: true, force: true })
}
