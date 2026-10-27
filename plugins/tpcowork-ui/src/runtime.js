/** Create a Client plugin using the host's React instance and the bundle's visual resources. */
export function createPlugin(React, ReactDOM, primitives, tokens, css, locales, defaultSidebarWidth, brandIcon, classes) {
  const id = '@tpcowork/dsh-ui';
  const h = React.createElement;
  const Brand = ({ t }) => h('span', { className: 'tpcowork-brand' },
    h('span', { className: 'tpcowork-brand-name' }, t('brand')),
    h('span', { className: 'tpcowork-preview-badge' }, t('preview')));
  const Mark = () => h('img', { className: 'tpcowork-brand-mark', src: brandIcon, alt: '', width: 24, height: 24, 'aria-hidden': true });
  // The reference product greets by the hour: morning from 5, afternoon from 12, evening from 18.
  const Greeting = ({ t }) => {
    const hour = new Date().getHours();
    const hello = hour >= 5 && hour < 12 ? 'greetingMorning' : hour >= 12 && hour < 18 ? 'greetingAfternoon' : 'greetingEvening';
    return h('div', { className: 'tpcowork-hero-greeting' },
      h('h1', { className: 'tpcowork-greeting' }, h('span', null, t(hello)), h('span', null, t('greetingTitle'))),
      h('p', { className: 'tpcowork-greeting-subtitle' }, t('greetingSubtitle')));
  };
  const CurrentVersion = ({ t }) => h('div', { className: 'tpcowork-current-version' }, t('currentVersion'));
  const TaskDock = createTaskDock(React, ReactDOM.createPortal);
  const SettingsLauncher = createSettingsLauncher(React, primitives);
  const NotificationSetting = createNotificationSetting(React, primitives);
  const NavigationControls = createNavigationControls(React, ReactDOM.createPortal, primitives, classes);
  const ModelControls = createModelControls(React, ReactDOM.createPortal, primitives);
  return {
    inject: ['theme', 'slots', 'locale', 'layout', 'configForms'],
    apply(ctx) {
      ctx.effect(() => adaptSidebar(ctx.slots, 264, defaultSidebarWidth), 'tpcowork: sidebar width');
      ctx.effect(() => ctx.theme.overrideTokens(id, tokens), 'tpcowork: theme overrides');
      ctx.effect(() => ctx.locale.register('tpcowork', locales), 'tpcowork: localized labels');
      adaptDeveloperMode(ctx, React);
      ctx.effect(() => gateComposerStats(ctx, React), 'tpcowork: developer-only composer stats');
      ctx.effect(() => resetOnboardingDeveloperMode(ctx.configForms), 'tpcowork: onboarding developer mode reset');
      ctx.inject(['sessions', 'workspaces', 'uiWorkspace', 'shortcuts'], scope => {
        const navigation = createNavigation(scope);
        scope.effect(() => () => navigation.dispose(), 'tpcowork: navigation history');
        const t = scope.locale.bind('tpcowork');
        for (const [direction, name, code] of [[-1, 'Back', 'BracketLeft'], [1, 'Forward', 'BracketRight']]) {
          scope.effect(() => scope.shortcuts.register({
            id: `tpcowork.navigation.${name.toLowerCase()}`, label: () => t(`navigation${name}`),
            aliases: [name.toLowerCase()],
            defaults: {
              ...Object.fromEntries(['desktop:macos', 'desktop:windows', 'desktop:linux']
                .map(profile => [profile, { code, modifiers: ['primary'] }])),
              ...Object.fromEntries(['web:macos', 'web:windows']
                .map(profile => [profile, { code, modifiers: ['primary', 'alt'] }])),
            },
            regions: ['page', 'editable'], modals: ['settings'],
            resolve: ({ modal }) => {
              if (modal === 'settings' && direction === -1) return { status: 'handled', run: () => primitives.closeTopModal(document) };
              if (modal !== null) return { status: 'blocked', reason: 'modal' };
              return { status: 'handled', run: () => navigation.move(direction) };
            },
          }), `tpcowork: navigate ${name.toLowerCase()}`);
        }
        scope.slots.inject('shell.overlay', () => scope.slots.register({
          name: 'shell.overlay', id: 'tpcowork-navigation', locale: 'tpcowork',
          inject: () => ({ navigation, shortcuts: scope.shortcuts }),
        }, NavigationControls));
      });
      const account = createTpcoworkHubAccount(window.dshDesktop?.tpcoworkHub);
      ctx.effect(() => () => account.dispose(), 'tpcowork: TpcoworkHub account lifetime');
      const preferences = createInterfacePreferences(ctx);
      ctx.effect(() => () => preferences.dispose(), 'tpcowork: interface preferences lifetime');
      ctx.slots.inject('settings.launcher', () => ctx.slots.register({
        name: 'settings.launcher', priority: -10, locale: 'tpcowork', inject: () => ({
          hooks: { tpcoworkHub: account.source, interfacePreferences: preferences.source },
          setInterfacePreference: preferences.setInterfacePreference, refreshPreferences: preferences.refreshPreferences,
          startSignIn: account.startSignIn, cancelSignIn: account.cancelSignIn,
          signOut: account.signOut, refreshAccount: account.refreshAccount,
        }),
      }, SettingsLauncher));
      ctx.slots.inject('settings.general.item', () => ctx.slots.register({
        name: 'settings.general.item', id: 'session-log-deepseek', priority: -10,
      }, () => null));
      ctx.slots.inject('settings.general.item', () => ctx.slots.register({
        name: 'settings.general.item', id: 'tpcowork-notifications', order: 12, locale: 'tpcowork',
      }, NotificationSetting));
      ctx.slots.inject('settings.general.item', () => ctx.slots.register({
        name: 'settings.general.item', id: 'current-version', order: 100, priority: -10, locale: 'tpcowork',
      }, CurrentVersion));
      // Native notifications belong to the desktop shell; a plain browser has no bridge.
      const notifications = window.dshDesktop?.notifications;
      if (notifications) {
        ctx.inject(['sessions', 'uiSession', 'uiWorkspace'], scope => {
          scope.effect(() => watchSessionNotifications(scope, notifications, ctx.locale.bind('tpcowork')), 'tpcowork: session notifications');
        });
      }
      ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
        name: 'conversation.input.dock', id: 'todo', order: 0, priority: -10, locale: 'tpcowork',
      }, TaskDock));
      // Shadow the native model seat with the reference product's combined model and effort picker over the same
      // directory, and cycle the effort with its Control+T.
      ctx.inject(['shortcuts'], scope => {
        const tp = scope.locale.bind('tpcowork');
        scope.effect(() => scope.shortcuts.register({
          id: 'tpcowork.thought.cycle', label: () => tp('effortCycle'), aliases: ['effort', 'thinking'],
          // Browsers keep Control+T, so the web profiles take the plugin's Primary+Alt pattern instead.
          defaults: {
            ...Object.fromEntries(['desktop:macos', 'desktop:windows', 'desktop:linux']
              .map(profile => [profile, { code: 'KeyT', modifiers: ['control'] }])),
            ...Object.fromEntries(['web:macos', 'web:windows']
              .map(profile => [profile, { code: 'KeyT', modifiers: ['primary', 'alt'] }])),
          },
          regions: ['page', 'editable'], modals: [],
          resolve: ({ modal }) => {
            if (modal !== null) return { status: 'blocked', reason: 'modal' };
            return { status: 'handled', run: () => { ModelControls.cycleThought(); } };
          },
        }), 'tpcowork: cycle thinking level');
      });
      ctx.slots.inject('conversation.input.model', () => {
        const name = 'conversation.input.model';
        const tp = ctx.locale.bind('tpcowork');
        let current;
        let dispose;
        const sync = () => {
          const entry = ctx.slots.entries(name).find(entry => entry.locale === 'model' && (entry.options.priority ?? 0) === 0);
          if (entry === current) return;
          current = entry;
          dispose?.();
          dispose = undefined;
          if (entry === undefined) return;
          dispose = ctx.slots.register({
            name, priority: -10, locale: entry.locale, store: entry.store,
            inject: sessionId => ({ ...entry.inject(sessionId), tp, shortcuts: ctx.get('shortcuts')?.catalog }),
          }, ModelControls);
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
