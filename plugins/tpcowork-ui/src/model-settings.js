/** Add navigation through the native footer seat, preserving every native editor and child slot. */
export function adaptModelSettings(ctx, React, ReactDOM, primitives, classes) {
  const h = React.createElement;
  const tp = ctx.locale.bind('tpcowork');
  // Lucide Unplug / LoaderCircle, ISC; see assets/settings-icons/LICENSE.
  const unplugPaths = ['m19 5 3-3', 'm2 22 3-3', 'M6.3 20.3a2.4 2.4 0 0 0 3.4 0L12 18l-6-6-2.3 2.3a2.4 2.4 0 0 0 0 3.4Z', 'M7.5 13.5 10 11', 'M10.5 16.5 13 14', 'm12 6 6 6 2.3-2.3a2.4 2.4 0 0 0 0-3.4l-2.6-2.6a2.4 2.4 0 0 0-3.4 0Z'];
  const testIcon = busy => h('svg', { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', className: busy ? 'tpcowork-spin' : undefined, 'data-icon': busy ? 'loader-circle' : 'unplug', 'aria-hidden': true }, ...(busy ? ['M21 12a9 9 0 1 1-6.219-8.56'] : unplugPaths).map(d => h('path', { key: d, d })));
  const pencilIcon = () => h('svg', { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
    h('path', { d: 'M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z' }), h('path', { d: 'm15 5 4 4' }));
  function ProviderLogo({ row }) {
    const deepseek = /deepseek/i.test(`${row.entry.provider} ${row.entry.displayName}`);
    return h('span', { className: 'tpcowork-provider-logo', 'data-logo': deepseek ? 'deepseek' : 'provider', 'aria-hidden': true },
      deepseek ? h(primitives.FishLogo, { size: 16 }) : h('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinejoin: 'round' }, h('path', { d: 'm12 3 9 5v8l-9 5-9-5V8l9-5Zm0 9 9-4M12 12 3 8m9 4v9M7.5 5.5l9 5' })));
  }
  function ProviderHeading({ row, title, children }) {
    return h('div', { className: `${classes.editorHeader} tpcowork-provider-detail-heading` },
      h('div', { className: 'tpcowork-provider-detail-title' }, h(ProviderLogo, { row }), h('span', { className: classes.editorTitle }, title || row.entry.displayName)), children);
  }
  function ProviderField({ label, ...props }) {
    return h('label', { className: classes.field }, h('span', { className: classes.fieldLabel }, label),
      h('input', { className: classes.input, 'aria-label': label, ...props }));
  }
  function ProviderProtocol({ value, readOnly, onChange }) {
    const options = [['openai-completions', 'OpenAI Chat Completions'], ['openai-responses', 'OpenAI Responses'], ['anthropic-messages', 'Anthropic Messages']];
    if (!options.some(([id]) => id === value)) options.unshift([value || '', value || '默认协议']);
    return h('label', { className: classes.field }, h('span', { className: classes.fieldLabel }, 'API 协议'),
      h('select', { className: `${classes.input} ${classes.selectInput} tpcowork-provider-protocol`, 'aria-label': 'API 协议', disabled: !!readOnly, value: value || '', onChange: event => onChange?.(event.target.value) },
        ...options.map(([id, label]) => h('option', { key: id, value: id }, label))));
  }
  function ModelListHeading({ children }) {
    return h('div', { className: 'tpcowork-model-list-heading' }, h('span', { className: classes.fieldLabel }, '模型列表'), children);
  }
  function ModelSummary({ model, profile }) {
    const capacity = model.contextWindow;
    return h('div', { className: 'tpcowork-provider-model-summary' },
      h('span', { className: 'tpcowork-provider-model-id', title: model.name || model.id }, model.id),
      capacity ? h('span', { className: 'tpcowork-managed-badge', title: `上下文窗口 ${capacity.toLocaleString()}` }, capacity >= 1000000 ? `${+(capacity / 1000000).toFixed(1)}M` : `${Math.round(capacity / 1000)}K`) : null,
      (model.input ?? profile.defaultInput ?? []).includes('image') ? h('span', { className: 'tpcowork-managed-badge' }, '视觉') : null);
  }
  function ModelFeedback({ feedback, onClose, anchor }) {
    const [target, setTarget] = React.useState(null);
    React.useLayoutEffect(() => {
      if (feedback) setTarget(anchor.current?.closest('.tpcowork-model-settings') ?? null);
    }, [!!feedback]);
    if (!feedback || !target) return null;
    return ReactDOM.createPortal(h('div', { className: 'tpcowork-model-feedback-viewport', 'aria-live': 'polite' },
      h('div', { className: 'tpcowork-model-feedback', role: feedback.state === 'failure' ? 'alert' : 'status', 'data-state': feedback.state, 'data-kind': feedback.kind || 'test' },
        feedback.state === 'pending' ? testIcon(true) : h('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, 'aria-hidden': true }, h('circle', { cx: 12, cy: 12, r: 9 }), h('path', { d: feedback.state === 'success' ? 'm7 12 3 3 7-7' : 'M12 7v6m0 3v1' })),
        h('span', { title: feedback.message }, feedback.message), feedback.onRetry ? h('button', { type: 'button', onMouseDown: event => event.preventDefault(), onClick: feedback.onRetry }, '重试') : null, feedback.state !== 'pending' ? h('button', { type: 'button', 'aria-label': feedback.kind === 'save' ? '关闭保存提示' : '关闭测试提示', onClick: onClose },
          h('svg', { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, 'aria-hidden': true }, h('path', { d: 'm18 6-12 12M6 6l12 12' }))) : null)), target);
  }
  function CredentialField({ row, profile, operations, onChange, onBlur, disabled = false }) {
    const [typed, setTyped] = React.useState('');
    const [revealed, setRevealed] = React.useState('');
    const [visible, setVisible] = React.useState(false);
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState('');
    const generation = React.useRef(0);
    const ref = profile.apiKeyEnv || row.apiKeyEnv || Object.entries(row.credentialChecks ?? {}).find(([, info]) => info.configured)?.[0] || `${row.entry.provider.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`;
    const configured = row.credential?.configured || row.derivedCredential?.configured || Object.values(row.credentialChecks ?? {}).some(info => info.configured);
    const hide = () => { generation.current++; setRevealed(''); setVisible(false); setBusy(false); };
    React.useEffect(() => {
      const hidden = () => { if (document.hidden) hide(); };
      document.addEventListener('visibilitychange', hidden);
      window.addEventListener('blur', hide);
      return () => { generation.current++; document.removeEventListener('visibilitychange', hidden); window.removeEventListener('blur', hide); };
    }, []);
    const toggle = async () => {
      if (visible) { hide(); return; }
      if (typed) { setVisible(true); return; }
      const request = ++generation.current;
      setBusy(true); setError('');
      try {
        if (!operations.revealCredential) throw new Error('请重启应用以加载密钥查看接口');
        const value = await operations.revealCredential(ref);
        if (request !== generation.current) return;
        setRevealed(value); setVisible(true);
      } catch (failure) { if (request === generation.current) setError(failure.message || '读取密钥失败'); }
      finally { if (request === generation.current) setBusy(false); }
    };
    return h('div', { className: classes.field },
      h('span', { className: classes.fieldLabel }, 'API Key'),
      h('div', { className: 'tpcowork-provider-key' },
        h('input', { className: classes.input, 'aria-label': 'API 密钥', autoComplete: 'off', spellCheck: false,
          readOnly: !onChange, disabled, type: visible ? 'text' : 'password', value: typed || revealed,
          placeholder: configured ? '••••••••••••••••••••••••' : '输入 API 密钥',
          onChange: event => { setTyped(event.target.value); setRevealed(''); onChange?.(event.target.value); },
          onBlur, onKeyDown: event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) onBlur?.(); } }),
        h('button', { type: 'button', className: 'tpcowork-provider-eye', 'aria-label': visible ? '隐藏 API 密钥' : '显示 API 密钥', 'aria-pressed': visible,
          disabled: disabled || busy || (!typed && !configured), onClick: () => void toggle() },
          h('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
            h('path', { d: visible ? 'm3 3 18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.8 4.3A11 11 0 0 1 12 4c7 0 10 8 10 8a17 17 0 0 1-3 4M6 6a20 20 0 0 0-4 6s3 8 10 8a11 11 0 0 0 5-1' : 'M2 12s3-8 10-8 10 8 10 8-3 8-10 8S2 12 2 12Zm13 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z' })))),
      error ? h('span', { role: 'alert' }, error) : null);
  }
  // One queue per mounted provider: writes never race each other, and unmount
  // flushes the captured provider rather than the next selection's namespace.
  function ProviderDetails({ row, namespace, operations, schema, controller, saveRef }) {
    const path = row.entry.settingsPath;
    const initial = schema.getPath(namespace.value, path) ?? {};
    const [draft, setDraft] = React.useState(initial);
    const [menu, setMenu] = React.useState(false);
    const [dialog, setDialog] = React.useState(null);
    const [name, setName] = React.useState(row.entry.displayName);
    const [modelEdit, setModelEdit] = React.useState(null);
    const [advancedOpen, setAdvancedOpen] = React.useState(false);
    const [modelDraft, setModelDraft] = React.useState({ id: '' });
    const [testing, setTesting] = React.useState(null);
    const [feedback, setFeedback] = React.useState(null);
    const feedbackTimer = React.useRef(null);
    const detailAnchor = React.useRef(null);
    const [reasoningText, setReasoningText] = React.useState('');
    const showFeedback = (state, message, options = {}) => {
      clearTimeout(feedbackTimer.current); setFeedback({ state, message, ...options });
      if (state !== 'pending') feedbackTimer.current = setTimeout(() => setFeedback(null), state === 'failure' ? 8000 : 3500);
    };
    React.useEffect(() => () => clearTimeout(feedbackTimer.current), []);
    const [fetching, setFetching] = React.useState(false);
    const [fetchError, setFetchError] = React.useState('');
    const [candidates, setCandidates] = React.useState(null);
    const [modelQuery, setModelQuery] = React.useState('');
    const [picked, setPicked] = React.useState(new Set());
    const fetchGeneration = React.useRef(0);
    const icon = (path, size = 16) => h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }, h('path', { d: path }));
    const pending = React.useRef({});
    const revision = React.useRef(namespace.revision);
    const timer = React.useRef(null);
    const queue = React.useRef(Promise.resolve());
    const alive = React.useRef(true);
    const removed = React.useRef(false);
    const composing = React.useRef(false);
    const report = value => {
      if (!alive.current || value === '待保存') return;
      if (value === '正在保存…') showFeedback('pending', '正在自动保存…', { kind: 'save' });
      else if (value === '已自动保存') showFeedback('success', '已自动保存', { kind: 'save' });
      else showFeedback('failure', `保存失败：${value}`, { kind: 'save', onRetry: () => void flush() });
    };
    const flush = () => {
      clearTimeout(timer.current);
      const job = async () => {
        if (removed.current || !Object.keys(pending.current).length) return true;
        const changes = { ...pending.current };
        report('正在保存…');
        try {
          const values = Object.entries(changes).filter(([key]) => key !== '$key');
          const ops = values.map(([key, value]) => value === '' ? { op: 'unset', path: [...path, key] } : { op: 'set', path: [...path, key], value: JSON.parse(JSON.stringify(value)) });
          if (changes.$key && !/^[\x21-\x7e]+$/.test(changes.$key.trim())) throw new Error('API 密钥包含空白或无效字符');
          if (changes.baseURL && !/^https?:\/\//i.test(changes.baseURL)) throw new Error('API 地址必须以 http:// 或 https:// 开头');
          if (changes.models && changes.models.some(model => !model.id?.trim())) throw new Error('请填写模型 ID');
          if (changes.models && new Set(changes.models.map(model => model.id.trim())).size !== changes.models.length) throw new Error('模型 ID 不能重复');
          if (changes.models && changes.models.some(model => ['contextWindow', 'maxTokens'].some(key => model[key] !== undefined && (!Number.isInteger(model[key]) || model[key] <= 0)))) throw new Error('模型容量必须为正整数');
          const keyRef = draft.apiKeyEnv || initial.apiKeyEnv || `${row.entry.provider.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`;
          if (changes.$key && !initial.apiKeyEnv) ops.push({ op: 'set', path: [...path, 'apiKeyEnv'], value: keyRef });
          if (ops.length) {
            const result = await operations.writeSettings(namespace.ns, ops, revision.current);
            if (result.kind !== 'written') {
              if (result.kind === 'conflict') await controller.load();
              throw new Error(result.message || '配置已被其他操作更新，请重试');
            }
            revision.current = result.view.revision;
          }
          if (changes.$key) {
            const error = await operations.storeCredential(keyRef, changes.$key.trim());
            if (error) throw new Error(error);
          }
          for (const [key, value] of Object.entries(changes)) if (pending.current[key] === value) delete pending.current[key];
          if (alive.current && changes.$key && !pending.current.$key) setDraft(value => ({ ...value, $key: '' }));
          report('已自动保存');
          await controller.load();
          return true;
        } catch (error) { report(error.message || String(error)); return false; }
      };
      const next = queue.current.then(job, job);
      queue.current = next;
      return next;
    };
    const change = (key, value) => {
      pending.current[key] = value;
      setDraft(current => ({ ...current, [key]: value }));
      report('待保存');
      clearTimeout(timer.current);
      if (!composing.current) timer.current = setTimeout(flush, 1200);
    };
    React.useEffect(() => { alive.current = true; saveRef.current = flush; return () => { if (saveRef.current === flush) saveRef.current = null; alive.current = false; void flush(); }; }, []);
    React.useEffect(() => { if (typeof namespace.revision === 'number' && (revision.current === undefined || namespace.revision > revision.current)) revision.current = namespace.revision; }, [namespace.revision]);
    const field = (label, key, type = 'text') => h(ProviderField, { label, type, value: draft[key] ?? '',
      onCompositionStart: () => { composing.current = true; clearTimeout(timer.current); }, onCompositionEnd: () => { composing.current = false; timer.current = setTimeout(flush, 1200); },
      onChange: event => change(key, event.target.value), onBlur: () => void flush(), onKeyDown: event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) void flush(); } });
    const models = Array.isArray(draft.models) ? draft.models : [];
    const disabledModels = Array.isArray(draft.disabledModels) ? draft.disabledModels : [];
    const testModel = async model => {
      if (testing || draft.enabled === false || disabledModels.includes(model.id)) return;
      setTesting(model.id);
      const identity = `${draft.displayName || row.entry.displayName} / ${model.id}`;
      try {
        if (!await flush()) return;
        if (alive.current) showFeedback('pending', `正在测试 ${identity}`);
        const result = await operations.testModel(row.entry.provider, model.id);
        if (alive.current) { showFeedback(result.ok ? 'success' : 'failure', result.ok ? `${identity} 连接成功` : `${identity} 连接失败：${result.message}`); }
      } catch (error) { if (alive.current) { showFeedback('failure', `${identity} 连接失败：${error.message || '连接失败'}`); } }
      finally { if (alive.current) setTesting(null); }
    };
    React.useEffect(() => { fetchGeneration.current++; setCandidates(null); setFetching(false); setFetchError(''); }, [draft.baseURL, draft.api]);
    const fetchModels = async () => {
      const generation = ++fetchGeneration.current;
      setFetching(true); setFetchError('');
      try {
        if (!await flush()) return;
        const answer = await operations.discoverModels(namespace.ns, {
          provider: row.entry.provider,
          ...(draft.baseURL || row.entry.defaultBaseURL ? { baseURL: draft.baseURL || row.entry.defaultBaseURL } : {}),
          ...(draft.api ? { api: draft.api } : {}),
        });
        if (!alive.current || generation !== fetchGeneration.current) return;
        if (answer.kind !== 'found') throw new Error(answer.message);
        const found = [...new Map(answer.models.filter(model => model.id).map(model => [model.id, model])).values()];
        if (!found.length) throw new Error('供应商未返回可用模型，请检查 API 地址和协议后重试。');
        setCandidates(found); setPicked(new Set()); setModelQuery('');
      } catch (error) { if (alive.current && generation === fetchGeneration.current) setFetchError(error.message || '获取失败，请检查连接配置后重试。'); }
      finally { if (alive.current && generation === fetchGeneration.current) setFetching(false); }
    };
    const visibleCandidates = (candidates ?? []).filter(model => `${model.id} ${model.name ?? ''}`.toLowerCase().includes(modelQuery.trim().toLowerCase()));
    const availableCandidates = visibleCandidates.filter(candidate => !models.some(model => model.id === candidate.id));
    const allPicked = availableCandidates.length > 0 && availableCandidates.every(model => picked.has(model.id));
    const smartConfig = modelDraft.input === undefined && modelDraft.reasoningEfforts === undefined && modelDraft.compat === undefined;
    let parsedReasoning;
    let reasoningError = '';
    try {
      parsedReasoning = reasoningText.trim() ? JSON.parse(reasoningText) : undefined;
      const levels = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
      if (parsedReasoning !== undefined && parsedReasoning !== false && (typeof parsedReasoning !== 'object' || parsedReasoning === null || Array.isArray(parsedReasoning) || !Object.keys(parsedReasoning).length || Object.entries(parsedReasoning).some(([key, value]) => !levels.includes(key) || (value !== null && typeof value !== 'string') || (value === null && key !== 'off')))) reasoningError = '请输入有效的推理等级映射；值为接口参数名称，off 可为 null。';
    } catch { reasoningError = '推理参数映射必须是有效的 JSON。'; }
    const help = (label, hint) => h('span', { className: 'tpcowork-model-label' }, label, h('span', { className: 'tpcowork-model-help', title: hint, 'aria-label': hint }, '?'));
    const resetAdvanced = () => {
      setModelDraft(current => { const next = { ...current }; for (const key of ['input', 'compat', 'reasoningEfforts']) delete next[key]; return next; });
      setReasoningText('');
    };
    return h('div', { ref: detailAnchor, className: 'tpcowork-managed-details tpcowork-editable-provider' },
      h(ModelFeedback, { feedback, anchor: detailAnchor, onClose: () => { clearTimeout(feedbackTimer.current); setFeedback(null); } }),
      h(ProviderHeading, { row, title: draft.displayName || row.entry.displayName },
        h('div', { className: 'tpcowork-provider-actions' },
          h('button', { type: 'button', role: 'switch', 'aria-label': draft.enabled === false ? '启用供应商' : '禁用供应商', 'aria-checked': draft.enabled !== false, className: 'tpcowork-provider-switch', style: { borderRadius: 999, overflow: 'hidden' }, onClick: () => { change('enabled', draft.enabled === false); void flush(); } }, h('span', { style: { borderRadius: '50%', flexShrink: 0 } })),
          h(primitives.Menu, { open: menu, onClose: () => setMenu(false), align: 'end', portal: true,
            anchor: h('button', { type: 'button', 'aria-label': '供应商操作', 'aria-expanded': menu, onClick: () => setMenu(!menu) }, '•••'),
            items: [{ id: 'rename', label: '重命名' }, ...(row.removable ? [{ id: 'delete', label: '删除', danger: true }] : [])],
            onSelect: id => { setMenu(false); setName(draft.displayName || row.entry.displayName); setDialog(id); } }))),
      field('API 地址', 'baseURL'),
      h(ProviderProtocol, { value: draft.api, onChange: value => { change('api', value); void flush(); } }),
      h(CredentialField, { row, profile: draft, operations, onChange: value => change('$key', value), onBlur: () => void flush() }),
      h('div', { className: 'tpcowork-managed-models' },
        h(ModelListHeading, null,
          h('button', { type: 'button', className: 'tpcowork-model-add-inline', disabled: fetching, onClick: () => void fetchModels() }, icon('M3 11a9 9 0 0 1 15-6l3 3M21 3v5h-5M21 13a9 9 0 0 1-15 6l-3-3M3 21v-5h5'), fetching ? '正在获取…' : '获取可用模型')),
        h('div', { className: 'tpcowork-provider-model-list' },
          ...models.map((model, index) => {
            const disabled = disabledModels.includes(model.id);
            return h('div', { key: model.id, className: 'tpcowork-provider-model-entry', 'data-enabled': !disabled },
              h('div', { className: 'tpcowork-provider-model-row' },
                h(ModelSummary, { model, profile: draft }),
                h('div', { className: 'tpcowork-provider-model-actions' },
                  h('button', { type: 'button', className: 'tpcowork-model-icon-button', 'aria-label': `测试模型 ${model.id}`, title: '测试模型', disabled: !!testing || draft.enabled === false || disabled,
                    onClick: () => void testModel(model) }, testIcon(testing === model.id)),
                  h('button', { type: 'button', className: 'tpcowork-model-icon-button', 'aria-label': `编辑模型 ${model.id}`, title: '编辑模型', disabled: testing === model.id, onClick: () => { setAdvancedOpen(false); setModelDraft({ ...model }); setReasoningText(model.reasoningEfforts === undefined ? '' : JSON.stringify(model.reasoningEfforts, null, 2)); setModelEdit(index); } }, pencilIcon()),
                  h('button', { type: 'button', role: 'switch', className: 'tpcowork-provider-switch', style: { borderRadius: 999, overflow: 'hidden' }, 'aria-label': `${disabled ? '启用' : '禁用'}模型 ${model.id}`, 'aria-checked': !disabled, disabled: testing === model.id,
                    onClick: () => { change('disabledModels', disabled ? disabledModels.filter(id => id !== model.id) : [...new Set([...disabledModels, model.id])]); void flush(); } }, h('span', { style: { borderRadius: '50%' } })))),
              null);
          }),
          models.length === 0 ? h('p', { className: 'tpcowork-provider-model-empty' }, '暂无模型，点击右上角获取可用模型') : null)),
      fetchError ? h('p', { role: 'alert', className: 'tpcowork-model-discovery-error' }, fetchError,
        h('button', { type: 'button', disabled: fetching, onClick: () => void fetchModels() }, '重试')) : null,
      h(primitives.Modal, { open: candidates !== null, title: '选择可用模型', closeLabel: '取消', onClose: () => setCandidates(null),
        description: '勾选需要使用的模型，已有模型和自定义参数会保留。',
        footer: h(React.Fragment, null,
          h(primitives.Button, { onClick: () => setCandidates(null) }, '取消'),
          h(primitives.Button, { variant: 'primary', disabled: picked.size === 0, onClick: () => {
            const byId = new Map(models.map(model => [model.id, model]));
            for (const candidate of candidates) {
              if (!picked.has(candidate.id) || byId.has(candidate.id)) continue;
              const next = { id: candidate.id };
              for (const key of ['name', 'contextWindow', 'maxTokens']) if (candidate[key] !== undefined) next[key] = candidate[key];
              if (candidate.inputModalities) next.input = [...candidate.inputModalities];
              byId.set(candidate.id, next);
            }
            change('models', [...byId.values()]); void flush(); setCandidates(null);
          } }, `使用所选模型${picked.size ? `（${picked.size}）` : ''}`)) },
        h('div', { className: 'tpcowork-model-discovery-toolbar' },
          h('input', { className: classes.input, type: 'search', 'aria-label': '搜索可用模型', placeholder: '搜索模型', value: modelQuery, onChange: event => setModelQuery(event.target.value) }),
          h(primitives.Button, { disabled: availableCandidates.length === 0, onClick: () => setPicked(current => {
            const next = new Set(current); for (const model of availableCandidates) if (allPicked) next.delete(model.id); else next.add(model.id); return next;
          }) }, allPicked ? '取消全选' : '全选')),
        h('div', { className: 'tpcowork-model-discovery-list' },
          ...visibleCandidates.map(candidate => {
            const exists = models.some(model => model.id === candidate.id);
            return h('label', { key: candidate.id, className: 'tpcowork-model-discovery-item' },
              h('input', { type: 'checkbox', 'aria-label': candidate.id, checked: exists || picked.has(candidate.id), disabled: exists, onChange: () => setPicked(current => { const next = new Set(current); if (!next.delete(candidate.id)) next.add(candidate.id); return next; }) }),
              h('span', null, candidate.id), exists ? h('small', null, '已使用') : candidate.name && candidate.name !== candidate.id ? h('small', null, candidate.name) : null);
          }), visibleCandidates.length === 0 ? h('p', { role: 'status' }, '没有匹配的模型') : null)),
      h(primitives.Modal, { open: modelEdit !== null, title: '编辑模型设置', className: 'tpcowork-model-editor-dialog', closeLabel: '关闭模型编辑', onClose: () => setModelEdit(null),
        footer: h(React.Fragment, null,
          h('button', { type: 'button', className: 'tpcowork-model-reset', onClick: () => { setModelDraft({ ...models[modelEdit] }); setReasoningText(models[modelEdit]?.reasoningEfforts === undefined ? '' : JSON.stringify(models[modelEdit].reasoningEfforts, null, 2)); } }, '重置表单'),
          h(primitives.Button, { onClick: () => setModelEdit(null) }, '取消'),
          h(primitives.Button, { variant: 'primary', disabled: !!reasoningError || !modelDraft.id?.trim() || ['contextWindow', 'maxTokens'].some(key => modelDraft[key] !== undefined && (!Number.isInteger(modelDraft[key]) || modelDraft[key] <= 0)), onClick: () => {
            const next = { ...modelDraft, id: modelDraft.id.trim() };
            if (parsedReasoning === undefined) delete next.reasoningEfforts; else next.reasoningEfforts = parsedReasoning;
            change('models', models.map((model, index) => index === modelEdit ? next : model));
            void flush(); setModelEdit(null);
          } }, '保存')) },
        h('div', { className: 'tpcowork-model-editor-fields' },
          h('div', { className: 'tpcowork-model-smart-row' }, help('智能配置', '自动继承适配器的输入类型、推理及协议默认能力；上下文和最大输出仍可单独覆盖。'),
            h('button', { type: 'button', role: 'switch', className: 'tpcowork-provider-switch', 'aria-label': '智能配置', 'aria-checked': smartConfig, onClick: () => { if (smartConfig) setModelDraft(current => ({ ...current, input: [...(draft.defaultInput ?? ['text'])] })); else resetAdvanced(); } }, h('span'))),
          ...[['id', '模型 ID', '供应商返回的模型标识，不需要手动填写。'], ['contextWindow', '上下文窗口', '输入与输出合计的最大 token 数，留空使用适配器默认值。'], ['maxTokens', '最大输出 Token', '一次回复最多生成的 token 数，留空使用适配器默认值。']].map(([key, label, hint]) => h('label', { key, className: classes.field }, help(label, hint),
            h('input', { className: classes.input, 'aria-label': label, readOnly: key === 'id', type: key === 'id' ? 'text' : 'number', min: key === 'id' ? undefined : 1, step: 1, placeholder: key === 'contextWindow' ? String(draft.defaultContextWindow ?? '') : key === 'maxTokens' ? String(draft.defaultMaxTokens ?? '') : '', value: modelDraft[key] ?? '', onChange: event => setModelDraft(current => ({ ...current, [key]: key === 'id' ? event.target.value : event.target.value === '' ? undefined : Number(event.target.value) })) }))),
          h('details', { className: 'tpcowork-model-advanced', open: advancedOpen, onToggle: event => setAdvancedOpen(event.currentTarget.open) }, h('summary', null, '高级设置'),
            h('section', null, help('输入类型', '文本始终启用；图像能力会影响聊天附件支持。'),
              h('div', { className: 'tpcowork-model-option-chips' },
                ...[['text', '文本'], ['image', '图像'], ['video', '视频'], ['pdf', 'PDF']].map(([type, label]) => {
                  const supported = type === 'text' || type === 'image';
                  const checked = type === 'text' || type === 'image' && (modelDraft.input ?? draft.defaultInput ?? []).includes('image');
                  return h('label', { key: type, className: 'tpcowork-model-option', 'data-checked': checked, 'data-disabled': !supported, title: !supported ? '当前适配器不支持此输入类型' : type === 'text' ? '文本为必需输入类型' : undefined },
                    h('input', { type: 'checkbox', 'aria-label': type === 'image' ? '支持视觉输入' : label, checked, disabled: type !== 'image', onChange: event => setModelDraft(current => ({ ...current, input: event.target.checked ? [...new Set(['text', ...(current.input ?? draft.defaultInput ?? []), 'image'])] : [...new Set(['text', ...(current.input ?? draft.defaultInput ?? []).filter(value => value !== 'image')])] })) }), label, type === 'text' ? h('svg', { width: 12, height: 12, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, 'aria-hidden': true }, h('rect', { x: 4, y: 10, width: 16, height: 12, rx: 2 }), h('path', { d: 'M8 10V6a4 4 0 0 1 8 0v4m-4 5v3' })) : null);
                }))),
            h('section', null, help('模型能力', '这些能力由当前模型适配器实现，不能通过界面开关凭空启用。'),
              h('div', { className: 'tpcowork-model-option-chips' }, ...['结构化输出', '原生网络搜索', '会话中途系统消息'].map(label => h('label', { key: label, className: 'tpcowork-model-option', 'data-disabled': true, title: '当前适配器未提供此独立能力开关' }, h('input', { type: 'checkbox', disabled: true }), label)))),
            h('section', null, help('推理等级（从低到高）', '设置此模型提供的推理等级；留空使用适配器自动识别。'),
              h('div', { className: 'tpcowork-model-reasoning-levels' },
                ...Object.keys(parsedReasoning && typeof parsedReasoning === 'object' ? parsedReasoning : {}).map(level => h('button', { key: level, type: 'button', title: '移除此等级', onClick: () => { const next = { ...parsedReasoning }; delete next[level]; setReasoningText(Object.keys(next).length ? JSON.stringify(next, null, 2) : ''); setModelDraft(current => { const value = { ...current }; delete value.reasoningEfforts; return value; }); } }, level, ' ×')),
                h('select', { 'aria-label': '添加推理等级', value: '', onChange: event => { const level = event.target.value; if (!level) return; const next = { ...(parsedReasoning && typeof parsedReasoning === 'object' ? parsedReasoning : {}), [level]: level === 'off' ? null : level }; setReasoningText(JSON.stringify(next, null, 2)); setModelDraft(current => ({ ...current, reasoningEfforts: next })); } }, h('option', { value: '' }, '+ 添加等级'), ...['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].map(level => h('option', { key: level, value: level, disabled: !!parsedReasoning?.[level] || parsedReasoning?.[level] === null }, level))))),
            h('section', null, help('推理参数映射', 'JSON 对象将推理等级映射到接口参数值，例如 {"low":"low","high":"high"}；false 表示禁用推理。'),
              h('textarea', { 'aria-label': '推理参数映射', spellCheck: false, placeholder: '自动使用适配器默认映射', value: reasoningText, onChange: event => { setReasoningText(event.target.value); setModelDraft(current => ({ ...current, reasoningEfforts: current.reasoningEfforts ?? {} })); } }), reasoningError ? h('p', { role: 'alert' }, reasoningError) : null)))),
      h(primitives.Modal, { open: dialog !== null, title: dialog === 'rename' ? '重命名供应商' : '删除供应商', closeLabel: '取消', onClose: () => setDialog(null),
        footer: h(React.Fragment, null, h(primitives.Button, { onClick: () => setDialog(null) }, '取消'), h(primitives.Button, { variant: 'primary', onClick: async () => {
          if (dialog === 'rename') { if (!name.trim()) return; change('displayName', name.trim()); if (await flush()) setDialog(null); }
          else if (await flush()) {
            try {
              const result = await operations.writeSettings(namespace.ns, [{ op: 'unset', path }], revision.current);
              if (result.kind !== 'written') throw new Error(result.message || '删除失败');
              removed.current = true; setDialog(null);
              const conventionalRef = `${row.entry.provider.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`;
              if ((initial.apiKeyEnv ?? row.apiKeyEnv) === conventionalRef && row.credential?.writable) {
                const error = await operations.removeCredential(conventionalRef);
                if (error) report(error);
              }
              await controller.load();
            } catch (error) { report(error.message); }
          }
        } }, dialog === 'rename' ? '确定' : '删除')) },
        dialog === 'rename' ? h('input', { className: classes.input, 'aria-label': '供应商名称', value: name, onChange: event => setName(event.target.value), autoFocus: true }) : h('p', null, `确定删除 ${row.entry.displayName}？`)));
  }

  function NewProvider({ namespace, operations, controller, onCreated, onCancel }) {
    const [id] = React.useState(() => `provider-${crypto.randomUUID()}`);
    const [name, setName] = React.useState('新供应商');
    const [baseURL, setBaseURL] = React.useState('');
    const [api, setApi] = React.useState('openai-completions');
    const [apiKey, setApiKey] = React.useState('');
    const [models, setModels] = React.useState([]);
    const [candidates, setCandidates] = React.useState(null);
    const [query, setQuery] = React.useState('');
    const [picked, setPicked] = React.useState(new Set());
    const [busy, setBusy] = React.useState(false);
    const [feedback, setFeedback] = React.useState(null);
    const anchor = React.useRef(null);
    const alive = React.useRef(true);
    const generation = React.useRef(0);
    React.useEffect(() => { alive.current = true; return () => { alive.current = false; generation.current++; }; }, []);
    React.useEffect(() => { generation.current++; setCandidates(null); setFeedback(null); }, [baseURL, api, apiKey]);
    const row = { entry: { provider: id, displayName: name || '新供应商' } };
    const validAddress = (() => { try { return ['http:', 'https:'].includes(new URL(baseURL.trim()).protocol); } catch { return false; } })();
    const keyValid = !apiKey || /^[\x21-\x7e]+$/.test(apiKey.trim());
    const create = async selectedModels => {
      if (busy || !validAddress || !selectedModels.length || !namespace) return;
      setBusy(true); setCandidates(null); setModels(selectedModels);
      setFeedback({ kind: 'save', state: 'pending', message: '正在添加供应商…' });
      const keyRef = `${id.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`;
      let storedKey = false;
      try {
        if (apiKey.trim()) {
          const error = await operations.storeCredential(keyRef, apiKey.trim());
          if (error) throw new Error(error);
          storedKey = true;
        }
        const profile = { displayName: name.trim() || '新供应商', baseURL: baseURL.trim(), api, models: selectedModels, ...(storedKey ? { apiKeyEnv: keyRef } : {}) };
        const result = await operations.writeSettings(namespace.ns, [{ op: 'set', path: ['providers', id], value: profile }], namespace.revision);
        if (result.kind !== 'written') {
          if (storedKey) { await operations.removeCredential(keyRef); storedKey = false; }
          await controller.load();
          throw new Error(result.message || '未能保存，请重试');
        }
        await controller.load();
        if (alive.current) onCreated(id);
      } catch (error) {
        if (alive.current) setFeedback({ kind: 'save', state: 'failure', message: `添加失败：${error.message || '请重试'}`, onRetry: () => void create(selectedModels) });
      } finally { if (alive.current) setBusy(false); }
    };
    const discover = async () => {
      if (busy || !validAddress || !keyValid) return;
      const request = ++generation.current;
      setBusy(true); setFeedback(null);
      try {
        const result = await operations.discoverModels(namespace.ns, { baseURL: baseURL.trim(), api, ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}) });
        if (!alive.current || request !== generation.current) return;
        if (result.kind !== 'found') throw new Error(result.message);
        if (!result.models.length) throw new Error('未获取到模型，请检查地址和密钥后重试');
        setCandidates([...new Map(result.models.map(model => [model.id, model])).values()]); setPicked(new Set()); setQuery('');
      } catch (error) {
        if (alive.current && request === generation.current) setFeedback({ state: 'failure', message: error.message || '获取失败，请重试', onRetry: () => void discover() });
      } finally { if (alive.current) setBusy(false); }
    };
    const visible = (candidates ?? []).filter(model => `${model.id} ${model.name ?? ''}`.toLowerCase().includes(query.trim().toLowerCase()));
    const allPicked = visible.length > 0 && visible.every(model => picked.has(model.id));
    return h('div', { ref: anchor, className: 'tpcowork-managed-details tpcowork-new-provider' },
      h(ModelFeedback, { feedback, anchor, onClose: () => setFeedback(null) }),
      h(ProviderHeading, { row, title: h('input', { className: 'tpcowork-new-provider-name', 'aria-label': '供应商名称', value: name, placeholder: '供应商名称', disabled: busy, onChange: event => setName(event.target.value) }) },
        h('button', { type: 'button', className: 'tpcowork-new-provider-close', title: '取消添加', 'aria-label': '取消添加供应商', onClick: onCancel }, '×')),
      h(ProviderField, { label: 'API 地址', value: baseURL, placeholder: '输入供应商提供的地址', disabled: busy, onChange: event => setBaseURL(event.target.value) }),
      h(ProviderProtocol, { value: api, readOnly: busy, onChange: setApi }),
      h(CredentialField, { row, profile: {}, operations, onChange: setApiKey, disabled: busy }),
      h('div', { className: 'tpcowork-managed-models' },
        h(ModelListHeading, null, h('button', { type: 'button', className: 'tpcowork-model-add-inline', disabled: busy || !validAddress || !keyValid || !namespace, onClick: () => void discover() }, busy ? '正在处理…' : '获取可用模型')),
        h('div', { className: 'tpcowork-provider-model-list' },
          ...models.map(model => h('div', { key: model.id, className: 'tpcowork-provider-model-entry' }, h('div', { className: 'tpcowork-provider-model-row' }, h(ModelSummary, { model, profile: {} })))),
          !models.length ? h('p', { className: 'tpcowork-provider-model-empty' }, '获取模型后，选择需要使用的模型') : null)),
      h(primitives.Modal, { open: candidates !== null, title: '选择可用模型', closeLabel: '取消', onClose: () => setCandidates(null),
        footer: h(React.Fragment, null, h(primitives.Button, { onClick: () => setCandidates(null) }, '取消'),
          h(primitives.Button, { variant: 'primary', disabled: busy || !picked.size, onClick: () => {
            const selected = candidates.filter(model => picked.has(model.id)).map(model => {
              const next = { id: model.id };
              for (const key of ['name', 'contextWindow', 'maxTokens']) if (model[key] !== undefined) next[key] = model[key];
              if (model.inputModalities) next.input = [...model.inputModalities];
              return next;
            });
            void create(selected);
          } }, `使用所选模型${picked.size ? `（${picked.size}）` : ''}`)) },
        h('div', { className: 'tpcowork-model-discovery-toolbar' },
          h('input', { className: classes.input, type: 'search', 'aria-label': '搜索可用模型', value: query, placeholder: '搜索模型', onChange: event => setQuery(event.target.value) }),
          h(primitives.Button, { disabled: !visible.length, onClick: () => setPicked(current => { const next = new Set(current); for (const model of visible) if (allPicked) next.delete(model.id); else next.add(model.id); return next; }) }, allPicked ? '取消全选' : '全选')),
        h('div', { className: 'tpcowork-model-discovery-list' }, ...visible.map(model => h('label', { key: model.id, className: 'tpcowork-model-discovery-item' },
          h('input', { type: 'checkbox', 'aria-label': model.id, checked: picked.has(model.id), onChange: () => setPicked(current => { const next = new Set(current); if (!next.delete(model.id)) next.add(model.id); return next; }) }), model.id)),
          !visible.length ? h('p', { role: 'status' }, '没有匹配的模型') : null)));
  }

  return ctx.slots.inject('settings.models.footer', () => {
    const entry = ctx.slots.entries('settings.section').find(row => row.options.id === 'models');
    if (!entry) return () => {};
    function Navigator(props) {
      const state = props.useSnapshot(value => value);
      const rows = state.rows.filter(row => row.configured)
        .sort((left, right) => Number(right.entry.provider === 'asset-deepseek') - Number(left.entry.provider === 'asset-deepseek'));
      const [selected, setSelected] = React.useState(null);
      const [adding, setAdding] = React.useState(false);
      const [targets, setTargets] = React.useState(null);
      const anchor = React.useRef(null);
      const saveRef = React.useRef(null);
      const root = React.useRef(null);
      const chosen = rows.find(row => row.entry.provider === selected) ?? rows[0];
      const openProvider = row => {
        const cards = [...(root.current?.querySelectorAll(`.${classes.rowCard}`) ?? [])];
        const identity = row.entry.provider === row.entry.displayName ? row.entry.provider : `${row.entry.displayName} (${row.entry.provider})`;
        const editLabel = props.t('editProvider').replace('{provider}', identity);
        const card = cards.find(node => node.querySelector(`.${classes.rowActions} .${classes.secondaryButton}`)?.getAttribute('aria-label') === editLabel)
          ?? cards.find(node => node.querySelector(`.${classes.rowName}`)?.textContent === (row.entry.provider === 'deepseek-account' ? props.t('deepSeekAccount') : row.entry.displayName));
        for (const candidate of cards) {
          candidate.dataset.tpSelected = String(candidate === card);
          candidate.dataset.tpReadonly = String(candidate === card && row.entry.provider === 'asset-deepseek');
        }
        if (row.entry.provider !== 'asset-deepseek' && row.entry.settingsNs !== 'llm-pi-ai' && card && !card.querySelector(`.${classes.editor}`)) card.querySelector(`.${classes.rowActions} .${classes.secondaryButton}`)?.click();
      };
      React.useEffect(() => {
        const section = anchor.current.closest(`.${classes.section}`);
        root.current = section;
        section.classList.add('tpcowork-model-settings');
        const toolbar = document.createElement('div');
        toolbar.className = 'tpcowork-model-toolbar-target';
        const rail = document.createElement('div');
        rail.className = 'tpcowork-model-rail-target';
        const managed = document.createElement('div');
        managed.className = 'tpcowork-managed-target';
        section.append(toolbar, rail, managed);
        setTargets({ toolbar, rail, managed });
        const opened = new Set();
        const readOnlyControls = new Map();
        const sync = () => {
          for (const control of section.querySelectorAll('[data-tp-readonly="true"] input, [data-tp-readonly="true"] select, [data-tp-readonly="true"] textarea')) {
            if (!readOnlyControls.has(control)) readOnlyControls.set(control, { readOnly: control.readOnly, disabled: control.disabled });
            if (control.tagName === 'SELECT' || ['checkbox', 'radio', 'range'].includes(control.type)) control.disabled = true;
            else control.readOnly = true;
          }
          for (const key of ['baseUrl', 'customApi', 'customDisplayName', 'keyInput']) {
            for (const input of section.querySelectorAll('input[aria-label], select[aria-label]')) {
              if (input.getAttribute('aria-label') === props.t(key)) {
                const field = input.closest(`.${classes.field}`);
                if (field) field.dataset.tpModelField = key;
              }
            }
          }
          for (const detail of section.querySelectorAll(`.${classes.rowCard} details.${classes.customized}, .${classes.setupCard} details.${classes.customized}`)) {
            if (!detail.open) { opened.add(detail); detail.open = true; }
          }

        };
        sync();
        const observer = new MutationObserver(sync);
        observer.observe(section, { childList: true, subtree: true });
        return () => {
          observer.disconnect(); toolbar.remove(); rail.remove(); managed.remove();
          section.classList.remove('tpcowork-model-settings'); delete section.dataset.adding; delete section.dataset.managed;
          for (const detail of opened) if (detail.isConnected) detail.open = false;
          for (const field of section.querySelectorAll('[data-tp-model-field]')) delete field.dataset.tpModelField;
          for (const card of section.querySelectorAll('[data-tp-selected]')) { delete card.dataset.tpSelected; delete card.dataset.tpReadonly; }
          for (const [control, previous] of readOnlyControls) {
            control.disabled = previous.disabled;
            if (previous.readOnly !== undefined) control.readOnly = previous.readOnly;
          }
        };
      }, []);
      React.useEffect(() => {
        if (targets && !adding && chosen && state.status === 'ready') openProvider(chosen);
      }, [targets, chosen?.entry.provider, state.status, adding]);
      const managedSelected = !adding && chosen?.entry.provider === 'asset-deepseek';
      const editableSelected = !adding && chosen?.entry.settingsNs === 'llm-pi-ai' && !managedSelected;
      React.useEffect(() => {
        if (root.current) { root.current.dataset.managed = String(adding || managedSelected || editableSelected); root.current.dataset.adding = String(adding); }
      }, [adding, managedSelected, editableSelected, targets]);
      const namespace = chosen && state.namespaces.get(chosen.entry.settingsNs);
      const profile = namespace && props.schema.getPath(namespace.value, chosen.entry.settingsPath);
      const configured = profile && typeof profile === 'object' ? profile : {};
      const managedDetails = managedSelected ? h('div', { className: 'tpcowork-managed-details tpcowork-readonly-provider' },
        h(ProviderHeading, { row: chosen }),
        h(ProviderField, { label: 'API 地址', value: configured.baseURL ?? chosen.entry.defaultBaseURL ?? '', readOnly: true }),
        h(ProviderProtocol, { value: configured.api, readOnly: true }),
        h(CredentialField, { key: chosen.entry.provider, row: chosen, profile: configured, operations: props.operations }),
        h('div', { className: 'tpcowork-managed-models' },
          h(ModelListHeading),
          h('div', { className: 'tpcowork-provider-model-list' },
            ...(Array.isArray(configured.models) ? configured.models : []).map(model => h('div', { key: model.id, className: 'tpcowork-provider-model-entry' },
              h('div', { className: 'tpcowork-provider-model-row' }, h(ModelSummary, { model, profile: configured }), h('div', { className: 'tpcowork-provider-model-actions', 'aria-hidden': true }))))))) : null;
      const svg = path => h('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }, h('path', { d: path }));
      return h(React.Fragment, null,
        h('span', { ref: anchor, hidden: true }),
        targets ? ReactDOM.createPortal(adding ? h(NewProvider, { namespace: state.namespaces.get('llm-pi-ai'), operations: props.operations, controller: props.controller, onCancel: () => setAdding(false), onCreated: id => { setSelected(id); setAdding(false); } }) : managedSelected ? managedDetails : editableSelected && namespace ? h(ProviderDetails, { key: chosen.entry.provider, row: chosen, namespace, operations: props.operations, schema: props.schema, controller: props.controller, saveRef }) : null, targets.managed) : null,
        targets ? ReactDOM.createPortal(h('div', { className: 'tpcowork-model-toolbar' },
          h('p', null, tp('modelSettingsIntro')),
          h('div', { className: 'tpcowork-model-toolbar-actions' },
            h('button', { type: 'button', className: 'tpcowork-model-refresh', 'aria-label': tp('modelSettingsRefresh'), disabled: state.status === 'loading', onClick: () => void props.controller.load() },
              svg('M3 11a9 9 0 0 1 15-6l3 3M21 3v5h-5M21 13a9 9 0 0 1-15 6l-3-3M3 21v-5h5')),
            h('button', { type: 'button', className: 'tpcowork-model-add', disabled: !state.writable || state.status !== 'ready', onClick: async () => { if (saveRef.current && !await saveRef.current()) return; setAdding(true); } },
              h(primitives.IconPlusOutlineRegular, { size: 16 }), tp('modelSettingsAdd')))), targets.toolbar) : null,
        targets ? ReactDOM.createPortal(h('nav', { className: 'tpcowork-model-providers', 'aria-label': tp('modelSettingsProviders') },
          h('p', { className: 'tpcowork-model-group' }, tp('modelSettingsProviders')),
          rows.map(row => h('button', { key: row.entry.provider, type: 'button', className: 'tpcowork-model-provider',
            'aria-label': tp('modelSettingsSelect', { name: row.entry.displayName }), 'aria-current': !adding && chosen?.entry.provider === row.entry.provider ? 'true' : undefined,
            onClick: async () => { if (saveRef.current && !await saveRef.current()) return; setAdding(false); setSelected(row.entry.provider); openProvider(row); } },
            h(ProviderLogo, { row }),
            h('span', { className: 'tpcowork-model-provider-name' }, row.entry.displayName),
            h('span', { className: 'tpcowork-model-status', 'data-configured': row.credential?.configured === true && props.schema.getPath(state.namespaces.get(row.entry.settingsNs)?.value, [...row.entry.settingsPath, 'enabled']) !== false }))),
          rows.length === 0 ? h('p', { className: 'tpcowork-model-empty' }, tp('modelSettingsEmpty')) : null), targets.rail) : null);
    }
    return ctx.slots.register({ name: 'settings.models.footer', id: 'tpcowork-provider-navigation', inject: entry.inject, locale: entry.locale }, Navigator);
  });
}
