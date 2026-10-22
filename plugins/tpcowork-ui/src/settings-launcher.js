/** Reference-style sidebar profile, appearance menu, and independent settings button. */
export function createSettingsLauncher(React, primitives) {
  const h = React.createElement;
  const { Menu, IconSettingsOutlineMedium, IconUserOutlineMedium, IconGlobeOutlineMedium,
    IconCheckOutlineRegular, IconChevronRightOutlineMedium } = primitives;
  const glyph = path => h('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
    strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }, h('path', { d: path }));
  return function SettingsLauncher({ wide, settingsShortcut, openSettings, useTpcoworkHub, useInterfacePreferences,
    setInterfacePreference, refreshPreferences, startSignIn, cancelSignIn, signOut, refreshAccount, t }) {
    const [open, setOpen] = React.useState(false);
    const [preferenceError, setPreferenceError] = React.useState(false);
    const [saving, setSaving] = React.useState(false);
    const trigger = React.useRef(null);
    const account = useTpcoworkHub(value => value);
    const preferences = useInterfacePreferences(value => value);
    const signedIn = account.status === 'signed_in';
    const loading = account.status === 'loading';
    const busy = account.phase !== 'idle';
    const name = signedIn ? account.user?.name || account.user?.username || 'TP Cowork Hub'
      : t(loading ? 'authLoading' : 'signIn');
    const avatar = () => h('span', { className: 'tpcowork-profile-avatar', 'aria-hidden': true, 'data-loading': loading },
      signedIn ? Array.from(name.trim())[0]?.toLocaleUpperCase() : h(IconUserOutlineMedium, { size: 18 }));
    const message = preferenceError ? t('preferenceFailed')
      : account.error ? t(account.error === 'timeout' ? 'authTimeout' : 'authFailed')
      : account.phase === 'committing' ? t('authCommitting')
      : account.status === 'expired' ? t('authExpired') : null;
    const selectedLabel = (label, selected) => h('span', { className: 'tpcowork-profile-option', 'data-selected': selected },
      label, selected ? h(IconCheckOutlineRegular, { size: 16, 'aria-hidden': true }) : null);
    const submenuLabel = label => h('span', { className: 'tpcowork-profile-option' }, label,
      h('span', { className: 'tpcowork-profile-detail', 'aria-hidden': true }, h(IconChevronRightOutlineMedium, { size: 14 })));
    const select = id => {
      trigger.current?.focus();
      setOpen(false);
      setPreferenceError(false);
      if (id === 'signin') void startSignIn().then(state => { if (state.error) setOpen(true); });
      else if (id === 'cancel') void cancelSignIn();
      else if (id === 'signout') void signOut().then(state => { if (state.error) setOpen(true); });
      else {
        setSaving(true);
        void Promise.resolve().then(() => setInterfacePreference(id)).catch(() => {
          setPreferenceError(true); setOpen(true);
        }).finally(() => setSaving(false));
      }
    };
    return h('div', { className: 'tpcowork-settings-launcher', 'data-collapsed': !wide },
      h(Menu, {
        open, side: 'top', portal: true,
        className: 'tpcowork-settings-anchor', listClassName: 'tpcowork-settings-menu',
        anchor: h('button', {
          ref: trigger, type: 'button', className: 'tpcowork-settings-trigger', 'data-collapsed': !wide,
          'aria-label': `${t('accountMenu')} · ${name}`, title: wide ? undefined : name,
          'aria-haspopup': 'menu', 'aria-expanded': open,
          onClick: () => {
            if (!open) { void refreshAccount(); refreshPreferences(); setPreferenceError(false); }
            setOpen(value => !value);
          },
        }, avatar(), wide ? h('span', { className: 'tpcowork-profile-name' }, name) : null),
        items: [
          ...(signedIn ? [{ type: 'label', id: 'account', text: h('div', { className: 'tpcowork-profile-header' },
            avatar(), h('div', { className: 'tpcowork-profile-identity' },
              h('div', { className: 'tpcowork-profile-name' }, name),
              h('div', { className: 'tpcowork-profile-id', title: account.user?.id }, t('accountId', { id: account.user?.id ?? '' })))) },
          { type: 'separator', id: 'account-separator' }] : []),
          ...(message ? [{ type: 'label', id: 'account-status', text: h('span', { role: 'status' }, message) }] : []),
          { id: 'locale', label: submenuLabel(t('interfaceLanguage')), disabled: saving, icon: h(IconGlobeOutlineMedium, { size: 16 }),
            submenu: [{ id: 'locale:system', label: selectedLabel(t('systemDefault'), preferences.localePreference === 'system') },
              ...preferences.locales.map(locale => ({ id: `locale:${locale.id}`, label: selectedLabel(locale.label, preferences.localePreference === locale.id) }))] },
          { id: 'theme', label: submenuLabel(t('interfaceTheme')), disabled: saving,
            icon: glyph('M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1.4-3.4 1.5 1.5 0 0 1 1.1-2.6H18a3 3 0 0 0 3-3 9 9 0 0 0-9-9ZM7.5 10h.01M10 6.5h.01M15 6.5h.01M18 10h.01'),
            submenu: ['system', 'dark', 'light'].map(theme => ({ id: `theme:${theme}`, label: selectedLabel(t(theme === 'system' ? 'systemDefault' : `theme_${theme}`), preferences.themePreference === theme) })) },
          { type: 'separator', id: 'signin-separator' },
          ...(account.phase === 'waiting'
            ? [{ id: 'cancel', label: t('cancelSignIn'), icon: h(IconUserOutlineMedium, { size: 16 }) }]
            : [{ id: signedIn ? 'signout' : 'signin', label: t(signedIn ? 'signOut' : 'signIn'),
              disabled: busy || loading || account.status === 'unconfigured', icon: h(IconUserOutlineMedium, { size: 16 }) }]),
        ],
        onClose: () => setOpen(false), onSelect: select,
      }),
      h('button', { type: 'button', className: 'tpcowork-settings-button', 'aria-label': t('settings'),
        'aria-keyshortcuts': settingsShortcut?.aria, title: t('settings'), onClick: openSettings },
      h(IconSettingsOutlineMedium, { size: 20 })));
  };
}
