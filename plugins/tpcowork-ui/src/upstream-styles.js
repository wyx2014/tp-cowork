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
  rule('sidebar', 'root', 'font-size: var(--dsh-sidebar-font-size);');
  rule('sidebar', 'logoRow', 'height: var(--dsh-sidebar-brand-height); padding: var(--dsh-sidebar-brand-padding);');
  rule('sidebar', 'brandMark', 'display: var(--dsh-sidebar-brand-mark-display);');
  rule('sidebar', 'brandName', 'font-weight: var(--dsh-sidebar-brand-weight);');
  rule('sidebar', 'topStrip', 'justify-content: flex-start; padding-left: 88px; gap: 4px;', mac);
  rule('sidebar', 'topStrip', 'padding-left: 12px;', 'html[data-platform="darwin"][data-fullscreen] body[data-tpcowork-ui]');
  rule('leading', 'controls', 'gap: 4px;');
  rules.push(`${selector('leading', 'iconButton')}:last-of-type { order: 1; }`);
  const web = 'html:not([data-platform="darwin"]):not([data-windows-titlebar]) body[data-tpcowork-ui]';
  rule('sidebar', 'logoRow', 'height: auto; min-height: 72px; flex-wrap: wrap; justify-content: flex-start; gap: 4px;', expanded(web));
  rule('sidebar', 'brand', 'order: 1; flex-basis: 100%; margin-top: 4px;', expanded(web));
  rules.push(`${web} .${className('sidebar', 'collapsed')} .${className('sidebar', 'logoRow')} { height: auto; flex-direction: column; gap: 4px; }`);
  rules.push(`${web} .${className('sidebar', 'collapsed')} .tpcowork-navigation { flex-direction: column; }`);
  rule('sidebar', 'newSession', 'left: 108px;', 'html[data-windows-titlebar] body[data-tpcowork-ui] .' + className('sidebar', 'collapsed'));
  rule('frame', 'frame', '--dsh-frame-leading-clearance: 224px;', mac + ':has([data-shell-leading])');
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
  rule('hero', 'stack', 'gap: var(--dsh-hero-gap); max-width: var(--dsh-hero-width);');
  rule('hero', 'titleGroup', 'display: none;');
  rule('hero', 'fishHitbox', 'flex: 1; min-width: 0; max-width: 100%;');
  // Home: the greeting, workspace row, composer and task suggestions share one centered column of 82% (at most
  // 880px); the greeting starts on the composer card's left edge.
  // The skyline's waterline sits at about 49% of the column height, so the greeting block reserves the space down
  // to half the window: the composer card starts on the water and never covers the buildings. The 40px header,
  // the 28px workspace row and its two 8px gaps complete that height. The greeting sits at the bottom of that
  // space, just above the workspace row, so no gap opens between them on tall windows. A fixed inset keeps the
  // suggestions' height from pushing the composer up.
  const home = `${scope} [data-conversation-content][data-content-phase="hero"]`;
  rules.push(`${home} { --tpcowork-home-top: clamp(48px, 8vh, 88px); --tpcowork-home-column: clamp(min(100%, 600px), 82%, 880px); }`);
  rules.push(`${home} .${className('conversation', 'scrollBody')} {
    justify-content: flex-start; padding-top: var(--tpcowork-home-top); box-sizing: border-box;
  }`);
  // The card otherwise follows the transcript width (64% of the column, 680-920px), which matches this 82% column
  // only at some window sizes; elsewhere it centers inside it and the workspace chip sticks out to its left.
  rules.push(`${home} .${className('conversation', 'composerHero')} {
    box-sizing: border-box; width: 100%; padding: 0 clamp(32px, 5.5%, 80px) 32px; align-items: center;
    --dsh-composer-card-max-width: 100%;
  }`);
  rules.push(`${home} .${className('conversation', 'composerHero')} > .${className('hero', 'root')} {
    align-self: center; justify-content: flex-start; box-sizing: border-box; width: var(--tpcowork-home-column); max-width: 100%;
    padding: 0 0 28px; margin: 0; min-height: calc(50vh - 40px - var(--tpcowork-home-top) - 44px); align-items: flex-end;
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
  return `${rules.join('\n')}\n`;
}
