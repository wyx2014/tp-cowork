import React, { useEffect, useRef, useState } from 'react';
import { Floating } from './pane.jsx';
import { Icon } from './icons.jsx';
import { importSummary } from './import-summary.js';
import { deferImportPrompt } from './import-preferences.js';

const cover = rect => ({ left: rect.left, top: rect.top, width: rect.width, height: rect.height });

/**
 * The first-use offer to bring Chrome sign-ins into this browser. It runs the same import as
 * Settings and stays open on a result, so the person sees what was imported or why it failed.
 */
export function ImportPrompt({ anchor, onImport, onDecide, t }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const primary = useRef();
  useEffect(() => { primary.current?.focus(); }, [result?.success]);
  const run = async () => {
    setBusy(true); setResult(null);
    try { const value = await onImport(); setResult({ success: value.success === true, message: importSummary(value, t) }); }
    catch (error) { setResult({ success: false, message: `${t('error')}: ${error.message}` }); }
    finally { setBusy(false); }
  };
  const later = () => { if (!busy) onDecide(result?.success ? { choice: 'imported' } : deferImportPrompt()); };
  return <Floating anchor={anchor} place={cover} className="tpcb-import-scrim" onKeyDown={event => { if (event.key === 'Escape') later(); }}>
    <section className="tpcb-import" role="dialog" aria-modal="true" aria-labelledby="tpcb-import-title" aria-describedby="tpcb-import-intro">
      <div className="tpcb-import-logo" aria-hidden="true"><span className="tpcb-chrome" /></div>
      <h2 id="tpcb-import-title">{t('importPromptTitle')}</h2>
      <p id="tpcb-import-intro">{t('importPromptIntro')}</p>
      <ul>{['importPromptScope', 'importPromptProfile', 'importPromptLocal'].map(key => <li key={key}><Icon name="CircleCheck" size={18} />{t(key)}</li>)}</ul>
      {result && <p className={`tpcb-import-result${result.success ? '' : ' tpcb-import-failed'}`} role={result.success ? 'status' : 'alert'}>{result.message}</p>}
      <footer>
        {result?.success
          ? <button ref={primary} type="button" className="tpcb-import-primary" onClick={() => onDecide({ choice: 'imported' })}>{t('done')}</button>
          : <>
            <button type="button" className="tpcb-import-never" disabled={busy} onClick={() => onDecide({ choice: 'dismissed' })}>{t('importPromptNever')}</button>
            <button type="button" className="tpcb-import-later" disabled={busy} onClick={later}>{t('importPromptLater')}</button>
            <button ref={primary} type="button" className="tpcb-import-primary" disabled={busy} onClick={() => { void run(); }}>{busy ? t('busy') : t(result ? 'importPromptRetry' : 'importPromptAction')}</button>
          </>}
      </footer>
    </section>
  </Floating>;
}
