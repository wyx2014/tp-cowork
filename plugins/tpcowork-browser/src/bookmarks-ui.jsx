/**
 * Imported bookmarks in the browser pane: a toolbar menu with search and folders, and suggestions under the address
 * while a person types. The folders come from the desktop on first use and again after each import; importing again
 * replaces a browser's snapshot, so there is nothing to edit here.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './icons.jsx';
import { Floating, IconButton, Popup } from './pane.jsx';
import { flattenBookmarks, searchBookmarks } from './bookmark-search.js';

const BROWSERS = ['chrome', 'edge'];
const BROWSER_NAMES = { chrome: 'Chrome', edge: 'Edge' };
const ROOT_LABELS = { bookmark_bar: 'bookmarkBar', other: 'bookmarkOther', synced: 'bookmarkSynced' };
const fill = (text, values) => text.replace(/\{(\w+)\}/gu, (match, name) => values[name] ?? match);

/**
 * The desktop's bookmark list, fetched once something asks for it and again whenever an import changes the summary.
 * @param request - the pane's desktop request.
 * @param revision - the summary revision from the browser state.
 * @param enabled - whether the browser plugin is enabled.
 * @returns the list (null until loaded) and `want()`, which starts loading.
 */
export function useBookmarkList(request, revision, enabled) {
  const [list, setList] = useState(null);
  const [wanted, setWanted] = useState(false);
  useEffect(() => {
    if (!wanted || !enabled) return undefined;
    let live = true;
    void request('bookmarks').then(value => { if (live) setList(value); }).catch(() => {});
    return () => { live = false; };
  }, [wanted, enabled, revision]);
  return { list, want: () => setWanted(true) };
}

/** Name a root folder in the interface language; Chromium writes its own names in the browser's language. */
export function bookmarkFolderName(t) {
  return (id, title) => ROOT_LABELS[id] ? t(ROOT_LABELS[id]) : title;
}

/** The outcome of an import, for the menu and the settings card. */
export function bookmarkImportMessage(result, t) {
  const browser = BROWSER_NAMES[result.browser] ?? result.browser;
  if (result.success) return fill(t('bookmarksImported'), { browser, count: String(result.count) });
  return fill(t(result.error === 'bookmarks_not_found' ? 'bookmarksNotFound' : 'bookmarksUnreadable'), { browser });
}

function BookmarkRow({ row, depth, onNavigate, showPath }) {
  return <button type="button" role="menuitem" className="tpcb-bookmark-row" data-bookmark-row="" title={row.url}
    style={{ paddingInlineStart: 8 + depth * 14 }} onClick={() => onNavigate(row.url)}>
    <Icon name="Globe" size={14} className="tpcb-bookmark-icon" />
    <span className="tpcb-bookmark-text"><span className="tpcb-bookmark-title">{row.title}</span>
      <span className="tpcb-bookmark-meta">{showPath ? [row.host, ...row.path].filter(Boolean).join(' · ') : row.host}</span></span>
  </button>;
}

function Folder({ node, id, depth, open, onToggle, onNavigate }) {
  const expanded = open.has(id);
  return <>
    <button type="button" role="menuitem" className="tpcb-bookmark-row tpcb-bookmark-folder" data-bookmark-row="" aria-expanded={expanded}
      style={{ paddingInlineStart: 8 + depth * 14 }} onClick={() => onToggle(id)}>
      <Icon name="ChevronRight" size={14} className="tpcb-bookmark-chevron" />
      <Icon name="Folder" size={14} className="tpcb-bookmark-icon" />
      <span className="tpcb-bookmark-title">{node.title}</span>
    </button>
    {expanded && node.children.map((child, index) => child.url === undefined
      ? <Folder key={index} node={child} id={`${id}/${index}`} depth={depth + 1} open={open} onToggle={onToggle} onNavigate={onNavigate} />
      : <BookmarkRow key={index} row={{ ...child, host: (() => { try { return new URL(child.url).hostname.replace(/^www\./u, ''); } catch { return ''; } })() }}
        depth={depth + 1} onNavigate={onNavigate} />)}
  </>;
}

function BookmarkPanel({ list, enabled, onNavigate, onImport, t }) {
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const sources = list?.sources ?? {};
  const imported = BROWSERS.filter(browser => sources[browser]);
  // Each browser's bookmarks bar starts open, as the browsers themselves show it first.
  const [open, setOpen] = useState(() => new Set(BROWSERS.map(browser => `${browser}:bookmark_bar`)));
  const panel = useRef();
  const rows = useMemo(() => flattenBookmarks(sources, bookmarkFolderName(t)), [sources, t]);
  const results = useMemo(() => searchBookmarks(rows, query), [rows, query]);
  const toggle = id => setOpen(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const runImport = async browser => {
    setBusy(true); setMessage('');
    try { setMessage(bookmarkImportMessage(await onImport(browser), t)); }
    catch (error) { setMessage(`${t('error')}: ${error.message}`); }
    finally { setBusy(false); }
  };
  const onKeyDown = event => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const items = [...panel.current.querySelectorAll('[data-bookmark-row]')];
    if (items.length === 0) return;
    event.preventDefault();
    const index = items.indexOf(document.activeElement);
    items[index === -1 ? (event.key === 'ArrowDown' ? 0 : items.length - 1) : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
  };
  return <div ref={panel} className="tpcb-bookmarks" role="menu" aria-label={t('bookmarks')} onKeyDown={onKeyDown}>
    <label className="tpcb-bookmark-search"><Icon name="Search" size={14} />
      <input autoFocus type="search" placeholder={t('bookmarksSearch')} aria-label={t('bookmarksSearch')} value={query}
        onChange={event => setQuery(event.target.value)} disabled={imported.length === 0} /></label>
    <div className="tpcb-bookmark-list">
      {list === null ? <p className="tpcb-bookmark-note">{t('busy')}</p>
        : imported.length === 0 ? <p className="tpcb-bookmark-note">{t('bookmarksEmpty')}</p>
        : query.trim() !== '' ? (results.length === 0 ? <p className="tpcb-bookmark-note">{t('bookmarksNoMatch')}</p>
          : results.map(row => <BookmarkRow key={row.key} row={row} depth={0} onNavigate={onNavigate} showPath />))
        : imported.map(browser => <section key={browser} aria-label={BROWSER_NAMES[browser]}>
          {imported.length > 1 && <div className="tpcb-bookmark-heading">{BROWSER_NAMES[browser]}</div>}
          {sources[browser].roots.map(root => <Folder key={root.id} node={{ ...root, title: bookmarkFolderName(t)(root.id, root.title) }}
            id={`${browser}:${root.id}`} depth={0} open={open} onToggle={toggle} onNavigate={onNavigate} />)}
        </section>)}
    </div>
    <div className="tpcb-bookmark-footer">
      {BROWSERS.map(browser => {
        const available = list?.available?.[browser] === true;
        return <button key={browser} type="button" className="tpcb-bookmark-import" disabled={!enabled || busy || !available}
          title={available ? undefined : fill(t('bookmarksUnavailable'), { browser: BROWSER_NAMES[browser] })}
          onClick={() => { void runImport(browser); }}>
          {fill(t(sources[browser] ? 'bookmarksReimport' : 'bookmarksImportFrom'), { browser: BROWSER_NAMES[browser] })}</button>;
      })}
      {(busy || message) && <p className="tpcb-bookmark-status" role="status">{busy ? t('busy') : message}</p>}
    </div>
  </div>;
}

/** The toolbar's bookmark button and its menu. */
export function BookmarkMenu({ list, enabled, onOpen, onNavigate, onImport, t }) {
  return <Popup className="tpcb-bookmark-popup" trigger={({ open, toggle }) => <IconButton icon="Bookmark" label={t('bookmarks')} pressed={open}
    aria-haspopup="menu" aria-expanded={open} disabled={!enabled} onClick={() => { if (!open) onOpen(); toggle(); }} />}>
    {close => <BookmarkPanel list={list} enabled={enabled} onImport={onImport} t={t} onNavigate={url => { close(); onNavigate(url); }} />}
  </Popup>;
}

const belowAddress = rect => ({ top: rect.bottom + 4, left: rect.left, width: rect.width });

/** Bookmarks matching the typed address; the active row follows the arrow keys in the address field. */
export function AddressSuggestions({ anchor, matches, active, onPick, t }) {
  if (matches.length === 0) return null;
  return <Floating anchor={anchor} place={belowAddress} className="tpcb-address-suggestions" role="listbox" aria-label={t('bookmarks')}>
    {matches.map((row, index) => <div key={row.key} role="option" id={`tpcb-suggestion-${index}`} aria-selected={index === active}
      className="tpcb-suggestion" data-active={index === active ? '' : undefined}
      // Keep the address focused; the click then picks the row.
      onMouseDown={event => event.preventDefault()} onClick={() => onPick(row.url)}>
      <Icon name="Bookmark" size={14} className="tpcb-bookmark-icon" />
      <span className="tpcb-bookmark-title">{row.title}</span><span className="tpcb-bookmark-meta">{row.host}</span>
    </div>)}
  </Floating>;
}
