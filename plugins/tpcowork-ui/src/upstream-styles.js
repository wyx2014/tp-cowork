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
  rule('conversation', 'composerHero', `width: min(calc(var(--dsh-hero-width)
    + 2 * var(--dsh-composer-side-clearance)), 100%);`);
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
  rule('chat', 'bubble', 'border: var(--dsh-chat-user-border); border-radius: var(--dsh-chat-user-radius);');
  rule('plugins', 'cardDesc', 'display: block; -webkit-line-clamp: unset; overflow: visible; overflow-wrap: anywhere; line-height: 20px;',
    `${scope} [data-plugin-package^="@tpcowork/"]`);
  return `${rules.join('\n')}\n`;
}
