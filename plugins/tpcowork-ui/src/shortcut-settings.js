/** Core actions keep the DSH reference's product order; other commands follow by id. */
const CORE_ORDER = new Map([
  'shortcuts.open', 'session.new', 'sidebar.left.toggle', 'session.search', 'workspace.add', 'session.rename', 'session.fork',
  'session.archive', 'settings.open', 'fontSize.increase', 'fontSize.decrease', 'workspace.openLocal', 'sidebar.right.toggle',
  'workspace.files', 'browser.new', 'terminal.new', 'pane.split', 'pane.fullscreen.toggle', 'page.refresh', 'page.close',
].map((id, index) => [id, index]));
const FIXED_GROUPS = ['input', 'menus', 'approval'];
const MODIFIER_CODE = /^(Control|Alt|Shift|Meta)(Left|Right)$/u;

/**
 * Translate one keydown into a DSH binding request.
 * @param event - keyboard event from the capture listener.
 * @returns the physical binding, or null for a lone modifier or an IME composition step.
 */
export function bindingFromEvent(event) {
  if (event.isComposing || event.keyCode === 229 || MODIFIER_CODE.test(event.code) || event.code === '') return null;
  const modifiers = ['control', 'alt', 'shift', 'meta'].filter(name => ({ control: event.ctrlKey, alt: event.altKey, shift: event.shiftKey, meta: event.metaKey })[name]);
  return { code: event.code, modifiers };
}

const bare = event => !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey;

/**
 * Order and filter the editable and fixed commands for the table.
 * @param catalog - editable command rows.
 * @param fixed - read-only reserved rows.
 * @param query - text filter over label, id and aliases.
 * @param keyMatches - command ids bound to the searched combination, or null without a key filter.
 * @returns rows with their scope group.
 */
export function shortcutRows(catalog, fixed, query, keyMatches) {
  const keyword = query.trim().toLowerCase();
  const rows = [
    ...catalog.map(row => ({ ...row, group: 'application', editable: true, words: [row.id, row.label, ...row.aliases] }))
      .sort((left, right) => (CORE_ORDER.get(left.id) ?? CORE_ORDER.size) - (CORE_ORDER.get(right.id) ?? CORE_ORDER.size)
        || Number(left.id > right.id) - Number(left.id < right.id)),
    ...FIXED_GROUPS.flatMap(group => fixed.filter(row => row.group === group)
      .map(row => ({ ...row, editable: false, modified: false, words: [row.id, row.label] }))),
  ];
  return rows.filter(row => (keyword === '' || row.words.some(word => word.toLowerCase().includes(keyword)))
    && (keyMatches === null || keyMatches.includes(row.id)));
}

/**
 * The reference product's (ZCode) "Keyboard shortcuts" settings page over the DSH shortcut service: a text search with
 * a press-to-search key button and "Restore all defaults", then one table of command, binding, scope and actions with
 * inline recording, conflict takeover and clearing. Fixed menu and input keys appear read-only.
 */
export function createShortcutSettings(React, primitives) {
  const h = React.createElement;
  const { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } = React;
  const use = source => useSyncExternalStore(listener => source.subscribe(listener), () => source.getSnapshot());
  const icon = (paths, size = 16) => h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2,
    strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }, ...paths.map(d => h('path', { key: d, d })));
  // Lucide's Keyboard, Search, X, RotateCcw, Pencil and Trash2, as in the reference product.
  const KeyboardIcon = ({ size }) => icon(['M10 8h.01', 'M12 12h.01', 'M14 8h.01', 'M16 12h.01', 'M18 8h.01', 'M6 8h.01', 'M7 16h10', 'M8 12h.01',
    'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z'], size);
  const SearchIcon = () => icon(['m21 21-4.34-4.34', 'M11 3a8 8 0 1 0 0 16 8 8 0 0 0 0-16z']);
  const ClearIcon = () => icon(['M18 6 6 18', 'm6 6 12 12'], 14);
  const ResetIcon = () => icon(['M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8', 'M3 3v5h5'], 14);
  const PencilIcon = () => icon(['M21.17 6.81a1 1 0 0 0-3.99-3.99L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5z', 'm15 5 4 4'], 14);
  const TrashIcon = () => icon(['M3 6h18', 'M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6', 'M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2', 'M10 11v6', 'M14 11v6'], 14);
  const Keys = ({ keys, custom }) => h('span', { className: 'tpcowork-kbd-group' },
    keys.filter(key => key !== '+').map((key, index) => h('kbd', { key: `${key}-${index}`, className: custom ? 'tpcowork-kbd tpcowork-kbd-custom' : 'tpcowork-kbd' }, key)));

  return function ShortcutSettings({ t, shortcuts }) {
    const catalog = use(shortcuts.catalog);
    const fixed = use(shortcuts.fixedCatalog);
    const config = use(shortcuts.config);
    const [query, setQuery] = useState('');
    const [recording, setRecording] = useState(null);
    const [armed, setArmed] = useState(false);
    const [keyFilter, setKeyFilter] = useState(null);
    const [confirmReset, setConfirmReset] = useState(false);
    const [busy, setBusy] = useState(false);
    const busyRef = useRef(false);
    const ready = config.status === 'ready';
    const modifiedCount = Object.keys(config.document.profiles?.[`${shortcuts.runtime}:${shortcuts.platform}`] ?? {}).length;
    const labelOf = useCallback(id => [...catalog, ...fixed].find(row => row.id === id)?.label ?? id, [catalog, fixed]);
    const failure = useCallback(result => result.issue ? t(`shortcutIssue.${result.issue}`)
      : result.status === 'conflict' ? t('shortcutOccupied', { command: (result.conflicts ?? []).map(labelOf).join('、') })
        : t(`shortcutStatus.${result.status}`), [labelOf, t]);

    /** Apply edits in order, each against the revision the previous one produced. */
    const save = useCallback(async operations => {
      if (busyRef.current) return null;
      busyRef.current = true;
      setBusy(true);
      try {
        let revision = shortcuts.config.getSnapshot().revision;
        for (const operation of operations) {
          const result = await shortcuts.edit(operation, revision);
          if (result.status !== 'saved') return result;
          revision = result.snapshot.revision;
        }
        return { status: 'saved' };
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    }, [shortcuts]);

    // Recording and key search own the keyboard, and the Desktop menu accelerators stand down meanwhile.
    const exclusive = recording !== null || armed;
    useEffect(() => {
      if (!exclusive) return undefined;
      void shortcuts.recording(true).catch(() => undefined);
      // The interface zoom keys are this plugin's own capture listener, so they stand down by this mark.
      document.documentElement.dataset.tpcoworkShortcutRecording = '';
      return () => {
        delete document.documentElement.dataset.tpcoworkShortcutRecording;
        void shortcuts.recording(false).catch(() => undefined);
      };
    }, [exclusive, shortcuts]);

    const recordingRef = useRef(recording);
    recordingRef.current = recording;
    useEffect(() => {
      if (recording === null) return undefined;
      const down = event => {
        const current = recordingRef.current;
        if (current === null || event.isComposing || event.keyCode === 229) return;
        event.preventDefault();
        event.stopPropagation();
        if (event.repeat || busyRef.current) return;
        if (event.key === 'Escape' && bare(event)) { setRecording(null); return; }
        if (event.key === 'Backspace' && bare(event)) {
          void save([{ type: 'reset', id: current.id }]).then(result => {
            if (result === null) return;
            if (result.status === 'saved') setRecording(null);
            else setRecording(state => state && { ...state, error: failure(result), conflict: null });
          });
          return;
        }
        const request = bindingFromEvent(event);
        if (request === null) return;
        let described;
        try { described = shortcuts.describeBinding(request); }
        catch (_error) { setRecording(state => state && { ...state, preview: null, error: t('shortcutIssue.unsupported-key'), conflict: null }); return; }
        const preview = described.keys.filter(key => key !== '+');
        if (described.issue !== null) { setRecording(state => state && { ...state, preview, error: t(`shortcutIssue.${described.issue}`), conflict: null }); return; }
        const others = described.conflicts.filter(id => id !== current.id);
        if (others.length > 0) {
          // Editable owners can give up their key; fixed menu and input keys are reserved.
          const reserved = others.some(id => fixed.some(row => row.id === id));
          setRecording(state => state && { ...state, preview, error: reserved ? t('shortcutReserved') : t('shortcutOccupied', { command: others.map(labelOf).join('、') }),
            conflict: reserved ? null : { binding: described.binding, owners: others } });
          return;
        }
        setRecording(state => state && { ...state, preview, error: null, conflict: null });
        void save([{ type: 'set', id: current.id, binding: described.binding }]).then(result => {
          if (result === null) return;
          if (result.status === 'saved') setRecording(null);
          else setRecording(state => state && { ...state, error: failure(result), conflict: null });
        });
      };
      window.addEventListener('keydown', down, true);
      return () => window.removeEventListener('keydown', down, true);
    }, [recording !== null, save, shortcuts, fixed, labelOf, failure, t]);

    useEffect(() => {
      if (!armed) return undefined;
      const down = event => {
        if (event.isComposing || event.keyCode === 229) return;
        event.preventDefault();
        event.stopPropagation();
        if (event.key === 'Escape' && bare(event)) { setArmed(false); return; }
        if (event.key === 'Backspace' && bare(event)) { setKeyFilter(null); return; }
        const request = bindingFromEvent(event);
        if (request === null) return;
        try {
          const described = shortcuts.describeBinding(request);
          if (described.binding === null) return;
          setKeyFilter({ keys: described.keys.filter(key => key !== '+'), ids: described.conflicts });
          setArmed(false);
        } catch (_error) { /* An unsupported key waits for the next combination. */ }
      };
      window.addEventListener('keydown', down, true);
      return () => window.removeEventListener('keydown', down, true);
    }, [armed, shortcuts]);

    const rows = useMemo(() => shortcutRows(catalog, fixed, query, keyFilter?.ids ?? null), [catalog, fixed, query, keyFilter]);
    const startRecording = id => { setArmed(false); setRecording({ id, preview: null, error: null, conflict: null }); };
    const steal = () => {
      const current = recordingRef.current;
      if (current?.conflict == null) return;
      void save([...current.conflict.owners.map(id => ({ type: 'set', id, binding: null })), { type: 'set', id: current.id, binding: current.conflict.binding }])
        .then(result => {
          if (result === null) return;
          if (result.status === 'saved') setRecording(null);
          else setRecording(state => state && { ...state, error: failure(result), conflict: null });
        });
    };
    const scope = row => row.editable ? t('shortcutScopeGlobal') : t(`shortcutScope.${row.group}`);

    const recorder = h('span', { className: 'tpcowork-shortcut-recorder' },
      h('span', { className: 'tpcowork-shortcut-recorder-line' },
        h('span', { className: 'tpcowork-shortcut-subtle' }, h(KeyboardIcon, { size: 16 })),
        // Taking focus moves it out of the search box, so an input method cannot swallow Shift combinations.
        h('kbd', { ref: element => element?.focus({ preventScroll: true }), tabIndex: -1, className: 'tpcowork-shortcut-preview' },
          recording?.preview?.length ? recording.preview.join(' ') : t('shortcutRecording'))),
      recording?.error
        ? h('span', { className: 'tpcowork-shortcut-error', role: 'alert' }, recording.error)
        : h('span', { className: 'tpcowork-shortcut-hint' }, t('shortcutRecordingHint')),
      recording?.conflict
        ? h('button', { type: 'button', className: 'tpcowork-shortcut-outline tpcowork-shortcut-steal', disabled: busy, onClick: steal }, t('shortcutSteal'))
        : null);

    const keyLabel = keyFilter === null ? null : keyFilter.keys.join(' ');
    return h('div', { className: 'tpcowork-shortcuts', 'data-platform': shortcuts.platform },
      h('div', { className: 'tpcowork-shortcut-bar' },
        h('button', { type: 'button', className: 'tpcowork-shortcut-outline', disabled: busy || !ready || modifiedCount === 0,
          onClick: () => { setRecording(null); setConfirmReset(true); } }, h(ResetIcon), t('shortcutResetAll')),
        h('div', { className: 'tpcowork-shortcut-search' },
          h('span', { className: 'tpcowork-shortcut-search-icon' }, h(SearchIcon)),
          h('input', {
            type: 'search', className: keyLabel === null ? 'tpcowork-shortcut-input' : 'tpcowork-shortcut-input tpcowork-shortcut-input-keys',
            placeholder: armed ? t('shortcutKeySearchPlaceholder') : t('shortcutSearchPlaceholder'), 'aria-label': t('shortcutSearchPlaceholder'),
            value: keyLabel ?? query, readOnly: armed || keyLabel !== null, onChange: event => setQuery(event.target.value),
          }),
          !armed && (keyLabel !== null || query !== '') ? h('button', { type: 'button', className: 'tpcowork-shortcut-key-clear',
            'aria-label': t(keyLabel !== null ? 'shortcutKeySearchClear' : 'shortcutSearchClear'),
            onClick: () => keyLabel !== null ? setKeyFilter(null) : setQuery('') }, h(ClearIcon)) : null,
          h('button', { type: 'button', className: armed ? 'tpcowork-shortcut-key-search tpcowork-shortcut-armed' : 'tpcowork-shortcut-key-search',
            'aria-label': t('shortcutKeySearch'), 'aria-pressed': armed, title: t('shortcutKeySearch'),
            onClick: () => { if (!armed) setRecording(null); setArmed(value => !value); } }, h(KeyboardIcon, { size: 16 })))),
      h('div', { className: 'tpcowork-shortcut-table', role: 'table', 'aria-busy': config.status === 'loading' },
        h('div', { className: 'tpcowork-shortcut-head', role: 'row' },
          ['shortcutColumnCommand', 'shortcutColumnBinding', 'shortcutColumnScope', 'shortcutColumnActions']
            .map(key => h('span', { key, role: 'columnheader' }, t(key)))),
        rows.map(row => {
          const active = recording?.id === row.id;
          const disabled = !row.editable || !ready || busy;
          const rebind = t('shortcutRebind', { command: row.label });
          return h('div', { key: row.id, className: 'tpcowork-shortcut-row', role: 'row', 'data-shortcut': row.id },
            h('span', { className: 'tpcowork-shortcut-command', role: 'cell' }, h('span', null, row.label)),
            h('span', { className: 'tpcowork-shortcut-bindings', role: 'cell' }, active ? recorder
              : row.keys.length === 0
                ? h('button', { type: 'button', className: 'tpcowork-shortcut-keys', disabled, 'aria-label': rebind, onClick: () => startRecording(row.id) },
                  h('kbd', { className: 'tpcowork-kbd' }, t('shortcutNotSet')))
                : h('span', { className: 'tpcowork-shortcut-binding' },
                  h('button', { type: 'button', className: 'tpcowork-shortcut-keys', disabled, 'aria-label': rebind, onClick: () => startRecording(row.id) },
                    h(Keys, { keys: row.keys, custom: row.modified })),
                  row.editable ? h('button', { type: 'button', className: 'tpcowork-shortcut-ghost tpcowork-shortcut-edit', disabled, 'aria-label': rebind,
                    onClick: () => startRecording(row.id) }, h(PencilIcon)) : null)),
            h('span', { className: 'tpcowork-shortcut-scope', role: 'cell' }, scope(row)),
            h('span', { role: 'cell' }, row.editable ? h('button', { type: 'button', className: 'tpcowork-shortcut-ghost tpcowork-shortcut-clear',
              'aria-label': t('shortcutClear', { command: row.label }), disabled: disabled || row.binding === null,
              onClick: () => { setRecording(null); void save([{ type: 'set', id: row.id, binding: null }]); } }, h(TrashIcon)) : null));
        }),
        rows.length === 0 ? h('div', { className: 'tpcowork-shortcut-empty', role: 'status' },
          keyLabel !== null ? t('shortcutKeySearchEmpty', { keys: keyLabel }) : t('shortcutSearchEmpty')) : null),
      h(primitives.Modal, {
        open: confirmReset, title: t('shortcutResetAllTitle'), description: t('shortcutResetAllDescription'), closeLabel: t('shortcutCancel'),
        onClose: () => { if (!busy) setConfirmReset(false); },
        footer: h(React.Fragment, null,
          h(primitives.Button, { 'data-modal-autofocus': true, disabled: busy, onClick: () => setConfirmReset(false) }, t('shortcutCancel')),
          h(primitives.Button, { variant: 'primary', disabled: busy || !ready, onClick: () => {
            void save([{ type: 'reset-all' }]).then(result => { if (result !== null) setConfirmReset(false); });
          } }, t('shortcutResetAll'))),
      }));
  };
}
