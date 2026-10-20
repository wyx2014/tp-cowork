/** Adapt the upstream layout's shared root store without changing its service or actions. */
export function adaptSidebar(slots, width, defaultWidth) {
  const roots = slots.entries('root');
  if (roots.length !== 1 || typeof roots[0].store?.create !== 'function') {
    throw new Error('TP Cowork: expected one upstream layout with a shared root store');
  }
  const instance = roots[0].store.create();
  if (roots[0].store.create() !== instance || typeof instance.actions?.setSidebar !== 'function'
      || typeof instance.getSnapshot().layoutInfo?.sidebar !== 'number') {
    throw new Error('TP Cowork: the upstream layout store has changed; rebuild and verify the adapter');
  }
  let previous = instance.getSnapshot().layoutInfo.sidebar;
  if (previous === defaultWidth) {
    instance.actions.setSidebar(width);
    previous = instance.getSnapshot().layoutInfo.sidebar;
  }
  const unsubscribe = instance.subscribe(() => {
    const current = instance.getSnapshot().layoutInfo.sidebar;
    const reopened = previous === 0 && current === defaultWidth;
    previous = current;
    if (reopened) instance.actions.setSidebar(width);
  });
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    unsubscribe();
    if (instance.getSnapshot().layoutInfo.sidebar === width) {
      instance.actions.setSidebar(defaultWidth);
    }
  };
}
