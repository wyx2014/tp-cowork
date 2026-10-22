import React, { useCallback, useEffect, useRef, useState } from 'react';
export { OPERATION_LINGER_MS, useOperationActive } from './operation.js';

/** The reference's viewport limits (CSS pixels). */
export const LIMITS = { minWidth: 320, maxWidth: 3840, minHeight: 320, maxHeight: 2160 };
const WARNING_MS = 3000;

const clamp = (value, min, max) => Math.min(max, Math.max(min, Math.round(value)));
const valid = (dimension, value) => Number.isInteger(value) && (dimension === 'width'
  ? value >= LIMITS.minWidth && value <= LIMITS.maxWidth : value >= LIMITS.minHeight && value <= LIMITS.maxHeight);

/** Width and height commit on Enter or blur, reject out-of-range values, and reset on Escape. */
export function ViewportInputs({ viewport, onChange, t }) {
  const [drafts, setDrafts] = useState({ width: String(viewport.width), height: String(viewport.height) });
  const [invalid, setInvalid] = useState({ width: false, height: false });
  useEffect(() => { setDrafts({ width: String(viewport.width), height: String(viewport.height) }); setInvalid({ width: false, height: false }); }, [viewport.width, viewport.height]);
  const reset = dimension => { setDrafts(value => ({ ...value, [dimension]: String(viewport[dimension]) })); setInvalid(value => ({ ...value, [dimension]: false })); };
  const commit = dimension => {
    const value = Number(drafts[dimension].trim());
    if (!valid(dimension, value)) { setInvalid(current => ({ ...current, [dimension]: true })); return; }
    setInvalid(current => ({ ...current, [dimension]: false }));
    if (value !== viewport[dimension]) onChange({ ...viewport, [dimension]: value });
  };
  // As in the reference, the size bar shows only the numbers; the labels are for assistive technology.
  const field = (dimension, label) => <label><span className="tpcb-sr-only">{label}</span><input aria-label={t(dimension === 'width' ? 'viewportWidth' : 'viewportHeight')} aria-invalid={invalid[dimension]} inputMode="numeric"
    value={drafts[dimension]} onChange={event => { const next = event.target.value; setDrafts(value => ({ ...value, [dimension]: next })); if (invalid[dimension]) setInvalid(value => ({ ...value, [dimension]: !valid(dimension, Number(next.trim())) })); }}
    onBlur={() => commit(dimension)} onKeyDown={event => {
      if (event.key === 'Enter') { event.preventDefault(); commit(dimension); }
      if (event.key === 'Escape') { event.preventDefault(); reset(dimension); event.currentTarget.blur(); }
    }} /></label>;
  return <>
    {field('width', t('width'))}<span>×</span>{field('height', t('height'))}
    {(invalid.width || invalid.height) && <span className="tpcb-invalid" role="alert">{t('dimensionRange').replace('{min}', String(invalid.width ? LIMITS.minWidth : LIMITS.minHeight)).replace('{max}', String(invalid.width ? LIMITS.maxWidth : LIMITS.maxHeight))}</span>}
  </>;
}

/**
 * A local, advisory notice when the browser area changes size during an automated action; it
 * neither cancels the action nor reaches the model. Shown once per operation cycle.
 */
export function useResizeWarning(active) {
  const [visible, setVisible] = useState(false);
  const warned = useRef(false);
  const timer = useRef();
  // Observers call back between renders; the ref keeps their view of the cycle current.
  const activeRef = useRef(active);
  activeRef.current = active;
  useEffect(() => { if (!active) warned.current = false; }, [active]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const resized = useCallback(() => {
    if (!activeRef.current || warned.current) return;
    warned.current = true;
    setVisible(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setVisible(false), WARNING_MS);
  }, []);
  return [visible, resized];
}
