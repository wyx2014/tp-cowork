import { useEffect, useState } from 'react';

/** Like the reference, the indicator outlives each operation briefly so it does not flicker between steps. */
export const OPERATION_LINGER_MS = 5000;

/** One activity judgement shared by the tab icon, status and resize warning. */
export function useOperationActive(state, keys) {
  const running = keys.some(key => key && state.operations[key]);
  const until = Math.max(0, ...keys.map(key => (key && state.operationUntil?.[key]) || 0));
  const [, wake] = useState(0);
  useEffect(() => {
    const remaining = until - Date.now();
    if (running || remaining <= 0) return;
    const timer = setTimeout(() => wake(value => value + 1), remaining);
    return () => clearTimeout(timer);
  }, [running, until]);
  return running || until > Date.now();
}
