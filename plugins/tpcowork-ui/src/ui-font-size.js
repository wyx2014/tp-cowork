/** A fixed pixel font size, the form nearly all DSH component styles use. */
const FIXED_PX = /^\d+(\.\d+)?px$/u;
/** Code and terminal text follow their own size settings, as the reference product's code size ignores its UI size. */
const OWN_SIZE = /xterm|terminal|monaco|codemirror|\bcode\b|\bpre\b|kbd/iu;

/**
 * The reference product's (ZCode) 界面字号: one size for all interface text, applied as a pixel offset from 14px
 * (its --text-ui-* tokens are calc(var(--ui-font-size) ± n)). DSH sizes its components with fixed pixels and only
 * moves chat content by its text size, so every fixed `font-size` in the loaded stylesheets is rewritten to add
 * DSH's --dsh-content-font-delta (text size − 14px, set on body before first paint). Icons, spacing and layout
 * keep their pixel sizes. Stylesheets added later (plugins, hot reload) are rewritten as they arrive.
 * @returns a disposer that restores every rewritten rule.
 */
export function scaleInterfaceText(doc = globalThis.document) {
  if (!doc?.styleSheets || !doc.head || typeof MutationObserver !== 'function') return () => {};
  const rewritten = [];
  const seen = new WeakSet();
  const visit = rules => {
    for (const rule of rules) {
      if (rule.cssRules && !rule.style) { visit(rule.cssRules); continue; }
      const style = rule.style;
      if (!style) continue;
      const size = style.getPropertyValue('font-size').trim();
      if (!FIXED_PX.test(size) || OWN_SIZE.test(rule.selectorText ?? '') || /mono/iu.test(style.getPropertyValue('font-family'))) continue;
      const priority = style.getPropertyPriority('font-size');
      style.setProperty('font-size', `calc(${size} + var(--dsh-content-font-delta, 0px))`, priority);
      rewritten.push([style, size, priority]);
      if (rule.cssRules?.length) visit(rule.cssRules);
    }
  };
  const scan = () => {
    for (const sheet of doc.styleSheets) {
      if (seen.has(sheet)) continue;
      let rules;
      // Cross-origin sheets (web fonts) cannot be read and hold no component sizes.
      try { rules = sheet.cssRules; } catch { seen.add(sheet); continue; }
      seen.add(sheet);
      visit(rules);
    }
  };
  scan();
  const observer = new MutationObserver(scan);
  // Stylesheets arrive in <head> (or directly under <body>); the app's own DOM churn is not watched.
  observer.observe(doc.head, { childList: true, subtree: true, characterData: true });
  if (doc.body) observer.observe(doc.body, { childList: true });
  // A <link> sheet exists only once it has loaded.
  const loaded = event => { if (event.target?.tagName === 'LINK') scan(); };
  doc.addEventListener('load', loaded, true);
  return () => {
    observer.disconnect();
    doc.removeEventListener('load', loaded, true);
    for (const [style, size, priority] of rewritten) style.setProperty('font-size', size, priority);
  };
}
