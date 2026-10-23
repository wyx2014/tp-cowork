export const suggestionStyles = `
.tp-task-suggestions { box-sizing:border-box; width:100%; min-width:0; padding:20px calc(var(--dsh-composer-side-clearance,24px) + 8px) 16px; color:var(--dsw-alias-label-primary); font-family:inherit; }
.tp-task-suggestions header { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:0 12px 8px; color:var(--dsw-alias-label-secondary); font-size:12px; line-height:20px; }
.tp-task-suggestions header > div { display:flex; align-items:center; gap:12px; }
.tp-task-suggestions button { font:inherit; color:inherit; border:0; background:transparent; cursor:pointer; }
.tp-task-suggestions header button { padding:2px 0; white-space:nowrap; }
.tp-task-suggestions .tp-suggestions-close { display:flex; align-items:center; justify-content:center; width:24px; height:24px; border-radius:6px; }
.tp-task-suggestions ul { list-style:none; margin:0; padding:0; }
.tp-task-suggestions li > button { box-sizing:border-box; display:flex; align-items:center; width:100%; min-height:48px; gap:12px; padding:12px; border-radius:12px; text-align:left; font-size:14px; line-height:24px; }
.tp-task-suggestions li > button > span:last-child { min-width:0; overflow-wrap:anywhere; }
.tp-task-suggestions button:hover:not(:disabled) { background:var(--dsw-alias-interactive-bg-hover); }
.tp-task-suggestions button:focus-visible { outline:2px solid var(--dsw-alias-label-secondary); outline-offset:2px; }
.tp-task-suggestions button:disabled { opacity:.45; cursor:default; }
.tp-suggestion-icon { box-sizing:border-box; display:flex; align-items:center; justify-content:center; width:24px; height:24px; padding:1px; flex-shrink:0; border-radius:6px; overflow:hidden; background:var(--dsw-alias-bg-layer-1); }
.tp-suggestion-icon img { display:block; width:100%; height:100%; border-radius:2px; object-fit:contain; }
.tp-suggestion-feedback { margin:8px 12px 0; color:var(--dsw-alias-label-secondary); font-size:12px; line-height:20px; }
.tp-suggestions-setting { display:flex; align-items:center; justify-content:space-between; gap:24px; padding:12px 0; font-size:14px; }
.tp-suggestions-setting p { margin:4px 0 0; font-size:12px; color:var(--dsw-alias-label-secondary); }
@media(max-width:600px) { .tp-task-suggestions { padding-top:16px; } .tp-task-suggestions li > button { padding:10px 8px; } .tp-task-suggestions header { padding-inline:8px; } }
`
