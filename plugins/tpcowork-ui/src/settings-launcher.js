/** Show product settings and delegate sign-in to the PromptHub website. */
export function createSettingsLauncher(React, primitives) {
  const h = React.createElement;
  const { Menu, IconEllipsisOutlineMedium, IconSettingsOutlineMedium, IconUserOutlineMedium } = primitives;
  return function SettingsLauncher({ wide, settingsShortcut, openSettings, usePromptHub, startSignIn, cancelSignIn, signOut, refreshAccount, t }) {
    const [open, setOpen] = React.useState(false);
    const trigger = React.useRef(null);
    const account = usePromptHub(value => value);
    const signedIn = account.status === 'signed_in';
    const busy = account.phase !== 'idle';
    const message = account.error ? t(account.error === 'timeout' ? 'authTimeout' : 'authFailed')
      : account.phase === 'committing' ? t('authCommitting')
      : account.status === 'expired' ? t('authExpired') : null;
    return h('div', { className: 'tpcowork-settings-launcher' },
      h(Menu, {
        open, side: 'top', portal: true, autoFocus: true,
        className: 'tpcowork-settings-anchor', listClassName: 'tpcowork-settings-menu',
        anchor: h('button', {
          ref: trigger, type: 'button', className: 'tpcowork-settings-trigger', 'data-collapsed': !wide,
          'aria-label': t('accountMenu'), 'aria-haspopup': 'menu', 'aria-expanded': open,
          onClick: () => { if (!open) void refreshAccount(); setOpen(value => !value); },
        }, h(signedIn ? IconUserOutlineMedium : IconEllipsisOutlineMedium, { size: signedIn ? 24 : 14 }),
        wide ? h('span', null, signedIn ? account.user?.name || account.user?.username || 'PromptHub' : t('more')) : null),
        items: [
          ...(message ? [{ type: 'label', id: 'account-status', text: message }] : []),
          { id: 'settings', label: t('settings'), icon: h(IconSettingsOutlineMedium, { size: 16 }),
            ...(settingsShortcut === undefined ? {} : { shortcut: settingsShortcut }) },
          ...(account.phase === 'waiting'
            ? [{ id: 'cancel', label: t('cancelSignIn'), icon: h(IconUserOutlineMedium, { size: 16 }) }]
            : [{ id: signedIn ? 'signout' : 'signin', label: t(signedIn ? 'signOut' : 'signIn'),
              disabled: busy || account.status === 'loading' || account.status === 'unconfigured', icon: h(IconUserOutlineMedium, { size: 16 }) }]),
        ],
        onClose: () => setOpen(false),
        onSelect: id => {
          setOpen(false);
          if (id === 'settings') {
            trigger.current?.focus();
            openSettings();
          } else if (id === 'signin') {
            void startSignIn().then(state => { if (state.error) setOpen(true); });
          } else if (id === 'cancel') void cancelSignIn();
          else if (id === 'signout') void signOut().then(state => { if (state.error) setOpen(true); });
        },
      }));
  };
}
