/** Match the automation page's content width, typography, controls and list rhythm. */
import { teamStyles } from './teams/styles.ts'
import { storeStyles } from './prompthub/styles.ts'
import { mcpStyles } from './mcp-styles.ts'

export const styles = `
.tp-toolbox-sidebar-icon { display:block; flex-shrink:0; }
.tp-toolbox { min-width:0; min-height:0; width:100%; height:100%; overflow:auto; container-type:inline-size; container-name:toolbox; color:var(--dsw-alias-label-primary); background:var(--dsw-alias-bg-base); font-family:inherit; font-size:14px; line-height:1.6; }
.tp-toolbox *,.tp-toolbox *::before,.tp-toolbox *::after,.tp-toolbox-dialog * { box-sizing:border-box; }
.tp-toolbox-content-wrap { max-width:1056px; margin:0 auto; padding:0 clamp(24px,4vw,48px) 48px; }
.tp-toolbox p { margin:6px 0 14px; overflow-wrap:anywhere; }
.tp-toolbox-heading { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; padding-top:28px; margin-bottom:32px; }
[data-platform=darwin] .tp-toolbox-heading { padding-top:calc(28px + var(--dsh-frame-top-clearance,0px)); }
.tp-toolbox-heading > div { min-width:0; }
.tp-toolbox-heading h1 { margin:0; font-size:20px; font-weight:500; line-height:28px; }
.tp-toolbox-heading p { margin:4px 0 0; color:var(--dsw-alias-label-secondary); font-size:13px; line-height:20px; }
.tp-toolbox-heading-actions { display:flex; align-items:center; gap:8px; flex-shrink:0; }
.tp-toolbox button,.tp-toolbox-dialog button { display:inline-flex; align-items:center; justify-content:center; gap:4px; min-height:36px; padding:0 14px; border:0; border-radius:var(--dsw-radius-md); background:transparent; color:inherit; font:inherit; font-size:14px; line-height:22px; cursor:pointer; }
.tp-toolbox button:hover:not(:disabled),.tp-toolbox-dialog button:hover:not(:disabled) { background:var(--dsw-alias-interactive-bg-hover); }
.tp-toolbox button:active:not(:disabled),.tp-toolbox-dialog button:active:not(:disabled) { background:var(--dsw-alias-interactive-bg-active); }
.tp-toolbox button:disabled,.tp-toolbox-dialog button:disabled { opacity:.4; cursor:not-allowed; }
.tp-toolbox button svg,.tp-toolbox-dialog button svg { flex-shrink:0; }
.tp-toolbox .tp-toolbox-primary,.tp-toolbox-dialog .tp-toolbox-primary { background:var(--dsw-alias-button-primary-fill); color:var(--dsw-alias-label-primary-foreground); }
.tp-toolbox .tp-toolbox-primary:hover:not(:disabled),.tp-toolbox-dialog .tp-toolbox-primary:hover:not(:disabled) { background:var(--dsw-alias-button-primary-hover); }
.tp-toolbox-heading-actions button { height:32px; min-height:32px; padding:0 12px; font-size:13px; line-height:20px; }
.tp-toolbox-heading-actions .tp-toolbox-primary { border-radius:16px; }
.tp-toolbox .tp-toolbox-icon-button { width:28px; height:28px; min-height:28px; padding:0; border-radius:var(--dsw-radius-sm); color:var(--dsw-alias-label-secondary); }
.tp-toolbox-toolbar,.tp-toolbox-section-toolbar { display:flex; align-items:center; justify-content:space-between; gap:16px; margin-bottom:24px; }
.tp-toolbox-tabs,.tp-toolbox-sources { display:flex; align-items:center; flex-wrap:wrap; gap:8px; }
.tp-toolbox-tabs button,.tp-toolbox-sources button { min-height:28px; height:28px; padding:0 10px; border-radius:14px; color:var(--dsw-alias-label-tertiary); }
.tp-toolbox-tabs [aria-pressed=true],.tp-toolbox-sources [aria-pressed=true] { color:var(--dsw-alias-label-primary); background:var(--dsw-alias-interactive-bg-active); }
.tp-toolbox-search { display:flex; width:240px; min-width:0; flex-shrink:0; }
.tp-toolbox-search input { font:inherit; font-size:13px; }
.tp-toolbox :is(button,input,select,textarea):focus-visible,.tp-toolbox-dialog :is(button,input,select,textarea):focus-visible { outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary)); outline-offset:2px; }
.tp-toolbox input:focus-visible,.tp-toolbox-dialog input:not([type=checkbox]):focus-visible { outline:none; }
.tp-toolbox-dialog :is(select,textarea):focus { outline:none; border-color:var(--dsw-alias-state-business-primary); }
.tp-toolbox input::placeholder,.tp-toolbox-dialog input::placeholder,.tp-toolbox-dialog textarea::placeholder { color:var(--dsw-alias-label-caption); opacity:1; }
.tp-toolbox-panel { min-width:0; }
.tp-toolbox-grid { display:flex; flex-direction:column; gap:16px; margin:0; }
.tp-toolbox-card { display:flex; align-items:center; gap:16px; padding:12px; border:1px solid var(--dsw-alias-border-l3); border-radius:12px; background:transparent; overflow-wrap:anywhere; min-width:0; }
.tp-toolbox-card:hover,.tp-toolbox-card:focus-within { border-color:var(--dsw-alias-border-l4); }
.tp-toolbox-card:hover { background:var(--dsw-alias-interactive-bg-hover); }
.tp-toolbox-card-body { min-width:0; flex:1; }
.tp-toolbox-card header { display:flex; align-items:center; flex-wrap:wrap; gap:8px; }
.tp-toolbox-card h3 { margin:0; min-width:0; font-size:14px; font-weight:500; line-height:23px; }
.tp-toolbox .tp-toolbox-card-description { display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:2; overflow:hidden; margin:2px 0 6px; font-size:13px; line-height:21px; color:var(--dsw-alias-label-secondary); }
.tp-toolbox-meta,.tp-toolbox-reasons,.tp-toolbox-card-credentials { color:var(--dsw-alias-label-tertiary); font-size:12px; line-height:20px; }
.tp-toolbox p.tp-toolbox-meta { margin:4px 0 0; }
.tp-toolbox-reasons { list-style:none; padding:0; margin:4px 0 0; }
.tp-toolbox-card-credentials { display:flex; flex-wrap:wrap; gap:4px 12px; list-style:none; padding:0; margin:4px 0 0; }
.tp-toolbox-actions { display:flex; flex-wrap:wrap; align-items:center; gap:8px; margin-top:12px; }
.tp-toolbox-card > .tp-toolbox-actions,.tp-toolbox-section-toolbar > .tp-toolbox-actions { margin:0; flex-shrink:0; gap:2px; }
.tp-toolbox-card > .tp-toolbox-actions { max-width:42%; justify-content:flex-end; }
.tp-toolbox-card > .tp-toolbox-actions button,.tp-toolbox-section-toolbar > .tp-toolbox-actions button { min-height:28px; height:28px; padding:0 8px; font-size:12px; line-height:20px; color:var(--dsw-alias-label-secondary); }
.tp-toolbox-badge { display:inline-block; flex-shrink:0; padding:1px 7px; border:0; border-radius:var(--dsw-radius-sm); background:var(--dsw-alias-interactive-bg-hover); color:var(--dsw-alias-label-secondary); font-size:11px; line-height:18px; white-space:nowrap; }
.tp-toolbox [role=status],.tp-toolbox [role=alert],.tp-toolbox-dialog [role=alert] { margin:0 0 20px; padding:12px 14px; border-radius:var(--dsw-radius-md); background:var(--dsw-specific-sidebar-fill); color:var(--dsw-alias-label-secondary); font-size:12px; line-height:20px; }
.tp-toolbox [role=alert],.tp-toolbox-dialog [role=alert] { color:var(--dsw-alias-state-error-primary); }
.tp-toolbox .tp-toolbox-empty { padding:48px 20px; text-align:center; color:var(--dsw-alias-label-tertiary); }
.tp-toolbox-fields { display:flex; flex-direction:column; gap:20px; border:0; margin:0; padding:0; min-width:0; }
.tp-toolbox-dialog label { display:flex; align-items:stretch; flex-direction:column; gap:7px; color:var(--dsw-alias-label-secondary); font-size:14px; line-height:22px; }
.tp-toolbox-dialog label:has(> input[type=checkbox]) { flex-direction:row; align-items:flex-start; }
.tp-toolbox-fields label > :is(input:not([type=checkbox]):not([type=radio]),textarea,select,span:has(> input)) { width:100%; min-width:0; box-sizing:border-box; }
.tp-toolbox-dialog label > span:has(> input) { height:36px; }
.tp-toolbox-fields select,.tp-toolbox-fields textarea { width:100%; max-width:100%; min-width:0; min-height:36px; color:var(--dsw-alias-label-primary); background:var(--dsw-alias-bg-layer-1); border:.5px solid var(--dsw-alias-border-l4); border-radius:var(--dsw-radius-md); padding:6px 12px; font:inherit; }
.tp-toolbox-fields textarea { resize:vertical; }
.tp-toolbox-fields :is(select,textarea):hover:not(:disabled) { border-color:var(--dsw-alias-border-l4); }
.tp-toolbox-fields :is(input,select,textarea):disabled { opacity:0.4; cursor:not-allowed; }
.tp-toolbox-credential { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
.tp-toolbox-content { white-space:pre-wrap; overflow-wrap:anywhere; max-height:45vh; overflow:auto; font-size:12px; line-height:20px; }
.tp-toolbox-dialog { max-height:100%; font-family:inherit; font-size:14px; line-height:1.6; }
.tp-toolbox-dialog button[aria-label] { min-width:28px; min-height:28px; height:28px; padding:0; }
.tp-toolbox-dialog-content { min-height:0; overflow:auto; }
.tp-toolbox-selection-status,.tp-toolbox-selection-error { font-size:12px; line-height:1.5; color:var(--dsw-alias-label-secondary); margin:0; }
.tp-toolbox-selection-error { color:var(--dsw-alias-state-error-primary); }
/* Editors and detail pages share the automation page layout. */
.tp-toolbox-editor { min-width:0; margin:0; padding:0 0 48px; }
.tp-toolbox-breadcrumb { display:flex; align-items:center; flex-wrap:wrap; gap:12px; min-height:48px; padding:12px clamp(20px,2vw,28px); font-size:14px; line-height:22px; }
[data-platform=darwin] .tp-toolbox-breadcrumb { padding-top:calc(12px + var(--dsh-frame-top-clearance,0px)); }
.tp-toolbox-breadcrumb > svg { color:var(--dsw-alias-label-caption); }
.tp-toolbox-breadcrumb > span { min-width:0; overflow-wrap:anywhere; font-weight:500; }
.tp-toolbox .tp-toolbox-breadcrumb button { min-height:24px; padding:0; border-radius:0; color:var(--dsw-alias-label-secondary); }
.tp-toolbox .tp-toolbox-breadcrumb button:hover:not(:disabled) { background:transparent; color:var(--dsw-alias-label-primary); }
.tp-toolbox-editor-content { max-width:1056px; margin:0 auto; padding:24px clamp(24px,4vw,48px) 0; }
.tp-toolbox-editor-heading h1 { margin:0; font-size:20px; font-weight:600; line-height:28px; }
.tp-toolbox-editor-heading p { margin:8px 0 0; color:var(--dsw-alias-label-secondary); font-size:14px; line-height:22px; }
.tp-toolbox-editor-toolbar { display:flex; align-items:center; justify-content:space-between; gap:16px; margin:28px 0; }
.tp-toolbox-editor-section { display:inline-flex; align-items:center; min-height:34px; padding:0 13px; border:3px solid var(--dsw-alias-interactive-bg-hover); border-radius:20px; background:var(--dsw-alias-bg-base); color:var(--dsw-alias-label-primary); font-weight:500; line-height:28px; }
.tp-toolbox-editor-actions { display:flex; align-items:center; gap:8px; }
.tp-toolbox-editor-actions button { height:32px; min-height:32px; padding:0 12px; border-radius:var(--dsw-radius-sm); }
.tp-toolbox-editor fieldset { min-width:0; margin:0; padding:0; border:0; }
.tp-toolbox-editor-fields { display:flex; flex-direction:column; gap:20px; }
.tp-toolbox-editor-field { display:flex; flex-direction:column; gap:7px; min-width:0; margin:0; color:var(--dsw-alias-label-secondary); font-size:14px; font-weight:400; line-height:22px; }
.tp-toolbox-editor-field :where(input:not([type=checkbox]),select,textarea) { width:100%; min-width:0; max-width:100%; min-height:36px; padding:0 12px; border:.5px solid var(--dsw-alias-border-l4); border-radius:var(--dsw-radius-md); background:var(--dsw-alias-bg-layer-1); color:var(--dsw-alias-label-primary); font:inherit; font-size:14px; line-height:22px; }
.tp-toolbox-editor-field textarea { padding:12px; resize:vertical; line-height:24px; }
.tp-toolbox-editor :is(input:not([type=checkbox]),textarea,select):focus { outline:none; border-color:var(--dsw-alias-state-business-primary); }
.tp-toolbox-editor [aria-invalid=true] { border-color:var(--dsw-alias-state-error-primary); }
.tp-toolbox-editor :is(input,textarea,select):disabled { opacity:.4; cursor:not-allowed; }
.tp-toolbox-editor textarea::placeholder { color:var(--dsw-alias-label-caption); opacity:1; }
.tp-toolbox-editor-field small { color:var(--dsw-alias-label-tertiary); font-size:12px; line-height:20px; }
.tp-toolbox-editor-composer { min-width:0; overflow:hidden; border:.5px solid var(--dsw-alias-border-l4); border-radius:var(--dsw-radius-md); background:var(--dsw-specific-sidebar-fill); }
.tp-toolbox-editor-composer:focus-within { border-color:var(--dsw-alias-state-business-primary); }
.tp-toolbox-editor-composer textarea { display:block; min-height:240px; max-height:560px; border:0; border-radius:0; background:transparent; }
.tp-toolbox-composer-footer { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px; padding:8px 12px; color:var(--dsw-alias-label-tertiary); font-size:12px; line-height:20px; }
.tp-toolbox-composer-footer > span { display:inline-flex; align-items:center; gap:6px; }
.tp-toolbox-transport { display:inline-flex; align-self:flex-start; max-width:100%; gap:2px; padding:3px; border-radius:20px; background:var(--dsw-alias-interactive-bg-hover); }
.tp-toolbox-transport button { min-height:28px; height:28px; padding:0 13px; border-radius:16px; color:var(--dsw-alias-label-secondary); }
.tp-toolbox-transport button[aria-pressed=true] { background:var(--dsw-alias-bg-base); color:var(--dsw-alias-label-primary); font-weight:500; }
.tp-toolbox-editor-advanced { margin-top:-4px; }
.tp-toolbox-editor-advanced > summary { display:flex; align-items:center; gap:6px; width:fit-content; list-style:none; cursor:pointer; color:var(--dsw-alias-label-tertiary); font-size:13px; line-height:24px; }
.tp-toolbox-editor-advanced > summary::-webkit-details-marker { display:none; }
.tp-toolbox-editor-advanced > summary:focus-visible { outline:2px solid var(--dsw-alias-state-business-primary); outline-offset:2px; }
.tp-toolbox-editor-advanced[open] > summary > svg { transform:rotate(180deg); }
.tp-toolbox-advanced-fields { display:flex; flex-direction:column; gap:20px; margin-top:16px; padding:20px 0; border-top:.5px solid var(--dsw-alias-border-l3); }
.tp-toolbox-editor-credentials h2 { margin:0; font-size:14px; font-weight:500; line-height:22px; }
.tp-toolbox-editor-credentials header p { margin:4px 0 16px; color:var(--dsw-alias-label-tertiary); font-size:12px; line-height:20px; }
.tp-toolbox-editor-credential { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr) minmax(0,.8fr) 28px; align-items:end; gap:12px; margin-bottom:12px; padding:14px; border:.5px solid var(--dsw-alias-border-l3); border-radius:var(--dsw-radius-md); }
.tp-toolbox-editor-credential .tp-toolbox-icon-button { margin-bottom:4px; }
.tp-toolbox-editor .tp-toolbox-add-credential { min-height:28px; padding:0 8px; color:var(--dsw-alias-label-secondary); font-size:13px; }
.tp-toolbox-editor-feedback { margin-top:20px; }
.tp-toolbox-editor-feedback:empty { display:none; }
.tp-toolbox-editor-checkbox { display:flex; align-items:flex-start; gap:8px; color:var(--dsw-alias-label-secondary); font-size:13px; line-height:22px; }
.tp-toolbox-editor-checkbox input { flex-shrink:0; margin:4px 0 0; accent-color:var(--dsw-alias-state-business-primary); }
.tp-toolbox-detail .tp-toolbox-editor-heading h1 { overflow-wrap:anywhere; }
.tp-toolbox-detail .tp-toolbox-editor-toolbar,.tp-toolbox-detail .tp-toolbox-editor-actions { flex-wrap:wrap; gap:12px; }
.tp-toolbox-detail-sections { display:flex; flex-direction:column; gap:28px; min-width:0; }
.tp-toolbox-detail-section { min-width:0; }
.tp-toolbox-detail-section > h2 { margin:0 0 12px; font-size:14px; font-weight:500; line-height:22px; }
.tp-toolbox-detail-facts { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px; margin:16px 0; }
.tp-toolbox-detail-facts dt { color:var(--dsw-alias-label-tertiary); font-size:12px; line-height:20px; }
.tp-toolbox-detail-facts dd { margin:6px 0 0; overflow-wrap:anywhere; }
.tp-toolbox-detail-wide { grid-column:1/-1; }
.tp-toolbox-detail-list { list-style:none; padding:0; margin:0; }
.tp-toolbox-detail-list li { display:flex; flex-wrap:wrap; align-items:baseline; justify-content:space-between; gap:6px 16px; padding:10px 0; border-bottom:.5px solid var(--dsw-alias-border-l3); overflow-wrap:anywhere; }
.tp-toolbox-detail code { overflow-wrap:anywhere; user-select:text; font-size:13px; }
.tp-toolbox-detail .tp-toolbox-content { max-height:none; overflow:visible; margin:0; padding:20px; border:.5px solid var(--dsw-alias-border-l3); border-radius:var(--dsw-radius-md); background:var(--dsw-specific-sidebar-fill); font-size:13px; line-height:22px; }
@container toolbox (max-width:720px) {
  .tp-toolbox-heading { flex-wrap:wrap; }
  .tp-toolbox-heading-actions { width:100%; flex-wrap:wrap; justify-content:flex-end; }
  .tp-toolbox-toolbar,.tp-toolbox-section-toolbar { align-items:stretch; flex-direction:column; gap:12px; }
  .tp-toolbox-search { width:100%; }
  .tp-toolbox-section-toolbar > .tp-toolbox-actions { justify-content:flex-end; }
  .tp-toolbox-card { align-items:stretch; flex-direction:column; gap:8px; }
  .tp-toolbox-card > .tp-toolbox-actions { max-width:100%; }
  .tp-toolbox-credential { grid-template-columns:1fr; }
  .tp-toolbox-editor-credential { grid-template-columns:minmax(0,1fr) minmax(0,1fr); }
  .tp-toolbox-editor-credential > button { justify-self:end; }
}
@container toolbox (max-width:480px) { .tp-toolbox-content-wrap,.tp-toolbox-editor-content { padding-right:20px; padding-left:20px; }.tp-toolbox-tabs,.tp-toolbox-sources { gap:4px; }.tp-toolbox-tabs button,.tp-toolbox-sources button { padding:0 8px; }.tp-toolbox-editor-credential,.tp-toolbox-detail-facts { grid-template-columns:minmax(0,1fr); }.tp-toolbox-transport { flex-wrap:wrap; border-radius:var(--dsw-radius-md); } }
@media(max-width:600px) { .tp-toolbox-credential { grid-template-columns:1fr; } }
${teamStyles}
${storeStyles}
${mcpStyles}
`
