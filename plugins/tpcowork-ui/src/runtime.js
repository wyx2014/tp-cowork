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
  // Settings is a full-window page, so its close control reads as a way back, as in the reference product.
  const BackToWorkspace = ({ t }) => t('backToWorkspace');
  // The page shows the active section's name as its title. DSH keeps the selection inside the shell, so this header
  // action follows the navigation row marked current and hands its label to the stylesheet as a custom property.
  const SectionTitle = ({ browserLabel, usageLabel, appearanceLabel }) => {
    const ref = React.useRef(null);
    React.useEffect(() => {
      const panel = ref.current?.closest('[role="dialog"]');
      const nav = panel?.querySelector('nav');
      if (!panel || !nav) return undefined;
      const sync = () => {
        const labelOfBrowser = browserLabel?.();
        const labelOfUsage = usageLabel?.();
        for (const button of nav.querySelectorAll('button')) {
          const icon = button.querySelector('svg');
          if (icon && labelOfBrowser && button.textContent.trim() === labelOfBrowser) icon.dataset.tpcoworkNavIcon = 'browser';
          if (icon && labelOfUsage && button.textContent.trim() === labelOfUsage) icon.dataset.tpcoworkNavIcon = 'usage';
          if (icon && appearanceLabel && button.textContent.trim() === appearanceLabel) icon.dataset.tpcoworkNavIcon = 'appearance';
        }
        const label = nav.querySelector('[aria-current="true"]')?.textContent?.trim() ?? '';
        panel.style.setProperty('--tpcowork-settings-title', JSON.stringify(label));
      };
      sync();
      const observer = new MutationObserver(sync);
      observer.observe(nav, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['aria-current'] });
      return () => { observer.disconnect(); panel.style.removeProperty('--tpcowork-settings-title'); };
    }, []);
    return h('span', { ref, hidden: true });
  };
  const TaskDock = createTaskDock(React, ReactDOM.createPortal);
  const SettingsLauncher = createSettingsLauncher(React, primitives);
  const FirstRunGuide = createFirstRunGuide(React, primitives);
  const SettingsSidebarChrome = createSettingsSidebarChrome(React, ReactDOM, primitives, SettingsLauncher, classes.settings);
  const generalPreferences = createGeneralPreferences();
  const ShortcutSettings = createShortcutSettings(React, primitives);
  const NavigationControls = createNavigationControls(React, ReactDOM.createPortal, primitives, classes);
  const ModelControls = createModelControls(React, ReactDOM.createPortal, primitives);
  // With the archive filter hidden, a view saved as "show" or "only archived" would strand archived rows in the
  // sidebar. The filter lives in the workspace browser's view store, which its slot registration carries.
  const keepArchivedHidden = slots => {
    let release;
    const bind = () => {
      release?.();
      release = undefined;
      const view = slots.entries('sidebar.workspaces').map(entry => entry.store?.create?.()).find(store => store?.actions?.setArchivedFilter);
      if (!view) return;
      const reset = () => { if ((view.getSnapshot().archivedFilter ?? 'default') !== 'default') view.actions.setArchivedFilter('default'); };
      reset();
      release = view.subscribe(reset);
    };
    bind();
    const unsubscribe = slots.subscribe('sidebar.workspaces', bind);
    return () => { unsubscribe(); release?.(); };
  };
  return {
    inject: ['theme', 'slots', 'locale', 'layout', 'configForms'],
    apply(ctx) {
      ctx.effect(() => adaptSidebar(ctx.slots, 264, defaultSidebarWidth), 'tpcowork: sidebar width');
      ctx.effect(() => keepArchivedHidden(ctx.slots), 'tpcowork: archived sessions stay out of the sidebar');
      ctx.effect(() => ctx.theme.overrideTokens(id, tokens), 'tpcowork: theme overrides');
      ctx.effect(() => ctx.locale.register('tpcowork', locales), 'tpcowork: localized labels');
      installGeneralSettings(ctx, React, primitives, generalPreferences);
      // DSH Desktop's first-run setup wizard, with TP Cowork's choices: language, theme and 界面字号. It shows once per
      // device and can be reopened from General settings.
      const guide = createFirstRunGuideState();
      // DSH's onboarding choices over the same stores it writes: 代码与开发 turns on Developer mode with the detailed
      // usage readout, 办公与创作 keeps both off; the work process is the chat transcript view.
      const chatForm = ctx.configForms.get('ui-chat');
      const developer = ctx.configForms.developerTools;
      let workSnapshot;
      const readWork = () => {
        const purpose = developer.enabled.getSnapshot() === true ? 'development' : 'office';
        const process = chatForm.getSnapshot().value?.transcriptView ?? 'detailed';
        if (workSnapshot?.purpose !== purpose || workSnapshot.process !== process) workSnapshot = { purpose, process };
        return workSnapshot;
      };
      const guideWork = {
        subscribe: listener => { const offs = [developer.enabled.subscribe(listener), chatForm.subscribe(listener)]; return () => offs.forEach(off => off()); },
        get: readWork,
        choosePurpose: purpose => {
          void developer.setEnabled(purpose === 'development');
          void chatForm.set('performanceUsage', purpose === 'development' ? 'detailed' : 'compact');
        },
        chooseProcess: mode => { void chatForm.set('transcriptView', mode); },
      };
      ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay', id: 'tpcowork-first-run-guide', locale: 'tpcowork', inject: () => ({
          hooks: { guide: guide.source }, finish: guide.finish, preferences: generalPreferences,
          theme: { subscribe: listener => ctx.on('theme/change', listener), get: () => ctx.theme.getTheme(),
            choose: mode => ctx.theme.setTheme(mode), chooseFontSize: px => ctx.theme.setFontSize('text', px) },
          // As the General language row: "System default" follows the system at each start, a language is saved.
          locale: { subscribe: listener => ctx.locale.subscribe(listener), get: () => ctx.locale.getSnapshot(), choose: id => {
            generalPreferences.set('followSystemLanguage', id === 'system');
            if (id !== 'system') ctx.locale.setLocale(id);
          } },
          work: guideWork,
        }),
      }, FirstRunGuide));
      ctx.slots.inject('settings.general.item', () => ctx.slots.register({
        name: 'settings.general.item', id: 'tpcowork-first-run-guide', order: generalLayout().rows['tpcowork-first-run-guide'], locale: 'tpcowork',
      }, ({ t }) => h('div', { className: 'tpcowork-setting-row' },
        h('div', null, h('div', { className: 'tpcowork-setting-title' }, t('guideReopenTitle')),
          h('div', { className: 'tpcowork-setting-description' }, t('guideReopenDescription'))),
        // The guide is a full-window page, so Settings closes first rather than covering it.
        h(primitives.Button, { variant: 'outline', onClick: () => { primitives.closeTopModal(document); guide.show(); } }, t('guideReopen')))));
      installAppearanceSettings(ctx, React, primitives);
      // 界面字号: the text size setting moves all interface text, as in the reference product, not only chat content.
      ctx.effect(() => scaleInterfaceText(), 'tpcowork: interface font size');
      adaptModelSettings(ctx, React, ReactDOM, primitives, classes.models);
      ctx.slots.inject('settings.close', () => ctx.slots.register({
        name: 'settings.close', priority: -10, locale: 'tpcowork',
      }, BackToWorkspace));
      ctx.slots.inject('settings.action', () => ctx.slots.register({
        name: 'settings.action', id: 'tpcowork-section-title', order: -100,
        inject: () => {
          const sectionLabel = id => () => {
            const label = ctx.slots.entries('settings.section').find(row => row.options.id === id)?.options.label;
            return typeof label === 'function' ? label() : label;
          };
          // The usage section is @tpcowork/dsh-usage's; its row gets the reference product's bar chart icon.
          return { appearanceLabel: ctx.locale.bind('tpcowork')('appearanceTitle'), browserLabel: sectionLabel('@tpcowork/dsh-browser'), usageLabel: sectionLabel('usage') };
        },
      }, SectionTitle));
      ctx.slots.inject('settings.action', () => ctx.slots.register({
        name: 'settings.action', id: 'open-document', priority: -10,
      }, () => null));
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
      // The reference product's interface zoom: the whole window, from the account menu and Command/Control +, - and 0.
      // The keys replace DSH's text-size keys; chat text size stays in Appearance.
      const zoom = createWindowZoom(window.dshDesktop?.browserAutomation);
      ctx.effect(() => () => zoom.dispose(), 'tpcowork: interface zoom lifetime');
      ctx.effect(() => zoom.listen(), 'tpcowork: interface zoom keys');
      const zoomKeys = action => ctx.get('shortcuts')?.describeBinding(ZOOM_BINDINGS[action][0]).keys;
      if (window.dshDesktop?.browserAutomation) ctx.inject(['shortcuts'], scope => {
        const tp = scope.locale.bind('tpcowork');
        for (const [action, label] of [['in', 'zoomIn'], ['out', 'zoomOut'], ['reset', 'zoomReset']]) {
          scope.effect(() => scope.shortcuts.registerFixed({
            id: `tpcowork.zoom.${action}`, label: () => tp(label), group: 'menus',
            keys: scope.shortcuts.describeBinding(ZOOM_BINDINGS[action][0]).keys, bindings: ZOOM_BINDINGS[action],
          }), `tpcowork: interface zoom ${action} reference`);
        }
      });
      const preferences = createInterfacePreferences(ctx);
      ctx.effect(() => () => preferences.dispose(), 'tpcowork: interface preferences lifetime');
      const usageAvailable = () => ctx.slots.entries('settings.section').some(entry => entry.options.id === 'usage');
      const subscribeUsage = listener => ctx.slots.subscribe('settings.section', listener);
      const openUsage = () => {
        if (!usageAvailable()) return false;
        const entry = ctx.slots.entries('sidebar.settings').find(entry => typeof entry.store?.create === 'function');
        if (!entry) return false;
        const shell = entry.store.create();
        if (entry.store.create() !== shell || typeof shell.actions?.openSection !== 'function') return false;
        shell.actions.openSection('usage');
        return true;
      };
      ctx.slots.inject('settings.launcher', () => ctx.slots.register({
        name: 'settings.launcher', priority: -10, locale: 'tpcowork', inject: () => ({
          hooks: { tpcoworkHub: account.source, interfacePreferences: preferences.source, windowZoom: zoom.source },
          setInterfacePreference: preferences.setInterfacePreference, refreshPreferences: preferences.refreshPreferences,
          startSignIn: account.startSignIn, cancelSignIn: account.cancelSignIn,
          signOut: account.signOut, refreshAccount: account.refreshAccount, openUsage, usageAvailable, subscribeUsage,
          runZoom: zoom.run, zoomKeys,
        }),
      }, SettingsLauncher));
      ctx.slots.inject('settings.action', () => ctx.slots.register({
        name: 'settings.action', id: 'tpcowork-settings-sidebar', order: -90, locale: 'tpcowork', inject: () => ({
          sections: () => ctx.slots.entries('settings.section').map(entry => ({ id: entry.options.id, order: entry.options.order ?? 0, label: typeof entry.options.label === 'function' ? entry.options.label() : entry.options.label })),
          hooks: { tpcoworkHub: account.source, interfacePreferences: preferences.source, windowZoom: zoom.source },
          setInterfacePreference: preferences.setInterfacePreference, refreshPreferences: preferences.refreshPreferences,
          startSignIn: account.startSignIn, cancelSignIn: account.cancelSignIn,
          signOut: account.signOut, refreshAccount: account.refreshAccount, openUsage, usageAvailable, subscribeUsage,
          runZoom: zoom.run, zoomKeys,
        }),
      }, SettingsSidebarChrome));
      ctx.slots.inject('settings.general.item', () => ctx.slots.register({
        name: 'settings.general.item', id: 'session-log-deepseek', priority: -10,
      }, () => null));
      // Shortcuts leave General for their own page, as in the reference product's "Keyboard shortcuts" section.
      ctx.slots.inject('settings.general.item', () => ctx.slots.register({
        name: 'settings.general.item', id: 'shortcuts', priority: -10,
      }, () => null));
      ctx.inject(['shortcuts'], scope => {
        const tp = scope.locale.bind('tpcowork');
        scope.slots.inject('settings.section', () => scope.slots.register({
          name: 'settings.section', id: 'shortcuts', order: 30, label: () => tp('shortcutTitle'), locale: 'tpcowork',
          inject: () => ({ shortcuts: scope.shortcuts }),
        }, ShortcutSettings));
      });
      // Archive notices keep Undo but drop DSH's "filter archived sessions" link, whose view no longer exists.
      for (const key of ['archived', 'stoppedAndArchived']) {
        ctx.slots.inject('workspace.toast', () => ctx.slots.register({
          name: 'workspace.toast', key, priority: -10, locale: 'workspace',
        }, ({ t, sessionId, seq, dismissToast, renderFactorySlot }) => renderFactorySlot('workspace.toast.content', {
          text: t(key === 'archived' ? 'toast.archived' : 'toast.stoppedAndArchived'), tone: 'success', holdMs: 6000, seq, onDone: dismissToast,
          actions: [{ label: t('toast.archivedUndo'), onClick: () => {
            dismissToast();
            void (ctx.get('uiWorkspace') ?? ctx.get('workspaces'))?.unarchiveSession(sessionId).catch(() => undefined);
          } }],
        })));
      }
      ctx.slots.inject('settings.general.item', () => ctx.slots.register({
        name: 'settings.general.item', id: 'current-version', order: generalLayout().rows['current-version'], priority: -10, locale: 'tpcowork',
      }, CurrentVersion));
      // Native notifications belong to the desktop shell; a plain browser has no bridge.
      const notifications = window.dshDesktop?.notifications;
      if (notifications) {
        ctx.inject(['sessions', 'uiSession', 'uiWorkspace'], scope => {
          scope.effect(() => watchSessionNotifications(scope, notifications, ctx.locale.bind('tpcowork'), () => generalPreferences.get().notificationSound), 'tpcowork: session notifications');
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
