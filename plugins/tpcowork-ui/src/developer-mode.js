/** Reuse the native preference and control with product-facing wording. */
export function adaptDeveloperMode(ctx, React) {
  return ctx.slots.inject('settings.general.item', () => {
    let current;
    let dispose;
    const t = ctx.locale.bind('tpcowork');
    const sync = () => {
      const entry = ctx.slots.entries('settings.general.item').find(row => row.options.id === 'developer-tools'
        && (row.options.priority ?? 0) === 0);
      if (entry === current) return;
      current = entry;
      dispose?.();
      dispose = undefined;
      if (!entry) return;
      const Row = ({ t: upstream, ...props }) => {
        const translated = React.useCallback((key, params) => key === 'developerTools.title' ? t('developerMode')
          : key === 'developerTools.description' ? t('developerModeDescription') : upstream(key, params), [upstream]);
        return React.createElement(entry.component, { ...props, t: translated });
      };
      dispose = ctx.slots.register({ name: 'settings.general.item', ...entry.options, priority: -10,
        locale: entry.locale, inject: entry.inject, store: entry.store }, Row);
    };
    const stop = ctx.slots.subscribe('settings.general.item', sync);
    try { sync(); } catch (error) { stop(); throw error; }
    return () => { stop(); dispose?.(); };
  });
}
