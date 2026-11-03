/**
 * The reference product's General page over the native rows: its cards, order and wording, plus its
 * notification sound, question auto-continue, reasoning and todo preferences. Every change is a slot
 * registration, a stylesheet hook or a Client-side observer; native packages are not modified.
 */
const GENERAL_PREFERENCES = {
  notifications: ['tpcowork-notification-enabled', true],
  notificationSound: ['tpcowork-notification-sound', true],
  askAutoContinue: ['tpcowork-ask-auto-continue', true],
  showReasoning: ['tpcowork-show-reasoning', true],
  showTodos: ['tpcowork-show-todos', false],
  followSystemLanguage: ['tpcowork-locale-system', false],
};

/** How long an unanswered question waits before it continues, as in the reference product. */
export const ASK_AUTO_CONTINUE_MS = 5 * 60 * 1000;
/** Model-facing reply for a question nobody answered; worded so it can never read as consent. */
export const ASK_AUTO_CONTINUE_NOTE = 'The user did not answer within 5 minutes. Continue with your best judgment; this is not approval.';

/**
 * Card order: each inner list is one card, top to bottom. Native rows keep their ids; `tpcowork-*` rows are this
 * plugin's. A row missing at runtime (Link opening outside the desktop shell) simply leaves its card shorter.
 */
export const GENERAL_CARDS = [
  ['language'],
  ['developer-tools', 'permission'],
  ['tpcowork-notifications', 'tpcowork-notification-sound', 'link-opening'],
  ['composer-enter', 'tpcowork-ask-auto-continue', 'tpcowork-show-reasoning', 'tpcowork-show-todos'],
  ['transcript-view', 'performance-usage'],
  ['current-version', 'tpcowork-first-run-guide'],
];

/**
 * Slot order of every row and of the gaps between cards.
 * @returns `rows` by id, and one `breaks` order before each card after the first.
 */
export function generalLayout(cards = GENERAL_CARDS) {
  const rows = {};
  const breaks = [];
  let order = 0;
  cards.forEach((card, index) => {
    if (index > 0) breaks.push(order++);
    for (const id of card) rows[id] = order++;
  });
  return { rows, breaks };
}

/**
 * Durable per-device switches, kept where the notification switch has always been.
 * @param storage - `localStorage`, or a stand-in for tests.
 * @returns Snapshot store with `get`, `subscribe` and `set`.
 */
export function createGeneralPreferences(storage = globalThis.localStorage) {
  const listeners = new Set();
  const read = name => {
    const [key, fallback] = GENERAL_PREFERENCES[name];
    try {
      const value = storage?.getItem(key);
      return value === null || value === undefined ? fallback : value === 'true';
    } catch (_error) { return fallback; }
  };
  let snapshot = Object.fromEntries(Object.keys(GENERAL_PREFERENCES).map(name => [name, read(name)]));
  return {
    get: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    set(name, value) {
      try { storage?.setItem(GENERAL_PREFERENCES[name][0], String(value)); }
      catch (_error) { /* Storage unavailable: the switch still applies for this run. */ }
      snapshot = { ...snapshot, [name]: value };
      for (const listener of listeners) listener();
    },
  };
}

/**
 * The first registered locale the system asks for, matched like the native browser detection.
 * @param locales - Registered `{ id }` definitions.
 * @param languages - System language tags in preference order.
 * @returns A locale id, or undefined when none matches.
 */
export function systemLocale(locales, languages) {
  const key = tag => tag.toLowerCase().replace('_', '-');
  for (const tag of languages) {
    const exact = locales.find(locale => key(locale.id) === key(tag));
    if (exact) return exact.id;
    const primary = locales.find(locale => key(locale.id).split('-')[0] === key(tag).split('-')[0]);
    if (primary) return primary.id;
  }
  return undefined;
}

/**
 * Continue questions nobody answers within the window, as the reference product does. The countdown runs only
 * while a card is untouched: focusing it pauses, and typing or "take my time" cancels it for that question.
 * Plan reviews and timed questions, which keep their own countdown, are left alone.
 * @param uiSession - Supplies `sessionStatus`, whose pending interaction is the live question card.
 * @param enabled - Reads the switch; turning it off stops every countdown, including the current ones.
 * @param subscribeEnabled - Notified when the switch changes.
 * @returns Stop observing.
 */
export function watchQuestionAutoContinue(uiSession, enabled, subscribeEnabled, delayMs = ASK_AUTO_CONTINUE_MS) {
  const waits = new Map();
  const stopWait = key => {
    const wait = waits.get(key);
    if (!wait) return;
    clearTimeout(wait.timer);
    wait.unsubscribe?.();
    waits.delete(key);
  };
  const fire = (key, pending) => {
    stopWait(key);
    const answer = { answers: pending.questions.map(question => ({ id: question.id, selected: [], custom: ASK_AUTO_CONTINUE_NOTE })) };
    void pending.answer(answer).catch(() => {});
  };
  const sync = key => {
    const wait = waits.get(key);
    if (!wait) return;
    const card = wait.pending.snapshot?.();
    const state = card?.waitState ?? 'counting';
    if (state === 'editing' || state === 'waiting' || state === 'continued' || card?.countdown !== undefined) {
      // An engaged or held card belongs to the person; a countdown of its own is the timed tool's.
      clearTimeout(wait.timer);
      wait.timer = undefined;
      wait.remaining = 0;
      return;
    }
    if (wait.remaining <= 0) return;
    if (state === 'focused') {
      if (wait.timer !== undefined) { clearTimeout(wait.timer); wait.remaining -= Date.now() - wait.started; wait.timer = undefined; }
      return;
    }
    if (wait.timer === undefined) {
      wait.started = Date.now();
      wait.timer = setTimeout(() => fire(key, wait.pending), Math.max(0, wait.remaining));
    }
  };
  const observe = () => {
    const live = new Set();
    if (enabled()) {
      for (const status of uiSession.sessionStatus.getSnapshot().values()) {
        const pending = status.pendingInteraction;
        if (pending?.kind !== 'question' || typeof pending.answer !== 'function' || !Array.isArray(pending.questions)) continue;
        live.add(pending.key);
        if (!waits.has(pending.key)) {
          const wait = { pending, remaining: delayMs, timer: undefined, started: 0 };
          waits.set(pending.key, wait);
          wait.unsubscribe = pending.subscribe?.(() => sync(pending.key));
        }
        sync(pending.key);
      }
    }
    for (const key of [...waits.keys()]) if (!live.has(key)) stopWait(key);
  };
  const unsubscribe = uiSession.sessionStatus.subscribe(observe);
  const unsubscribeEnabled = subscribeEnabled(observe);
  observe();
  return () => { unsubscribe(); unsubscribeEnabled(); for (const key of [...waits.keys()]) stopWait(key); };
}

/**
 * Mark every reasoning row after the first of its Turn, so the stylesheet can hide it.
 * @param root - Document or element holding the conversation.
 * @returns The rows that were marked.
 */
export function markLaterReasoning(root) {
  const seen = new Set();
  const marked = [];
  for (const row of root.querySelectorAll('[data-variant="think"]')) {
    const turn = row.closest('[data-chat-turn]')?.getAttribute('data-chat-turn') ?? '';
    const later = seen.has(turn);
    seen.add(turn);
    if (later) marked.push(row);
    if (later !== row.hasAttribute('data-tpcowork-later-reasoning')) row.toggleAttribute('data-tpcowork-later-reasoning', later);
  }
  return marked;
}

/**
 * Register the reference General page over the native rows.
 * @param ctx - Client context with `slots` and `locale`.
 * @param React - Host React.
 * @param primitives - Host UI primitives.
 * @param preferences - Store from {@link createGeneralPreferences}.
 */
export function installGeneralSettings(ctx, React, primitives, preferences) {
  const h = React.createElement;
  const tp = ctx.locale.bind('tpcowork');
  const { rows: order, breaks } = generalLayout();
  const usePreferences = () => React.useSyncExternalStore(preferences.subscribe, preferences.get);

  const SwitchRow = ({ title, description, checked, disabled, onChange }) => h('div', { className: 'tpcowork-setting-row' },
    h('div', null,
      h('div', { className: 'tpcowork-setting-title' }, title),
      h('div', { className: 'tpcowork-setting-description' }, description)),
    h(primitives.Switch, { checked, disabled, label: title, onChange }));
  const preferenceRow = (name, title, description, disabledWhen) => function PreferenceSwitch({ t }) {
    const values = usePreferences();
    return h(SwitchRow, { title: t(title), description: t(description), checked: values[name],
      disabled: disabledWhen ? disabledWhen(values) : false, onChange: next => preferences.set(name, next) });
  };
  const own = {
    'tpcowork-notifications': preferenceRow('notifications', 'notifyTitle', 'notifyDescription'),
    'tpcowork-notification-sound': preferenceRow('notificationSound', 'notifySoundTitle', 'notifySoundDescription', values => !values.notifications),
    'tpcowork-ask-auto-continue': preferenceRow('askAutoContinue', 'askAutoContinueTitle', 'askAutoContinueDescription'),
    'tpcowork-show-reasoning': preferenceRow('showReasoning', 'showReasoningTitle', 'showReasoningDescription'),
    'tpcowork-show-todos': preferenceRow('showTodos', 'showTodosTitle', 'showTodosDescription'),
  };
  for (const [id, Row] of Object.entries(own)) ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item', id, order: order[id], locale: 'tpcowork',
  }, Row));
  // The reference page opens with the language preference as a pill under the title.
  const subscribeLocale = listener => ctx.locale.subscribe(listener);
  const Summary = ({ t }) => {
    const follow = usePreferences().followSystemLanguage;
    const locale = React.useSyncExternalStore(subscribeLocale, () => ctx.locale.getSnapshot());
    const label = follow ? t('languageSystem') : locale.locales.find(row => row.id === locale.active)?.label ?? locale.active;
    return h('div', { className: 'tpcowork-general-summary' }, h('span', { className: 'tpcowork-general-pill' }, label));
  };
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item', id: 'tpcowork-general-summary', order: -1, locale: 'tpcowork',
  }, Summary));
  const CardBreak = () => h('div', { className: 'tpcowork-general-break', 'aria-hidden': true });
  breaks.forEach((at, index) => ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item', id: `tpcowork-card-break-${index}`, order: at,
  }, CardBreak)));

  // Native rows move into their card and take the reference wording; their own controls and stores stay native.
  const wording = {
    language: { 'language.title': () => h(React.Fragment, null, tp('languageTitle'),
      h('div', { className: 'tpcowork-setting-description' }, tp('languageDescription'))) },
    'developer-tools': { 'developerTools.title': () => tp('developerMode'), 'developerTools.description': () => tp('developerModeDescription') },
    'composer-enter': { 'settings.enter.title': () => tp('interactionTitle'), 'settings.enter.description': () => tp('interactionDescription'),
      'settings.enter.queue': () => tp('interactionQueue'), 'settings.enter.steer': () => tp('interactionSteer') },
  };
  for (const id of ['language', 'developer-tools', 'permission', 'link-opening', 'composer-enter', 'transcript-view', 'performance-usage']) {
    adaptNativeGeneralRow(ctx, React, id, { order: order[id], wording: wording[id] ?? {},
      adapt: id === 'language' ? languageAdapter(ctx, React, preferences, tp) : undefined });
  }

  // Follow the system language at each start while "System default" is chosen.
  ctx.effect(() => {
    const apply = () => {
      if (!preferences.get().followSystemLanguage) return;
      const snapshot = ctx.locale.getSnapshot();
      const languages = [...(globalThis.navigator?.languages ?? []), globalThis.navigator?.language].filter(Boolean);
      const id = systemLocale(snapshot.locales, languages);
      if (id && id !== snapshot.active) ctx.locale.setLocale(id);
    };
    apply();
    return preferences.subscribe(apply);
  }, 'tpcowork: system language');

  // Reasoning and todo visibility are stylesheet switches on the body; later reasoning rows are marked as they render.
  ctx.effect(() => {
    let frame;
    let observer;
    const mark = () => { frame = undefined; markLaterReasoning(document); };
    const sync = () => {
      const { showReasoning, showTodos } = preferences.get();
      document.body.toggleAttribute('data-tpcowork-hide-todos', !showTodos);
      document.body.toggleAttribute('data-tpcowork-hide-reasoning', !showReasoning);
      if (showReasoning) { observer?.disconnect(); observer = undefined; return; }
      if (observer) return;
      mark();
      observer = new MutationObserver(() => { frame ??= requestAnimationFrame(mark); });
      observer.observe(document.body, { subtree: true, childList: true });
    };
    sync();
    const unsubscribe = preferences.subscribe(sync);
    return () => {
      unsubscribe();
      observer?.disconnect();
      if (frame !== undefined) cancelAnimationFrame(frame);
      document.body.removeAttribute('data-tpcowork-hide-todos');
      document.body.removeAttribute('data-tpcowork-hide-reasoning');
    };
  }, 'tpcowork: reasoning and todo visibility');

  ctx.inject(['uiSession'], scope => {
    scope.effect(() => watchQuestionAutoContinue(scope.uiSession, () => preferences.get().askAutoContinue,
      listener => preferences.subscribe(listener)), 'tpcowork: question auto-continue');
  });
}

/**
 * The native Language row with "System default" first, as in the reference product.
 * The native store stays the source of the list and the active id; the choice is mirrored into the preference.
 */
function languageAdapter(ctx, React, preferences, tp) {
  return (props, entry) => {
    const follow = React.useSyncExternalStore(preferences.subscribe, () => preferences.get().followSystemLanguage);
    const cache = React.useRef({});
    const useStore = React.useCallback(selector => props.useStore(state => {
      const memo = cache.current;
      if (memo.options !== state.options || memo.follow !== follow) {
        memo.options = state.options;
        memo.follow = follow;
        memo.value = { ...state, options: [{ id: 'system', label: tp('languageSystem') }, ...state.options] };
      }
      return selector({ ...memo.value, active: follow ? 'system' : state.active });
    }), [props.useStore, follow]);
    const setLocale = id => {
      preferences.set('followSystemLanguage', id === 'system');
      if (id !== 'system') props.setLocale(id);
    };
    return React.createElement(entry.component, { ...props, useStore, setLocale });
  };
}

/**
 * Re-register one native General row above its own registration with a new order and wording.
 * @param ctx - Client context.
 * @param React - Host React.
 * @param id - Native row id.
 * @param options - `order`, `wording` (native key → replacement factory) and an optional `adapt(props, entry)` renderer.
 */
export function adaptNativeGeneralRow(ctx, React, id, { order, wording = {}, adapt }) {
  ctx.slots.inject('settings.general.item', () => {
    let current;
    let dispose;
    const sync = () => {
      const entry = ctx.slots.entries('settings.general.item').find(row => row.options.id === id && (row.options.priority ?? 0) === 0);
      if (entry === current) return;
      current = entry;
      dispose?.();
      dispose = undefined;
      if (!entry) return;
      const Row = ({ t: upstream, ...props }) => {
        const t = React.useCallback((key, params) => (wording[key] ? wording[key]() : upstream(key, params)), [upstream]);
        return adapt ? adapt({ ...props, t }, entry) : React.createElement(entry.component, { ...props, t });
      };
      dispose = ctx.slots.register({ name: 'settings.general.item', ...entry.options, order, priority: -10,
        locale: entry.locale, inject: entry.inject, store: entry.store }, Row);
    };
    const stop = ctx.slots.subscribe('settings.general.item', sync);
    try { sync(); } catch (error) { stop(); throw error; }
    return () => { stop(); dispose?.(); };
  });
}
