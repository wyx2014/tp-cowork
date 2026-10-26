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

/**
 * Undo the native onboarding's Developer mode for installations that ran before the product skipped it.
 * That onboarding stored `developerTools: true` in its own user layer when it found a model key; the product
 * composes it as false, so a stored true can only come from there. Clearing both fields re-inherits the
 * product defaults once: a later manual opt-in writes only the developer-tools preference and is kept.
 * @param forms - `ctx.configForms`.
 * @returns stop observing.
 */
export function resetOnboardingDeveloperMode(forms) {
  const account = forms.get('ui-settings-account');
  const developer = forms.get('ui-settings');
  let running = false;
  const ready = form => form.getSnapshot().status === 'ready' && form.getSnapshot().writable;
  const check = () => {
    if (running || !ready(account) || !ready(developer) || account.getSnapshot().user?.developerTools !== true) return;
    running = true;
    // The preference goes first, so a refused write leaves the marker for the next launch to retry.
    void developer.unset('enabled').then(cleared => cleared && account.unset('developerTools'))
      .catch(() => false).finally(() => { running = false; });
  };
  const disposers = [account.subscribe(check), developer.subscribe(check)];
  check();
  return () => { for (const dispose of disposers) dispose(); };
}
