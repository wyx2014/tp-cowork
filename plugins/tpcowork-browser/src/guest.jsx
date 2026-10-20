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
      const scale = capture ? 1 : visible ? zoom === 'fit' ? Math.min(1, rect.width / width, rect.height / height) : Number(zoom) / 100 : 1;
      const present = visible || Boolean(capture);
      const css = `position:fixed;left:${capture ? 0 : visible ? rect.left : 0}px;top:${capture ? 48 : visible ? rect.top : 48}px;width:${width}px;height:${height}px;clip-path:inset(0 ${visible && !capture ? Math.max(0, width - rect.width / scale) : 0}px ${visible && !capture ? Math.max(0, height - rect.height / scale) : 0}px 0);transform:scale(${scale});transform-origin:top left;visibility:${present ? 'visible' : 'hidden'};opacity:${capture ? 0.001 : 1};pointer-events:${visible && !capture ? 'auto' : 'none'};z-index:${capture ? -1 : 2};border:0;`;
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
