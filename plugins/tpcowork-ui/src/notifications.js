/**
 * System notifications for Session results and requests, after the reference desktop's task notifications:
 * the renderer decides what happened and localizes it, the desktop shell decides whether to show it.
 */
const NOTIFICATIONS_ENABLED_KEY = 'tpcowork-notification-enabled';
const SESSION_TARGET = 'session:';

function notificationsEnabled() {
  try { return globalThis.localStorage?.getItem(NOTIFICATIONS_ENABLED_KEY) !== 'false'; }
  catch (_error) { return true; }
}

/**
 * Announce observed Session edges: a run that stops, and each new approval, question or plan review.
 * A Session's first observed status is its silent baseline, so restored history never notifies.
 * @param services - `sessions`, `uiSession` and `uiWorkspace` from the Client.
 * @param bridge - `dshDesktop.notifications`.
 * @param t - Localized copy in the `tpcowork` namespace.
 * @returns Stop observing and release the click subscription.
 */
export function watchSessionNotifications({ sessions, uiSession, uiWorkspace }, bridge, t) {
  let previous;
  let pendingKeys = new Set();
  const show = (sessionId, key, title, body) => {
    void bridge.show({ id: `${SESSION_TARGET}${sessionId}`, key, title, body }).catch(() => {});
  };
  const observe = () => {
    const status = uiSession.sessionStatus.getSnapshot();
    const rows = sessions.list.getSnapshot().byId;
    const before = previous;
    const seen = pendingKeys;
    previous = status;
    // A request keeps its key until answered; new requests always carry new keys.
    pendingKeys = new Set([...status.values()].flatMap(entry => entry.pendingInteraction ? [entry.pendingInteraction.key] : []));
    if (before === undefined || !notificationsEnabled()) return;
    for (const [sessionId, current] of status) {
      const was = before.get(sessionId);
      if (was === undefined) continue;
      const row = rows[sessionId];
      // Subagents report through their parent; scheduled runs are announced by Automation with their result.
      if (!row || row.origin === 'subagent' || row.parentId || sessionId.startsWith('automation-')) continue;
      const title = row.displayTitle?.trim();
      const task = title ? t('notifyTask', { title }) : undefined;
      const pending = current.pendingInteraction;
      if (pending && current.running === true && !seen.has(pending.key)) {
        if (pending.kind === 'approval') show(sessionId, `pending:${pending.key}`, t('notifyApproval'), pending.reason?.trim() || task || t('notifyApproval'));
        else if (pending.kind === 'plan-review') show(sessionId, `pending:${pending.key}`, t('notifyPlan'), t('notifyPlanBody'));
        else show(sessionId, `pending:${pending.key}`, t('notifyQuestion'), pending.questions?.[0]?.question?.trim() || task || t('notifyQuestion'));
      } else if (was.running === true && current.running === false && !pending) {
        show(sessionId, `completed:${sessionId}`, t('notifyCompleted'), task || t('notifyCompleted'));
      }
    }
  };
  const unsubscribe = uiSession.sessionStatus.subscribe(observe);
  const unclick = bridge.subscribe(id => {
    if (id.startsWith(SESSION_TARGET)) uiWorkspace.openSession(id.slice(SESSION_TARGET.length));
  });
  observe();
  return () => { unsubscribe(); unclick(); };
}

/** The General settings switch shared with Automation results. */
export function createNotificationSetting(React, primitives) {
  const h = React.createElement;
  return function NotificationSetting({ t }) {
    const [enabled, setEnabled] = React.useState(notificationsEnabled);
    const change = next => {
      try { globalThis.localStorage?.setItem(NOTIFICATIONS_ENABLED_KEY, String(next)); }
      catch (_error) { /* Storage unavailable: the switch still applies for this run. */ }
      setEnabled(next);
    };
    return h('div', { className: 'tpcowork-setting-row' },
      h('div', null,
        h('div', { className: 'tpcowork-setting-title' }, t('notifyTitle')),
        h('div', { className: 'tpcowork-setting-description' }, t('notifyDescription'))),
      h(primitives.Switch, { checked: enabled, label: t('notifyTitle'), onChange: change }));
  };
}
