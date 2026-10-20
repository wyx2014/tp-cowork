/** Present the native task projection in its own conversation's upper-right corner. */
export function createTaskDock(React, createPortal) {
  const h = React.createElement;
  function Icon({ kind }) {
    const paths = {
      list: [h('path', { key: 'checks', d: 'm3 5 1 1 2-2M3 10l1 1 2-2M3 15l1 1 2-2' }),
        h('path', { key: 'lines', d: 'M9 5h8M9 10h8M9 15h8' })],
      completed: [h('circle', { key: 'circle', cx: 10, cy: 10, r: 7 }),
        h('path', { key: 'check', d: 'm6.5 10 2.2 2.2 4.8-4.8' })],
      in_progress: h('path', { d: 'M4 10h12m-5-5 5 5-5 5' }),
      pending: h('circle', { cx: 10, cy: 10, r: 6.5 }),
      expand: h('path', { d: 'M12 3h5v5M17 3l-6 6M8 17H3v-5m0 5 6-6' }),
      collapse: h('path', { d: 'M17 8h-5V3m0 5 5-5M3 12h5v5m0-5-5 5' }),
    };
    return h('svg', { viewBox: '0 0 20 20', width: 16, height: 16, fill: 'none',
      stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round',
      'aria-hidden': true }, paths[kind]);
  }

  function TaskPanel({ todos, wide, t }) {
    const [preference, setPreference] = React.useState(null);
    const listId = React.useId();
    const expanded = preference ?? wide;
    const done = todos.filter(item => item.status === 'completed').length;
    const active = todos.find(item => item.status === 'in_progress') ?? todos.find(item => item.status === 'pending');
    const toggle = () => setPreference(!expanded);
    const action = t(expanded ? 'tasksCollapse' : 'tasksExpand');
    return h('aside', {
      className: 'tpcowork-task-panel', 'aria-label': t('tasksTitle'),
      'data-expanded': expanded, 'data-completed': done === todos.length,
    },
    h('div', { className: 'tpcowork-task-header' },
      h('button', { type: 'button', className: 'tpcowork-task-summary', onClick: toggle,
        'aria-expanded': expanded, 'aria-controls': listId, title: action },
      h(Icon, { kind: 'list' }),
      h('span', { className: 'tpcowork-task-title', title: expanded ? undefined : active?.content },
        expanded ? t('tasksTitle') : active?.content ?? t('tasksCompleted')),
      h('span', { className: 'tpcowork-task-count', 'aria-label': t('tasksProgress', { done, total: todos.length }) }, `${done}/${todos.length}`)),
      h('button', { type: 'button', className: 'tpcowork-task-toggle', onClick: toggle,
        'aria-label': action, 'aria-expanded': expanded, 'aria-controls': listId, title: action },
      h(Icon, { kind: expanded ? 'collapse' : 'expand' }))),
    h('ul', { id: listId, className: 'tpcowork-task-list', hidden: !expanded },
      todos.map((item, index) => h('li', { key: `${index}:${item.content}`, className: 'tpcowork-task-item', 'data-status': item.status },
        h('span', { className: 'tpcowork-task-status', role: 'img', 'aria-label': t(`tasksStatus_${item.status}`) },
          h(Icon, { kind: item.status })),
        h('span', { className: 'tpcowork-task-content', title: item.content }, item.content)))));
  }

  return function TaskDock({ sessionId, useProjection, t }) {
    const todos = useProjection('todos') ?? [];
    const anchor = React.useRef(null);
    const [surface, setSurface] = React.useState(null);
    const visible = todos.length > 0;
    React.useLayoutEffect(() => {
      if (!visible) {
        setSurface(null);
        return;
      }
      // Anchor to the owning pane: a global query would move another pane's tasks here.
      const target = anchor.current?.closest('[data-conversation-content]');
      if (!target) return;
      const update = width => setSurface(previous => {
        const wide = width >= 1280;
        return previous?.target === target && previous.sessionId === sessionId && previous.wide === wide
          ? previous : { target, sessionId, wide };
      });
      update(target.clientWidth);
      const observer = new ResizeObserver(entries => update(entries[0].contentRect.width));
      observer.observe(target);
      return () => observer.disconnect();
    }, [visible, sessionId]);
    if (!visible) return null;
    return h(React.Fragment, null,
      h('span', { ref: anchor, hidden: true }),
      surface && surface.sessionId === sessionId ? createPortal(
        h(TaskPanel, { key: sessionId, todos, wide: surface.wide, t }), surface.target) : null);
  };
}
