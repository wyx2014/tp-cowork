/** Window-local visit history; native services remain the navigation owners. */
export function createNavigation({ layout, sessions, workspaces, uiWorkspace, slots }) {
  let entries = [];
  let cursor = -1;
  let queued = false;
  let disposed = false;
  let error = false;
  let snapshot = { canBack: false, canForward: false, error: false };
  const listeners = new Set();
  const mainSession = () => Object.values(sessions.list.getSnapshot().byId)
    .find(row => (row.retainedBy.mainView ?? 0) > 0)?.id;
  const current = () => {
    const panel = layout.panelInfo.getSnapshot().activePanelId;
    if (panel !== null) return { kind: 'panel', id: panel };
    const id = mainSession();
    return id === undefined ? { kind: 'empty' }
      : { kind: 'session', id, target: sessions.subagentAddress(id) ?? id };
  };
  const same = (left, right) => left?.kind === right.kind && left.id === right.id;
  const available = entry => {
    if (entry.kind === 'panel') return slots.entries('main').some(item => item.options.key === entry.id);
    if (entry.kind === 'empty') return mainSession() === undefined;
    const list = sessions.list.getSnapshot();
    const workspace = workspaces.list.getSnapshot();
    return list.byId[entry.id] !== undefined && !workspace.archivedSessionIds.includes(entry.id);
  };
  const destination = direction => {
    for (let index = cursor + direction; index >= 0 && index < entries.length; index += direction) {
      if (available(entries[index]) && !same(entries[index], entries[cursor])) return index;
    }
    return -1;
  };
  const publish = () => {
    const next = { canBack: destination(-1) !== -1, canForward: destination(1) !== -1, error };
    if (Object.keys(next).every(key => next[key] === snapshot[key])) return;
    snapshot = next;
    for (const listener of listeners) listener();
  };
  const record = () => {
    if (disposed) return;
    queued = false;
    const entry = current();
    if (!same(entries[cursor], entry)) {
      entries = [...entries.slice(0, cursor + 1), entry].slice(-50);
      cursor = entries.length - 1;
      error = false;
    }
    publish();
  };
  const schedule = () => {
    if (queued || disposed) return;
    queued = true;
    // 原生切换先 retain 新会话，再 release 旧会话并切换主面板；合并后只记录最终目标。
    queueMicrotask(() => { if (queued) record(); });
  };
  const unsubscribers = [layout.panelInfo.subscribe(schedule), sessions.list.subscribe(schedule),
    workspaces.list.subscribe(schedule), slots.subscribe('main', schedule)];
  record();
  return {
    source: {
      getSnapshot: () => snapshot,
      subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    },
    move(direction) {
      if (disposed) return;
      record();
      const index = destination(direction);
      if (index === -1) return;
      const previous = cursor;
      cursor = index;
      const entry = entries[index];
      try {
        if (entry.kind === 'session') uiWorkspace.openSession(entry.target);
        else layout.selectPanel(entry.kind === 'panel' ? entry.id : null);
        error = false;
      } catch {
        cursor = previous;
        error = true;
      }
      publish();
    },
    dispose() {
      disposed = true;
      for (const unsubscribe of unsubscribers) unsubscribe();
      listeners.clear();
      entries = [];
    },
  };
}

/** Mount beside the native sidebar toggle, including its collapsed macOS seat. */
export function createNavigationControls(React, createPortal, { Tooltip }, classes) {
  const h = React.createElement;
  return function NavigationControls({ navigation, shortcuts, t }) {
    const state = React.useSyncExternalStore(navigation.source.subscribe, navigation.source.getSnapshot);
    const commands = React.useSyncExternalStore(shortcuts.catalog.subscribe, shortcuts.catalog.getSnapshot);
    const anchor = React.useRef(null);
    const [target, setTarget] = React.useState(null);
    React.useLayoutEffect(() => {
      const frame = anchor.current?.closest(`.${classes.frame.frame}`);
      if (!frame) return;
      const locate = () => setTarget(frame.querySelector(`[data-shell-leading] .${classes.leading.controls}`)
        ?? frame.querySelector(`.${classes.sidebar.topStrip}`)
        ?? frame.querySelector(`.${classes.sidebar.logoRow}`));
      locate();
      const observer = new MutationObserver(locate);
      observer.observe(frame, { childList: true, subtree: true });
      return () => observer.disconnect();
    }, []);
    const controls = h('nav', { className: 'tpcowork-navigation', 'aria-label': t('navigation') },
      ...[[-1, 'Back', 'M19 12H5m7-7-7 7 7 7'], [1, 'Forward', 'M5 12h14m-7-7 7 7-7 7']].map(([direction, name, path]) => {
        const command = commands.find(row => row.id === `tpcowork.navigation.${name.toLowerCase()}`);
        const label = t(`navigation${name}`);
        return h(Tooltip, { key: name, label, shortcutKeys: command?.keys, side: 'bottom', delayMs: 500 },
          h('button', { type: 'button', className: 'tpcowork-navigation-button', 'aria-label': label,
            'aria-keyshortcuts': command?.aria, disabled: !state[`can${name}`],
            onClick: () => navigation.move(direction) },
          h('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
            strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }, h('path', { d: path }))));
      }),
      state.error ? h('span', { className: 'tpcowork-navigation-error', role: 'alert' }, t('navigationFailed')) : null);
    return h(React.Fragment, null, h('span', { ref: anchor, hidden: true }), target ? createPortal(controls, target) : null);
  };
}
