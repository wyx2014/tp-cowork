/** Reference settings sidebar chrome, sharing the workspace account menu and native close action. */
export function createSettingsSidebarChrome(React, ReactDOM, primitives, SettingsLauncher, classes) {
  const h = React.createElement;
  return function SettingsSidebarChrome(props) {
    const anchor = React.useRef(null);
    const [targets, setTargets] = React.useState(null);
    const [hint, setHint] = React.useState(null);
    const close = () => targets?.panel.querySelector(`.${classes.close}`)?.click();
    React.useEffect(() => {
      const panel = anchor.current?.closest('[role="dialog"]');
      const nav = panel?.querySelector(`.${classes.nav}`);
      const list = nav?.querySelector(`.${classes.navList}`);
      if (!list) return undefined;
      panel.dataset.tpcoworkSettingsChrome = '';
      const back = document.createElement('div');
      back.className = 'tpcowork-settings-back-target';
      const footer = document.createElement('div');
      footer.className = 'tpcowork-settings-footer';
      nav.append(back, footer);
      const headings = new Map();
      const previous = new Map();
      const sync = () => {
        const entries = props.sections();
        const visible = new Set();
        for (const button of list.querySelectorAll(`.${classes.navCell}`)) {
          const entry = entries.find(entry => entry.label === button.textContent.trim());
          if (!entry) continue;
          const agent = /memory|agent|preset|plugin|mcp|skill|command|hook|expert/.test(entry.id);
          const data = /usage|stat|archiv/.test(entry.id);
          const group = data ? 'data' : agent ? 'agent' : 'basic';
          const base = { basic: 0, agent: 100, data: 200 }[group];
          const basics = ['general', 'appearance', 'models', '@tpcowork/dsh-browser', 'remote', 'computerUse', 'shortcuts'];
          if (!previous.has(button)) previous.set(button, button.style.order);
          const index = group === 'basic' ? basics.indexOf(entry.id) : -1;
          button.style.order = String(base + 10 + (index < 0 ? entry.order : index));
          visible.add(group);
          if (!headings.has(group)) {
            const title = document.createElement('div');
            title.className = 'tpcowork-settings-group-label';
            title.style.order = String(base);
            title.dataset.group = group;
            title.setAttribute('role', 'heading');
            title.setAttribute('aria-level', '2');
            list.append(title);
            headings.set(group, title);
          }
        }
        for (const [group, title] of headings) {
          const text = props.t(`settingsGroup_${group}`);
          if (title.textContent !== text) title.textContent = text;
          title.hidden = !visible.has(group);
        }
      };
      const showHint = event => {
        const button = event.target.closest?.(`.${classes.navCell}`);
        if (!button || !list.contains(button)) return;
        const rect = button.getBoundingClientRect();
        const label = button.textContent.trim();
        setHint(previous => previous?.button === button && previous.label === label ? previous : { button, label, left: rect.right + 2, top: rect.top + rect.height / 2 });
      };
      const hideHint = event => {
        const button = event.target.closest?.(`.${classes.navCell}`);
        if (button?.contains(event.relatedTarget)) return;
        setHint(null);
      };
      const clearHint = () => setHint(null);
      list.addEventListener('mouseover', showHint);
      list.addEventListener('mouseout', hideHint);
      list.addEventListener('scroll', clearHint);
      window.addEventListener('resize', clearHint);
      sync();
      const observer = new MutationObserver(sync);
      observer.observe(list, { childList: true, subtree: true, characterData: true });
      setTargets({ panel, back, footer });
      return () => {
        observer.disconnect();
        list.removeEventListener('mouseover', showHint);
        list.removeEventListener('mouseout', hideHint);
        list.removeEventListener('scroll', clearHint);
        window.removeEventListener('resize', clearHint);
        back.remove(); footer.remove();
        for (const title of headings.values()) title.remove();
        for (const [button, order] of previous) button.style.order = order;
        delete panel.dataset.tpcoworkSettingsChrome;
      };
    }, []);
    return h(React.Fragment, null, h('span', { ref: anchor, hidden: true }),
      hint && hint.button.isConnected ? ReactDOM.createPortal(h('div', { role: 'tooltip', className: 'tpcowork-settings-nav-hint',
        style: { left: hint.left, top: hint.top, maxWidth: `min(50vw, calc(100vw - ${hint.left + 12}px))` } }, hint.label), document.body) : null,
      targets ? ReactDOM.createPortal(h(primitives.Tooltip, { label: props.t('backToWorkspace'), side: 'right', align: 'center', gap: 2, portal: true },
        h('button', { type: 'button', className: 'tpcowork-settings-back', 'aria-label': props.t('backToWorkspace'), onClick: close },
          h('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
            h('path', { d: 'm12 19-7-7 7-7M19 12H5' })),
          h('span', null, props.t('backToWorkspace')))), targets.back) : null,
      targets ? ReactDOM.createPortal(h(SettingsLauncher, { ...props, wide: true, openSettings: close }), targets.footer) : null);
  };
}
