export const suggestionStyles = `
.tp-task-suggestions { --tp-card-glass:rgba(255, 255, 255, .55); --tp-card-glass-hover:rgba(255, 255, 255, .82); --tp-card-line:rgba(120, 150, 200, .24); box-sizing:border-box; width:100%; min-width:0; padding:20px 0 16px; color:var(--dsw-alias-label-primary); font-family:inherit; }
.tp-task-suggestions header { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:0 4px 10px; color:var(--dsw-alias-label-secondary); font-size:12px; line-height:20px; }
.tp-task-suggestions header > div { display:flex; align-items:center; gap:12px; }
.tp-task-suggestions button { font:inherit; color:inherit; border:0; background:transparent; cursor:pointer; }
.tp-task-suggestions header button { padding:2px 0; white-space:nowrap; }
.tp-task-suggestions .tp-suggestions-close { display:flex; align-items:center; justify-content:center; width:24px; height:24px; border-radius:6px; }
.tp-task-suggestions ul { display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:12px; list-style:none; margin:0; padding:0; }
.tp-task-suggestions li { display:flex; min-width:0; }
.tp-task-suggestions li > button { box-sizing:border-box; display:flex; align-items:center; width:100%; min-height:72px; gap:12px; padding:12px 14px; border:1px solid var(--tp-card-line); border-radius:16px; background:var(--tp-card-glass); -webkit-backdrop-filter:blur(14px); backdrop-filter:blur(14px); text-align:left; transition:background-color 160ms ease; }
.tp-suggestion-copy { display:flex; flex:1; flex-direction:column; gap:2px; min-width:0; }
.tp-suggestion-copy strong, .tp-suggestion-copy span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.tp-suggestion-copy strong { font-size:14px; font-weight:600; line-height:20px; }
.tp-suggestion-copy span { color:var(--dsw-alias-label-secondary); font-size:12px; line-height:18px; }
.tp-task-suggestions header button:hover:not(:disabled) { background:var(--dsw-alias-interactive-bg-hover); }
.tp-task-suggestions li > button:is(:hover, :focus-visible):not(:disabled) { background:var(--tp-card-glass-hover); }
.tp-task-suggestions button:focus-visible { outline:2px solid var(--dsw-alias-label-secondary); outline-offset:2px; }
.tp-task-suggestions button:disabled { opacity:.45; cursor:default; }
.tp-suggestion-icon { box-sizing:border-box; display:flex; align-items:center; justify-content:center; width:32px; height:32px; flex-shrink:0; border-radius:8px; overflow:hidden; }
.tp-suggestion-icon img { display:block; width:100%; height:100%; object-fit:contain; }
.tp-suggestion-feedback { margin:8px 4px 0; color:var(--dsw-alias-label-secondary); font-size:12px; line-height:20px; }
.tp-suggestions-setting { display:flex; align-items:center; justify-content:space-between; gap:24px; padding:12px 0; font-size:14px; }
.tp-suggestions-setting p { margin:4px 0 0; font-size:12px; color:var(--dsw-alias-label-secondary); }
body[data-ds-dark-theme] .tp-task-suggestions { --tp-card-glass:rgba(16, 30, 58, .62); --tp-card-glass-hover:rgba(23, 38, 72, .86); --tp-card-line:rgba(150, 185, 240, .22); }
@media(max-width:600px) { .tp-task-suggestions { padding-top:16px; } }
@media(prefers-reduced-motion:reduce) { .tp-task-suggestions li > button { transition:none; } }
`
