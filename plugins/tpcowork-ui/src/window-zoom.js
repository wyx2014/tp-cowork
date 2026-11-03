/** The reference product's (ZCode) Command/Control +, - and 0, as listed on the shortcuts page. */
export const ZOOM_BINDINGS = {
  in: [{ code: 'Equal', modifiers: ['primary'] }, { code: 'Equal', modifiers: ['primary', 'shift'] }],
  out: [{ code: 'Minus', modifiers: ['primary'] }],
  reset: [{ code: 'Digit0', modifiers: ['primary'] }],
};
/** The numeric keypad's keys work too; DSH's shortcut list has no keypad codes, so they are matched here only. */
const KEYPAD = { NumpadAdd: 'in', NumpadSubtract: 'out', Numpad0: 'reset' };

/**
 * Match one keydown to a zoom step. Primary is Command on macOS and Control elsewhere; any other modifier, apart
 * from Shift for the shifted plus, leaves the key to its owner.
 * @returns 'in' | 'out' | 'reset', or null.
 */
export function zoomAction(event, mac) {
  if (event.isComposing || event.keyCode === 229 || event.altKey) return null;
  if (mac ? !event.metaKey || event.ctrlKey : !event.ctrlKey || event.metaKey) return null;
  if (KEYPAD[event.code] && !event.shiftKey) return KEYPAD[event.code];
  for (const [action, bindings] of Object.entries(ZOOM_BINDINGS)) {
    if (bindings.some(binding => binding.code === event.code && binding.modifiers.includes('shift') === event.shiftKey)) return action;
  }
  return null;
}

/**
 * Whole-window interface zoom through the desktop main process (the browser plugin's desktop payload applies
 * 1.1^level to the window, moves the native window controls, and saves the level). The page publishes the factor
 * as --tpcowork-zoom so CSS can keep a fixed-size native area, such as the macOS traffic lights, clear.
 * @param bridge - `window.dshDesktop.browserAutomation`; without it (a plain browser) zoom stays unavailable.
 */
export function createWindowZoom(bridge, root = document.documentElement) {
  let state = { available: false, level: 0, min: -3, max: 5 };
  const listeners = new Set();
  const publish = next => {
    state = { ...state, ...next };
    root.style.setProperty('--tpcowork-zoom', String(1.1 ** state.level));
    for (const listener of [...listeners]) listener();
  };
  let queue = Promise.resolve();
  const run = action => {
    if (!bridge?.request) return Promise.resolve(state);
    // Steps apply in order, so holding the key never skips or reorders a level.
    queue = queue.then(() => bridge.request('windowZoom', { action })).then(result => {
      if (Number.isFinite(result?.level)) publish({ available: true, level: result.level, min: result.min ?? -3, max: result.max ?? 5 });
      return state;
    }, error => { console.warn('[tpcowork] interface zoom failed', error); return state; });
    return queue;
  };
  void run('get');
  return {
    source: { subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); }, getSnapshot: () => state },
    run,
    /** Capture-phase keys: a consumed key is default-prevented, so DSH's own text-size keys stand down. */
    listen(target, mac) {
      if (!bridge?.request) return () => {};
      target ??= window;
      mac ??= /Mac/u.test(navigator.platform);
      const down = event => {
        if (event.defaultPrevented || root.dataset.tpcoworkShortcutRecording !== undefined) return;
        const action = zoomAction(event, mac);
        if (action === null) return;
        event.preventDefault();
        void run(action);
      };
      target.addEventListener('keydown', down, true);
      return () => target.removeEventListener('keydown', down, true);
    },
    dispose() { listeners.clear(); root.style.removeProperty('--tpcowork-zoom'); },
  };
}
