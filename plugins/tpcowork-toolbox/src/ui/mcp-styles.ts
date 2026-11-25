/** Match nanobot-gui's form controls within the toolbox breadcrumb editor. */
export const mcpStyles = `
.tp-mcp-modes { display:flex; flex-wrap:wrap; align-self:flex-start; gap:4px; padding:4px; border-radius:8px; background:var(--dsw-alias-interactive-bg-hover); }
.tp-mcp-modes button { gap:6px; padding:6px 12px; border-radius:6px; color:var(--dsw-alias-label-secondary); font-size:12px; }
.tp-mcp-modes button[aria-pressed=true] { color:var(--dsw-alias-label-primary); background:var(--dsw-alias-bg-base); box-shadow:0 1px 2px #0001; font-weight:500; }
.tp-mcp-body { min-width:0; }
.tp-mcp-fields { display:flex; flex-direction:column; gap:12px; min-width:0; margin:0; padding:0; border:0; }
.tp-mcp-fields .tp-toolbox-editor-field { gap:4px; font-size:12px; font-weight:500; line-height:20px; }
.tp-mcp-editor :is(input:not([type=file]),textarea,select) { width:100%; min-width:0; max-width:100%; height:36px; padding:6px 12px; border:1px solid var(--dsw-alias-border-l4); border-radius:8px; background:var(--dsw-alias-bg-layer-1); color:var(--dsw-alias-label-primary); font:inherit; font-size:13px; font-weight:400; line-height:22px; }
.tp-mcp-editor :is(input,textarea,select):focus { outline:none; border-color:var(--dsw-alias-state-business-primary); }
.tp-mcp-editor :is(input,textarea,select)::placeholder { color:var(--dsw-alias-label-caption); }
.tp-mcp-fields:disabled { opacity:.7; }
.tp-mcp-field-heading { display:flex; align-items:center; justify-content:space-between; gap:8px; color:var(--dsw-alias-label-secondary); font-size:12px; font-weight:500; }
.tp-mcp-field-heading label { font-size:12px; }
.tp-mcp-pairs { display:flex; flex-direction:column; gap:8px; }
.tp-mcp-pair { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1.3fr) 28px; align-items:center; gap:8px; }
.tp-mcp-argument { display:grid; grid-template-columns:minmax(0,1fr) 28px; align-items:center; gap:8px; margin-top:-4px; }
.tp-mcp-editor .tp-mcp-icon { width:28px; height:28px; min-height:28px; padding:0; border-radius:7px; color:var(--dsw-alias-label-secondary); }
.tp-mcp-advanced { padding-top:16px; border-top:1px solid var(--dsw-alias-border-l3); }
.tp-mcp-advanced summary { cursor:pointer; color:var(--dsw-alias-label-secondary); font-size:12px; }
.tp-mcp-advanced > div { padding-top:12px; }
.tp-mcp-timeouts { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px; }
.tp-mcp-editor .tp-mcp-modes button { min-height:30px; gap:6px; border-radius:6px; font-size:12px; }
.tp-mcp-editor .tp-mcp-outline { border:1px solid var(--dsw-alias-border-l4); background:var(--dsw-alias-bg-base); }
.tp-mcp-editor .tp-toolbox-editor-toolbar,.tp-mcp-editor .tp-toolbox-editor-actions { flex-wrap:wrap; }
.tp-mcp-feedback { margin:0 0 16px; padding:12px; border:1px solid var(--dsw-alias-border-l3); border-radius:8px; font-size:13px; line-height:20px; overflow-wrap:anywhere; }
.tp-mcp-fields + .tp-mcp-feedback { margin:16px 0 0; }
.tp-mcp-editor .tp-mcp-feedback.error,.tp-mcp-error { color:var(--dsw-alias-state-error-primary); }
.tp-mcp-feedback.success { color:var(--dsw-alias-state-success-primary,#047857); }
.tp-mcp-editor .tp-mcp-json { height:220px; min-height:190px; max-height:300px; resize:vertical; font-family:monospace; font-size:12px; }
.tp-mcp-import-entry { display:flex; flex-direction:column; gap:8px; padding:12px 0; border-top:1px solid var(--dsw-alias-border-l3); font-size:12px; }
.tp-mcp-import-entry p { margin:0; }
.tp-mcp-import-name { display:flex; flex-wrap:wrap; gap:8px; overflow-wrap:anywhere; }
.tp-mcp-import-name span { color:var(--dsw-alias-label-tertiary); }
@container toolbox (max-width:520px) { .tp-mcp-timeouts { gap:10px; }.tp-mcp-editor .tp-toolbox-editor-actions { justify-content:flex-end; margin-left:auto; } }
`
