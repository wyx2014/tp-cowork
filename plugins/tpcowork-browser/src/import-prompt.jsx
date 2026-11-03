import React, { useEffect, useRef, useState } from 'react';
import { Floating } from './pane.jsx';
import { Icon } from './icons.jsx';
import { BOOKMARK_BROWSER_NAMES, bookmarkImportMessage } from './bookmarks-ui.jsx';
import { deferImportPrompt } from './import-preferences.js';

const cover = rect => ({ left: rect.left, top: rect.top, width: rect.width, height: rect.height });
const fill = (text, values) => text.replace(/\{(\w+)\}/gu, (match, name) => values[name] ?? match);

/**
 * The first-use offer to bring Chrome or Edge bookmarks into this browser. It runs the same import as the bookmark
 * menu and Settings and stays open on a result, so the person sees what was imported or why it failed.
 * @param available - which browsers have a profile to import from, or undefined while the desktop checks.
 */
export function ImportPrompt({ anchor, available, onImport, onDecide, t }) {
  const [busy, setBusy] = useState(null);
  const [result, setResult] = useState(null);
  const primary = useRef();
  useEffect(() => { primary.current?.focus(); }, [result?.success, available !== undefined]);
  const run = async browser => {
    setBusy(browser); setResult(null);
    try { const value = await onImport(browser); setResult({ success: value.success === true, message: bookmarkImportMessage(value, t) }); }
    catch (error) { setResult({ success: false, message: `${t('error')}: ${error.message}` }); }
    finally { setBusy(null); }
  };
  const later = () => { if (busy === null) onDecide(result?.success ? { choice: 'imported' } : deferImportPrompt()); };
  const browsers = Object.keys(BOOKMARK_BROWSER_NAMES);
  const first = browsers.find(browser => available?.[browser] === true);
  return <Floating anchor={anchor} place={cover} className="tpcb-import-scrim" onKeyDown={event => { if (event.key === 'Escape') later(); }}>
    <section className="tpcb-import" role="dialog" aria-modal="true" aria-labelledby="tpcb-import-title" aria-describedby="tpcb-import-intro">
      <div className="tpcb-import-logo" aria-hidden="true"><span className="tpcb-import-mark"><Icon name="Bookmark" size={22} /></span></div>
      <h2 id="tpcb-import-title">{t('importPromptTitle')}</h2>
      <p id="tpcb-import-intro">{t('importPromptIntro')}</p>
      <ul>{['importPromptScope', 'importPromptProfile', 'importPromptLocal'].map(key => <li key={key}><Icon name="CircleCheck" size={18} />{t(key)}</li>)}</ul>
      {result && <p className={`tpcb-import-result${result.success ? '' : ' tpcb-import-failed'}`} role={result.success ? 'status' : 'alert'}>{result.message}</p>}
      {/* The source buttons share one row of equal columns, so neither wraps under the other in a narrow pane. */}
      {!result?.success && <div className="tpcb-import-sources">
        {browsers.map(browser => {
          const name = BOOKMARK_BROWSER_NAMES[browser];
          const ready = available?.[browser] === true;
          return <button key={browser} ref={browser === first ? primary : undefined} type="button" className="tpcb-import-primary"
            disabled={busy !== null || !ready} title={available && !ready ? fill(t('bookmarksUnavailable'), { browser: name }) : undefined}
            onClick={() => { void run(browser); }}>{busy === browser ? t('busy') : fill(t('importPromptFrom'), { browser: name })}</button>;
        })}
      </div>}
      <footer>
        {result?.success
          ? <button ref={primary} type="button" className="tpcb-import-primary" onClick={() => onDecide({ choice: 'imported' })}>{t('done')}</button>
          : <>
            <button type="button" className="tpcb-import-never" disabled={busy !== null} onClick={() => onDecide({ choice: 'dismissed' })}>{t('importPromptNever')}</button>
            <button type="button" className="tpcb-import-later" disabled={busy !== null} onClick={later}>{t('importPromptLater')}</button>
          </>}
      </footer>
    </section>
  </Floating>;
}
