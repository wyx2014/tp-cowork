/** Keep the workbench inaccessible until the shared native SkillHub account has been verified. */
export function createLoginGate(React, primitives, brandIcon) {
  const h = React.createElement;
  const { Button, Modal } = primitives;
  const logo = h('div', { className: 'tpcowork-login-logo' },
    h('img', { src: brandIcon, alt: '', width: 64, height: 64, draggable: false }));
  const spinner = h('span', { className: 'tpcowork-login-spinner', 'aria-hidden': true });
  return function LoginGate({ account, startSignIn, cancelSignIn, refreshAccount, t }) {
    const state = React.useSyncExternalStore(account.subscribe, account.getSnapshot);
    const page = React.useRef(null);
    const authenticated = state.status === 'signed_in' && state.phase === 'idle';
    React.useLayoutEffect(() => {
      if (authenticated) return;
      // Modal portals outside the shell. Hide and disable every other body surface, including later portals.
      const overlay = page.current?.closest('[data-dsh-modal-part="overlay"]');
      if (!overlay) return;
      const document = overlay.ownerDocument;
      const blocked = new Map();
      const hideWorkbench = () => {
        for (const element of document.body.children) {
          if (element === overlay || element.matches('script, style, link') || blocked.has(element)) continue;
          blocked.set(element, ['hidden', 'inert', 'aria-hidden'].map(name => element.getAttribute(name)));
          element.setAttribute('hidden', '');
          element.setAttribute('inert', '');
          element.setAttribute('aria-hidden', 'true');
        }
      };
      hideWorkbench();
      const observer = new MutationObserver(hideWorkbench);
      observer.observe(document.body, { childList: true });
      return () => {
        observer.disconnect();
        for (const [element, values] of blocked) {
          ['hidden', 'inert', 'aria-hidden'].forEach((name, index) => {
            if (values[index] === null) element.removeAttribute(name);
            else element.setAttribute(name, values[index]);
          });
        }
      };
    }, [authenticated]);
    const waiting = state.phase === 'waiting' || state.phase === 'committing';
    const checking = state.status === 'loading';
    if (authenticated) return null;
    const unavailable = state.status === 'unavailable' || state.status === 'unconfigured';
    let message;
    if (!waiting && !checking) {
      if (state.error === 'timeout') message = 'authTimeout';
      else if (state.status === 'expired') message = 'authExpired';
      else if (unavailable || state.error) message = 'loginUnavailable';
    }
    let actionLabel = 'loginAction';
    if (checking) actionLabel = 'authLoading';
    else if (waiting) actionLabel = state.phase === 'committing' ? 'authCommitting' : 'loginWaiting';
    return h(Modal, { open: true, headless: true, onClose: () => {}, title: t('loginTitle'), className: 'tpcowork-login-modal' },
      h('main', { ref: page, className: 'tpcowork-login-page', 'aria-labelledby': 'tpcowork-login-title' },
      h('div', { className: 'tpcowork-login-drag', 'aria-hidden': true }),
      h('section', { className: 'tpcowork-login-card' },
        h('header', { className: 'tpcowork-login-heading' }, logo,
          h('h1', { id: 'tpcowork-login-title' }, t('loginTitle'))),
        h('div', { className: 'tpcowork-login-actions' },
          message ? h('p', { className: 'tpcowork-login-notice', role: 'alert' }, t(message)) : null,
          h(Button, { variant: 'primary', className: 'tpcowork-login-primary',
            disabled: checking || waiting || state.status === 'unconfigured', 'data-modal-autofocus': true,
            onClick: () => { void startSignIn(); } }, checking || waiting ? spinner : null, t(actionLabel)),
          waiting ? h(Button, { variant: 'outline', onClick: () => { void cancelSignIn(); } }, t('cancelSignIn')) : null,
          unavailable ? h(Button, { variant: 'outline', onClick: () => { void refreshAccount(); } }, t('loginRetry')) : null))));
  };
}
