/**
 * General settings row for @tpcowork/dsh-diagnostics, in place of DSH Desktop's tray command 导出诊断信息…: the desktop
 * main process shows the privacy notice, builds the archive and reveals it, reached through the browser plugin's desktop
 * bridge. Outside the desktop shell (a plain browser) there is no bridge and no row.
 */
export function installDiagnosticsSettings(ctx, React, primitives, order, bridge = globalThis.window?.dshDesktop?.browserAutomation) {
  if (typeof bridge?.request !== 'function') return;
  const h = React.createElement;
  function DiagnosticsRow({ t }) {
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState('');
    const run = async () => {
      setBusy(true);
      setError('');
      try {
        const locale = /^zh/i.test(ctx.locale.getSnapshot().active ?? '') ? 'zh' : 'en';
        // The main process reports its own failures in a native error dialog; only an unreachable bridge lands here.
        await bridge.request('diagnostics', { action: 'export', locale });
      } catch {
        setError(t('diagnosticsUnavailable'));
      } finally {
        setBusy(false);
      }
    };
    return h('div', { className: 'tpcowork-setting-row' },
      h('div', null, h('div', { className: 'tpcowork-setting-title' }, t('diagnosticsTitle')),
        h('div', { className: 'tpcowork-setting-description' }, error || t('diagnosticsDescription'))),
      h(primitives.Button, { variant: 'outline', disabled: busy, onClick: () => { void run(); } }, busy ? t('diagnosticsExporting') : t('diagnosticsExport')));
  }
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item', id: 'tpcowork-diagnostics', order, locale: 'tpcowork',
  }, DiagnosticsRow));
}
