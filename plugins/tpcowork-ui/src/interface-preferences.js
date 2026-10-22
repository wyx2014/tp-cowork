/** Keep the profile menu synchronized with the application's accepted preferences. */
export function createInterfacePreferences(ctx) {
  const form = ctx.configForms.get('locale');
  const listeners = new Set();
  let disposed = false;
  let snapshot;
  const sync = () => {
    if (disposed) return;
    const locale = ctx.locale.getLocale();
    snapshot = {
      locales: locale.locales,
      localePreference: form.getSnapshot().value?.preference ?? 'system',
      themePreference: ctx.theme.getTheme().preference,
    };
    for (const listener of listeners) listener();
  };
  sync();
  const disposers = [ctx.locale.subscribe(sync), form.subscribe(sync), ctx.on('theme/change', sync)];
  return {
    source: { getSnapshot: () => snapshot, subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); } },
    refreshPreferences: sync,
    async setInterfacePreference(id) {
      if (id.startsWith('locale:')) {
        const locale = id.slice(7);
        if (locale !== 'system' && !snapshot.locales.some(item => item.id === locale)) throw new Error('Unknown locale');
        // The locale service adopts accepted form writes, including clearing the system override.
        const accepted = await (locale === 'system' ? form.unset('preference') : form.set('preference', locale));
        if (!accepted) throw new Error('Locale preference was refused');
      } else if (id.startsWith('theme:')) {
        ctx.theme.setTheme(id.slice(6));
      }
      sync();
    },
    dispose() { disposed = true; for (const dispose of disposers) dispose(); listeners.clear(); },
  };
}
