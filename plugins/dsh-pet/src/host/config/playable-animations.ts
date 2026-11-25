import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { BUILTIN_WEBM_DIRECTORY } from '../../shared/constants.ts';
import type { Animations, Events, EventSlot } from '../../shared/types.ts';
import type { ConfigPaths } from './constants.ts';

/** 按主宠物素材路由的目录优先级收集可播放动作。 */
export function mainAnimationFiles(paths: ConfigPaths): Set<string> {
  const own = join(paths.petDir, 'main-animation');
  const custom = join(dirname(paths.userFile), 'main-animation');
  const builtIn = dirname(paths.defaultFile);
  const directories = existsSync(own)
    ? [own]
    : [join(custom, 'webm'), join(custom, 'mov'), join(builtIn, BUILTIN_WEBM_DIRECTORY), join(builtIn, 'mov')];
  const available = new Set<string>();
  for (const directory of directories) {
    try {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (!entry.isFile() && !(entry.isSymbolicLink() && existsSync(join(directory, entry.name)))) continue;
        if (/\.(?:webm|mov)$/u.test(entry.name)) available.add(entry.name.replace(/\.(?:webm|mov)$/u, ''));
      }
    } catch {
      // 自定义素材目录可能不存在；继续扫描其余目录。
    }
  }
  return available;
}

/** 清理旧配置的缺失动作；事件档位用同位置的默认素材补齐，避免后续索引错位。 */
export function playableAnimations(
  animations: Animations,
  defaults: Animations,
  available: ReadonlySet<string>,
): Animations {
  const keep = (names: string[]) => names.filter((name) => available.has(name));
  const playableSlot = (slot: EventSlot | undefined): EventSlot | undefined => {
    if (typeof slot === 'string') return available.has(slot) ? slot : undefined;
    const names = keep(slot ?? []);
    return names.length ? names : undefined;
  };
  const events: Events = {};
  for (const [event, slots] of Object.entries(animations.events)) {
    const fallback = defaults.events[event];
    const selected = slots.map((slot, index) => playableSlot(slot) ?? playableSlot(fallback?.[index]));
    if (selected.every((slot): slot is EventSlot => slot !== undefined)) events[event] = selected;
  }

  const idle = keep(animations.idle);
  const defaultIdle = keep(defaults.idle);
  const idleSequential = idle.length ? animations.idleSequential : defaults.idleSequential;
  const sleep = animations.sleep
    ?.map((set) => ({ start: keep(set.start), loop: keep(set.loop), end: keep(set.end) }))
    .filter((set) => set.start.length && set.loop.length && set.end.length);

  return {
    idle: idle.length ? idle : defaultIdle.length ? defaultIdle : [...available].sort().slice(0, 1),
    ...(idleSequential === undefined ? {} : { idleSequential }),
    turn: keep(animations.turn),
    drag: keep(animations.drag),
    clicks: keep(animations.clicks),
    moves: {
      ...animations.moves,
      actions: animations.moves.actions.filter((action) => action && available.has(action.name)),
    },
    categories: animations.categories
      .filter((category) => category && Array.isArray(category.actions))
      .map((category) => ({ ...category, actions: keep(category.actions) }))
      .filter((category) => category.actions.length > 0),
    events,
    ...(sleep?.length ? { sleep } : {}),
    ...(animations.baifan?.every((name) => available.has(name)) ? { baifan: animations.baifan } : {}),
  };
}
