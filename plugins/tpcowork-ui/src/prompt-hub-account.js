/** Bind the native website authentication bridge to the renderer's account hook. */
export function createPromptHubAccount(bridge) {
  let snapshot = { status: 'loading', phase: 'idle' };
  let active = true;
  let generation = 0;
  let started = false;
  const listeners = new Set();
  const publish = value => {
    if (!active) return;
    snapshot = value;
    for (const listener of listeners) listener();
  };
  const failed = () => ({ status: 'unavailable', phase: 'idle', error: 'failed' });
  const run = async method => {
    const revision = ++generation;
    let value;
    try { value = bridge ? await bridge[method]() : failed(); }
    catch (_error) { value = failed(); }
    if (revision === generation) publish(value);
    return value;
  };
  const unsubscribe = bridge?.subscribe(value => { generation++; publish(value); });
  void run('state');
  return {
    source: { getSnapshot: () => snapshot, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); } },
    refreshAccount: () => run('state'),
    async startSignIn() {
      started = true;
      try { return await run('start'); }
      finally { started = false; }
    },
    cancelSignIn: () => run('cancel'),
    signOut: () => run('signOut'),
    async dispose() {
      active = false;
      unsubscribe?.();
      listeners.clear();
      if (started) await bridge?.cancel();
    },
  };
}
