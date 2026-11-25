/** Workspace and settings Help share the same dialogs and background issue submissions. */
export function createHelpMenu(React, createPortal, primitives, brandIcon, frameClass, { FloatingToastStack, successDuration }) {
  const h = React.createElement;
  const { Menu, Modal, Button, Switch } = primitives;
  const maxImages = 5;
  const maxImageBytes = 2 * 1024 * 1024;
  const maxAttachments = 12_000_000;
  const logAllowance = 1_400_000;
  const imageTypes = ['image/png', 'image/jpeg', 'image/webp'];
  const newDraft = (contact, includeLogs) => ({
    requestId: crypto.randomUUID(), content: '', solution: '', contact, images: [], includeLogs,
  });
  const makeImage = (url, name) => ({ id: crypto.randomUUID(), url, name });
  const readImage = file => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(makeImage(String(reader.result), file.name));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  const attachmentsFit = (images, includeLogs) =>
    images.reduce((total, image) => total + image.url.length, includeLogs ? logAllowance : 0) <= maxAttachments;
  const nativeRequest = async (desktop, action, timeout) => {
    let timer;
    try {
      return await Promise.race([
        desktop.browserAutomation.request('diagnostics', { action }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Desktop feedback request timed out')), timeout); }),
      ]);
    } finally { clearTimeout(timer); }
  };

  let jobs = [];
  const listeners = new Set();
  const subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener); };
  const getJobs = () => jobs;
  const updateJob = (key, next) => {
    jobs = next && jobs.some(job => job.key === key)
      ? jobs.map(job => job.key === key ? next : job)
      : [...jobs.filter(job => job.key !== key), ...(next ? [next] : [])];
    for (const listener of listeners) listener();
  };
  const showReceipt = (key, accountId, id) => {
    updateJob(key, { key, accountId, status: 'success', id });
    setTimeout(() => updateJob(key, null), successDuration);
  };

  function ImageThumbnails({ t, images, loading, remove, preview }) {
    return h('div', { className: 'tpcowork-feedback-previews' }, images.map(image =>
      h('div', { className: 'tpcowork-feedback-thumb', key: image.id },
        h('button', { type: 'button', className: 'tpcowork-feedback-preview', onClick: () => preview(image) },
          h('img', { src: image.url, alt: image.name })),
        remove ? h('button', { type: 'button', className: 'tpcowork-feedback-remove', disabled: loading,
          title: t('feedbackRemoveImage'), 'aria-label': t('feedbackRemoveImage') + ' ' + image.name,
          onClick: () => remove(image.id) }, '×') : null)));
  }

  function ImagePicker({ t, images, loading, accept, remove, preview }) {
    const input = React.useRef(null);
    const [dragging, setDragging] = React.useState(false);
    return h('section', { className: 'tpcowork-feedback-attachments' },
      h('div', { className: 'tpcowork-feedback-label' },
        h('span', null, t('feedbackImages')), h('small', null, images.length + '/' + maxImages)),
      h('div', {
        className: 'tpcowork-feedback-drop', 'data-dragging': dragging,
        onDragOver: event => { event.preventDefault(); setDragging(true); },
        onDragLeave: event => { if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false); },
        onDrop: event => { event.preventDefault(); setDragging(false); void accept(Array.from(event.dataTransfer.files)); },
      },
      images.length ? h(ImageThumbnails, { t, images, loading, remove, preview }) : null,
      h('div', { className: 'tpcowork-feedback-drop-footer' },
        h('div', null, h('p', null, t('feedbackImageHint')), h('p', null, t('feedbackImagePrivacy'))),
        h(Button, { type: 'button', variant: 'outline', size: 'sm', disabled: loading || images.length >= maxImages,
          onClick: () => input.current?.click() }, t('feedbackAddImage'))),
      h('input', { ref: input, type: 'file', accept: imageTypes.join(','), multiple: true, hidden: true,
        onChange: event => { const files = Array.from(event.target.files ?? []); event.target.value = ''; void accept(files); } })));
  }

  return function HelpMenu({ t, submitFeedback, attachFeedbackIssue, listFeedbackIssues, account, desktop, workspace = false }) {
    const opening = React.useRef(false);
    const readingImages = React.useRef(false);
    const sending = React.useRef(null);
    const anchor = React.useRef(null);
    const [open, setOpen] = React.useState(false);
    const [dialog, setDialog] = React.useState(null);
    const [draft, setDraft] = React.useState(null);
    const [preview, setPreview] = React.useState(null);
    const [loadingImages, setLoadingImages] = React.useState(false);
    const [busy, setBusy] = React.useState(false);
    const [notice, setNotice] = React.useState(null);
    const [error, setError] = React.useState('');
    const [corner, setCorner] = React.useState(null);
    const [jobKey, setJobKey] = React.useState(null);
    const [issuePage, setIssuePage] = React.useState(1);
    const [issues, setIssues] = React.useState(null);
    const [issuesRevision, setIssuesRevision] = React.useState(0);
    const [appleSilicon, setAppleSilicon] = React.useState(false);
    const accountState = React.useSyncExternalStore(account.subscribe, account.getSnapshot, account.getSnapshot);
    const accountId = accountState.user?.id;
    const allJobs = React.useSyncExternalStore(subscribe, getJobs, getJobs);
    const userJobs = allJobs.filter(job => job.accountId === accountId);
    const selectedJob = userJobs.find(job => job.key === jobKey);
    const nativeAvailable = typeof desktop.browserAutomation?.request === 'function';
    const contactKey = accountId ? 'tpcowork.feedback.contact.' + accountId : null;

    React.useLayoutEffect(() => {
      if (!workspace) return;
      const frame = anchor.current?.closest(`.${frameClass}`);
      if (!frame) return;
      const locate = () => setCorner(frame.querySelector('[data-conversation-header-corner]'));
      locate();
      const observer = new MutationObserver(locate);
      observer.observe(frame, { childList: true, subtree: true });
      return () => observer.disconnect();
    }, [workspace]);

    React.useEffect(() => {
      if (dialog !== 'issues') return;
      const active = new AbortController();
      setIssues(null);
      void listFeedbackIssues({ page: issuePage }, active.signal).then(
        value => { if (!active.signal.aborted) setIssues(value); },
        () => { if (!active.signal.aborted) setIssues({ error: true }); },
      );
      return () => active.abort();
    }, [dialog, issuePage, issuesRevision, listFeedbackIssues]);

    React.useEffect(() => () => sending.current?.abort(), []);

    React.useEffect(() => {
      if (typeof desktop?.deviceInfo !== 'function') { setAppleSilicon(false); return; }
      let active = true;
      void Promise.resolve(desktop.deviceInfo()).then(info => {
        if (active) setAppleSilicon(typeof info === 'string' && /\bplatform=darwin\b/.test(info) && /\bapp_arch=arm64\b/.test(info));
      }, () => { if (active) setAppleSilicon(false); });
      return () => { active = false; };
    }, [desktop]);

    const close = () => {
      if (sending.current) { sending.current.abort(); return; }
      if (!readingImages.current) setDialog(null);
    };
    const change = (field, value) => setDraft(old => ({ ...old, [field]: value }));
    const updateContact = value => {
      change('contact', value);
      if (!contactKey) return;
      try {
        if (value.trim()) localStorage.setItem(contactKey, value.trim());
        else localStorage.removeItem(contactKey);
      } catch { /* The form still works with storage disabled. */ }
    };
    const addImages = async files => {
      if (!files.length || sending.current || readingImages.current) return;
      const remaining = maxImages - draft.images.length;
      if (!remaining || files.some(file => !imageTypes.includes(file.type) || file.size > maxImageBytes)) {
        setError('feedbackImageLimit');
        return;
      }
      readingImages.current = true;
      setLoadingImages(true);
      setError('');
      try {
        const images = [...draft.images, ...await Promise.all(files.slice(0, remaining).map(readImage))];
        if (attachmentsFit(images, draft.includeLogs)) {
          change('images', images);
          if (files.length > remaining) setError('feedbackImageLimit');
        } else setError('feedbackAttachmentLimit');
      } catch { setError('feedbackImageReadError'); }
      finally { readingImages.current = false; setLoadingImages(false); }
    };

    const uploadIssueAttachments = async job => {
      const { snapshot, key, id } = job;
      if (jobs.some(current => current.key === key && current.status === 'sending')) return;
      const controller = new AbortController();
      updateJob(key, { ...job, status: 'sending', error: null, controller });
      let logArchive;
      try {
        if (snapshot.includeLogs) {
          logArchive = await nativeRequest(desktop, 'feedbackLogs', 8000);
          if (typeof logArchive !== 'string' || logArchive.length > logAllowance) throw new Error('Unavailable logs');
        }
      } catch {
        if (!controller.signal.aborted) updateJob(key, { ...job, status: 'error', error: 'feedbackLogsFailed' });
        return;
      }
      if (controller.signal.aborted) return;
      try {
        if (account.getSnapshot().user?.id !== job.accountId) throw new Error('Feedback account changed');
        await attachFeedbackIssue({
          id, images: snapshot.images.map(image => image.url),
          ...(logArchive ? { logArchive } : {}),
        }, AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]));
        if (controller.signal.aborted) return;
        showReceipt(key, job.accountId, id);
      } catch {
        if (!controller.signal.aborted) updateJob(key, { ...job, status: 'error', error: 'feedbackUploadFailed' });
      }
    };

    const pauseUpload = job => {
      job.controller.abort();
      updateJob(job.key, { ...job, status: 'paused', controller: null });
    };
    const jobStatus = job => job.error || (job.status === 'paused' ? 'feedbackUploadPaused' : 'feedbackBackground');

    const submit = async event => {
      event.preventDefault();
      if (sending.current || readingImages.current || !draft.content.trim()) return;
      if (issue ? !attachmentsFit(draft.images, draft.includeLogs) : !draft.solution.trim()) return;
      const active = new AbortController();
      sending.current = active;
      setBusy(true);
      setError('');
      try {
        const common = { requestId: draft.requestId, content: draft.content.trim(), contact: draft.contact.trim() };
        const id = await submitFeedback(issue ? { ...common, type: 'issue', images: [] }
          : { ...common, type: 'feature', solution: draft.solution.trim() }, active.signal);
        if (active.signal.aborted) return;
        if (issue && (draft.images.length || draft.includeLogs)) {
          setDialog(null);
          void uploadIssueAttachments({ key: draft.requestId, id, accountId, snapshot: draft });
        } else {
          showReceipt(draft.requestId, accountId, id);
          if (issue) {
            setDraft(newDraft(draft.contact, nativeAvailable));
            showIssues();
          } else setDialog(null);
        }
      } catch {
        if (!active.signal.aborted) setError('feedbackFailed');
      } finally {
        if (active.signal.aborted) setError('feedbackCancelled');
        sending.current = null;
        setBusy(false);
      }
    };

    const select = async action => {
      setOpen(false);
      if (opening.current || sending.current) return;
      setNotice(null);
      setError('');
      if (action === 'issue' || action === 'feature') {
        let contact = '';
        try { contact = contactKey ? localStorage.getItem(contactKey) || '' : ''; } catch { /* Optional preference. */ }
        const next = newDraft(contact.slice(0, 200), action === 'issue' && nativeAvailable);
        if (action === 'issue' && nativeAvailable) {
          opening.current = true;
          try {
            // Allow the Help menu to leave the frame before capturing the app window.
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            const url = await nativeRequest(desktop, 'feedbackScreenshot', 2000);
            if (typeof url === 'string' && url.startsWith('data:image/jpeg;base64,') && url.length <= 2_800_000) {
              next.images.push(makeImage(url, t('feedbackAutoScreenshot')));
            }
          } catch { /* A failed capture must not prevent reporting the issue. */ }
          finally { opening.current = false; }
        }
        setDraft(next);
        setDialog(action);
        return;
      }
      if (action === 'about') { setDialog(action); return; }
      try { await desktop.browserAutomation.request('diagnostics', { action: 'export', locale: t('feedbackLocale') }); }
      catch { setNotice({ key: 'diagnosticsUnavailable' }); }
    };
    const showIssues = () => { setIssues(null); setIssuePage(1); setDialog('issues'); };
    const field = (key, label, placeholder, maxLength) => h('label', { className: 'tpcowork-feedback-field' },
      h('span', { className: 'tpcowork-feedback-label' }, h('span', null, t(label)),
        h('small', { 'aria-hidden': true }, draft[key].length + '/' + maxLength)),
      h('textarea', {
        'aria-label': t(label), value: draft[key], maxLength, required: true, disabled: busy, rows: 4,
        placeholder: t(placeholder), 'data-modal-autofocus': key === 'content' ? '' : undefined,
        onChange: event => change(key, event.target.value),
      }));
    const statusLabel = { new: 'feedbackStatusNew', in_progress: 'feedbackStatusWorking', closed: 'feedbackStatusClosed' };
    const issue = dialog === 'issue';
    const formTitle = t(issue ? 'feedbackIssue' : 'feedbackFeature');
    const fit = !issue || attachmentsFit(draft.images, draft.includeLogs);
    const formError = error || (!fit ? 'feedbackAttachmentLimit' : '');
    const form = issue || dialog === 'feature' ? h(Modal, {
      open: true, title: formTitle, closeLabel: t('feedbackCancel'), className: 'tpcowork-feedback-dialog', onClose: close,
      footer: h('div', { className: 'tpcowork-feedback-actions' },
        issue ? h(Button, { type: 'button', variant: 'ghost', disabled: busy || loadingImages, onClick: showIssues }, t('feedbackViewIssues'))
          : h(Button, { type: 'button', variant: 'ghost', disabled: busy, onClick: () => {
            setDraft(newDraft(draft.contact, false));
            setError('');
          } }, t('feedbackReset')),
        h('div', null,
          h(Button, { type: 'button', variant: 'outline', onClick: close, disabled: loadingImages }, t('feedbackCancel')),
          h(Button, { type: 'submit', form: workspace ? 'tpcowork-feedback-workspace' : 'tpcowork-feedback-settings',
            variant: 'primary', disabled: busy || loadingImages || !fit || !draft.content.trim() || (!issue && !draft.solution.trim()) },
          t(busy ? 'feedbackSubmitting' : issue ? 'feedbackSubmitIssue' : 'feedbackSubmitFeature')))),
    },
    h('form', { id: workspace ? 'tpcowork-feedback-workspace' : 'tpcowork-feedback-settings',
      onSubmit: submit, className: 'tpcowork-feedback-form', onPaste: event => {
        const files = Array.from(event.clipboardData.files);
        if (!issue || !files.length) return;
        event.preventDefault();
        void addImages(files);
      } },
      field('content', issue ? 'feedbackProblem' : 'feedbackDescription',
        issue ? 'feedbackProblemPlaceholder' : 'feedbackDescriptionPlaceholder', issue ? 4000 : 2000),
      issue ? h(ImagePicker, { t, images: draft.images, loading: busy || loadingImages, accept: addImages, preview: setPreview,
        remove: id => { change('images', draft.images.filter(image => image.id !== id)); setError(''); } })
        : field('solution', 'feedbackSolution', 'feedbackSolutionPlaceholder', 2000),
      h('label', { className: 'tpcowork-feedback-field' }, h('span', { className: 'tpcowork-feedback-label' }, t('feedbackContact')),
        h('input', { type: 'text', inputMode: 'email', autoComplete: 'email', maxLength: 200, disabled: busy,
          value: draft.contact, placeholder: t('feedbackContactPlaceholder'), onChange: event => updateContact(event.target.value) })),
      issue && nativeAvailable ? h('div', { className: 'tpcowork-feedback-logs' },
        h('span', null, h('strong', null, t('feedbackIncludeLogs')), h('small', null, t('feedbackLogsHint'))),
        h(Switch, { checked: draft.includeLogs, disabled: busy || loadingImages, label: t('feedbackIncludeLogs'),
          onChange: checked => { change('includeLogs', checked); setError(''); } })) : null,
      busy ? h('p', { className: 'tpcowork-feedback-progress', role: 'status' }, t('feedbackConnecting')) : null,
      formError ? h('p', { role: 'alert', className: 'tpcowork-feedback-error' }, t(formError)) : null)) : null;

    const issueHistory = dialog === 'issues' ? h(Modal, { open: true, title: t('feedbackViewIssues'),
      closeLabel: t('feedbackCancel'), className: 'tpcowork-feedback-dialog', onClose: close,
      footer: h('div', { className: 'tpcowork-feedback-actions' },
        h(Button, { type: 'button', variant: 'ghost', onClick: () => setDialog('issue') }, t('feedbackBackToIssue')),
        issues?.total > 20 ? h('div', null,
          h(Button, { type: 'button', variant: 'outline', disabled: issuePage === 1, onClick: () => setIssuePage(issuePage - 1) }, t('feedbackPreviousPage')),
          h(Button, { type: 'button', variant: 'outline', disabled: issuePage * 20 >= issues.total, onClick: () => setIssuePage(issuePage + 1) }, t('feedbackNextPage'))) : null),
    }, issues?.error ? h('div', { className: 'tpcowork-feedback-form' },
      h('p', { className: 'tpcowork-feedback-error', role: 'alert' }, t('feedbackListFailed')),
      h(Button, { type: 'button', variant: 'outline', onClick: () => setIssuesRevision(issuesRevision + 1) }, t('feedbackRetry')))
      : !issues?.items.length ? h('p', { role: 'status' }, t(issues ? 'feedbackNoIssues' : 'feedbackLoading'))
        : h('div', { className: 'tpcowork-feedback-history' }, issues.items.map(item => h('details', { key: item.id },
          h('summary', null, h('span', null, item.content), h('small', null, t(statusLabel[item.status]))),
          h('p', null, item.content), h('small', null, new Date(item.createdAt).toLocaleString(t('feedbackLocale'))),
          h('small', null, t('feedbackReceipt', { id: item.id })))))) : null;

    const toastStates = { sending: 'pending', paused: 'cancelled', error: 'failure', success: 'success' };
    const feedbackJobs = workspace ? h(FloatingToastStack, {
      entries: userJobs.filter(job => job.key !== jobKey || job.status === 'success').map(job => ({
        key: job.key,
        toast: {
          seq: job.status, state: toastStates[job.status],
          message: job.status === 'success' ? t('feedbackSuccess', { id: job.id }) : t(jobStatus(job)),
        },
        closeLabel: t('feedbackDismiss'),
        onClose: job.status === 'sending' ? undefined : () => updateJob(job.key, null),
        action: job.status === 'success' ? undefined : { label: t('feedbackViewSubmission'), onClick: () => setJobKey(job.key) },
      })),
    }) : null;
    const jobDialog = selectedJob && selectedJob.status !== 'success' ? h(Modal, { open: true, title: t('feedbackIssue'),
      closeLabel: t('feedbackCancel'), className: 'tpcowork-feedback-dialog', onClose: () => setJobKey(null),
      footer: h('div', { className: 'tpcowork-feedback-actions' }, h('div', null,
        selectedJob.error === 'feedbackLogsFailed' ? h(Button, { type: 'button', variant: 'outline',
          onClick: () => { void uploadIssueAttachments({ ...selectedJob, snapshot: { ...selectedJob.snapshot, includeLogs: false } }); } },
        t('feedbackRetryWithoutLogs')) : null,
        selectedJob.status === 'sending' ? h(Button, { type: 'button', variant: 'outline', onClick: () => pauseUpload(selectedJob) }, t('feedbackPauseUpload'))
          : h(Button, { type: 'button', variant: 'primary', onClick: () => { void uploadIssueAttachments(selectedJob); } },
            t(selectedJob.status === 'paused' ? 'feedbackResumeUpload' : 'feedbackRetry')))),
    }, h('div', { className: 'tpcowork-feedback-job-details' },
      h('p', { role: selectedJob.error ? 'alert' : 'status' }, t(jobStatus(selectedJob))),
      h('small', null, t('feedbackReceipt', { id: selectedJob.id })),
      h('p', null, selectedJob.snapshot.content),
      selectedJob.snapshot.contact ? h('p', null, selectedJob.snapshot.contact) : null,
      h('small', null, t('feedbackImages') + ' · ' + selectedJob.snapshot.images.length),
      selectedJob.snapshot.images.length ? h(ImageThumbnails, { t, images: selectedJob.snapshot.images, preview: setPreview }) : null,
      selectedJob.snapshot.includeLogs ? h('small', null, t('feedbackIncludeLogs')) : null)) : null;

    const menu = h('div', {
      className: workspace ? 'tpcowork-help tpcowork-help-workspace' + (corner ? '' : ' tpcowork-help-floating') : 'tpcowork-help',
    },
      h(Menu, {
        open, align: 'end', portal: true, id: workspace ? 'tpcowork-help-workspace' : 'tpcowork-help-settings',
        onClose: () => setOpen(false), onSelect: action => { void select(action); },
        anchor: h('button', {
          type: 'button', className: 'tpcowork-help-trigger', title: t('helpMenu'),
          'aria-label': t('helpMenu'), 'aria-haspopup': 'menu', 'aria-expanded': open,
          onClick: () => { if (!opening.current) setOpen(!open); setNotice(null); },
        }, h('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none',
          stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', 'aria-hidden': true },
        h('circle', { cx: 12, cy: 12, r: 9 }), h('path', { d: 'M9.5 9a2.5 2.5 0 1 1 3.8 2.1c-.9.55-1.3 1.15-1.3 2.4M12 16.5h.01' }))),
        items: [
          { id: 'issue', label: t('feedbackIssue') },
          { id: 'feature', label: t('feedbackFeature') },
          { type: 'separator', id: 'desktop' },
          ...(nativeAvailable ? [{ id: 'logs', label: t('feedbackExportLogs') }] : []),
          { id: 'about', label: t('feedbackAbout') },
        ],
      }),
      notice ? h('div', { className: 'tpcowork-help-notice', role: 'status' }, t(notice.key, { id: notice.id })) : null);
    return h(React.Fragment, null,
      workspace ? h('span', { ref: anchor, hidden: true }) : null,
      corner ? createPortal(menu, corner) : menu,
      form, issueHistory, feedbackJobs, jobDialog,
      preview ? h(Modal, { open: true, title: preview.name, closeLabel: t('feedbackClose'),
        className: 'tpcowork-feedback-image-dialog', onClose: () => setPreview(null) },
      h('img', { src: preview.url, alt: preview.name })) : null,
      dialog === 'about' ? h(Modal, {
        open: true, headless: true, title: t('feedbackAbout'),
        className: 'tpcowork-about-dialog', onClose: close,
        onKeyDownCapture: event => {
          if (event.key === 'Enter') { event.preventDefault(); close(); }
        },
      },
      h('div', { className: 'tpcowork-about-card' },
        h('div', { className: 'tpcowork-about-content' },
          h('div', { className: 'tpcowork-about-icon', 'aria-hidden': true },
            h('img', { className: 'tpcowork-about-logo', src: brandIcon, alt: '', width: 52, height: 52, draggable: false })),
          h('h2', { className: 'tpcowork-about-title' },
            t('aboutAppName'),
            h('br'),
            t('aboutVersion', { version: t('aboutVersionValue') })),
          h('div', { className: 'tpcowork-about-meta' },
            appleSilicon ? h('div', null, t('aboutAppleSilicon')) : null,
            h('div', null, t('aboutCopyright', { year: String(new Date().getFullYear()) })))),
        h('button', {
          type: 'button', className: 'tpcowork-about-ok', 'data-modal-autofocus': true, onClick: close,
        }, t('aboutOk')))) : null);
  };
}
