/**
 * The reference product's combined composer model picker (ZCode 3.16 `ModelConfigSelect` with `composerOptions`) over
 * the native model directory. The trigger names the model and its thinking level; the menu opening above it holds a
 * provider row with a side submenu, the provider's models, and an effort slider whose fill turns into a gradient with
 * drifting bubbles at the greatest level. Levels come from the Host's model metadata; the plugin only names them.
 */

/** The reference product's names for effort ids, aliases included; any other id keeps the Host's own name. */
const NO_THOUGHT = ['disabled', 'false', 'no', 'none', 'nothink', 'no-think', 'no_think', 'off'];
const THOUGHT_LABELS = {
  ...Object.fromEntries(NO_THOUGHT.map(id => [id, 'thoughtOff'])),
  ...Object.fromEntries(['enable', 'enabled', 'on', 'true'].map(id => [id, 'thoughtOn'])),
  minimal: 'thoughtMinimal', low: 'thoughtLow', medium: 'thoughtMedium', high: 'thoughtHigh',
  'extra-high': 'thoughtXhigh', extra_high: 'thoughtXhigh', xhigh: 'thoughtXhigh', max: 'thoughtMax', ultra: 'thoughtUltra',
};
const isNoThought = effort => NO_THOUGHT.includes(effort.trim().toLowerCase());
const PROVIDER_ORDER = id => id === 'deepseek-account' ? 0 : id === 'deepseek-official' ? 1 : 2;
/** The reference product's bubble field: offset, diameter, and timing of each bubble in the max-level fill. */
const BUBBLES = [[4, 2, 2.6, -0.4], [14, 3, 3.2, -2.1], [8, 4, 2.8, -1.1], [18, 2, 3.6, -0.8], [3, 3, 3, -2.5],
  [12, 2, 3.4, -1.7], [6, 3, 3.1, -0.9], [17, 4, 2.9, -2.3], [10, 2, 3.5, -0.2], [2, 2, 2.7, -1.8], [15, 3, 3.3, -1.2],
  [7, 4, 3.6, -3.1]];

/**
 * Order provider groups as the native pickers do: the account, then the official provider, then catalog order.
 * @param groups - provider groups in catalog order.
 * @returns a sorted copy.
 */
export function orderProviders(groups) {
  return groups.toSorted((left, right) => PROVIDER_ORDER(left.id) - PROVIDER_ORDER(right.id));
}

/**
 * Thinking-level rows for the selected model, in the Host's order.
 * @param reasoning - the model's reasoning metadata, or undefined when it has none.
 * @param t - native `model` translator, for the provider default.
 * @param tp - plugin translator.
 * @returns rows with `effort` undefined for the provider default.
 */
export function thoughtLevels(reasoning, t, tp) {
  if (reasoning === undefined) return [];
  return [
    ...reasoning.defaultEffort === undefined ? [{ key: 'default', effort: undefined, label: t('effort.providerDefault') }] : [],
    ...reasoning.efforts.map(level => ({
      key: level.id, effort: level.id,
      label: Object.hasOwn(THOUGHT_LABELS, level.id.trim().toLowerCase()) ? tp(THOUGHT_LABELS[level.id.trim().toLowerCase()]) : level.name,
    })),
  ];
}

/**
 * The compact meter's fill: off and unknown levels are empty, the strongest is full.
 * @param levels - rows from {@link thoughtLevels}.
 * @param effort - the effective effort.
 * @returns a fraction from 0 to 1.
 */
export function thoughtProgress(levels, effort) {
  const thinking = levels.filter(level => level.effort !== undefined && !isNoThought(level.effort));
  const index = thinking.findIndex(level => level.effort === effort);
  return index === -1 ? 0 : (index + 1) / thinking.length;
}

/**
 * The next level for the cycle shortcut, wrapping; an unknown current level starts at the first.
 * @param levels - rows from {@link thoughtLevels}.
 * @param effort - the effective effort.
 * @returns the next row, or undefined when there is nothing to cycle.
 */
export function nextThoughtLevel(levels, effort) {
  if (levels.length < 2) return undefined;
  const index = levels.findIndex(level => level.effort === effort);
  return levels[index === -1 ? 0 : (index + 1) % levels.length];
}

/** Build the seat component from the host's React and primitives. */
export function createModelControls(React, createPortal, primitives) {
  const h = React.createElement;
  const {
    FishLogo, MenuSurface, ShortcutKeys, StateDot, Toast, Tooltip, useAnchoredPosition,
    IconCheckOutlineRegular, IconChevronDownOutlineRegular, IconChevronRightOutlineRegular, IconDataOutlineRegular,
    IconWarningOutlineRegular,
  } = primitives;
  /** Mounted seats, newest last; the cycle shortcut drives the one the user is working in. */
  const seats = new Set();

  /** Enabled rows of one menu; a submenu nested in its parent's DOM keeps its own rows. */
  const rowsOf = container => Array.from(container?.querySelectorAll('[data-menu-row]:not(:disabled), input[type="range"]:not([aria-disabled="true"])') ?? [])
    .filter(row => row.closest('[role="menu"]') === container);
  const step = (container, offset) => {
    const rows = rowsOf(container);
    if (rows.length === 0) return;
    const index = rows.indexOf(document.activeElement);
    rows[index === -1 ? (offset > 0 ? 0 : rows.length - 1) : (index + offset + rows.length) % rows.length].focus();
  };
  const enter = container => {
    const rows = rowsOf(container);
    (rows.find(row => row.getAttribute('aria-checked') === 'true') ?? rows[0])?.focus();
  };

  /** The reference product's provider logos: DeepSeek routes take the whale, any other the package glyph. */
  const isDeepSeek = group => /deepseek/i.test(`${group.id} ${group.name}`)
    || (group.models.length > 0 && group.models.every(model => /deepseek/i.test(model.id)));
  const ProviderLogo = ({ group }) => isDeepSeek(group)
    ? h('span', { className: 'tpcowork-provider-logo', 'data-logo': 'deepseek', 'aria-hidden': true }, h(FishLogo, { size: 16 }))
    : h('span', { className: 'tpcowork-provider-logo', 'aria-hidden': true }, h(IconDataOutlineRegular, { size: 16 }));
  const Badge = ({ children, outline }) => h('span', { className: outline ? 'tpcowork-model-badge tpcowork-model-badge-outline' : 'tpcowork-model-badge' }, children);
  const Check = ({ busy, checked }) => h('span', { className: 'tpcowork-menu-check' },
    busy ? h(StateDot, { state: 'ongoing' }) : checked ? h(IconCheckOutlineRegular, null) : null);

  /** The trigger's level: its name, or in a compact row the reference product's fill meter. */
  const ThoughtMeter = ({ levels, effort, label }) => h(React.Fragment, null,
    h('span', { className: 'tpcowork-composer-thought-label', 'data-composer-thought-label': '' }, label),
    h('span', { className: 'tpcowork-thought-meter', 'aria-hidden': true, 'data-progress': thoughtProgress(levels, effort) * 100 },
      h('span', { style: { height: `${thoughtProgress(levels, effort) * 100}%` } })));

  /** The effort section: label, value and shortcut, then the slider over a native range input. */
  function EffortSlider({ levels, effort, active, disabled, shortcut, tp, onChange }) {
    const index = levels.findIndex(level => level.effort === effort);
    const label = active && index >= 0 ? levels[index].label : '—';
    const [hovered, setHovered] = React.useState(null);
    const header = h('div', { className: 'tpcowork-effort-header' },
      h('span', { className: 'tpcowork-effort-title' }, tp('effortTitle')),
      h('span', { 'data-testid': 'composer-thought-value' }, label),
      shortcut !== undefined && shortcut.length > 0 ? h(ShortcutKeys, { keys: shortcut, className: 'tpcowork-effort-shortcut' }) : null);
    if (levels.length === 1) return h('div', { className: 'tpcowork-effort' }, header);
    const position = levels.length > 1 && index >= 0 && active ? index / (levels.length - 1) : 0;
    const filled = active && index >= 0 && !(levels[index].effort !== undefined && isNoThought(levels[index].effort));
    const max = filled && index === levels.length - 1;
    const commit = value => {
      const level = levels[value];
      if (!disabled && level !== undefined && level.effort !== effort) onChange(level.effort);
    };
    return h('div', { className: 'tpcowork-effort' }, header,
      h('div', { className: 'tpcowork-thought-slider', 'data-disabled': disabled },
        h('div', { className: 'tpcowork-thought-slider-art', 'aria-hidden': true },
          h('div', { className: 'tpcowork-thought-track', 'data-progress': filled ? position * 100 : 0 },
            h('div', { className: 'tpcowork-thought-track-border' }),
            h('div', { className: 'tpcowork-thought-fill', 'data-max': max,
              style: { width: filled ? `calc(14px + (100% - 28px) * ${position})` : 0 } },
            max && !disabled ? h('div', { className: 'tpcowork-thought-bubbles', 'data-testid': 'composer-thought-bubbles' },
              ...BUBBLES.map(([top, size, duration, delay], key) => h('span', { key, className: 'tpcowork-thought-bubble',
                style: { top, animationDuration: `${duration}s`, animationDelay: `${delay}s` } },
              h('span', { style: { width: size, height: size } })))) : null)),
          h('div', { className: 'tpcowork-thought-stops' }, ...levels.map((level, at) => h('span', {
            key: level.key, className: 'tpcowork-thought-stop', 'data-filled': filled && at <= index,
            'data-hovered': !disabled && hovered === at }))),
          h('div', { className: 'tpcowork-thought-thumb', style: { left: `calc((100% - 28px) * ${position})` } })),
        h('input', {
          type: 'range', min: 0, max: Math.max(0, levels.length - 1), step: 1, value: Math.max(0, index),
          'aria-disabled': disabled, 'aria-label': tp('effortTitle'), 'aria-valuetext': label,
          'data-testid': 'composer-thought-slider', className: 'tpcowork-thought-range',
          onPointerDown: event => { if (disabled) event.preventDefault(); },
          onPointerLeave: () => setHovered(null),
          onPointerMove: event => {
            const box = event.currentTarget.getBoundingClientRect();
            const span = box.width - 28;
            const at = Math.round((event.clientX - box.left - 14) / span * (levels.length - 1));
            const center = box.left + 14 + span * at / (levels.length - 1);
            setHovered(!disabled && event.pointerType !== 'touch' && levels[at] && Math.abs(event.clientX - center) <= 10 ? at : null);
          },
          onKeyDown: event => {
            if (event.key === 'Escape') return;
            event.stopPropagation();
            if (disabled && event.key !== 'Tab') event.preventDefault();
          },
          onChange: event => commit(Number(event.currentTarget.value)),
        })));
  }

  function ProviderRow({ groups, view, current, t, tp, onSelect }) {
    const [open, setOpen] = React.useState(false);
    const [style, setStyle] = React.useState(null);
    const row = React.useRef(null);
    const submenu = React.useRef(null);
    React.useLayoutEffect(() => {
      if (!open) { setStyle(null); return; }
      const anchor = row.current?.getBoundingClientRect();
      const menu = row.current?.closest('[role="menu"]')?.getBoundingClientRect();
      const panel = submenu.current;
      if (!anchor || !menu || !panel) return;
      const width = panel.offsetWidth;
      const left = menu.right + 4 + width + 12 <= window.innerWidth ? menu.right + 4 : Math.max(12, menu.left - 4 - width);
      setStyle({ left, top: Math.max(12, Math.min(anchor.top - 5, window.innerHeight - panel.offsetHeight - 12)) });
    }, [open, groups]);
    const name = group => group.id === 'deepseek-account' ? t('provider.account') : group.name;
    const badge = group => group.id === 'deepseek-account' ? undefined : tp('providerApiBadge');
    return h('div', { className: 'tpcowork-provider', onMouseLeave: event => {
      if (!(event.relatedTarget instanceof Node) || !submenu.current?.contains(event.relatedTarget)) setOpen(false);
    } },
    h('button', {
      ref: row, type: 'button', role: 'menuitem', 'aria-haspopup': 'menu', 'aria-expanded': open, 'data-menu-row': '',
      'aria-label': `${tp('providerLabel')}: ${view ? name(view) : '—'}`, 'data-testid': 'composer-provider-trigger',
      className: 'tpcowork-menu-row tpcowork-provider-row', 'data-open': open ? '' : undefined, disabled: groups.length === 0,
      onMouseEnter: () => setOpen(true), onClick: () => setOpen(true),
      onKeyDown: event => {
        if (event.key === 'ArrowRight' || event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          event.stopPropagation();
          setOpen(true);
          queueMicrotask(() => enter(submenu.current));
        }
      },
    }, view ? h(ProviderLogo, { group: view }) : null,
    h('span', { className: 'tpcowork-menu-label' }, view ? name(view) : '—'),
    view && badge(view) ? h(Badge, null, badge(view)) : null,
    h(IconChevronRightOutlineRegular, { className: 'tpcowork-menu-chevron' })),
    open ? h(MenuSurface, {
      ref: submenu, role: 'menu', 'aria-label': tp('providerLabel'), className: 'tpcowork-menu tpcowork-provider-menu',
      style: style ?? { visibility: 'hidden', left: 0, top: 0 }, 'data-composer-provider-list': '',
      onKeyDown: event => {
        if (event.key === 'ArrowLeft' || event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
          row.current?.focus();
        } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          event.stopPropagation();
          step(submenu.current, event.key === 'ArrowDown' ? 1 : -1);
        }
      },
    }, ...groups.map(group => h('button', {
      key: group.id, type: 'button', role: 'menuitemradio', 'aria-checked': group === view, 'data-menu-row': '',
      'data-model-provider-key': group.id, className: 'tpcowork-menu-row',
      'aria-label': [name(group), badge(group)].filter(Boolean).join(' '),
      onClick: () => { setOpen(false); row.current?.focus(); onSelect(group); },
    }, h(ProviderLogo, { group }), h('span', { className: 'tpcowork-menu-label' }, name(group)),
    badge(group) ? h(Badge, null, badge(group)) : null,
    h(Check, { checked: group.id === current?.provider })))) : null);
  }

  /** The `conversation.input.model` seat: one trigger and the combined menu. */
  const NO_COMMANDS = [];
  const NO_SHORTCUTS = { subscribe: () => () => {}, getSnapshot: () => NO_COMMANDS };
  function ModelControls({ locked, available, directory, load, select, shortcuts = NO_SHORTCUTS, t, tp }) {
    const state = React.useSyncExternalStore(directory.subscribe, directory.getSnapshot);
    const commands = React.useSyncExternalStore(shortcuts.subscribe, shortcuts.getSnapshot);
    const shortcut = commands.find(row => row.id === 'tpcowork.thought.cycle')?.keys;
    const [open, setOpen] = React.useState(false);
    const [width, setWidth] = React.useState(null);
    const [viewKey, setViewKey] = React.useState(null);
    const [toast, setToast] = React.useState(null);
    const root = React.useRef(null);
    const trigger = React.useRef(null);
    const menu = React.useRef(null);
    const focusOnOpen = React.useRef(false);
    const position = useAnchoredPosition({ open, anchorRef: trigger, panelRef: menu, side: 'top', align: 'start', gap: 6, margin: 12 });
    // The injected face is rebuilt on every render; the shared catalog needs one load per mount.
    React.useEffect(() => { load(); }, []);
    const groups = React.useMemo(() => orderProviders(state.groups), [state.groups]);
    const current = state.current;
    const group = current === null ? undefined : groups.find(candidate => candidate.id === current.provider);
    const model = group?.models.find(candidate => candidate.id === current.model);
    const levels = thoughtLevels(model?.reasoning, t, tp);
    const effort = current?.reasoningEffort ?? model?.reasoning?.defaultEffort;
    const busy = state.pending !== null;
    const submit = selection => {
      void select(selection).then(result => {
        if (result === undefined || result.ok) return;
        setToast(previous => ({ seq: (previous?.seq ?? 0) + 1, text: result.error.code === 'session/writer-held'
          ? t('error.sessionInUse') : t('error.action', { message: `${result.error.code}: ${result.error.message}` }) }));
      });
    };
    const chooseEffort = next => {
      if (current === null) return;
      submit({ provider: current.provider, model: current.model, ...next === undefined ? {} : { reasoningEffort: next } });
    };
    const latest = React.useRef(null);
    latest.current = { root, levels, effort, busy, locked, model, chooseEffort };
    React.useEffect(() => {
      const seat = latest;
      seats.add(seat);
      return () => { seats.delete(seat); };
    }, []);
    React.useEffect(() => {
      if (!open) return;
      // Clicks outside close the menu; the submenu is a child of the menu surface.
      const closeOutside = event => {
        if (root.current?.contains(event.target) || menu.current?.contains(event.target)) return;
        setOpen(false);
      };
      document.addEventListener('pointerdown', closeOutside);
      return () => document.removeEventListener('pointerdown', closeOutside);
    }, [open]);
    React.useEffect(() => {
      if (!open) focusOnOpen.current = false;
      if (!focusOnOpen.current) return;
      enter(menu.current);
      if (menu.current?.contains(document.activeElement)) focusOnOpen.current = false;
    });
    if (!available) return null;
    const waiting = model === undefined && state.status === 'loading';
    const name = waiting ? t('trigger.loading') : model?.name ?? t('trigger.fallback');
    const level = levels.find(row => row.effort === effort);
    const view = groups.find(candidate => candidate.id === viewKey) ?? group ?? groups[0];
    const viewing = view !== undefined && view === group;
    const show = () => {
      load();
      setWidth(trigger.current?.getBoundingClientRect().width ?? null);
      setViewKey(null);
      focusOnOpen.current = true;
      setOpen(true);
    };
    const close = () => {
      setOpen(false);
      queueMicrotask(() => trigger.current?.focus());
    };
    const chooseProvider = next => {
      setViewKey(next.id);
      if (next === group) return;
      // The reference product moves the selection with the provider: the current model when it is there, else the first.
      const first = next.models[0];
      if (first !== undefined) submit({ provider: next.id, model: first.id });
    };
    const onKeyDown = event => {
      if (event.nativeEvent.isComposing) return;
      if (!open) {
        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); show(); }
        return;
      }
      if (event.key === 'Escape') { event.preventDefault(); close(); }
      else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        step(menu.current, event.key === 'ArrowDown' ? 1 : -1);
      } else if (event.key === 'Tab') setOpen(false);
    };
    const triggerLabel = level !== undefined ? `${name} ${level.label}` : name;
    return h('div', { ref: root, className: 'tpcowork-model-controls', 'data-tpcowork-model-controls': '', onKeyDown },
      h(Tooltip, { label: open ? '' : tp('selectModel'), side: 'top', delayMs: 500, disabled: open },
        h('button', {
          ref: trigger, type: 'button', className: 'tpcowork-composer-trigger tpcowork-model-trigger',
          'aria-haspopup': 'menu', 'aria-expanded': open, 'aria-busy': busy, 'aria-label': triggerLabel, title: open ? undefined : triggerLabel,
          disabled: locked, 'data-tpcowork-model-trigger': '', 'data-open': open ? '' : undefined,
          'data-empty': current === null ? '' : undefined,
          style: open && width !== null ? { '--tpcowork-model-open-width': `max(${width}px, 8rem)` } : undefined,
          onClick: () => open ? close() : show(),
        }, open
          ? h('span', { className: 'tpcowork-model-open-label' }, tp('selectModel'))
          : h(React.Fragment, null,
            h(IconDataOutlineRegular, { className: 'tpcowork-model-icon', size: 16 }),
            h('span', { className: 'tpcowork-composer-label', 'data-model-label': '' }, name),
            model !== undefined && levels.length > 0 ? h(ThoughtMeter, { levels, effort, label: level?.label ?? '—' }) : null,
            busy ? h(StateDot, { state: 'ongoing' }) : h(IconChevronDownOutlineRegular, { className: 'tpcowork-composer-chevron' })))),
      open && createPortal(h(MenuSurface, {
        ref: menu, role: 'menu', 'aria-label': t('menu.aria'), 'aria-busy': state.status === 'loading' || busy,
        className: 'tpcowork-menu tpcowork-combined-menu', 'data-tpcowork-model-menu': '',
        style: position === null ? { visibility: 'hidden', left: 0, top: 0 } : {
          ...position,
          // Centered on the trigger, as the reference product aligns it, within the viewport.
          left: Math.max(12, Math.min(window.innerWidth - 300,
            (trigger.current?.getBoundingClientRect().left ?? 0) + (trigger.current?.getBoundingClientRect().width ?? 0) / 2 - 144)),
        },
      },
      state.error !== null ? h('div', { className: 'tpcowork-menu-note tpcowork-menu-error', role: 'alert' },
        h('span', null, t('error.action', { message: state.error })),
        h('button', { type: 'button', className: 'tpcowork-menu-retry', onClick: () => load() }, t('action.reload'))) : null,
      ...state.failures.map(failure => h('div', { key: failure.id, className: 'tpcowork-menu-note tpcowork-menu-error' },
        t('warning.groupLoad', { name: failure.id === 'deepseek-account' ? t('provider.account') : failure.name, message: failure.message }))),
      h(ProviderRow, { groups, view, current, t, tp, onSelect: chooseProvider }),
      h('div', { className: 'tpcowork-menu-separator', role: 'separator' }),
      h('div', { className: 'tpcowork-menu-heading' }, tp('modelsTitle')),
      h('div', { className: 'tpcowork-model-list scrollable', 'data-composer-model-list': '' },
        state.status === 'loading' && groups.length === 0 ? h('div', { className: 'tpcowork-menu-note' }, t('status.loading')) : null,
        state.status !== 'loading' && groups.length === 0 ? h('div', { className: 'tpcowork-menu-note', role: 'status' }, t('empty.models')) : null,
        ...(view?.models ?? []).map(candidate => {
          const checked = current?.provider === view.id && current.model === candidate.id;
          return h('button', {
            key: candidate.id, type: 'button', role: 'menuitemradio', 'aria-checked': checked, 'data-menu-row': '',
            className: 'tpcowork-menu-row', title: candidate.name, disabled: busy,
            // The combined menu stays open, so the effort below follows the model just chosen.
            onClick: () => { if (!checked) submit({ provider: view.id, model: candidate.id }); },
          }, h('span', { className: 'tpcowork-menu-label' }, candidate.name),
          candidate.inputModalities?.includes('image') ? h(Badge, { outline: true }, tp('visionBadge')) : null,
          h(Check, { checked, busy: state.pending?.provider === view.id && state.pending.model === candidate.id }));
        })),
      viewing && levels.length > 0 ? h(React.Fragment, null,
        h('div', { className: 'tpcowork-menu-separator', role: 'separator' }),
        h(EffortSlider, { levels, effort, active: model !== undefined, disabled: busy || levels.length < 2, shortcut, tp, onChange: chooseEffort })) : null),
      document.body),
      toast !== null ? h(Toast, {
        key: toast.seq, text: toast.text, icon: h(IconWarningOutlineRegular, null),
        anchor: root.current?.closest('[data-composer-card]') ?? null, onDone: () => setToast(null),
      }) : null);
  }

  /**
   * Step the thinking level of the seat the user is working in: the one holding focus, else the newest visible one.
   * @returns whether a seat took the step.
   */
  ModelControls.cycleThought = () => {
    const live = [...seats].map(seat => seat.current).filter(seat => seat.root.current?.isConnected);
    const target = live.find(seat => seat.root.current.closest('[data-composer-card]')?.contains(document.activeElement))
      ?? live.findLast(seat => seat.root.current.offsetParent !== null) ?? live.at(-1);
    if (target === undefined || target.busy || target.locked || target.model === undefined) return false;
    const next = nextThoughtLevel(target.levels, target.effort);
    if (next === undefined) return false;
    target.chooseEffort(next.effort);
    return true;
  };
  return ModelControls;
}
