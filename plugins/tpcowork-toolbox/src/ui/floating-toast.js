export const floatingToastStyles = `
.tp-toolbox-toast-viewport { position:fixed; top:16px; left:50%; transform:translateX(-50%); z-index:1200; max-width:min(560px,calc(100vw - 32px)); width:max-content; pointer-events:none; display:grid; justify-items:center; gap:8px; }
[data-platform=darwin] .tp-toolbox-toast-viewport { top:calc(16px + var(--dsh-frame-top-clearance,0px)); }
.tp-toolbox-toast { display:flex; align-items:center; gap:10px; height:48px; min-height:48px; max-height:48px; max-width:100%; box-sizing:border-box; padding:8px 12px; border:1px solid var(--dsw-alias-border-l3); border-radius:12px; background:var(--dsw-alias-bg-layer-1); color:var(--dsw-alias-label-primary); box-shadow:0 6px 20px rgb(0 0 0 / 14%); backdrop-filter:blur(8px); font-family:inherit; font-size:13px; font-weight:500; line-height:20px; pointer-events:auto; animation:tp-toolbox-toast-in 160ms ease-out; }
.tp-toolbox-toast[data-state=success] { color:light-dark(#178146,#52c985); background:color-mix(in srgb,#178146 10%,var(--dsw-alias-bg-layer-1)); border-color:color-mix(in srgb,#178146 30%,transparent); }
.tp-toolbox-toast[data-state=failure] { color:light-dark(#d53030,#f87171); background:color-mix(in srgb,#d53030 10%,var(--dsw-alias-bg-layer-1)); border-color:color-mix(in srgb,#d53030 30%,transparent); }
.tp-toolbox-toast > svg { flex:none; width:16px; height:16px; }
.tp-toolbox-toast > span { min-width:0; flex:1; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
.tp-toolbox-toast button { flex:none; display:inline-flex; align-items:center; justify-content:center; box-sizing:border-box; min-height:28px; height:28px; max-height:28px; border:0; border-radius:6px; background:transparent; color:inherit; font:inherit; cursor:pointer; }
.tp-toolbox-toast button:hover { background:color-mix(in srgb,currentColor 8%,transparent); }
.tp-toolbox-toast button:focus-visible { outline:2px solid var(--dsw-alias-state-business-primary); outline-offset:1px; }
.tp-toolbox-toast button[aria-label] { width:28px; padding:0; }
.tp-toolbox-toast button:not([aria-label]) { padding:0 8px; white-space:nowrap; }
@keyframes tp-toolbox-toast-in { from { opacity:0; transform:translateY(-8px); } to { opacity:1; transform:translateY(0); } }
.tp-toolbox-toast-spinner { transform-origin:center; animation:tp-toolbox-toast-spin 800ms linear infinite; }
@keyframes tp-toolbox-toast-spin { to { transform:rotate(360deg); } }
@media (prefers-reduced-motion:reduce) { .tp-toolbox-toast,.tp-toolbox-toast-spinner { animation:none; } }
`

export function createFloatingToast(React, createPortal, renderSpinner) {
  const h = React.createElement
  const successDuration = 3500

  function useFloatingToast() {
    const [toast, setToast] = React.useState(null)
    const timer = React.useRef(null)
    const seq = React.useRef(0)
    const stopTimer = React.useCallback(() => {
      if (timer.current !== null) clearTimeout(timer.current)
      timer.current = null
    }, [])
    const clear = React.useCallback(() => {
      stopTimer()
      setToast(null)
    }, [stopTimer])
    const show = React.useCallback((state, message) => {
      stopTimer()
      setToast({ seq: ++seq.current, state, message })
      if (state !== 'pending') {
        timer.current = setTimeout(clear, state === 'failure' ? 8000 : successDuration)
      }
    }, [clear, stopTimer])
    React.useEffect(() => stopTimer, [stopTimer])
    return { toast, show, clear }
  }

  function FloatingToastStack({ entries, anchor }) {
    const [left, setLeft] = React.useState(null)
    const sequence = entries[0]?.toast.seq
    React.useLayoutEffect(() => {
      if (sequence === undefined) return
      const surface = anchor?.current?.closest('.tp-toolbox')
      if (!surface) { setLeft(null); return }
      const measure = () => {
        const rect = surface.getBoundingClientRect()
        setLeft(rect.width > 0 ? rect.left + rect.width / 2 : null)
      }
      measure()
      window.addEventListener('resize', measure)
      const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null
      observer?.observe(surface)
      return () => {
        window.removeEventListener('resize', measure)
        observer?.disconnect()
      }
    }, [sequence, anchor])
    if (!entries.length || typeof document === 'undefined') return null
    return createPortal(
      h('div', { className: 'tp-toolbox-toast-viewport', 'aria-live': 'polite', style: left === null ? undefined : { left } },
        entries.map(({ key, ...entry }) => h(ToastCard, { ...entry, key: key ?? entry.toast.seq }))),
      document.body,
    )
  }

  function ToastCard({ toast, closeLabel, onClose, action }) {
    const { seq, state, message } = toast
    const icon = (size, ...children) => h('svg', {
      width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
      strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
    }, ...children)
    return h('div', { key: seq, className: 'tp-toolbox-toast', role: state === 'failure' ? 'alert' : 'status', 'data-state': state },
      state === 'pending' ? renderSpinner?.() ?? icon(16, h('path', { className: 'tp-toolbox-toast-spinner', d: 'M20 12a8 8 0 1 1-8-8' }))
        : icon(16, h('circle', { cx: 12, cy: 12, r: 9 }), h('path', { d: state === 'success' ? 'm7 12 3 3 7-7' : 'M12 7v6m0 3v1' })),
      h('span', { title: message }, message),
      action ? h('button', { type: 'button', onClick: action.onClick }, action.label) : null,
      onClose ? h('button', { type: 'button', 'aria-label': closeLabel, onClick: onClose },
        icon(14, h('path', { d: 'm18 6-12 12M6 6l12 12' }))) : null)
  }

  function FloatingToast({ toast, anchor, closeLabel, cancelLabel, onCancel, onClose }) {
    return h(FloatingToastStack, { anchor, entries: toast ? [{
      toast, closeLabel, onClose: toast.state === 'pending' ? undefined : onClose,
      action: toast.state === 'pending' && onCancel && cancelLabel ? { label: cancelLabel, onClick: onCancel } : undefined,
    }] : [] })
  }

  return { FloatingToast, FloatingToastStack, useFloatingToast, successDuration }
}
