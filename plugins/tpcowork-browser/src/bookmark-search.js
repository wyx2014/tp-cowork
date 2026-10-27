/** Flat bookmark rows and the ranking the bookmark menu and the address suggestions share. */

const hostOf = url => { try { return new URL(url).hostname.replace(/^www\./u, ''); } catch { return ''; } };

/**
 * Every imported bookmark with its folder path, browser by browser in import order.
 * @param sources - snapshots keyed by browser, as the desktop lists them.
 * @param folderName - names a root folder by its id; other folders keep their own title.
 * @returns rows `{ key, title, url, host, path, browser }`.
 */
export function flattenBookmarks(sources, folderName = (_id, title) => title) {
  const rows = [];
  for (const [browser, source] of Object.entries(sources ?? {})) {
    const walk = (node, path, key) => {
      if (node.url !== undefined) { rows.push({ key, title: node.title, url: node.url, host: hostOf(node.url), path, browser }); return; }
      node.children.forEach((child, index) => walk(child, child.url === undefined ? [...path, child.title] : path, `${key}/${index}`));
    };
    for (const root of source.roots ?? []) walk(root, [folderName(root.id, root.title)], `${browser}:${root.id}`);
  }
  return rows;
}

/**
 * Bookmarks matching every word of a query, best first: a title or host that starts with the query, then one
 * containing it, then a match anywhere in the address. Each address appears once.
 * @param rows - rows from {@link flattenBookmarks}.
 * @param query - what the person typed.
 * @param limit - most rows to return.
 * @returns the matching rows.
 */
export function searchBookmarks(rows, query, limit = 50) {
  const needle = query.trim().toLowerCase();
  if (needle === '') return [];
  const words = needle.split(/\s+/u);
  const scored = [];
  const seen = new Set();
  for (const row of rows) {
    if (seen.has(row.url)) continue;
    const title = row.title.toLowerCase();
    const url = row.url.toLowerCase();
    const haystack = `${title} ${url} ${row.path.join(' ').toLowerCase()}`;
    if (!words.every(word => haystack.includes(word))) continue;
    seen.add(row.url);
    const score = title.startsWith(needle) || row.host.startsWith(needle) ? 0
      : title.includes(needle) || row.host.includes(needle) ? 1 : url.includes(needle) ? 2 : 3;
    scored.push({ row, score });
  }
  return scored.sort((a, b) => a.score - b.score || a.row.title.length - b.row.title.length)
    .slice(0, limit).map(entry => entry.row);
}
