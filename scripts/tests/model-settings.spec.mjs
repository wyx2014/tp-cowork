import { createServer } from 'node:http'
import { registerHooks } from 'node:module'
import { mkdir, writeFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { chromium } from 'playwright-core'
import { expect, it, onTestFinished } from 'vitest'
import { launchWebScaffold } from '../../../deepseek-harness/apps/web/tests/scaffold.ts'

const root = fileURLToPath(new URL('../../', import.meta.url))
const artifacts = join(root, 'artifacts/model-settings')

it('offers only custom API creation and preserves the saved endpoint and models after reload', async () => {
  let replyMode = 'ok';
  const requests = [];
  const server = createServer((request, response) => {
    const record = { url: request.url, authorization: request.headers.authorization };
    requests.push(record);
    if (request.method === 'POST') {
      let body = '';
      request.on('data', chunk => { body += chunk; });
      request.on('end', () => {
        record.body = JSON.parse(body);
        if (replyMode === 'test-fail') { response.writeHead(401, { 'content-type': 'application/json' }); response.end(JSON.stringify({ error: { message: 'test credential refused' } })); return; }
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        const base = { id: 'test-completion', object: 'chat.completion.chunk', created: 1, model: record.body.model };
        response.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { role: 'assistant', content: 'OK' }, finish_reason: null }] })}\n\n`);
        response.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
        response.end('data: [DONE]\n\n');
      });
      return;
    }
    response.setHeader('content-type', 'application/json');
    if (replyMode === 'fail') { response.writeHead(503); response.end(JSON.stringify({ error: { message: 'temporary failure' } })); return; }
    response.end(JSON.stringify({ data: replyMode === 'empty' ? [] : [
      { id: 'test-model', context_window: 128000 },
      { id: 'second-model', context_window: 1000000, max_tokens: 8192 },
      { id: 'managed-model' },
    ] }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  onTestFinished(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const apiRoot = `http://127.0.0.1:${server.address().port}`;
  const temp = await mkdtemp(join(tmpdir(), 'tpcowork-create-provider-'))
  onTestFinished(() => rm(temp, { recursive: true, force: true }))
  const managedOverlay = join(temp, 'managed.yml')
  await writeFile(managedOverlay, `- insert:
    - id: tpcowork-core-model
      name: '@tpcowork/dsh-core/model'
      config:
        providers:
          asset-deepseek:
            displayName: 资产DeepSeek
            api: openai-completions
            baseURL: ${apiRoot}/managed/v1
            models:
              - id: managed-model
`)
  const hooks = registerHooks({ resolve(specifier, context, next) {
    return next(specifier.startsWith('file:') ? fileURLToPath(specifier) : specifier, context)
  } })
  onTestFinished(() => hooks.deregister())
  const scaffold = await launchWebScaffold({
    extraOverlayPath: [join(root, '../deepseek-harness/apps/web/tests/pin-browse-picker.overlay.yml'), managedOverlay],
    profile: { hmr: false, packages: [{ dir: join(root, 'plugins/tpcowork-ui'), enabled: true }, { dir: join(root, 'plugins/tpcowork-core'), enabled: false }] },
  })
  onTestFinished(() => scaffold.close())
  const browser = await chromium.launch({ executablePath: process.env.TPCOWORK_TEST_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
  onTestFinished(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })
  // Existing profiles have finished the first-run guide; first-run-guide.spec.mjs covers it.
  await page.addInitScript(() => localStorage.setItem('tpcowork.first-run-guide.v1', 'done'))
  page.setDefaultTimeout(20000)
  const errors = []
  const receivedFrames = []
  page.on('websocket', socket => socket.on('framereceived', event => receivedFrames.push(String(event.payload))))
  page.on('pageerror', error => errors.push(error.message))
  await mkdir(artifacts, { recursive: true })
  onTestFinished(async () => {
    await writeFile(join(artifacts, 'page.txt'), await page.locator('body').innerText())
    await writeFile(join(artifacts, 'errors.json'), JSON.stringify(errors, null, 2))
    await page.screenshot({ path: join(artifacts, 'last.png'), fullPage: true })
  })
  const dialog = page.getByRole('dialog', { name: '设置', exact: true })
  const openModels = async () => {
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await dialog.getByRole('button', { name: '模型', exact: true }).click()
    await dialog.getByRole('button', { name: '添加供应商', exact: true }).waitFor()
    const existing = dialog.getByRole('button', { name: '选择供应商 自定义 API 测试', exact: true })
    if (await existing.count()) await existing.click()
  }
  await page.goto(scaffold.authenticatedUrl)
  await openModels()
  expect(await dialog.getByRole('button', { name: '添加模型提供商', exact: true }).count()).toBe(0)
  await dialog.getByRole('button', { name: '添加供应商', exact: true }).click()
  await dialog.getByRole('textbox', { name: '供应商名称', exact: true }).waitFor()
  const creationInset = await page.evaluate(() => {
    const section = document.querySelector('.tpcowork-model-settings')
    const id = section.querySelector('.tpcowork-new-provider input[aria-label="API 地址"]')
    const heading = section.querySelector('.tpcowork-new-provider .tpcowork-provider-detail-heading')
    return { top: heading.getBoundingClientRect().top - section.getBoundingClientRect().top,
      left: id.getBoundingClientRect().left - section.querySelector('.tpcowork-model-rail-target').getBoundingClientRect().right }
  })
  expect(creationInset.top).toBeGreaterThanOrEqual(24)
  expect(creationInset.left).toBe(24)

  expect(await dialog.getByRole('tablist', { name: '添加方式' }).count()).toBe(0)
  expect(await dialog.getByText('第三方模型提供商', { exact: true }).count()).toBe(0)
  expect(await dialog.getByRole('combobox', { name: '提供商', exact: true }).count()).toBe(0)
  expect(await page.locator('.tpcowork-model-settings').count()).toBe(1)
  await page.screenshot({ path: join(artifacts, 'custom-api.png'), fullPage: true })
  expect(await dialog.getByRole('textbox', { name: 'Provider ID', exact: true }).count()).toBe(0)
  expect(await dialog.getByText(/连接中转站|自部署服务|派生凭据/).count()).toBe(0)
  await dialog.getByRole('button', { name: '选择供应商 资产DeepSeek', exact: true }).click()
  expect(await dialog.getByRole('textbox', { name: '供应商名称', exact: true }).count()).toBe(0)
  await dialog.getByRole('button', { name: '添加供应商', exact: true }).click()
  await dialog.getByRole('button', { name: '取消添加供应商', exact: true }).click()
  expect(await dialog.getByRole('textbox', { name: '供应商名称', exact: true }).count()).toBe(0)
  await dialog.getByRole('button', { name: '添加供应商', exact: true }).click()
  await dialog.getByRole('textbox', { name: '供应商名称', exact: true }).fill('自定义 API 测试')
  await dialog.getByRole('textbox', { name: 'API 地址', exact: true }).fill(`${apiRoot}/v1`)
  await dialog.getByRole('combobox', { name: 'API 协议', exact: true }).selectOption('openai-completions')
  await dialog.getByLabel('API 密钥', { exact: true }).fill('sk-test-custom-api')
  expect(await dialog.getByRole('button', { name: '添加模型', exact: true }).count()).toBe(0)
  await dialog.getByRole('button', { name: '获取可用模型', exact: true }).click()
  const createPicker = page.getByRole('dialog', { name: '选择可用模型', exact: true })
  await createPicker.getByRole('checkbox', { name: 'test-model', exact: true }).check()
  await createPicker.getByRole('button', { name: '使用所选模型（1）', exact: true }).click()
  const editName = '选择供应商 自定义 API 测试'
  await dialog.getByRole('button', { name: editName, exact: true }).waitFor()
  await page.reload()
  await openModels()
  await dialog.getByRole('button', { name: editName, exact: true }).click()
  expect(await dialog.getByRole('textbox', { name: 'API 地址', exact: true }).inputValue()).toBe(`${apiRoot}/v1`)
  expect(await dialog.locator('.tpcowork-provider-model-id').first().innerText()).toBe('test-model')
  expect(await dialog.getByRole('combobox', { name: 'API 协议', exact: true }).inputValue()).toBe('openai-completions')
  await page.evaluate(() => {
    window.__feedbackMeasurements = [];
    new MutationObserver(() => {
      const node = document.querySelector('.tpcowork-model-feedback');
      if (node) window.__feedbackMeasurements.push({ kind: node.dataset.kind, state: node.dataset.state, height: node.getBoundingClientRect().height });
    }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-kind', 'data-state'] });
  });
  await dialog.getByRole('textbox', { name: 'API 地址', exact: true }).fill(`${apiRoot}/custom/v1`)
  await dialog.getByText('已自动保存', { exact: true }).waitFor()
  expect(await dialog.locator('.tpcowork-provider-save-status').count()).toBe(0)
  const saveFeedback = dialog.locator('.tpcowork-model-feedback[data-kind="save"][data-state="success"]')
  expect(await saveFeedback.isVisible()).toBe(true)
  const saveBox = await saveFeedback.boundingBox()
  expect(saveBox.height).toBe(48)
  const saveMeasurements = await page.evaluate(() => window.__feedbackMeasurements)
  expect(saveMeasurements.some(entry => entry.kind === 'save' && entry.state === 'pending' && entry.height === 48)).toBe(true)
  const saveFrame = await dialog.locator('.tpcowork-model-settings').boundingBox()
  expect(saveBox.y + saveBox.height).toBeLessThanOrEqual(saveFrame.y + saveFrame.height - 15)
  await page.screenshot({ path: join(artifacts, 'model-autosave-feedback.png'), fullPage: true })
  await dialog.getByRole('button', { name: '关闭保存提示', exact: true }).click()
  expect(await dialog.locator('.tpcowork-model-feedback[data-kind="save"]').count()).toBe(0)
  await dialog.getByRole('textbox', { name: 'API 地址', exact: true }).fill('invalid-endpoint')
  await dialog.getByRole('textbox', { name: 'API 地址', exact: true }).press('Enter')
  const failedSave = dialog.locator('.tpcowork-model-feedback[data-kind="save"][data-state="failure"]')
  await failedSave.waitFor()
  expect(await failedSave.getByRole('button', { name: '重试', exact: true }).isVisible()).toBe(true)
  expect((await failedSave.boundingBox()).height).toBe(48)
  await dialog.getByRole('textbox', { name: 'API 地址', exact: true }).fill(`${apiRoot}/custom/v1`)
  await failedSave.getByRole('button', { name: '重试', exact: true }).click()
  await dialog.getByText('已自动保存', { exact: true }).waitFor()
  expect(await dialog.getByRole('textbox', { name: '显示名称', exact: true }).count()).toBe(0)
  expect(await dialog.getByRole('button', { name: '保存', exact: true }).count()).toBe(0)
  await dialog.getByRole('switch', { name: '禁用供应商', exact: true }).click()
  await dialog.getByText('已自动保存', { exact: true }).waitFor()
  await dialog.getByRole('switch', { name: '启用供应商', exact: true }).click()
  await dialog.getByText('已自动保存', { exact: true }).waitFor()
  await dialog.getByRole('button', { name: editName, exact: true }).click()
  expect(await dialog.getByRole('textbox', { name: 'API 地址', exact: true }).inputValue()).toBe(`${apiRoot}/custom/v1`)
  const endpointBox = await dialog.getByRole('textbox', { name: 'API 地址', exact: true }).boundingBox()
  const protocolBox = await dialog.getByRole('combobox', { name: 'API 协议', exact: true }).boundingBox()
  const keyBox = await dialog.getByRole('textbox', { name: 'API 密钥', exact: true }).boundingBox()
  expect(endpointBox.y).toBeLessThan(protocolBox.y)
  expect(protocolBox.y).toBeLessThan(keyBox.y)
  expect(keyBox.y).toBeLessThan((await dialog.locator('.tpcowork-provider-model-row').first().boundingBox()).y)
  const rail = page.locator('.tpcowork-model-providers')
  const details = dialog.getByRole('textbox', { name: 'API 地址', exact: true })
  expect((await rail.boundingBox()).x).toBeLessThan((await details.boundingBox()).x)
  const toggleRadii = await dialog.getByRole('switch', { name: '禁用供应商', exact: true }).evaluate(button => [getComputedStyle(button).borderTopLeftRadius, getComputedStyle(button.firstElementChild).borderTopLeftRadius])
  expect(toggleRadii).toEqual(['999px', '50%'])
  const keyInput = dialog.getByLabel('API 密钥', { exact: true })
  await dialog.getByRole('button', { name: '显示 API 密钥', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.tpcowork-editable-provider input[aria-label="API 密钥"]')?.value === 'sk-test-custom-api')
  expect(await keyInput.getAttribute('type')).toBe('text')
  await dialog.getByRole('button', { name: '隐藏 API 密钥', exact: true }).click()
  expect(await keyInput.inputValue()).toBe('')
  await keyInput.fill('sk-visible-test')
  expect(await keyInput.getAttribute('type')).toBe('password')
  await dialog.getByRole('button', { name: '显示 API 密钥', exact: true }).click()
  expect(await keyInput.getAttribute('type')).toBe('text')
  expect(await keyInput.inputValue()).toBe('sk-visible-test')
  await dialog.getByRole('button', { name: '隐藏 API 密钥', exact: true }).click()
  expect(await dialog.getByRole('button', { name: '添加模型', exact: true }).count()).toBe(0)
  replyMode = 'fail'
  await dialog.getByRole('button', { name: '获取可用模型', exact: true }).click()
  await dialog.locator('.tpcowork-model-discovery-error').waitFor()
  expect(await dialog.locator('.tpcowork-provider-model-id').first().innerText()).toBe('test-model')
  replyMode = 'empty'
  await dialog.locator('.tpcowork-model-discovery-error').getByRole('button', { name: '重试', exact: true }).click()
  await dialog.getByText('供应商未返回可用模型，请检查 API 地址和协议后重试。', { exact: false }).waitFor()
  replyMode = 'ok'
  await dialog.locator('.tpcowork-model-discovery-error').getByRole('button', { name: '重试', exact: true }).click()
  const modelDialog = page.getByRole('dialog', { name: '选择可用模型', exact: true })
  expect(await modelDialog.getByRole('checkbox', { name: 'test-model', exact: true }).isDisabled()).toBe(true)
  await modelDialog.getByRole('searchbox', { name: '搜索可用模型', exact: true }).fill('second')
  await modelDialog.getByRole('checkbox', { name: 'second-model', exact: true }).check()
  await modelDialog.getByRole('button', { name: '使用所选模型（1）', exact: true }).click()
  await dialog.getByText('second-model', { exact: true }).waitFor()
  expect(await dialog.getByText('1M', { exact: true }).count()).toBe(1)
  await dialog.getByRole('button', { name: '编辑模型 second-model', exact: true }).click()
  const editModel = page.getByRole('dialog', { name: '编辑模型设置', exact: true })
  expect(await editModel.locator('details').getAttribute('open')).toBeNull()
  expect(await editModel.getByRole('button', { name: '删除模型', exact: true }).count()).toBe(0)
  expect(await editModel.locator('[data-dsh-modal-part="body"]').evaluate(node => getComputedStyle(node).scrollbarWidth)).toBe('none')
  await page.screenshot({ path: join(artifacts, 'model-editor-collapsed.png'), fullPage: true })
  await editModel.locator('summary').click()
  await editModel.getByRole('checkbox', { name: '支持视觉输入', exact: true }).check()
    expect(await editModel.getByRole('switch', { name: '智能配置', exact: true }).count()).toBe(1)
  expect(await editModel.getByRole('checkbox', { name: '视频', exact: true }).isDisabled()).toBe(true)
  await editModel.getByRole('textbox', { name: '推理参数映射', exact: true }).fill('{invalid')
  expect(await editModel.getByRole('button', { name: '保存', exact: true }).isDisabled()).toBe(true)
  await editModel.getByRole('textbox', { name: '推理参数映射', exact: true }).fill('{"off":null,"low":"low","high":"high"}')
  await editModel.locator('[data-dsh-modal-part="body"]').evaluate(node => { node.scrollTop = 0 })
  expect(await editModel.getByRole('textbox', { name: '模型 ID', exact: true }).isVisible()).toBe(true)
  const editorBounds = await editModel.boundingBox()
  const footerBounds = await editModel.locator('[data-dsh-modal-part="footer"]').boundingBox()
  expect(footerBounds.y + footerBounds.height).toBeLessThanOrEqual(editorBounds.y + editorBounds.height)
  await page.screenshot({ path: join(artifacts, 'model-editor.png'), fullPage: true })
  await editModel.getByRole('button', { name: '保存', exact: true }).click()
  await dialog.getByText('视觉', { exact: true }).waitFor()
  await dialog.getByRole('switch', { name: '禁用模型 second-model', exact: true }).click()
  await dialog.getByText('已自动保存', { exact: true }).waitFor()
  expect(await dialog.getByRole('button', { name: '测试模型 second-model', exact: true }).isDisabled()).toBe(true)
  await page.reload()
  await openModels()
  expect(await dialog.getByRole('switch', { name: '启用模型 second-model', exact: true }).getAttribute('aria-checked')).toBe('false')
  expect(await dialog.getByText('视觉', { exact: true }).count()).toBe(1)
  await dialog.getByRole('button', { name: '编辑模型 second-model', exact: true }).click()
  expect(await editModel.locator('details').getAttribute('open')).toBeNull()
  await editModel.locator('summary').click()
  expect(JSON.parse(await editModel.getByRole('textbox', { name: '推理参数映射', exact: true }).inputValue())).toEqual({ off: null, low: 'low', high: 'high' })
  await editModel.getByRole('button', { name: '取消', exact: true }).click()
  await dialog.getByRole('switch', { name: '启用模型 second-model', exact: true }).click()
  await dialog.getByRole('button', { name: '测试模型 second-model', exact: true }).click()
  await page.locator('.tpcowork-model-feedback[data-kind="test"][data-state="success"]').waitFor()
  expect(await page.locator('.tpcowork-model-feedback').innerText()).toContain('自定义 API 测试 / second-model 连接成功')
  expect(await dialog.locator('.tpcowork-model-test-result').count()).toBe(0)
  const feedbackBox = await page.locator('.tpcowork-model-feedback').boundingBox()
  expect(feedbackBox.height).toBe(48)
  const modelFrame = await dialog.locator('.tpcowork-model-settings').boundingBox()
  expect(feedbackBox.x).toBeGreaterThan(modelFrame.x)
  expect(feedbackBox.x + feedbackBox.width).toBeLessThanOrEqual(modelFrame.x + modelFrame.width - 15)
  expect(feedbackBox.y + feedbackBox.height).toBeLessThanOrEqual(modelFrame.y + modelFrame.height - 15)
  expect(feedbackBox.y + feedbackBox.height).toBeGreaterThan(modelFrame.y + modelFrame.height - 40)
  expect(await dialog.getByRole('button', { name: '测试模型 second-model', exact: true }).getAttribute('title')).toBe('测试模型')
  expect(await dialog.getByRole('button', { name: '测试模型 second-model', exact: true }).locator('[data-icon="unplug"] path').count()).toBe(6)
  await page.getByRole('button', { name: '关闭测试提示', exact: true }).click()
  expect(await page.locator('.tpcowork-model-feedback').count()).toBe(0)
  replyMode = 'test-fail'
  await dialog.getByRole('button', { name: '测试模型 second-model', exact: true }).click()
  await page.locator('.tpcowork-model-feedback[data-kind="test"][data-state="failure"]').waitFor()
  expect(await dialog.getByRole('button', { name: '测试模型 second-model', exact: true }).getAttribute('title')).toBe('测试模型')
  expect((await page.locator('.tpcowork-model-feedback').boundingBox()).height).toBe(48)
  await page.screenshot({ path: join(artifacts, 'model-test-feedback.png'), fullPage: true })
  replyMode = 'ok'
  await dialog.getByRole('switch', { name: '禁用模型 second-model', exact: true }).click()
  await dialog.getByText('已自动保存', { exact: true }).waitFor()
  await page.screenshot({ path: join(artifacts, 'provider-details.png'), fullPage: true })
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.waitForFunction(() => document.body.hasAttribute('data-ds-dark-theme'))
  await page.screenshot({ path: join(artifacts, 'provider-details-dark.png'), fullPage: true })
  await dialog.getByRole('button', { name: '添加供应商', exact: true }).click()
  await dialog.getByRole('textbox', { name: '供应商名称', exact: true }).fill('未完成的供应商')
  await dialog.getByRole('button', { name: editName, exact: true }).click()
  expect(await dialog.getByRole('textbox', { name: '供应商名称', exact: true }).count()).toBe(0)
  expect(await dialog.getByRole('textbox', { name: 'API 地址', exact: true }).inputValue()).toBe(`${apiRoot}/custom/v1`)
  await dialog.getByRole('button', { name: '选择供应商 资产DeepSeek', exact: true }).click()
  await page.locator('.tpcowork-managed-details input[aria-label="API 地址"]').waitFor()
  expect(await dialog.getByRole('textbox', { name: 'API 地址', exact: true }).inputValue()).toBe(`${apiRoot}/managed/v1`)
  await page.waitForFunction(() => document.querySelector('.tpcowork-managed-details input[aria-label="API 地址"]').readOnly)
  for (const label of ['取消', '保存']) expect(await dialog.getByRole('button', { name: label, exact: true }).count()).toBe(0)
  expect(await page.locator('.tpcowork-managed-details').getByRole('button', { name: /删除|移除/ }).count()).toBe(0)
  expect(await page.locator('.tpcowork-managed-details').innerText()).toContain('managed-model')
  expect(await dialog.getByText(/其余字段在 cordis.patch.yml/).count()).toBe(0)
  expect(await page.locator('.tpcowork-model-providers button').first().getAttribute('aria-label')).toBe('选择供应商 资产DeepSeek')
  expect(await page.locator('.tpcowork-managed-details [data-logo="deepseek"] svg').count()).toBe(1)
  await page.screenshot({ path: join(artifacts, 'managed-provider.png'), fullPage: true })
  const providerGeometry = () => page.locator('.tpcowork-managed-details').evaluate(detail => {
    const frame = detail.closest('.tpcowork-model-settings').getBoundingClientRect();
    return ['.tpcowork-provider-detail-heading', 'input[aria-label="API 地址"]', 'select[aria-label="API 协议"]', 'input[aria-label="API 密钥"]', '.tpcowork-model-list-heading', '.tpcowork-provider-model-row'].map(selector => {
      const box = detail.querySelector(selector).getBoundingClientRect();
      return [box.x - frame.x, box.y - frame.y, box.width, box.height].map(value => Math.round(value * 100) / 100);
    });
  });
  const managedGeometry = await providerGeometry();
  await dialog.getByRole('button', { name: editName, exact: true }).click()
  expect(await providerGeometry()).toEqual(managedGeometry)
  expect(await page.locator('.tpcowork-provider-detail-title [data-logo="provider"] svg').count()).toBe(1)
  expect(await dialog.getByRole('textbox', { name: 'API 地址', exact: true }).evaluate(input => input.readOnly)).toBe(false)
  expect(await dialog.getByRole('button', { name: '保存', exact: true }).count()).toBe(0)
  await page.setViewportSize({ width: 600, height: 900 })
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
  expect(overflow).toBe(false)
  await page.screenshot({ path: join(artifacts, 'provider-details-narrow.png'), fullPage: true })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await dialog.getByRole('button', { name: '供应商操作', exact: true }).click()
  await page.getByRole('menuitem', { name: '重命名', exact: true }).click()
  const rename = page.getByRole('dialog', { name: '重命名供应商', exact: true })
  await rename.getByRole('textbox', { name: '供应商名称', exact: true }).fill('重命名测试')
  await rename.getByRole('button', { name: '确定', exact: true }).click()
  await dialog.getByRole('button', { name: '选择供应商 重命名测试', exact: true }).waitFor()
  await page.reload()
  await openModels()
  await dialog.getByRole('button', { name: '选择供应商 重命名测试', exact: true }).click()
  expect(await dialog.getByRole('textbox', { name: 'API 地址', exact: true }).inputValue()).toBe(`${apiRoot}/custom/v1`)
  await dialog.getByRole('button', { name: '显示 API 密钥', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.tpcowork-editable-provider input[aria-label="API 密钥"]')?.value === 'sk-visible-test')
  await page.evaluate(() => window.dispatchEvent(new Event('blur')))
  expect(await dialog.getByLabel('API 密钥', { exact: true }).inputValue()).toBe('')
  await dialog.getByRole('button', { name: '供应商操作', exact: true }).click()
  await page.getByRole('menuitem', { name: '删除', exact: true }).click()
  await page.getByRole('dialog', { name: '删除供应商', exact: true }).getByRole('button', { name: '删除', exact: true }).click()
  await dialog.getByRole('button', { name: '选择供应商 重命名测试', exact: true }).waitFor({ state: 'detached' })
  expect(requests.some(request => request.url === '/custom/v1/chat/completions' && request.body?.model === 'second-model' && (request.body.max_tokens ?? request.body.max_completion_tokens) === 32)).toBe(true)
  expect(requests.some(request => request.url === '/custom/v1/models' && request.authorization === 'Bearer sk-visible-test')).toBe(true)
  expect(receivedFrames.join('')).not.toContain('sk-test-custom-api')
  expect(receivedFrames.join('')).not.toContain('sk-visible-test')
  expect(errors).toEqual([])
})

it('shows the managed provider from its independent tpcowork-core-model namespace', async () => {
  const { mkdtemp, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const temp = await mkdtemp(join(tmpdir(), 'tpcowork-managed-model-'))
  onTestFinished(() => rm(temp, { recursive: true, force: true }))
  const overlay = join(temp, 'model.yml')
  await writeFile(overlay, `- insert:
    - id: tpcowork-core-model
      name: '@tpcowork/dsh-core/model'
      config:
        providers:
          asset-deepseek:
            displayName: 资产DeepSeek
            api: openai-completions
            baseURL: https://example.test/intranet/v1
            models:
              - id: intranet-model
                contextWindow: 128000
                maxTokens: 8192
`)
  const hooks = registerHooks({ resolve(specifier, context, next) {
    return next(specifier.startsWith('file:') ? fileURLToPath(specifier) : specifier, context)
  } })
  onTestFinished(() => hooks.deregister())
  const scaffold = await launchWebScaffold({
    extraOverlayPath: [join(root, '../deepseek-harness/apps/web/tests/pin-browse-picker.overlay.yml'), overlay],
    profile: { hmr: false, packages: [
      { dir: join(root, 'plugins/tpcowork-ui'), enabled: true },
      { dir: join(root, 'plugins/tpcowork-core'), enabled: false },
    ] },
  })
  onTestFinished(() => scaffold.close())
  const browser = await chromium.launch({ executablePath: process.env.TPCOWORK_TEST_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
  onTestFinished(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })
  // Existing profiles have finished the first-run guide; first-run-guide.spec.mjs covers it.
  await page.addInitScript(() => localStorage.setItem('tpcowork.first-run-guide.v1', 'done'))
  page.setDefaultTimeout(60000)
  await page.goto(scaffold.authenticatedUrl)
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.getByRole('dialog', { name: '设置', exact: true }).getByRole('button', { name: '模型', exact: true }).click()
  await page.getByRole('button', { name: '选择供应商 资产DeepSeek', exact: true }).click()
  const details = page.locator('.tpcowork-managed-details')
  await details.getByRole('textbox', { name: 'API 地址', exact: true }).waitFor()
  expect(await details.getByRole('textbox', { name: 'API 地址', exact: true }).inputValue()).toBe('https://example.test/intranet/v1')
  expect(await details.innerText()).toContain('intranet-model')
  expect(await page.getByText(/其余字段在 cordis.patch.yml/).count()).toBe(0)
  expect(await details.getByRole('button', { name: '显示 API 密钥', exact: true }).count()).toBe(1)
  await mkdir(artifacts, { recursive: true })
  await page.screenshot({ path: join(artifacts, 'managed-independent-namespace.png'), fullPage: true })
})
