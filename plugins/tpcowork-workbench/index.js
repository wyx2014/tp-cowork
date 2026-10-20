import { createUserMessage } from '@deepseek-ai/dsh-llm';

export const name = 'tpcowork-workbench';
export const inject = ['sessionProjections', 'tools'];

const instructions = '请核对本轮任务清单，并调用 todo_write 写回完整清单：'
  + '已经实际完成的步骤标记 completed；已经成功交付的文件，其对应的交付步骤也应标记 completed。'
  + '未完成或等待用户的步骤保留 pending，并在回复中说明原因。'
  + '不要仅因准备结束回复就把未完成的工作标为 completed，也不要为了更新状态而重复生成或交付文件。';

function reminder(text) {
  return createUserMessage({
    content: [{ type: 'text', text: `${text}\n${instructions}` }],
    source: { kind: 'tpcowork-task-completion', form: 'notice', summary: '核对任务完成状态' },
  });
}

/** Remind the owning agent to reconcile its plan; only todo_write changes task status. */
export function apply(ctx) {
  const remindedTurns = new WeakMap();
  function todosFor(agent) {
    if (!ctx.tools.get('todo_write', { agent: agent.id })) return null;
    return ctx.sessionProjections.stateOf(agent.session, 'todos');
  }

  ctx.on('tools/result', (exec, result) => {
    if (exec.name !== 'present' || !exec.agent || exec.signal.aborted
      || result.isError) return;
    const todos = todosFor(exec.agent);
    if (!todos?.some(todo => todo.status !== 'completed')) return;
    exec.agent.inject(reminder('文件交付已成功。发送最终回复前，请同步实际任务进度。'));
  });

  ctx.on('agent/turn-stopping', ({ agent, turn, signal }) => {
    if (signal.aborted || remindedTurns.get(agent) === turn) return;
    const todos = todosFor(agent);
    if (!todos?.some(todo => todo.status === 'in_progress')) return;
    const lastMessage = agent.session.snapshotEvents().findLast(event =>
      event.type === 'assistant/message' && event.data.turn === turn);
    const finish = lastMessage?.data.stream?.at(-1);
    // Token limits and tool-directed stops must not be turned into more model work.
    if (finish?.type !== 'chunk' || finish.chunk.type !== 'finish'
      || finish.chunk.reason.kind !== 'stop') return;
    remindedTurns.set(agent, turn);
    agent.steer(reminder('本轮即将结束，但任务清单仍有进行中的步骤。请先核对并更新状态，再结束回复。'));
  });
}
