import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { test } from 'node:test'
import { upstreamCss } from '../../plugins/tpcowork-ui/src/upstream-css.js'

for (const sourcePath of [
  '/workspace/ui-sidebar/src/client/SidebarRoot.module.css.mjs',
  String.raw`D:\a\tp-cowork\deepseek-harness\packages\client\ui-sidebar\src\client\SidebarRoot.module.css.mjs`,
]) {
  test(`reads shipped CSS and class names from ${sourcePath}`, async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'tpcowork-css-'))
    t.after(() => rm(root, { recursive: true, force: true }))
    await mkdir(join(root, 'lib'))
    await writeFile(join(root, 'lib/client.js'), [
      '//#region \\0dsh-css:' + sourcePath,
      'const css = ".sidebar_123 { display: flex; }";',
      'var SidebarRoot_module_css_default = {"sidebar":"sidebar_123"};',
      '//#endregion',
    ].join('\r\n'))
    assert.deepEqual(await upstreamCss(pathToFileURL(join(root, 'src/client/SidebarRoot.module.css'))), {
      css: '.sidebar_123 { display: flex; }', classes: { sidebar: 'sidebar_123' },
    })
  })
}
