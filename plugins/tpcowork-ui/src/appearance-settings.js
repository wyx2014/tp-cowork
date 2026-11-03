/** Move existing theme and font preferences to their own appearance page. */
export function installAppearanceSettings(ctx, React, primitives) {
  const h = React.createElement;
  const t = ctx.locale.bind('tpcowork');
  const subscribe = listener => ctx.on('theme/change', listener);
  const snapshot = () => ctx.theme.getTheme();
  function Appearance() {
    const theme = React.useSyncExternalStore(subscribe, snapshot);
    const [themeMenuOpen, setThemeMenuOpen] = React.useState(false);
    const themeIcons = { light: primitives.IconLightOutlineMedium, dark: primitives.IconDarkOutlineMedium, system: primitives.IconFollowsystemOutlineMedium };
    const themeIcon = mode => h(themeIcons[mode], { size: 16, 'aria-hidden': true });
    const themeControl = h('div', { className: 'tpcowork-appearance-theme' }, h(primitives.Menu, {
      open: themeMenuOpen, onClose: () => setThemeMenuOpen(false), align: 'end', portal: true, minWidthFromAnchor: true,
      selectedId: theme.preference,
      items: ['light', 'dark', 'system'].map(mode => ({ id: mode, label: t(`appearanceTheme_${mode}`), icon: themeIcon(mode) })),
      onSelect: mode => { ctx.theme.setTheme(mode); setThemeMenuOpen(false); },
      anchor: h('button', { type: 'button', className: 'tpcowork-appearance-theme-selector', 'aria-label': t('appearanceTheme'), 'aria-haspopup': 'menu', 'aria-expanded': themeMenuOpen, onClick: () => setThemeMenuOpen(value => !value) },
        themeIcon(theme.preference), h('span', null, t(`appearanceTheme_${theme.preference}`)), h(primitives.IconChevronDownOutlineRegular, { size: 16, 'aria-hidden': true })),
    }));
    const row = (title, description, control) => h('div', { key: title, className: 'tpcowork-appearance-row' },
      h('div', { className: 'tpcowork-appearance-copy' }, h('strong', null, title), h('p', null, description)), control);
    const size = (role, min, max, label) => h('label', { className: 'tpcowork-appearance-size' },
      h('input', { key: `${role}:${theme.fontSizes[role]}`, type: 'number', min, max, step: 1,
        'aria-label': label, defaultValue: theme.fontSizes[role], onBlur: event => {
          const value = Number(event.target.value);
          if (event.target.value !== '' && Number.isInteger(value) && value >= min && value <= max) ctx.theme.setFontSize(role, value);
          else event.target.value = String(ctx.theme.getTheme().fontSizes[role]);
        }, onKeyDown: event => { if (event.key === 'Enter') event.currentTarget.blur(); } }), h('span', { 'aria-hidden': true }, 'px'));
    const family = (role, label) => h('input', { key: `${role}:${theme.fontFamilies[role]}`, type: 'text', className: 'tpcowork-appearance-font',
      'aria-label': label, placeholder: t('appearanceDefaultFont'), defaultValue: theme.fontFamilies[role],
      onBlur: event => ctx.theme.setFontFamily(role, event.target.value), onKeyDown: event => { if (event.key === 'Enter') event.currentTarget.blur(); } });
    const group = (title, description, children) => h('section', { className: 'tpcowork-appearance-group' },
      h('h2', null, title), h('p', { className: 'tpcowork-appearance-description' }, description), h('div', { className: 'tpcowork-appearance-card' }, children));
    return h('div', { className: 'tpcowork-appearance' },
      group(t('appearanceInterface'), t('appearanceInterfaceDescription'), [
        row(t('appearanceTheme'), t('appearanceThemeDescription'), themeControl),
        row(t('appearanceTextSize'), t('appearanceTextSizeDescription'), size('text', 12, 20, t('appearanceTextSize'))),
        row(t('appearanceTextFont'), t('appearanceTextFontDescription'), family('text', t('appearanceTextFont'))),
      ]),
      group(t('appearanceCode'), t('appearanceCodeDescription'), [
        row(t('appearanceCodeSize'), t('appearanceCodeSizeDescription'), size('code', 10, 16, t('appearanceCodeSize'))),
        row(t('appearanceCodeFont'), t('appearanceCodeFontDescription'), family('code', t('appearanceCodeFont'))),
      ]),
      group(t('appearanceTerminal'), t('appearanceTerminalDescription'), [
        row(t('appearanceTerminalSize'), t('appearanceTerminalSizeDescription'), size('terminal', 10, 20, t('appearanceTerminalSize'))),
        row(t('appearanceTerminalFont'), t('appearanceTerminalFontDescription'), family('terminal', t('appearanceTerminalFont'))),
      ]));
  }
  for (const id of ['appearance', 'font-size']) ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item', id, priority: -10,
  }, () => null));
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'appearance', order: 5, label: () => t('appearanceTitle'),
  }, Appearance));
}
