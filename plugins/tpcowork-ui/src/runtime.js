/** Create a Client plugin using the host's React instance and the bundle's visual resources. */
export function createPlugin(React, ReactDOM, primitives, tokens, css, locales, defaultSidebarWidth) {
  const id = '@tpcowork/dsh-ui';
  const h = React.createElement;
  const Brand = ({ t }) => h('span', { className: 'tpcowork-brand' },
    h('span', { className: 'tpcowork-brand-name' }, t('brand')),
    h('span', { className: 'tpcowork-preview-badge' }, t('preview')));
  const Mark = () => h('span', { className: 'tpcowork-brand-mark', 'aria-hidden': true }, 'TP');
  const Greeting = ({ t }) => h('h1', { className: 'tpcowork-greeting' }, t('greeting'));
  const TaskDock = createTaskDock(React, ReactDOM.createPortal);
  const SettingsLauncher = createSettingsLauncher(React, primitives);
  return {
    inject: ['theme', 'slots', 'locale', 'layout'],
    apply(ctx) {
      ctx.effect(() => adaptSidebar(ctx.slots, 264, defaultSidebarWidth), 'tpcowork: sidebar width');
      ctx.effect(() => ctx.theme.overrideTokens(id, tokens), 'tpcowork: theme overrides');
      ctx.effect(() => ctx.locale.register('tpcowork', locales), 'tpcowork: localized labels');
      const account = createPromptHubAccount(window.dshDesktop?.promptHub);
      ctx.effect(() => () => account.dispose(), 'tpcowork: PromptHub account lifetime');
      ctx.slots.inject('settings.launcher', () => ctx.slots.register({
        name: 'settings.launcher', priority: -10, locale: 'tpcowork', inject: () => ({
          hooks: { promptHub: account.source }, startSignIn: account.startSignIn, cancelSignIn: account.cancelSignIn,
          signOut: account.signOut, refreshAccount: account.refreshAccount,
        }),
      }, SettingsLauncher));
      ctx.slots.inject('settings.general.item', () => ctx.slots.register({
        name: 'settings.general.item', id: 'session-log-deepseek', priority: -10,
      }, () => null));
      ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
        name: 'conversation.input.dock', id: 'todo', order: 0, priority: -10, locale: 'tpcowork',
      }, TaskDock));
      // Shadow the Schedule entries while preserving their components and business props.
      for (const [name, cell] of [['sidebar.panellist', 'id'], ['main', 'key']]) {
        ctx.slots.inject(name, () => {
          const t = ctx.locale.bind('tpcowork');
          let current;
          let dispose;
          const sync = () => {
            const entries = ctx.slots.entries(name);
            const automation = entries.some(entry => entry.locale === 'tpcowork.automation' && entry.options[cell] === 'schedules');
            const entry = automation ? undefined : entries.find(entry => entry.locale === 'schedule.manager'
              && entry.options[cell] === 'schedules' && (entry.options.priority ?? 0) === 0);
            if (entry === current) return;
            current = entry;
            dispose?.();
            dispose = undefined;
            if (entry === undefined) return;
            const Page = ({ t: upstream, ...props }) => {
              const translated = React.useCallback((key, params) =>
                key === 'title' ? t('automation') : upstream(key, params), [upstream]);
              return h(entry.component, { ...props, t: translated });
            };
            dispose = ctx.slots.register({
              name, ...entry.options, priority: -10,
              locale: entry.locale, inject: entry.inject, store: entry.store,
              ...(name === 'sidebar.panellist' ? { label: () => t('automation') } : {}),
            }, name === 'main' ? Page : entry.component);
          };
          const unsubscribe = ctx.slots.subscribe(name, sync);
          try {
            sync();
          } catch (error) {
            unsubscribe();
            throw error;
          }
          return () => { unsubscribe(); dispose?.(); };
        });
      }
      ctx.effect(() => {
        const style = document.createElement('style');
        style.dataset.plugin = id;
        style.textContent = css;
        document.head.appendChild(style);
        document.body.setAttribute('data-tpcowork-ui', '');
        return () => {
          style.remove();
          document.body.removeAttribute('data-tpcowork-ui');
        };
      }, 'tpcowork: presentation styles');
      for (const [name, Component] of [
        ['sidebar.brand.name', Brand],
        ['sidebar.brand.mark', Mark],
        ['conversation.hero.brand.mark', Greeting],
      ]) {
        ctx.slots.inject(name, () => ctx.slots.register({
          name, id: 'tpcowork', priority: -10, locale: 'tpcowork',
        }, Component));
      }
    },
  };
}
