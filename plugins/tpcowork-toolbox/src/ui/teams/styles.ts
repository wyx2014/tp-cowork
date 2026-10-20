export const teamStyles = `
.tp-team-detail { --tp-team-accent:#347f6b; --tp-team-wash:#e9f3ee; }
.tp-team-supply { --tp-team-accent:#77609f; --tp-team-wash:#eeebf5; }
[data-ds-dark-theme] .tp-team-detail { --tp-team-accent:#9ad6bd; --tp-team-wash:rgba(109,185,155,.12); }
[data-ds-dark-theme] .tp-team-supply { --tp-team-accent:#c7b4e9; --tp-team-wash:rgba(161,135,205,.12); }
.tp-toolbox-editor-heading-visual { display:flex; align-items:flex-start; gap:24px; }
.tp-toolbox-editor-heading-text { min-width:0; }
.tp-team-emblem { display:block; width:88px; height:88px; flex-shrink:0; }
.tp-team-detail .tp-toolbox-editor-heading h1 { font-size:24px; font-weight:600; line-height:34px; }
.tp-team-detail .tp-toolbox-editor-heading .tp-toolbox-editor-actions { margin-top:18px; flex-wrap:wrap; }
.tp-team-detail .tp-toolbox-editor-heading .tp-toolbox-primary { min-width:96px; }
.tp-team-detail .tp-toolbox-detail-sections { margin-top:28px; gap:36px; }
.tp-team-intro > p { max-width:900px; margin:0 0 16px; font-size:15px; line-height:26px; }
.tp-team-tags { display:flex; align-items:center; flex-wrap:wrap; gap:8px; padding:0; margin:0; list-style:none; }
.tp-team-tags > :is(span,li) { padding:3px 9px; border-radius:5px; background:var(--dsw-alias-interactive-bg-hover); color:var(--dsw-alias-label-secondary); font-size:12px; line-height:20px; overflow-wrap:anywhere; }
.tp-team-tags > .tp-toolbox-badge[data-state=ready] { color:var(--tp-team-accent); background:var(--tp-team-wash); }
.tp-team-intro .tp-toolbox-reasons { margin-top:12px; }
.tp-team-stats { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px; margin:0; padding:22px 0; border-block:.5px solid var(--dsw-alias-border-l3); }
.tp-team-stats > div { display:flex; flex-direction:column; align-items:center; gap:5px; min-width:0; text-align:center; }
.tp-team-stats dt { font-size:12px; line-height:20px; color:var(--dsw-alias-label-tertiary); }
.tp-team-stats dd { order:-1; margin:0; font-size:18px; font-weight:600; line-height:28px; overflow-wrap:anywhere; }
.tp-team-stats dd > span { color:var(--dsw-alias-label-tertiary); font-weight:400; }
.tp-team-section { min-width:0; }
.tp-team-section-heading { margin-bottom:18px; }
.tp-team-section-heading h2 { display:flex; align-items:center; gap:9px; margin:0; font-size:17px; font-weight:600; line-height:26px; }
.tp-team-section-heading h2 > svg { flex-shrink:0; }
.tp-team-section-heading p { margin:6px 0 0; color:var(--dsw-alias-label-tertiary); font-size:12px; line-height:20px; }
.tp-team-examples { display:flex; flex-direction:column; gap:10px; }
.tp-toolbox .tp-team-examples button { justify-content:space-between; gap:16px; min-height:56px; padding:14px 18px; border:1px solid transparent; border-radius:12px; background:var(--dsw-specific-sidebar-fill); text-align:left; font-size:14px; line-height:22px; }
.tp-team-examples button > span { min-width:0; overflow-wrap:anywhere; }
.tp-team-examples button > svg { color:var(--dsw-alias-label-secondary); }
.tp-toolbox .tp-team-examples button:hover:not(:disabled) { border-color:var(--dsw-alias-border-l3); background:var(--dsw-alias-interactive-bg-hover); }
.tp-team-draft-hint { display:block; margin-top:12px; color:var(--dsw-alias-label-tertiary); font-size:12px; line-height:20px; }
.tp-team-cases { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px; }
.tp-toolbox .tp-team-case { display:block; min-width:0; padding:0; overflow:hidden; border:1px solid var(--dsw-alias-border-l3); border-radius:14px; background:var(--dsw-alias-bg-base); text-align:left; }
.tp-toolbox .tp-team-case:hover { background:var(--dsw-alias-bg-base); border-color:var(--tp-team-accent); }
.tp-team-case[aria-expanded=true] { border-color:var(--tp-team-accent); box-shadow:0 0 0 1px var(--tp-team-accent); }
.tp-team-case-preview { height:186px; padding:20px 24px 0; overflow:hidden; background:var(--tp-team-wash); }
.tp-team-case-paper { min-height:190px; padding:16px; border:1px solid var(--dsw-alias-border-l3); border-radius:7px 7px 0 0; background:var(--dsw-alias-bg-base); box-shadow:0 8px 20px rgba(0,0,0,.04); }
.tp-team-case-paper-heading { display:flex; align-items:center; gap:7px; min-width:0; font-size:10px; line-height:16px; }
.tp-team-case-paper-heading > svg { flex-shrink:0; color:var(--tp-team-accent); }
.tp-team-case-paper-heading strong { overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
.tp-team-case-paper-subtitle { display:block; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; margin:4px 0 12px; color:var(--dsw-alias-label-tertiary); font-size:8px; line-height:12px; }
.tp-team-case-paper-section { margin-top:10px; }
.tp-team-case-paper-section strong { display:block; font-size:8px; font-weight:500; line-height:12px; }
.tp-team-case-paper-section > span { display:block; width:90%; height:3px; margin-top:4px; border-radius:2px; background:var(--dsw-alias-interactive-bg-hover); }
.tp-team-case-paper-section > span:last-child { width:65%; }
.tp-team-case-paper-tags { display:flex; gap:5px; margin-top:12px; }
.tp-team-case-paper-tags > span { padding:0 5px; border-radius:5px; color:var(--tp-team-accent); background:var(--tp-team-wash); font-size:7px; line-height:12px; }
.tp-team-case-caption { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:16px 18px; }
.tp-team-case-caption > span { min-width:0; }
.tp-team-case-caption strong { display:block; font-size:14px; font-weight:600; line-height:22px; overflow-wrap:anywhere; }
.tp-team-case-caption small { display:block; margin-top:4px; font-size:12px; line-height:19px; color:var(--dsw-alias-label-secondary); }
.tp-team-case[aria-expanded=true] .tp-team-case-caption > svg { transform:rotate(180deg); }
.tp-team-report { margin-top:20px; padding:24px; border:1px solid var(--dsw-alias-border-l3); border-radius:14px; }
.tp-team-report > header { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:16px; }
.tp-team-report h3 { margin:8px 0 0; font-size:18px; font-weight:600; line-height:28px; overflow-wrap:anywhere; }
.tp-team-report-label { display:flex; align-items:center; gap:6px; color:var(--tp-team-accent); font-size:12px; line-height:20px; }
.tp-team-report .tp-team-report-note { margin:12px 0 20px; color:var(--dsw-alias-label-tertiary); font-size:12px; line-height:20px; }
.tp-team-report h4 { margin:0; font-size:13px; font-weight:600; line-height:22px; }
.tp-team-report p { margin:6px 0 0; font-size:13px; line-height:23px; color:var(--dsw-alias-label-secondary); }
.tp-team-report-scope { padding:16px; border-radius:8px; background:var(--dsw-specific-sidebar-fill); }
.tp-team-report ol { list-style:none; margin:20px 0 0; padding:0; counter-reset:report-step; }
.tp-team-report ol > li { position:relative; margin-top:18px; padding-left:30px; counter-increment:report-step; }
.tp-team-report ol > li::before { position:absolute; left:0; top:1px; content:counter(report-step,decimal-leading-zero); color:var(--tp-team-accent); font-size:12px; line-height:22px; }
.tp-team-members { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:28px 24px; list-style:none; padding:0; margin:0; }
.tp-team-member { display:flex; align-items:flex-start; gap:12px; min-width:0; }
.tp-team-avatar { display:block; flex-shrink:0; width:48px; height:48px; }
.tp-team-member > div { min-width:0; }
.tp-team-member h3 { margin:1px 0 0; font-size:14px; font-weight:600; line-height:22px; overflow-wrap:anywhere; }
.tp-team-member-perspective { display:block; margin-top:2px; font-size:12px; line-height:20px; color:var(--dsw-alias-label-tertiary); }
.tp-team-member p { margin:7px 0 0; font-size:12px; line-height:21px; color:var(--dsw-alias-label-secondary); }
.tp-team-member-phase { display:inline-block; margin-top:8px; padding:1px 7px; border-radius:5px; background:var(--dsw-alias-interactive-bg-hover); color:var(--dsw-alias-label-tertiary); font-size:11px; line-height:18px; }
.tp-team-workflow { display:flex; flex-wrap:wrap; gap:12px 16px; margin:0; padding:0; list-style:none; }
.tp-team-workflow li { display:flex; align-items:center; gap:8px; color:var(--dsw-alias-label-secondary); font-size:13px; line-height:24px; }
.tp-team-workflow li > span { display:inline-flex; align-items:center; justify-content:center; width:24px; height:24px; border-radius:50%; background:var(--tp-team-wash); color:var(--tp-team-accent); font-size:12px; }
.tp-team-workflow li > svg { margin-left:8px; color:var(--dsw-alias-label-caption); }
@container toolbox (max-width:800px) { .tp-team-members { grid-template-columns:repeat(2,minmax(0,1fr)); } }
@container toolbox (max-width:560px) {
  .tp-team-cases { grid-template-columns:minmax(0,1fr); }
  .tp-team-case-preview { height:176px; }
  .tp-team-report { padding:18px; }
  .tp-team-stats dd { font-size:15px; line-height:24px; }
}
@container toolbox (max-width:480px) {
  .tp-toolbox-editor-heading-visual { gap:16px; }
  .tp-team-emblem { width:64px; height:64px; }
  .tp-team-detail .tp-toolbox-editor-heading h1 { font-size:20px; line-height:29px; }
  .tp-team-detail .tp-toolbox-editor-heading .tp-toolbox-editor-actions { margin-top:14px; gap:4px; }
  .tp-team-detail .tp-toolbox-editor-actions button { padding-inline:10px; }
  .tp-team-detail .tp-toolbox-editor-heading .tp-toolbox-primary { min-width:0; }
  .tp-team-detail .tp-toolbox-detail-sections { gap:30px; }
  .tp-team-intro > p { font-size:14px; line-height:25px; }
  .tp-team-stats { gap:8px; padding-block:18px; }
  .tp-team-stats dd { font-size:14px; }
  .tp-team-members { grid-template-columns:minmax(0,1fr); gap:24px; }
}
`
