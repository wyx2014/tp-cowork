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
 * Show a notification without sound through the page's Notification API, skipped while the window has focus
 * like the desktop bridge.
 * @returns Whether this path handled the notice; false sends it through the bridge instead.
 */
export function showSilently(title, body, tag, open) {
  const Native = globalThis.Notification;
  if (typeof Native !== 'function' || Native.permission !== 'granted') return false;
  if (globalThis.document?.hasFocus?.()) return true;
  try {
    const notification = new Native(title, { body, tag, silent: true });
    notification.onclick = () => { globalThis.focus?.(); open(); notification.close(); };
    return true;
  } catch (_error) { return false; }
}

/**
 * Announce observed Session edges: a run that stops, and each new approval, question or plan review.
 * A Session's first observed status is its silent baseline, so restored history never notifies.
 * @param services - `sessions`, `uiSession` and `uiWorkspace` from the Client.
 * @param bridge - `dshDesktop.notifications`.
 * @param t - Localized copy in the `tpcowork` namespace.
 * @param sound - Whether notifications may play the system sound; defaults to on.
 * @returns Stop observing and release the click subscription.
 */
export function watchSessionNotifications({ sessions, uiSession, uiWorkspace }, bridge, t, sound = () => true) {
  let previous;
  let pendingKeys = new Set();
  const show = (sessionId, key, title, body) => {
    const id = `${SESSION_TARGET}${sessionId}`;
    // The desktop bridge always plays the system sound; a silent notice uses the page's own notification instead.
    if (sound() || !showSilently(title, body, key, () => uiWorkspace.openSession(sessionId))) {
      void bridge.show({ id, key, title, body }).catch(() => {});
    }
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
