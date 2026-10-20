/** Compact store rows follow nanobot-gui and use the current app's theme tokens. */
export const storeStyles = `
.tp-store-list { display:flex; flex-direction:column; gap:8px; }
.tp-store-card { display:flex; align-items:center; min-width:0; gap:8px; padding:0 10px 0 0; border:.5px solid var(--dsw-alias-border-l3); border-radius:var(--dsw-radius-md); background:var(--dsw-alias-bg-layer-1); transition:border-color .15s,background .15s; }
.tp-store-card:hover,.tp-store-card:focus-within { border-color:var(--dsw-alias-border-l4); background:var(--dsw-alias-interactive-bg-hover); }
.tp-toolbox .tp-store-open { display:flex; flex:1; justify-content:flex-start; gap:12px; min-width:0; padding:12px; text-align:left; }
.tp-toolbox .tp-store-open:hover:not(:disabled) { background:transparent; }
.tp-store-icon { display:flex; align-items:center; justify-content:center; flex-shrink:0; width:36px; height:36px; border-radius:8px; color:var(--dsw-alias-label-tertiary); background:var(--dsw-alias-interactive-bg-hover); }
.tp-store-card-body { display:flex; flex:1; flex-direction:column; min-width:0; gap:3px; }
.tp-store-card-title { display:flex; align-items:center; flex-wrap:wrap; gap:6px; min-width:0; }
.tp-store-name { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:100%; font-size:14px; line-height:22px; font-weight:500; }
.tp-store-description,.tp-store-tags { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--dsw-alias-label-secondary); font-size:12px; line-height:20px; }
.tp-store-tags { color:var(--dsw-alias-label-tertiary); font-size:11px; line-height:18px; }
.tp-store-badge { flex-shrink:0; border:1px solid color-mix(in srgb,currentColor 16%,transparent); border-radius:4px; padding:0 5px; font-size:10px; line-height:17px; font-weight:400; white-space:nowrap; }
.tp-store-badge[data-tone=store] { color:light-dark(#aa531a,#edaa73); background:light-dark(#fff4e9,#38291d); }
.tp-store-badge[data-tone=installed] { color:light-dark(#287653,#78c9a4); background:light-dark(#edf8f1,#1c332b); }
.tp-store-badge[data-tone=pending] { color:light-dark(#94701d,#d9bc6c); background:light-dark(#fff9e6,#352f1d); }
.tp-store-badge[data-tone=rejected] { color:var(--dsw-alias-state-error-primary); background:color-mix(in srgb,currentColor 6%,transparent); }
.tp-toolbox .tp-store-download { flex-shrink:0; width:32px; height:32px; min-height:32px; padding:0; color:var(--dsw-alias-label-secondary); opacity:0; transition:opacity .15s,color .15s; }
.tp-store-card:hover .tp-store-download,.tp-store-card:focus-within .tp-store-download,.tp-store-download:disabled { opacity:1; }
.tp-toolbox .tp-store-download:hover:not(:disabled) { color:light-dark(#aa531a,#edaa73); background:color-mix(in srgb,currentColor 8%,transparent); }
.tp-toolbox .tp-store-loading { display:flex; align-items:center; justify-content:center; gap:10px; min-height:220px; margin:0; padding:24px; background:transparent; color:var(--dsw-alias-label-tertiary); font-size:13px; }
.tp-store-spinner { transform-origin:center; animation:tp-store-spin 1s linear infinite; }
@keyframes tp-store-spin { to { transform:rotate(360deg); } }
.tp-store-more { display:flex; justify-content:center; margin-top:20px; }
.tp-store-detail-meta,.tp-store-detail-tags { display:flex; align-items:center; flex-wrap:wrap; gap:8px; color:var(--dsw-alias-label-secondary); font-size:12px; }
.tp-store-detail-tags { margin-top:-16px; }
.tp-store-detail-tags > span { padding:2px 8px; border:.5px solid var(--dsw-alias-border-l3); border-radius:4px; }
.tp-store-detail .tp-toolbox-content { max-height:65vh; overflow:auto; }
@media (hover:none) { .tp-toolbox .tp-store-download { opacity:1; } }
@media (prefers-reduced-motion:reduce) { .tp-store-spinner { animation:none; } }
@container toolbox (max-width:480px) { .tp-toolbox .tp-store-open { gap:8px; padding:10px; }.tp-store-icon { width:30px; height:30px; }.tp-toolbox .tp-store-download { opacity:1; } }
`
