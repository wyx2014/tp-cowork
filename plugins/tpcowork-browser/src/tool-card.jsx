import React, { useEffect, useState } from 'react';

function BrowserImage({ attachment, loadImage, t }) {
  const [url, setUrl] = useState(() => loadImage.peek?.(attachment));
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    void loadImage(attachment).then(value => { if (active) setUrl(value); }, () => { if (active) setError(true); });
    return () => { active = false; };
  }, [attachment, loadImage]);
  return url ? <img className="tpcb-evidence" src={url} alt={t('screenshot')} /> : <span>{t(error ? 'imageUnavailable' : 'busy')}</span>;
}

/** Present durable tool results; page controls use the current native inventory. */
export function BrowserTool({ phase, block, toolName, sessionId, useBrowser, reveal, openFile, inspect, loadImage, t }) {
  const state = useBrowser(value => value);
  const settled = phase === 'result';
  const meta = settled && block.meta && typeof block.meta === 'object' ? block.meta : {};
  const nativeId = meta.page?.tabId ?? meta.tab?.tabId;
  const available = state.tabs.some(row => row.id === nativeId && row.sessionId === sessionId);
  const images = settled ? block.content.filter(item => item.type === 'image' && item.attachment) : [];
  const text = settled ? block.content.filter(item => item.type === 'text').map(item => item.text).join('\n') : '';
  return <section className="tpcb-tool-card" data-browser-tool={toolName}>
    <div><strong>{t(toolName)}</strong><span role="status">{t(settled ? block.isError ? 'error' : 'done' : 'busy')}</span></div>
    {(meta.tab?.title || meta.page?.url) && <p>{meta.tab?.title || meta.page.url}</p>}
    <div>{available && <button onClick={() => reveal(sessionId, nativeId)}>{t('showPage')}</button>}{meta.path && <button onClick={() => openFile(meta.path)}>{t('openArtifact')}</button>}{inspect && <button onClick={inspect}>{t('details')}</button>}</div>
    {images.map((item, index) => <BrowserImage key={index} attachment={item.attachment} loadImage={loadImage} t={t} />)}
    {text && <details><summary>{t('result')}</summary><pre>{text}</pre></details>}
  </section>;
}
