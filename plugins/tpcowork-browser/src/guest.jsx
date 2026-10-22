import React, { useLayoutEffect, useRef } from 'react';

/** Keep every webview at one DOM position for its entire native guest lifetime. */
export function Guest({ row, surface, anchor, request, fail }) {
  const ref = useRef();
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || !row.lease) return;
    let frame;
    let acknowledged;
    let last = '';
    const layout = () => {
      const target = anchor(row.id);
      const capture = surface?.tabId === row.id ? surface : null;
      const rect = target?.getBoundingClientRect();
      const visible = Boolean(rect && rect.width > 1 && rect.height > 1);
      const viewport = capture?.viewport ?? row.viewport;
      const width = viewport?.width ?? (visible ? rect.width : 1280);
      const height = viewport?.height ?? (visible ? rect.height : 720);
      const zoom = target?.dataset.browserZoom ?? 'fit';
      // A responsive frame publishes its exact scale; otherwise the page fits its anchor.
      const explicit = Number(target?.dataset.browserScale);
      const scale = capture ? 1 : visible ? explicit > 0 ? explicit : zoom === 'fit' ? Math.min(1, rect.width / width, rect.height / height) : Number(zoom) / 100 : 1;
      // Clip to the part of the anchor that its scrolling canvas actually shows.
      const clip = visible ? target.closest('[data-browser-clip]')?.getBoundingClientRect() ?? rect : undefined;
      const inset = clip && !capture ? [
        Math.max(0, Math.max(rect.top, clip.top) - rect.top) / scale,
        Math.max(0, rect.left + width * scale - Math.min(rect.right, clip.right)) / scale,
        Math.max(0, rect.top + height * scale - Math.min(rect.bottom, clip.bottom)) / scale,
        Math.max(0, Math.max(rect.left, clip.left) - rect.left) / scale,
      ] : [0, 0, 0, 0];
      // The pane hides the page behind its empty, error and crashed states, as the reference hides its webview.
      const hidden = target?.dataset.browserHidden === 'true';
      const shown = visible && !hidden && (capture || (inset[0] + inset[2] < height && inset[1] + inset[3] < width));
      const present = shown || Boolean(capture);
      const css = `position:fixed;left:${capture ? 0 : visible ? rect.left : 0}px;top:${capture ? 48 : visible ? rect.top : 48}px;width:${width}px;height:${height}px;clip-path:inset(${inset.map(value => `${value}px`).join(' ')});transform:scale(${scale});transform-origin:top left;visibility:${present ? 'visible' : 'hidden'};opacity:${capture ? 0.001 : 1};pointer-events:${shown && !capture ? 'auto' : 'none'};z-index:${capture ? -1 : 2};border:0;`;
      if (last !== css) { element.style.cssText = css; last = css; }
      if (capture && row.ready && acknowledged !== capture.requestId) {
        acknowledged = capture.requestId;
        requestAnimationFrame(() => requestAnimationFrame(() => { void request('surfaceReady', { ...capture, surfaceScale: 1 }).catch(fail); }));
      }
      frame = requestAnimationFrame(layout);
    };
    layout();
    return () => cancelAnimationFrame(frame);
  }, [row.id, row.lease, row.ready, row.viewport, surface, anchor, request, fail]);
  if (!row.lease) return null;
  return <div ref={ref} className="tpcb-guest-host"><webview style={{width:'100%',height:'100%',display:'flex'}} name={row.lease} partition={row.partition} src={row.bootstrap} allowpopups="true" data-sidebar-browser-frame="webview" data-tpcowork-guest={row.id} /></div>;
}
