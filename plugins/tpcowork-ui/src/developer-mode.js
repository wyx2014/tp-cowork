/**
 * Keep Developer mode disabled across the product, clearing any persisted opt-in from earlier builds or native
 * onboarding (`ui-settings.enabled` and `ui-settings-account.developerTools`).
 * @param forms - `ctx.configForms`.
 * @returns stop observing.
 */
export function resetOnboardingDeveloperMode(forms) {
  const account = forms.get('ui-settings-account');
  const developer = forms.get('ui-settings');
  let running = false;
  const ready = form => form.getSnapshot().status === 'ready' && form.getSnapshot().writable === true;
  const check = () => {
    if (running || !ready(developer)) return;
    const devSnap = developer.getSnapshot();
    const devOn = devSnap.value?.enabled === true;
    const accOn = ready(account) && account.getSnapshot().user?.developerTools === true;
    if (!devOn && !accOn) return;
    running = true;
    // Clear the preference first so a refused write retries on the next launch.
    const clearDev = !devOn ? Promise.resolve(true)
      : (devSnap.base?.enabled === true ? developer.set('enabled', false) : developer.unset('enabled'));
    void clearDev.then(cleared => (cleared && ready(account) && account.getSnapshot().user?.developerTools === true
      ? account.unset('developerTools')
      : cleared))
      .catch(() => false).finally(() => { running = false; });
  };
  const disposers = [account.subscribe(check), developer.subscribe(check)];
  check();
  return () => { for (const dispose of disposers) dispose(); };
}

/**
 * Show the composer's turn, step, cache-hit and context-used readings only while Developer mode is on.
 * Each native pill (`conversation.composer.dock`: activity, usage) is shadowed by a wrapper over the same
 * component and injection that renders nothing otherwise; disabling the plugin restores the native pills.
 * @param ctx - plugin context with `slots` and `configForms`.
 * @param React - host React.
 * @returns stop shadowing.
 */
export function gateComposerStats(ctx, React) {
  const name = 'conversation.composer.dock';
  const enabled = ctx.configForms.developerTools.enabled;
  const Gate = entry => props => {
    const on = React.useSyncExternalStore(enabled.subscribe, enabled.getSnapshot);
    return on ? React.createElement(entry.component, props) : null;
  };
  // The context meter is hard-wired in the composer, so it is hidden by CSS keyed on this body flag.
  const flag = () => document.body.toggleAttribute('data-tpcowork-developer', enabled.getSnapshot() === true);
  const unflag = enabled.subscribe(flag);
  flag();
  const unslot = ctx.slots.inject(name, () => {
    const shadows = new Map();
    const sync = () => {
      const entries = ctx.slots.entries(name);
      for (const stat of ['activity', 'usage']) {
        const entry = entries.find(row => row.options.id === stat && (row.options.priority ?? 0) === 0);
        const held = shadows.get(stat);
        if (held?.entry === entry) continue;
        held?.dispose();
        shadows.delete(stat);
        if (entry === undefined) continue;
        shadows.set(stat, { entry, dispose: ctx.slots.register({ name, ...entry.options, priority: -10,
          locale: entry.locale, inject: entry.inject, store: entry.store }, Gate(entry)) });
      }
    };
    const stop = ctx.slots.subscribe(name, sync);
    try { sync(); } catch (error) { stop(); throw error; }
    return () => { stop(); for (const { dispose } of shadows.values()) dispose(); };
  });
  return () => { unslot(); unflag(); document.body.removeAttribute('data-tpcowork-developer'); };
}
