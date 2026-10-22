/**
 * The right-pane browser chrome, ported from the reference's EmbeddedBrowserPaneParts,
 * BrowserViewportToolbar, BrowserViewportSurface, ResponsiveBrowserViewport and
 * ResponsiveBrowserResizeHandles. The page itself is the native guest laid over `anchorRef`.
 */
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { isCertificateBrowserLoadErrorCode } from '../vendor/tpcowork/packages/ui/src/embeddedBrowserHelpers.ts';
import { Icon } from './icons.jsx';
import { LIMITS, ViewportInputs } from './viewport.jsx';

/** The reference's BROWSER_VIEWPORT_ZOOM_OPTIONS (shared/browser-use/command-metadata.ts), kept local so the Client bundle has no Zod. */
const BROWSER_VIEWPORT_ZOOM_OPTIONS = ['fit', '50', '75', '100', '125', '150', '200'];
/** Fit leaves the reference's p-4 canvas padding on every side. */
export const CANVAS_PADDING = 16;
/** The reference's default free-size viewport for a person entering responsive mode. */
export const DEFAULT_RESPONSIVE_VIEWPORT = { width: 393, height: 852 };

/** The reference's resolveBrowserViewportScale, at desktop zoom 1. */
export function viewportScale(canvas, viewport, zoom) {
  if (zoom !== 'fit') return Number(zoom) / 100;
  if (!canvas || canvas.width <= 0 || canvas.height <= 0) return 1;
  const width = Math.max(0, canvas.width - CANVAS_PADDING * 2), height = Math.max(0, canvas.height - CANVAS_PADDING * 2);
  if (width === 0 || height === 0) return 1;
  return Math.min(1, width / viewport.width, height / viewport.height);
}

function IconButton({ icon, label, disabled = false, active = false, pressed, onClick, spin = false, ...props }) {
  return <button type="button" className={`tpcb-icon-button${active ? ' tpcb-active' : ''}`} title={label} aria-label={label}
    aria-pressed={pressed} disabled={disabled} onClick={onClick} {...props}><Icon name={icon} className={spin ? 'tpcb-spin' : undefined} /></button>;
}

/**
 * Fixed-position UI above the native page. The page is composed in the shell overlay over this pane,
 * so floating chrome joins it at document level, as the reference's DOM-composed webview allows.
 */
export function Floating({ anchor, place, className, children, role, ...props }) {
  const element = useRef();
  useLayoutEffect(() => {
    let frame;
    const follow = () => {
      const target = anchor.current;
      const node = element.current;
      if (target && node) {
        const rect = target.getBoundingClientRect();
        const style = place(rect, node.getBoundingClientRect());
        node.style.left = `${Math.round(style.left)}px`;
        node.style.top = `${Math.round(style.top)}px`;
        // A placement may also size the element, as a cover over the whole surface does.
        if (style.width !== undefined) { node.style.width = `${Math.round(style.width)}px`; node.style.height = `${Math.round(style.height)}px`; }
        node.style.visibility = rect.width > 0 && rect.height > 0 ? 'visible' : 'hidden';
      }
      frame = requestAnimationFrame(follow);
    };
    follow();
    return () => cancelAnimationFrame(frame);
  }, [anchor, place]);
  return createPortal(<div ref={element} className={`tpcb-floating ${className ?? ''}`} role={role} {...props}>{children}</div>, document.body);
}
const below = align => (rect, own) => ({ top: rect.bottom + 6, left: align === 'start' ? rect.left : rect.right - own.width });

/** A small anchored menu or popover that closes on outside press or Escape. */
function Popup({ trigger, children, align = 'end', className = '' }) {
  const [open, setOpen] = useState(false);
  const root = useRef();
  const panel = useRef();
  useEffect(() => {
    if (!open) return;
    const outside = event => { if (!root.current?.contains(event.target) && !panel.current?.contains(event.target)) setOpen(false); };
    const escape = event => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', escape, true);
    window.addEventListener('blur', () => setOpen(false), { once: true });
    return () => { document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', escape, true); };
  }, [open]);
  const [place] = useState(() => below(align));
  return <div className="tpcb-popup-root" ref={root}>
    {trigger({ open, toggle: () => setOpen(value => !value) })}
    {open && <Floating anchor={root} place={place} className={`tpcb-popup ${className}`}><div ref={panel}>{children(() => setOpen(false))}</div></Floating>}
  </div>;
}

/** The reference's "…" menu: open externally and developer tools, plus this plugin's page controls. */
export function MoreMenu({ items, t }) {
  return <Popup trigger={({ open, toggle }) => <IconButton icon="Ellipsis" label={t('more')} pressed={open} onClick={toggle} aria-haspopup="menu" aria-expanded={open} />}>
    {close => <div role="menu" aria-label={t('more')}>
      {items.map((item, index) => item.separator ? <div key={index} className="tpcb-menu-separator" role="separator" />
        : <button key={index} type="button" role="menuitem" className="tpcb-menu-item" disabled={item.disabled}
          onClick={() => { close(); item.onSelect(); }}>{item.icon ? <Icon name={item.icon} /> : <span className="tpcb-menu-spacer" />}<span>{item.label}</span></button>)}
    </div>}
  </Popup>;
}

/** The reference's site-settings entry in the address bar; this pane edits the origin's permissions in place. */
export function SiteSettings({ origin, rules, onChange, t }) {
  return <Popup align="start" className="tpcb-site-popup" trigger={({ open, toggle }) =>
    <IconButton icon="SlidersHorizontal" label={t('siteInfo')} pressed={open} onClick={toggle} className="tpcb-icon-button tpcb-round" />}>
    {() => <div className="tpcb-site">
      <div className="tpcb-site-origin">{origin}</div>
      {Object.keys(rules ?? {}).length === 0 ? <p>{t('noSitePermissions')}</p>
        : Object.entries(rules).map(([permission, value]) => <label key={permission} className="tpcb-permission-rule">{permission}
          <select aria-label={`${origin} ${permission}`} value={value} onChange={event => onChange(permission, event.target.value)}>
            {['ask', 'allow', 'deny'].map(option => <option key={option} value={option}>{t(option)}</option>)}</select></label>)}
    </div>}
  </Popup>;
}

/** The reference's BrowserToolbar. */
export function BrowserToolbar({ row, address, editing, onAddressChange, onAddressFocus, onAddressBlur, onSubmit, onBack, onForward, onReload,
  responsive, onToggleResponsive, siteControl, menu, t }) {
  return <form className="tpcb-toolbar" onSubmit={onSubmit}>
    <IconButton icon="ChevronLeft" label={t('back')} disabled={!row?.canGoBack} onClick={onBack} />
    <IconButton icon="ChevronRight" label={t('forward')} disabled={!row?.canGoForward} onClick={onForward} />
    <IconButton icon="RefreshCw" label={t('reload')} disabled={!row?.ready} onClick={onReload} spin={row?.loading === true} />
    <div className="tpcb-address">
      <input aria-label={t('address')} placeholder={t('address')} value={address} spellCheck={false}
        onChange={event => onAddressChange(event.target.value)} onFocus={onAddressFocus} onBlur={onAddressBlur} />
      {/* Hidden, not unmounted, while the URL is being edited. */}
      {siteControl && <div className="tpcb-address-site" hidden={editing}>{siteControl}</div>}
    </div>
    <IconButton icon="MonitorSmartphone" label={t(responsive ? 'responsiveExit' : 'responsiveEnter')} active={responsive} pressed={responsive} onClick={onToggleResponsive} />
    {menu}
  </form>;
}

/** The reference's BrowserViewportToolbar: centered size inputs and the zoom choice. */
export function ViewportToolbar({ viewport, zoom, onViewportChange, onZoomChange, t }) {
  return <div className="tpcb-viewport-toolbar">
    <ViewportInputs viewport={viewport} onChange={onViewportChange} t={t} />
    <select className="tpcb-zoom" aria-label={t('zoom')} value={zoom} onChange={event => onZoomChange(event.target.value)}>
      {BROWSER_VIEWPORT_ZOOM_OPTIONS.map(option => <option key={option} value={option}>{option === 'fit' ? t('fitToWindow') : `${option}%`}</option>)}
    </select>
  </div>;
}

const EDGES = [
  { key: 'left', width: -1, height: 0 }, { key: 'right', width: 1, height: 0 },
  { key: 'top', width: 0, height: -1 }, { key: 'bottom', width: 0, height: 1 },
  { key: 'top-left', width: -1, height: -1 }, { key: 'top-right', width: 1, height: -1 },
  { key: 'bottom-left', width: -1, height: 1 }, { key: 'bottom-right', width: 1, height: 1 },
];
const clamp = (value, min, max) => Math.min(max, Math.max(min, Math.round(value)));
const clampViewport = size => ({ width: clamp(size.width, LIMITS.minWidth, LIMITS.maxWidth), height: clamp(size.height, LIMITS.minHeight, LIMITS.maxHeight) });

/**
 * The reference's ResponsiveBrowserResizeHandles on the centered frame. A drag previews the size and
 * applies it on release; focused handles take arrow keys (1 CSS px, 10 with Shift), as in the reference.
 */
function ResizeHandles({ viewport, scale, onResize, t }) {
  const drag = useRef(null);
  const [preview, setPreview] = useState(null);
  const sized = (current, event) => clampViewport({
    width: current.start.width + ((event.clientX - current.x) / scale) * current.edge.width,
    height: current.start.height + ((event.clientY - current.y) / scale) * current.edge.height,
  });
  const finish = (event, commit = true) => {
    const current = drag.current;
    if (!current || (event && current.pointerId !== event.pointerId)) return;
    drag.current = null;
    setPreview(null);
    const next = event && commit ? sized(current, event) : null;
    if (next && (next.width !== viewport.width || next.height !== viewport.height)) onResize(next);
  };
  useEffect(() => {
    const blur = () => { drag.current = null; setPreview(null); };
    window.addEventListener('blur', blur);
    return () => window.removeEventListener('blur', blur);
  }, []);
  return <>
    {preview && <div className="tpcb-resize-preview" aria-hidden="true" style={{ width: preview.width * scale, height: preview.height * scale }}><span>{preview.width} × {preview.height}</span></div>}
    {EDGES.map(edge => <div key={edge.key} role="separator" tabIndex={0} className={`tpcb-handle tpcb-handle-${edge.key}`}
      aria-label={edge.width && edge.height ? t('resizeCorner') : edge.width ? t('resizeWidth') : t('resizeHeight')}
      aria-orientation={edge.width && !edge.height ? 'vertical' : 'horizontal'}
      aria-valuenow={edge.width ? viewport.width : viewport.height}
      aria-valuemin={edge.width ? LIMITS.minWidth : LIMITS.minHeight} aria-valuemax={edge.width ? LIMITS.maxWidth : LIMITS.maxHeight}
      onPointerDown={event => {
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        event.preventDefault(); event.stopPropagation();
        try { event.currentTarget.setPointerCapture?.(event.pointerId); } catch {}
        drag.current = { edge, pointerId: event.pointerId, x: event.clientX, y: event.clientY, start: viewport };
        setPreview(viewport);
      }}
      onPointerMove={event => {
        const current = drag.current;
        if (!current || current.pointerId !== event.pointerId) return;
        // A released mouse button ends the gesture even if the pointerup was lost to the system.
        if (event.pointerType === 'mouse' && (event.buttons & 1) === 0) { finish(event); return; }
        setPreview(sized(current, event));
      }}
      onPointerUp={event => finish(event)} onPointerCancel={event => finish(event, false)} onLostPointerCapture={event => finish(event)}
      onKeyDown={event => {
        const step = event.shiftKey ? 10 : 1;
        let next;
        if (edge.width && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) next = { ...viewport, width: viewport.width + (event.key === 'ArrowRight' ? step : -step) * edge.width };
        if (edge.height && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) next = { ...viewport, height: viewport.height + (event.key === 'ArrowDown' ? step : -step) * edge.height };
        if (!next) return;
        event.preventDefault();
        next = clampViewport(next);
        if (next.width !== viewport.width || next.height !== viewport.height) onResize(next);
      }} />)}
  </>;
}

/** The reference's empty, load-error and crashed-page states over the page area. */
export function PageState({ kind, message, certificate, onRetry, t }) {
  if (kind === 'error' || kind === 'crashed') return <div className="tpcb-state" role="alert">
    <Icon name="TriangleAlert" size={64} className="tpcb-state-icon tpcb-warn" />
    <h3>{t(kind === 'crashed' ? 'crashedTitle' : certificate ? 'certErrorTitle' : 'loadErrorTitle')}</h3>
    {message && <p className="tpcb-state-detail">{message}</p>}
    {kind === 'error' && certificate && <p>{t('certErrorHint')}</p>}
    {onRetry && <button type="button" className="tpcb-outline-button" onClick={onRetry}><Icon name="RefreshCw" />{t('retry')}</button>}
  </div>;
  return <div className="tpcb-state">
    <Icon name={kind === 'starting' ? 'Loader' : 'Globe'} size={64} className={`tpcb-state-icon${kind === 'starting' ? ' tpcb-spin' : ''}`} />
    <h3>{t('title')}</h3>
    <p>{t(kind === 'unavailable' ? 'unavailable' : 'empty')}</p>
    {onRetry && <button type="button" className="tpcb-outline-button" onClick={onRetry}>{t('restore')}</button>}
  </div>;
}

/**
 * The reference's BrowserViewportSurface and ResponsiveBrowserViewport. In responsive mode the
 * page is a centered, ringed frame on the alternate background; the guest is laid over the frame.
 */
const LAYOUT_SETTLE_MS = 500;
const topCenter = (rect, own) => ({ top: rect.top + 8, left: rect.left + (rect.width - own.width) / 2 });
const bottomCenter = (rect, own) => ({ top: rect.bottom - own.height - 16, left: rect.left + (rect.width - own.width) / 2 });

export function BrowserSurface({ anchorRef, responsive, viewport, zoom, onResize, overlay, hidePage, banner, warning, resized, zoomLabel, t }) {
  const canvasRef = useRef();
  const surfaceRef = useRef();
  const [canvas, setCanvas] = useState(null);
  // Layout the pane causes itself (entering free-size mode, a new page size) settles before
  // a size change counts as the person's resize, as in the reference's agent-layout settle window.
  const settleUntil = useRef(0);
  useLayoutEffect(() => { settleUntil.current = Date.now() + LAYOUT_SETTLE_MS; }, [responsive, viewport.width, viewport.height]);
  useLayoutEffect(() => {
    const element = canvasRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    let last;
    const update = ({ width, height }) => {
      // A hidden pane reports 0×0; it has no layout authority and must not reset Fit.
      if (width <= 0 || height <= 0) return;
      if (last && Date.now() > settleUntil.current && (Math.abs(last.width - width) > 1 || Math.abs(last.height - height) > 1)) resized?.();
      last = { width, height };
      setCanvas(previous => previous?.width === width && previous?.height === height ? previous : { width, height });
    };
    const rect = element.getBoundingClientRect();
    update({ width: rect.width, height: rect.height });
    const observer = new ResizeObserver(([entry]) => update(entry.contentRect));
    observer.observe(element);
    return () => observer.disconnect();
  }, [resized]);
  const scale = responsive ? viewportScale(canvas, viewport, zoom) : 1;
  return <div className="tpcb-surface" ref={surfaceRef}>
    {warning && <Floating anchor={surfaceRef} place={topCenter} className="tpcb-resize-warning" role="status" aria-live="polite"><span className="tpcb-warning-accent" /><Icon name="TriangleAlert" className="tpcb-warn" /><span>{t('resizeWarning')}</span></Floating>}
    {banner && <Floating anchor={surfaceRef} place={bottomCenter} className="tpcb-control-banner" role="status">{banner}</Floating>}
    <div ref={canvasRef} className={`tpcb-canvas${responsive ? ' tpcb-canvas-responsive' : ''}`} data-browser-clip="" data-responsive-browser-mode={responsive ? 'active' : 'inactive'}>
      <div className={responsive ? 'tpcb-canvas-center' : 'tpcb-canvas-fill'}>
        <div className={responsive ? 'tpcb-frame' : 'tpcb-frame-fill'} style={responsive ? { width: viewport.width * scale, height: viewport.height * scale } : undefined}>
          <div ref={anchorRef} className="tpcb-page" aria-label={zoomLabel} data-browser-scale={responsive ? String(scale) : undefined} data-browser-hidden={hidePage ? 'true' : undefined}
            style={responsive ? { width: viewport.width, height: viewport.height, transform: `scale(${scale})`, transformOrigin: 'top left' } : undefined} />
          {overlay}
          {responsive && <div className="tpcb-handles" style={{ width: viewport.width * scale, height: viewport.height * scale }}>
            <ResizeHandles viewport={viewport} scale={scale} onResize={onResize} t={t} /></div>}
        </div>
      </div>
    </div>
  </div>;
}

export function useStableCallback(callback) {
  const ref = useRef(callback);
  ref.current = callback;
  return useCallback((...args) => ref.current(...args), []);
}
