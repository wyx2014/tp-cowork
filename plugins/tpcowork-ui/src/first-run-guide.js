/** Saved once the guide is finished or skipped; per device, like the other General preferences. */
export const FIRST_RUN_GUIDE_KEY = 'tpcowork.first-run-guide.v1';
/** DSH Desktop's setup wizard order: a welcome page, one choice per page, then a completion page. */
export const FIRST_RUN_STEPS = Object.freeze(['welcome', 'language', 'theme', 'fontSize', 'purpose', 'process', 'success']);
/** DSH's own onboarding choices (ui-settings-account): what the agent is for, and how much of its work to show. */
export const FIRST_RUN_PURPOSES = Object.freeze(['office', 'development']);
export const FIRST_RUN_PROCESSES = Object.freeze(['compact', 'standard', 'detailed']);
/** 界面字号 choices within the reference product's 12–20px range; 14px is the default. */
export const FIRST_RUN_FONT_SIZES = Object.freeze([13, 14, 16]);

/**
 * Whether the guide is due and the calls that show or end it. Existing installs see it once too.
 * @param storage - `localStorage`, or a stand-in for tests.
 */
export function createFirstRunGuideState(storage = globalThis.localStorage) {
  const listeners = new Set();
  let open = false;
  try { open = storage?.getItem(FIRST_RUN_GUIDE_KEY) === null; } catch (_error) { open = false; }
  const publish = next => { open = next; for (const listener of [...listeners]) listener(); };
  return {
    source: { getSnapshot: () => open, subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); } },
    /** Reopen from General settings. */
    show: () => publish(true),
    /** @param reason - 'done' after 开始使用, 'skipped' after 跳过设置. */
    finish(reason) {
      try { storage?.setItem(FIRST_RUN_GUIDE_KEY, reason); } catch (_error) { /* The guide still closes for this run. */ }
      publish(false);
    },
  };
}

/**
 * The first-run guide modeled on DSH Desktop's setup wizard (`dsh-plugin-desktop` native-ui/setup-wizard embedded in
 * the official onboarding surface): progress dots and "n / N" at the top, the page copy on the left and its choice
 * cards on the right, a primary 下一步, 上一步 and 跳过设置 along the bottom, a skip confirmation, and a completion page.
 * Choices apply at once through the same stores as Settings, so the guide previews them and skipping keeps them.
 */
export function createFirstRunGuide(React, primitives) {
  const h = React.createElement;
  const { useEffect, useRef, useState, useSyncExternalStore } = React;
  // Lucide ArrowRight, ArrowLeft and CircleCheck (ISC), the icons of the reference wizard.
  const icon = (name, paths, size = 16) => h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
    strokeWidth: size > 24 ? 1.25 : 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, 'data-icon': name },
  ...paths.map(d => h('path', { key: d, d })));
  const arrowRight = () => icon('arrow-right', ['M5 12h14', 'm12 5 7 7-7 7']);
  const arrowLeft = () => icon('arrow-left', ['m12 19-7-7 7-7', 'M19 12H5']);
  const success = () => icon('circle-check', ['M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z', 'm9 12 2 2 4-4'], 112);

  const Choice = ({ name, value, title, body, selected, onSelect }) => h('label', { className: 'tpcowork-guide-choice', 'data-selected': selected },
    h('span', { className: 'tpcowork-guide-choice-copy' },
      h('span', { className: 'tpcowork-guide-choice-title' }, title),
      body ? h('span', { className: 'tpcowork-guide-choice-body' }, body) : null),
    h('input', { type: 'radio', name, value, checked: selected, onChange: () => onSelect(value) }));

  const Page = ({ step, title, subtitle, badge, children, action }) => h('div', { className: 'tpcowork-guide-page', 'data-guide-step': step },
    h('header', { className: 'tpcowork-guide-copy' },
      h('div', { className: 'tpcowork-guide-heading' }, h('h1', { tabIndex: -1 }, title), badge ? h('span', { className: 'tpcowork-guide-badge' }, badge) : null),
      h('p', null, subtitle)),
    h('div', { className: 'tpcowork-guide-options' }, children),
    action ? h('div', { className: 'tpcowork-guide-actions' }, action) : null);

  return function FirstRunGuide({ t, useGuide, finish, theme, preferences, locale, work }) {
    const open = useGuide(value => value);
    const [step, setStep] = useState('welcome');
    const [confirmSkip, setConfirmSkip] = useState(false);
    const root = useRef(null);
    const appearance = useSyncExternalStore(theme.subscribe, theme.get);
    const followSystem = useSyncExternalStore(preferences.subscribe, () => preferences.get().followSystemLanguage);
    const language = useSyncExternalStore(locale.subscribe, locale.get);
    const working = useSyncExternalStore(work.subscribe, work.get);
    useEffect(() => { if (open) setStep('welcome'); }, [open]);
    useEffect(() => {
      if (!open || step === 'welcome') return;
      root.current?.querySelector('h1')?.focus({ preventScroll: true });
    }, [open, step]);
    if (!open) return null;
    const index = FIRST_RUN_STEPS.indexOf(step);
    const go = offset => setStep(FIRST_RUN_STEPS[Math.max(0, Math.min(FIRST_RUN_STEPS.length - 1, index + offset))]);
    const next = h(primitives.Button, { variant: 'primary', size: 'lg', onClick: () => go(1) }, t('guideNext'), arrowRight());
    const version = String(t('currentVersion')).split(/[:：]/u).pop().trim();
    let page;
    if (step === 'welcome') {
      page = h(Page, { step, title: t('guideWelcomeTitle'), subtitle: t('guideWelcomeBody'), badge: `${t('preview')} · v${version}`,
        action: h(primitives.Button, { variant: 'primary', size: 'lg', onClick: () => go(1) }, t('guideStart')) },
      h('div', { className: 'tpcowork-guide-card' },
        h('span', { className: 'tpcowork-guide-card-label' }, t('guideContents')),
        h('span', { className: 'tpcowork-guide-card-value' }, [t('interfaceLanguage'), t('interfaceTheme'), t('appearanceTextSize'), t('guidePurposeShort'), t('guideProcessShort')].join(' · ')),
        h('p', null, t('guideWelcomeNote'))));
    } else if (step === 'language') {
      const selected = followSystem ? 'system' : language.active;
      page = h(Page, { step, title: t('guideLanguageTitle'), subtitle: t('guideLanguageBody'), action: next },
        h('div', { role: 'radiogroup', 'aria-label': t('guideLanguageTitle') },
          h(Choice, { name: 'tpcowork-guide-language', value: 'system', title: t('languageSystem'), body: t('guideLanguageSystemBody'), selected: selected === 'system', onSelect: locale.choose }),
          ...language.locales.map(row => h(Choice, { key: row.id, name: 'tpcowork-guide-language', value: row.id, title: row.label, selected: selected === row.id, onSelect: locale.choose }))));
    } else if (step === 'theme') {
      page = h(Page, { step, title: t('guideThemeTitle'), subtitle: t('guideThemeBody'), action: next },
        h('div', { role: 'radiogroup', 'aria-label': t('guideThemeTitle') },
          ...['light', 'dark', 'system'].map(mode => h(Choice, { key: mode, name: 'tpcowork-guide-theme', value: mode,
            title: t(`appearanceTheme_${mode}`), body: t(`guideTheme_${mode}`), selected: appearance.preference === mode, onSelect: theme.choose }))));
    } else if (step === 'fontSize') {
      page = h(Page, { step, title: t('guideFontTitle'), subtitle: t('guideFontBody'), action: next },
        h('div', { role: 'radiogroup', 'aria-label': t('guideFontTitle') },
          ...FIRST_RUN_FONT_SIZES.map(px => h(Choice, { key: px, name: 'tpcowork-guide-font', value: String(px),
            title: `${t(`guideFont_${px}`)} · ${px}px`, body: t(`guideFont_${px}_body`), selected: appearance.fontSizes.text === px,
            onSelect: value => theme.chooseFontSize(Number(value)) }))));
    } else if (step === 'purpose') {
      page = h(Page, { step, title: t('guidePurposeTitle'), subtitle: t('guidePurposeBody'), action: next },
        h('div', { role: 'radiogroup', 'aria-label': t('guidePurposeTitle') },
          ...FIRST_RUN_PURPOSES.map(purpose => h(Choice, { key: purpose, name: 'tpcowork-guide-purpose', value: purpose,
            title: t(`guidePurpose_${purpose}`), body: t(`guidePurpose_${purpose}_body`), selected: working.purpose === purpose, onSelect: work.choosePurpose }))));
    } else if (step === 'process') {
      page = h(Page, { step, title: t('guideProcessTitle'), subtitle: t('guideProcessBody'), action: next },
        h('div', { role: 'radiogroup', 'aria-label': t('guideProcessTitle') },
          ...FIRST_RUN_PROCESSES.map(mode => h(Choice, { key: mode, name: 'tpcowork-guide-process', value: mode,
            title: t(`guideProcess_${mode}`), body: t(`guideProcess_${mode}_body`), selected: working.process === mode, onSelect: work.chooseProcess }))));
    } else {
      page = h(Page, { step, title: t('guideDoneTitle'), subtitle: t('guideDoneBody'),
        action: h(primitives.Button, { variant: 'primary', size: 'lg', onClick: () => finish('done') }, t('guideStartUsing'), arrowRight()) },
      h('div', { className: 'tpcowork-guide-success', 'aria-hidden': true }, success()));
    }
    return h('div', { ref: root, className: 'tpcowork-guide', role: 'dialog', 'aria-modal': true, 'aria-label': t('guideTitle'), lang: language.active },
      h('header', { className: 'tpcowork-guide-progress' },
        h('ol', { 'aria-label': t('guideProgress') }, FIRST_RUN_STEPS.map((item, at) => h('li', { key: item, 'aria-current': item === step ? 'step' : undefined },
          h('span', { className: 'tpcowork-guide-sr' }, at + 1)))),
        h('span', null, `${index + 1} / ${FIRST_RUN_STEPS.length}`)),
      h('main', { className: 'tpcowork-guide-main' }, page),
      h('nav', { className: 'tpcowork-guide-navigation', 'aria-label': t('guideNavigation') },
        step === 'welcome' ? h('span') : h('button', { type: 'button', onClick: () => go(-1) }, arrowLeft(), t('guideBack')),
        step === 'success' ? h('span') : h('button', { type: 'button', onClick: () => setConfirmSkip(true) }, t('guideSkip'))),
      h(primitives.Modal, { open: confirmSkip, title: t('guideSkipTitle'), closeLabel: t('guideContinue'), onClose: () => setConfirmSkip(false),
        // As the reference confirmation: its two footer buttons are the only ways out (Escape still continues).
        showCloseButton: false, className: 'tpcowork-guide-dialog',
        footer: h(React.Fragment, null,
          h(primitives.Button, { variant: 'outline', autoFocus: true, onClick: () => setConfirmSkip(false) }, t('guideContinue')),
          h(primitives.Button, { variant: 'primary', onClick: () => { setConfirmSkip(false); finish('skipped'); } }, t('guideSkip'))) },
      h('p', { className: 'tpcowork-guide-dialog-body' }, t('guideSkipBody'))));
  };
}
