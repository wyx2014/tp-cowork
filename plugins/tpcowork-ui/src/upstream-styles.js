/** Compile scoped overrides against the upstream CSS Modules class maps. */
export function upstreamStyles(modules) {
  const scope = 'html body[data-tpcowork-ui]';
  const mac = 'html[data-platform="darwin"] body[data-tpcowork-ui]';
  const className = (module, local) => {
    const name = modules[module]?.[local];
    if (typeof name !== 'string') {
      throw new Error(`TP Cowork: upstream CSS class ${module}.${local} is missing`);
    }
    return name;
  };
  const selector = (module, local, prefix = scope) => `${prefix} .${className(module, local)}`;
  const rules = [];
  const expanded = prefix => `${prefix} .${className('sidebar', 'root')}:not(.${className('sidebar', 'collapsed')})`;
  const rule = (module, local, declarations, prefix) => {
    rules.push(`${selector(module, local, prefix)} { ${declarations} }`);
  };
  // Panel rows inherit the sidebar size; include the UI delta as the New Session button does.
  rule('sidebar', 'root', 'font-size: calc(var(--dsh-sidebar-font-size, 14px) + var(--dsh-content-font-delta, 0px));');
  rule('sidebar', 'logoRow', 'height: var(--dsh-sidebar-brand-height); padding: var(--dsh-sidebar-brand-padding);');
  rule('sidebar', 'brandMark', 'display: var(--dsh-sidebar-brand-mark-display);');
  rule('sidebar', 'brandName', 'font-weight: var(--dsh-sidebar-brand-weight);');
  // The macOS traffic lights end at x 68 and do not scale with interface zoom (--tpcowork-zoom), so the controls
  // beside them keep 68 window pixels clear plus a 20px gap that does scale.
  const lights = 'calc(68px / var(--tpcowork-zoom, 1) + 20px)';
  rule('sidebar', 'topStrip', `justify-content: flex-start; padding-left: ${lights}; gap: 4px;`, mac);
  rule('frame', 'leadingSeat', `left: ${lights};`, 'html[data-platform="darwin"]:not([data-fullscreen]) body[data-tpcowork-ui]');
  rule('sidebar', 'topStrip', 'padding-left: 12px;', 'html[data-platform="darwin"][data-fullscreen] body[data-tpcowork-ui]');
  rule('leading', 'controls', 'gap: 4px;');
  rules.push(`${selector('leading', 'iconButton')}:last-of-type { order: 1; }`);
  const web = 'html:not([data-platform="darwin"]):not([data-windows-titlebar]) body[data-tpcowork-ui]';
  rule('sidebar', 'logoRow', 'height: auto; min-height: 72px; flex-wrap: wrap; justify-content: flex-start; gap: 4px;', expanded(web));
  rule('sidebar', 'brand', 'order: 1; flex-basis: 100%; margin-top: 4px;', expanded(web));
  rules.push(`${web} .${className('sidebar', 'collapsed')} .${className('sidebar', 'logoRow')} { height: auto; flex-direction: column; gap: 4px; }`);
  rules.push(`${web} .${className('sidebar', 'collapsed')} .tpcowork-navigation { flex-direction: column; }`);
  rule('sidebar', 'newSession', 'left: 108px;', 'html[data-windows-titlebar] body[data-tpcowork-ui] .' + className('sidebar', 'collapsed'));
  rule('frame', 'frame', '--dsh-frame-leading-clearance: calc(68px / var(--tpcowork-zoom, 1) + 156px);', mac + ':has([data-shell-leading])');
  rule('frame', 'frame', '--dsh-frame-leading-clearance: 148px;', 'html[data-platform="darwin"][data-fullscreen] body[data-tpcowork-ui]:has([data-shell-leading])');
  rule('sidebar', 'newSession', `justify-content: var(--dsh-sidebar-action-align);
    height: var(--dsh-sidebar-action-height); padding: var(--dsh-sidebar-action-padding);
    margin: var(--dsh-sidebar-action-margin); border-style: var(--dsh-sidebar-action-border-style);
    border-radius: var(--dsh-sidebar-action-radius); background: var(--dsh-sidebar-action-fill);`, expanded(scope));
  rules.push(`${selector('sidebar', 'newSession', expanded(scope))}:hover { background: var(--dsh-sidebar-action-hover); }`);
  rule('sidebar', 'newSession', 'background: var(--dsh-sidebar-action-fill);', expanded(mac));
  rules.push(`${selector('sidebar', 'newSession', expanded(mac))}:hover { background: var(--dsh-sidebar-action-hover); }`);
  rule('sidebar', 'newSessionContent', 'justify-content: var(--dsh-sidebar-action-align); gap: var(--dsh-sidebar-action-gap);', expanded(scope));
  rules.push(`${selector('sidebar', 'newSession')}, ${selector('sidebar', 'panelRow')} { color: var(--dsw-alias-label-primary); font-weight: 400; }`);
  rules.push(`${selector('sidebar', 'newSessionContent')} svg, ${selector('sidebar', 'panelGlyph')} svg { color: inherit; }`);
  rule('sidebar', 'panelList', 'gap: var(--dsh-sidebar-panels-gap); margin-bottom: var(--dsh-sidebar-panels-margin);');
  rule('sidebar', 'panelRow', `min-height: var(--dsh-sidebar-panel-height);
    padding: var(--dsh-sidebar-panel-padding); border-radius: var(--dsh-sidebar-action-radius);`);
  rule('frame', 'sidebarCol', 'background: var(--dsh-sidebar-material);', mac);
  // Desktop windows lay the main area out as the reference product's (ZCode) raised panel on the sidebar's ground:
  // a rounded, bordered conversation column 4px from the top, right and bottom edges, whose top strip still drags
  // the window, and an open side panel as a second such panel 4px to its right. The browser build and the
  // Windows caption layout keep their own frames.
  const desktop = ':is(html[data-platform="darwin"], html[data-platform="linux"]) body[data-tpcowork-ui]';
  const frame = `${desktop} .${className('frame', 'frame')}`;
  const panel = 'margin: 4px 4px 4px 0; box-sizing: border-box; border: 1px solid var(--dsw-alias-border-l3); border-radius: 12px; overflow: hidden; background: var(--dsw-alias-bg-base);';
  rules.push(`${frame} { background: var(--dsh-sidebar-material); }`);
  rules.push(`${frame}::before { content: ''; position: absolute; z-index: 1; inset: 0 0 auto; height: 4px; -webkit-app-region: drag; }`);
  rules.push(`${frame} > .${className('frame', 'sidebarCol')} { border-right: none; }`);
  rules.push(`${frame} > .${className('frame', 'centerCol')} { ${panel} }`);
  rules.push(`${frame} > .${className('frame', 'bottomRow')} { background: transparent; }`);
  // The panel box keeps the column's inline width, so its body takes the 4px gap on the left instead.
  const sidePanel = `${frame} .${className('sidebarRight', 'panel')}[data-sidebar-right-panel="push"][data-sidebar-right-open]`;
  rules.push(`${sidePanel} { top: 4px; right: 4px; bottom: 4px; }`);
  rules.push(`${sidePanel} > .${className('sidebarRight', 'panelBody')} { ${panel} margin: 0 0 0 4px; }`);
  // The header keeps its title row level with the traffic lights and the sidebar's top strip.
  rules.push(`${frame} .${className('conversation', 'header')} { min-height: 71px; padding-top: 5px; }`);
  // The home measures from the window top: the panel's 4px inset and border above that 71px header.
  rules.push(`${frame} { --tpcowork-home-chrome: 76px; }`);
  // Windows keeps its own frame, whose padding puts the caption row above the 40px header; count it the same way.
  rules.push(`html[data-windows-titlebar] body[data-tpcowork-ui] .${className('frame', 'frame')} { --tpcowork-home-chrome: calc(40px + var(--dsh-windows-titlebar-height, 0px)); }`);
  // ZCode uses compact, regular-weight navigation with neutral selected surfaces.
  rules.push(`${selector('sidebar', 'panelRow', expanded(scope))} { gap: 8px; }`);
  rules.push(`${selector('sidebar', 'panelGlyph', expanded(scope))} svg, ${selector('sidebar', 'newSessionContent', expanded(scope))} svg { width: 16px; height: 16px; }`);
  rule('hero', 'stack', 'gap: var(--dsh-hero-gap); max-width: var(--dsh-hero-width);');
  rule('hero', 'titleGroup', 'display: none;');
  rule('hero', 'fishHitbox', 'flex: 1; min-width: 0; max-width: 100%;');
  // Home: the greeting, workspace row, composer and task suggestions share one centered column of 82% (at most
  // 880px); the greeting starts on the composer card's left edge.
  // The skyline's waterline sits at about 49% of the column height, so the greeting block reserves the space down
  // to half the window: the composer card starts on the water and never covers the buildings. The header (40px, or
  // the desktop panel's 76px),
  // the 28px workspace row and its two 8px gaps complete that height. The greeting sits at the bottom of that
  // space, just above the workspace row, so no gap opens between them on tall windows. A fixed inset keeps the
  // suggestions' height from pushing the composer up.
  const home = `${scope} [data-conversation-content][data-content-phase="hero"]`;
  rules.push(`${home} { --tpcowork-home-top: clamp(48px, 8vh, 88px); --tpcowork-home-column: clamp(min(100%, 600px), 82%, 880px); }`);
  rules.push(`${home} .${className('conversation', 'scrollBody')} {
    justify-content: flex-start; padding-top: var(--tpcowork-home-top); box-sizing: border-box; scrollbar-width: none;
  }`);
  // Short windows can still scroll the home, but without a scrollbar track beside the skyline.
  rules.push(`${home} .${className('conversation', 'scrollBody')}::-webkit-scrollbar { display: none; }`);
  // The card otherwise follows the transcript width (64% of the column, 680-920px), which matches this 82% column
  // only at some window sizes; elsewhere it centers inside it and the workspace chip sticks out to its left.
  rules.push(`${home} .${className('conversation', 'composerHero')} {
    box-sizing: border-box; width: 100%; padding: 0 clamp(32px, 5.5%, 80px) 32px; align-items: center;
    --dsh-composer-card-max-width: 100%;
  }`);
  rules.push(`${home} .${className('conversation', 'composerHero')} > .${className('hero', 'root')} {
    align-self: center; justify-content: flex-start; box-sizing: border-box; width: var(--tpcowork-home-column); max-width: 100%;
    padding: 0 0 28px; margin: 0; min-height: calc(50vh - var(--tpcowork-home-chrome, 40px) - var(--tpcowork-home-top) - 44px); align-items: flex-end;
  }`);
  // The stack's gap would also open below the greeting, before an empty slot.
  rules.push(`${home} .${className('hero', 'stack')} { max-width: none; gap: 0; }`);
  rules.push(`${home} .${className('conversation', 'heroWorkspaceRow')} { padding-left: 0; }`);
  rules.push(`${home} .${className('hero', 'headline')} { justify-content: flex-start; }`);
  // Descendants, not children: the composer card sits inside a display:contents slot wrapper.
  rules.push(`${home} .${className('conversation', 'composerHero')} :is(.${className('conversation', 'heroWorkspaceRow')}, .${className('input', 'root')}, .tp-task-suggestions) {
    box-sizing: border-box; width: var(--tpcowork-home-column); max-width: 100%;
  }`);
  rules.push(`${home} .${className('input', 'card')} { --dsw-elevation-stroke-color: var(--tpcowork-home-card-stroke);
    box-shadow: var(--dsw-elevation-soft), var(--tpcowork-home-card-glow); }`);
  // Entrance whenever the home appears: the greeting fades in, then the workspace row and composer, then the
  // suggestions. Opacity only, so nothing moves while the layout settles. Under the startup cover it waits and starts as
  // the cover fades, continuing from the splash; reduced motion skips it.
  const entering = [
    ['.tpcowork-hero-greeting', 0],
    [`.${className('conversation', 'composerHero')} :is(.${className('conversation', 'heroWorkspaceRow')}, .${className('input', 'root')})`, 120],
    ['.tp-task-suggestions', 240],
  ];
  rules.push('@keyframes tpcowork-home-enter { from { opacity: 0; } }');
  rules.push(`@media (prefers-reduced-motion: no-preference) {
    ${entering.map(([target, delay]) => `${home} ${target} { animation: tpcowork-home-enter 360ms ease-out ${delay}ms both; }`).join('\n    ')}
    ${scope}:has(#dsh-startup):not(.dsh-startup-ready) [data-content-phase="hero"] :is(${entering.map(([target]) => target).join(', ')}) { animation-play-state: paused; }
  }`);
  // The skyline covers the whole conversation column, header included: it sits top right and fades out to
  // the left, and its water continues under the composer. It stays a faded backdrop behind the greeting.
  const backdrop = `${selector('conversation', 'root')}[data-phase="hero"]`;
  rules.push(`${backdrop} { position: relative; isolation: isolate; background: var(--tpcowork-home-wash); }`);
  rules.push(`${backdrop}::before, ${backdrop}::after { position: absolute; z-index: -1; content: ''; pointer-events: none; }`);
  rules.push(`${backdrop}::before { inset: 0; background: var(--tpcowork-home-art) right top / auto 82% no-repeat;
    mask-image: linear-gradient(90deg, transparent 10%, #000 48%, #000); opacity: var(--tpcowork-home-art-opacity); }`);
  rules.push(`${backdrop}::after { inset: 49% 0 0; background: var(--tpcowork-home-art) right bottom / 100% 275% no-repeat;
    mask-image: linear-gradient(180deg, transparent, #000 32%); opacity: var(--tpcowork-home-art-opacity); }`);
  rule('input', 'root', 'padding: var(--dsh-composer-padding);');
  // Keep a breathing space below the chat card when the developer footer is absent.
  rules.push(`${scope}:not([data-tpcowork-developer]) .${className('input', 'root')}:not(.${className('input', 'hero')}) { padding-bottom: max(20px, env(safe-area-inset-bottom, 0px)); }`);
  rule('input', 'card', `gap: var(--dsh-composer-gap); padding-top: var(--dsh-composer-top-padding);
    border-radius: var(--dsh-composer-radius);`);
  rules.push(`${selector('input', 'cardWorkspaceTrigger')}::after { border-radius: var(--dsh-composer-radius); }`);
  rule('input', 'input', 'padding: var(--dsh-composer-editor-padding);');
  rules.push(`${selector('input', 'root')}:not(.${className('input', 'hero')}) .${className('input', 'input')}
    { min-height: var(--dsh-composer-min-height); }`);
  rule('input', 'placeholder', 'inset: var(--dsh-composer-placeholder-inset);');
  rule('input', 'row', 'padding: var(--dsh-composer-toolbar-padding);');
  rule('input', 'add', 'background: var(--dsh-composer-attach-fill); color: var(--dsh-composer-attach-ink);');
  rule('input', 'primary', `width: var(--dsh-composer-submit-size); height: var(--dsh-composer-submit-size);
    background: var(--dsh-composer-submit-fill); color: var(--dsh-composer-submit-ink);
    transform: var(--dsh-composer-submit-transform);`);
  rules.push(`${selector('input', 'primary')}:hover:not(:disabled) { background: var(--dsh-composer-submit-hover); }`);
  // The context meter is not a slot; the developer flag on body (set by gateComposerStats) decides its visibility.
  rules.push(`${scope}:not([data-tpcowork-developer]) .${className('meter', 'root')} { display: none; }`);
  rule('chat', 'bubble', 'border: var(--dsh-chat-user-border); border-radius: var(--dsh-chat-user-radius);');
  rule('plugins', 'cardDesc', 'display: block; -webkit-line-clamp: unset; overflow: visible; overflow-wrap: anywhere; line-height: 20px;',
    `${scope} [data-plugin-package^="@tpcowork/"]`);
  // Settings opens as a full-window page with the reference product's (ZCode) measurements instead of a centered
  // dialog over a mask: a sidebar-colored column whose top returns to the workspace, an inset rounded content panel
  // with a 48px header, the active section's title, and setting rows grouped in cards. Only styles change; the DSH
  // settings components and their slots stay as they are.
  rule('settings', 'overlay', 'top: var(--dsh-frame-chrome-top, 0px); align-items: stretch; justify-content: stretch;');
  rule('settings', 'mask', 'display: none;');
  rule('settings', 'panel', 'width: 100%; max-width: none; height: 100%; border-radius: 0; box-shadow: none; background: var(--dsw-specific-sidebar-fill);');
  rule('settings', 'nav', 'width: 268px; gap: 0; padding: 112px 8px 12px; background: transparent;');
  rule('settings', 'navTitle', 'display: none;');
  rules.push(`${selector('settings', 'triggerRow', expanded(scope))} { width: 236px; max-width: 100%; margin: 4px 0 6px 4px; }`);
  rule('settings', 'navList', 'gap: 4px; flex: 1; min-height: 0;');
  rule('settings', 'nav', 'position: relative;');
  // Its ghost buttons draw no focus ring, so neither do the navigation rows and the back control here.
  rule('settings', 'navCell', 'height: 32px; padding: 0 10px; gap: 8px; border-radius: 12px; font-size: 14px; line-height: 20px; color: var(--dsw-alias-label-primary); outline: none; transition: background-color 150ms;');
  rules.push(`${selector('settings', 'navCell')}:hover { background: var(--dsw-alias-interactive-bg-hover); }`);
  rules.push(`${selector('settings', 'navCell')}.${className('settings', 'active')} { background: color-mix(in srgb, var(--dsw-alias-label-primary) 8%, transparent); }`);
  rule('settings', 'close', 'position: absolute; z-index: 1; top: 64px; left: 12px; width: 244px; height: 32px; justify-content: flex-start; gap: 8px; padding: 0 6px; border-radius: 12px; box-shadow: none; outline: none; font-size: 14px; line-height: 20px; color: var(--dsw-alias-label-secondary); transition: background-color 150ms, color 150ms;');
  rules.push(`${selector('settings', 'close')}:hover { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-interactive-bg-hover); }`);
  rules.push(`${selector('settings', 'close')} > svg { display: none; }`);
  rules.push(`${scope} [data-tpcowork-settings-chrome] .${className('settings', 'close')} { display: none; }`);
  // The 64px/112px offsets clear the macOS traffic lights. The Windows overlay already starts below its caption row.
  const windowsSettings = 'html[data-windows-titlebar] body[data-tpcowork-ui]';
  rule('settings', 'nav', 'padding-top: 60px;', windowsSettings);
  rule('settings', 'close', 'top: 12px;', windowsSettings);
  rules.push(`${windowsSettings} .tpcowork-settings-back-target { top: 12px; }`);
  const arrow = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m12 19-7-7 7-7'/%3E%3Cpath d='M19 12H5'/%3E%3C/svg%3E") center / contain no-repeat`;
  rules.push(`${selector('settings', 'close')}::before { content: ''; flex: none; width: 16px; height: 16px; background: currentColor; -webkit-mask: ${arrow}; mask: ${arrow}; }`);
  rules.push(`${selector('settings', 'close')} .${className('settings', 'hiddenLabel')} { position: static; width: auto; height: auto; overflow: hidden; clip: auto; text-overflow: ellipsis; }`);
  // The back control is positioned against the panel, so the content column must not become its containing block.
  rule('settings', 'content', 'margin: 4px 4px 4px 0; border: 1px solid var(--dsw-alias-border-l3); border-radius: 12px; overflow: hidden; background: var(--dsw-alias-bg-base);');
  rule('settings', 'header', 'height: 48px; align-items: center; padding: 0 12px;');
  // Archived sessions never return to the sidebar, as in the reference product; they live in Settings › Archive management.
  // The view menu ends with the archive filter: separator, heading, then hide / show / only archived.
  rules.push(`${selector('browser', 'viewOptionsMenu')} > [role="presentation"] > :nth-last-child(-n+5) { display: none; }`);
  rule('settings', 'options', 'padding: 0 max(32px, calc((100% - 832px) / 2)) 40px;');
  // The title comes from the active navigation row, published as --tpcowork-settings-title by the plugin. A section
  // that draws its own heading row (such as Usage stats with its tab pill) opts out with data-tpcowork-own-title.
  rules.push(`${selector('settings', 'options')}:not(:has([data-tpcowork-own-title]))::before { content: var(--tpcowork-settings-title, ''); display: block; margin: 0 0 32px; font-size: 30px; line-height: 36px; font-weight: 600; letter-spacing: -0.025em; color: var(--dsw-alias-label-primary); }`);
  // General rows form the reference product's separate cards; the plugin's break rows mark where one card ends.
  const generalRow = `${selector('general', 'section')} > [data-slot='settings.general.item'] > *`;
  rules.push(`${generalRow} { padding: 12px 16px; background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l3); border-top: none; }`);
  rules.push(`${generalRow}:first-child, ${generalRow}.tpcowork-general-break + * { border-top: 1px solid var(--dsw-alias-border-l3); border-radius: 12px 12px 0 0; }`);
  rules.push(`${generalRow}:last-child, ${generalRow}:has(+ .tpcowork-general-break) { border-radius: 0 0 12px 12px; }`);
  rules.push(`${generalRow}:first-child:last-child, ${generalRow}.tpcowork-general-break + :is(:last-child, :has(+ .tpcowork-general-break)), ${generalRow}:first-child:has(+ .tpcowork-general-break) { border-radius: 12px; }`);
  rules.push(`${generalRow}:is(.tpcowork-general-break, .tpcowork-general-summary) { padding: 0; border: none; border-radius: 0; background: none; }`);
  rules.push(`${generalRow}.tpcowork-general-break { height: 16px; }`);
  // The reference summary row sits 16px under the page title and 24px above the first card.
  rules.push(`${generalRow}.tpcowork-general-summary { display: flex; flex-wrap: wrap; gap: 8px; margin: -16px 0 24px; }`);
  rules.push(`${generalRow}.tpcowork-general-summary + * { border-top: 1px solid var(--dsw-alias-border-l3); border-radius: 12px 12px 0 0; }`);
  rules.push(`${generalRow}.tpcowork-general-summary + :is(:last-child, :has(+ .tpcowork-general-break)) { border-radius: 12px; }`);
  // Row copy in the reference sizes: 14px medium titles, 14px/24px subtle descriptions 4px below.
  const titles = [['preferenceRow', 'title'], ['permissionRow', 'title'], ['languageRow', 'title'], ['developerRow', 'title'], ['enterRow', 'title']];
  const descriptions = [['preferenceRow', 'desc'], ['permissionRow', 'desc'], ['developerRow', 'description'], ['enterRow', 'desc']];
  rules.push(`${titles.map(([module, local]) => `${generalRow} .${className(module, local)}`).join(', ')} { font-size: 14px; line-height: 20px; font-weight: 500; color: var(--dsw-alias-label-primary); }`);
  rules.push(`${descriptions.map(([module, local]) => `${generalRow} .${className(module, local)}`).join(', ')} { margin-top: 0; font-size: 14px; line-height: 24px; color: var(--tpcowork-settings-subtle); }`);
  for (const module of ['preferenceRow', 'permissionRow', 'languageRow', 'enterRow']) rules.push(`${generalRow} .${className(module, 'rowText')} { gap: 4px; }`);
  // The font group lays its rows out directly, so its rows take the card row padding and dividers instead.
  rules.push(`${selector('general', 'section')} > [data-slot='settings.general.item'] > .${className('fontGroup', 'group')} { padding: 0; }`);
  rules.push(`${selector('fontGroup', 'group')} > * { padding: 12px 16px; border-bottom: 1px solid var(--dsw-alias-border-l3); }`);
  rules.push(`${selector('fontGroup', 'group')} > :last-child { border-bottom: none; }`);
  rule('models', 'section', 'max-width: none;');
  rule('models', 'title', 'display: none;');
  const model = local => `.tpcowork-model-settings .${className('models', local)}`;
  rules.push(`${model('intro')}, ${model('addActions')}, ${model('rowTag')} { display: none; }`);
  rules.push(`${model('rows')} { grid-column: 2; margin: 0; padding: 24px; gap: 0; }`);
  rules.push(`${model('addBlock')} { grid-column: 2; padding: 24px; }`);
  rules.push(`${model('addCard')} { gap: 24px; }`);
  rules.push(`${model('addPanel')} { gap: 16px; }`);
  rules.push(`${model('savedNotice')}, ${model('notice')} { grid-column: 2; padding: 0 24px; }`);
  rules.push(`${model('rowCard')}:not([data-tp-selected='true']):not(:has(.${className('models', 'editor')})) { display: none; }`);
  rules.push(`.tpcowork-model-settings[data-adding='true']  .${className('models', 'rows')} { display: none; }`);
  rules.push(`.tpcowork-model-settings[data-managed='true'] .${className('models', 'rows')}, .tpcowork-model-settings[data-managed='true'] .${className('models', 'addBlock')} { display: none; }`);
  rules.push(`${model('rowCard')}, ${model('setupCard')}, ${model('addCard')}, ${model('editor')} { border: none; border-radius: 0; padding: 0; background: transparent; }`);
  rules.push(`${model('rowCard')} { position: relative; }`);
  rules.push(`${model('rowHead')} { position: absolute; top: 0; right: 0; z-index: 1; justify-content: flex-end; }`);
  rules.push(`${model('rowIdentity')}, ${model('rowActions')} .${className('models', 'secondaryButton')} { display: none; }`);
  rules.push(`${model('editor')} { gap: 16px; }`);
  rules.push(`${model('editorTitle')} { font-size: 16px; line-height: 24px; font-weight: 600; }`);
  rules.push(`${model('fieldLabel')} { font-size: 14px; line-height: 20px; font-weight: 400; }`);
  rules.push(`${model('input')} { min-height: 32px; border: 1px solid var(--dsw-alias-border-l3); border-radius: 8px; background-color: var(--dsw-alias-bg-layer-1); }`);
  rules.push(`${model('customized')} { border: 0; padding: 0; margin: 0; }`);
  rules.push(`${model('customizedSummary')} { display: none; }`);
  rules.push(`${model('customized')}, ${model('customizedBody')}, ${model('customized')}::details-content { display: contents; }`);
  rules.push(`${model('editorHeader')} { order: 0; min-height: 28px; }`);
  rules.push(`.tpcowork-model-settings [data-tp-model-field='baseUrl'] { order: 1; }`);
  rules.push(`.tpcowork-model-settings [data-tp-model-field='customApi'] { order: 2; }`);
  rules.push(`.tpcowork-model-settings [data-tp-model-field='keyInput'] { order: 3; }`);
  rules.push(`.tpcowork-model-settings [data-tp-model-field='customDisplayName'] { order: 4; }`);
  rules.push(`${model('modelCatalog')} { order: 5; }`);
  rules.push(`${model('editorActions')} { order: 6; }`);
  const managed = `.tpcowork-model-settings [data-tp-readonly='true']`;
  rules.push(`${managed} .${className('models', 'rowActions')}, ${managed} .${className('models', 'editorActions')}, ${managed} .${className('models', 'addModelButton')}, ${managed} .${className('models', 'iconButton')}, ${managed} .${className('models', 'linkButton')} { display: none; }`);

  rules.push(`.tpcowork-model-settings[data-adding='true'] .${className('models', 'addModelButton')} { display: none; }`);
  rules.push(`${model('selectInput')} { width: 100%; max-width: none; }`);
  rules.push(`${model('primaryButton')}, ${model('secondaryButton')}, ${model('dangerButton')}, ${model('addModelButton')} { height: 28px; padding: 0 8px; border-radius: 6px; }`);

  // Agent presets read like the other settings pages: the page title only, the intro as its subtitle, and the built-in
  // presets as one bordered list of rows with a radio marking the new-task default. The custom group and its Creator
  // entry are not offered; a group is custom when it holds none of the built-in presets.
  const preset = local => selector('agentPreset', local);
  const builtIn = ['standard', 'ptc', 'minimal', 'cordis'].map(id => `[data-agent-preset-id='${id}']`).join(', ');
  const presetRow = preset('card');
  rules.push(`${preset('section')} { max-width: none; gap: 0; }`);
  rules.push(`${preset('title')}, ${preset('groupHead')}, ${preset('cardId')}, ${preset('creatorButton')} { display: none; }`);
  rules.push(`${preset('group')}:has(.${className('agentPreset', 'creatorButton')}), ${preset('group')}:not(:has(${builtIn})) { display: none; }`);
  rules.push(`${preset('intro')} { margin: -16px 0 24px; font-size: 14px; line-height: 24px; color: var(--dsw-alias-label-secondary); }`);
  rules.push(`${preset('error')} { margin: 0 0 16px; font-size: 14px; line-height: 20px; }`);
  rules.push(`${preset('group')} + .${className('agentPreset', 'group')} { margin-top: 0; }`);
  rules.push(`${preset('cards')} { display: flex; flex-direction: column; gap: 0; }`);
  rules.push(`${presetRow} { position: relative; flex-direction: row; align-items: center; gap: 16px; padding-right: 16px; border: 1px solid var(--dsw-alias-border-l3); border-top: none; border-radius: 0; background: var(--dsw-alias-bg-layer-1); }`);
  rules.push(`${presetRow}:first-child { border-top: 1px solid var(--dsw-alias-border-l3); border-radius: 12px 12px 0 0; }`);
  rules.push(`${presetRow}:last-child { border-radius: 0 0 12px 12px; }`);
  rules.push(`${presetRow}:first-child:last-child { border-radius: 12px; }`);
  rules.push(`${presetRow}.${className('agentPreset', 'cardActive')}, ${presetRow}.${className('agentPreset', 'cardBroken')} { border-color: var(--dsw-alias-border-l3); background: var(--dsw-alias-bg-layer-1); }`);
  rules.push(`${presetRow}:hover:not(.${className('agentPreset', 'cardActive')}):not(.${className('agentPreset', 'cardBroken')}) { background: linear-gradient(var(--dsw-alias-interactive-bg-hover), var(--dsw-alias-interactive-bg-hover)) var(--dsw-alias-bg-layer-1); }`);
  rules.push(`${preset('cardMain')} { position: relative; min-width: 0; min-height: 74px; justify-content: center; gap: 6px; padding: 12px 0 12px 48px; border-radius: inherit; }`);
  // The radio is drawn on the row's own button, so it stays the one control that sets the default.
  rules.push(`${preset('cardMain')}::before { content: ''; position: absolute; left: 16px; top: 50%; width: 16px; height: 16px; margin-top: -8px; box-sizing: border-box; border: 1.5px solid var(--dsw-alias-border-l4); border-radius: 50%; corner-shape: round; background: var(--dsw-alias-bg-layer-1); transition: border-color 150ms, border-width 150ms; }`);
  rules.push(`${preset('cardMain')}:not(:disabled):not([aria-disabled='true']):hover::before { border-color: var(--dsw-alias-label-tertiary); }`);
  rules.push(`${preset('cardActive')} > .${className('agentPreset', 'cardMain')}::before { border: 5px solid var(--dsw-alias-label-primary); }`);
  rules.push(`${preset('cardBroken')} > .${className('agentPreset', 'cardMain')}::before { border-style: dashed; opacity: .5; }`);
  rules.push(`${preset('cardHead')} { align-items: center; }`);
  rules.push(`${preset('cardName')} { font-size: 14px; line-height: 20px; font-weight: 600; }`);
  // Only the default keeps its tag; every remaining row is built in, so a 内置 tag on each would say nothing.
  rules.push(`${presetRow}:not(.${className('agentPreset', 'cardActive')}) .${className('agentPreset', 'cardIdentity')} > :last-child { display: none; }`);
  rules.push(`${preset('cardDesc')} { margin: 0; font-size: 14px; line-height: 24px; color: var(--dsw-alias-label-secondary); -webkit-line-clamp: 2; }`);
  rules.push(`${preset('cardFoot')} { flex: none; flex-wrap: nowrap; gap: 4px; padding: 0; border-top: none; }`);
  rules.push(`${preset('cardHelp')} { margin-right: 0; gap: 4px; }`);
  rules.push(`${preset('helpButton')} { height: 28px; min-height: 28px; padding: 0 8px; border-radius: 6px; font-size: 13px; color: var(--dsw-alias-label-secondary); }`);
  rules.push(`${preset('iconButton')} { width: 28px; height: 28px; justify-content: center; padding: 0; border-radius: 6px; color: var(--dsw-alias-label-secondary); }`);
  rules.push(`${preset('iconButton')}:hover { background: var(--dsw-alias-interactive-bg-hover); }`);
  rules.push(`@media (max-width: 639px) {
  ${presetRow} { flex-wrap: wrap; gap: 0; }
  ${preset('cardMain')} { flex-basis: 100%; }
  ${preset('cardFoot')} { width: 100%; justify-content: flex-start; padding: 0 0 12px 40px; }
}`);

  // Below 1024px the column narrows to a 68px icon rail, as the reference product's does.
  rules.push(`@media (max-width: 1023px) {
  ${selector('settings', 'nav')} { width: 68px; padding-inline: 14px; }
  ${selector('settings', 'navCell')} { width: 40px; height: 40px; justify-content: center; padding: 0; }
  ${selector('settings', 'navLabel')} { display: none; }
  ${selector('settings', 'close')} { left: 14px; width: 40px; height: 40px; justify-content: center; padding: 0; }
  ${selector('settings', 'close')} .${className('settings', 'hiddenLabel')} { position: absolute; width: 1px; height: 1px; clip: rect(0 0 0 0); }
  ${selector('settings', 'options')} { padding-inline: 16px; }
  ${selector('settings', 'options')}::before { font-size: 24px; line-height: 32px; }
}`);
  return `${rules.join('\n')}\n`;
}
