import { registerHooks } from 'node:module'
import { createServer } from 'node:http'
import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { expect, it, onTestFinished } from 'vitest'
import { launchWebScaffold } from '../../../deepseek-harness/apps/web/tests/scaffold.ts'
import { artifactPeers } from '../../plugins/tpcowork-toolbox/tests/artifact-peers.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const toolbox = join(root, 'plugins/tpcowork-toolbox')

it('lets a skill script call an internal API as the user signed in to TP Cowork, without ever seeing the token', async () => {
  const requireUrls = registerHooks({ resolve(specifier, context, next) {
    return next(specifier.startsWith('file:') ? fileURLToPath(specifier) : specifier, context)
  } })
  onTestFinished(() => requireUrls.deregister())
  const hook = await artifactPeers()
  onTestFinished(() => hook.deregister())

  // A stand-in Hub (users:me) and internal CRM API; both identify the caller from the Bearer token only.
  const users = { 'token-zhangsan': { _id: 'u1', username: 'zhangsan', name: '张三' } }
  const crmCalls = []
  const server = createServer((request, response) => {
    let body = ''
    request.on('data', chunk => { body += chunk })
    request.on('end', () => {
      const user = users[String(request.headers.authorization ?? '').replace(/^Bearer /u, '')]
      if (!user) { response.writeHead(401); response.end(); return }
      response.writeHead(200, { 'content-type': 'application/json' })
      if (request.url === '/tpcoworkapi/convex/query' && JSON.parse(body).path === 'users:me') { response.end(JSON.stringify(user)); return }
      if (request.url?.startsWith('/crm/')) { crmCalls.push({ user: user.username, url: request.url }); response.end(JSON.stringify({ owner: user.username, customers: ['客户A'] })); return }
      response.end('{}')
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  onTestFinished(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve) }))
  const hub = `http://127.0.0.1:${server.address().port}`

  const bundle = await mkdtemp(join(tmpdir(), 'skill-api-auth-'))
  onTestFinished(() => rm(bundle, { recursive: true, force: true }))
  await writeFile(join(bundle, 'package.json'), JSON.stringify({ name: 'skill-api-auth-fixture', version: '1.0.0', dsh: { bundle: { patch: 'cordis.patch.yml' } } }))
  await writeFile(join(bundle, 'cordis.patch.yml'), JSON.stringify([{ id: 'tpcowork-toolbox', config: { skills: { userRoot: join(bundle, 'skills') }, tpcoworkhub: { endpoint: hub, apis: { crm: `${hub}/crm` } } } }]))
  const scaffold = await launchWebScaffold({ profile: { hmr: false, packages: [
    ...['tpcowork-experts', 'tpcowork-toolbox'].map(name => ({ dir: join(root, 'plugins', name), enabled: true })), { dir: bundle, enabled: true },
  ] } })
  onTestFinished(() => scaffold.close())
  const hubService = () => scaffold.ctx.get('toolboxTpcoworkHub')
  await expect.poll(() => hubService() !== undefined && 'DSH_TPCOWORK_API_URL' in scaffold.ctx.shellEnv.collect({}), { timeout: 30000 }).toBe(true)

  // Exactly what the model's shell gets: the relay URL, its key and the Python launcher, never the token.
  const environment = () => scaffold.ctx.shellEnv.collect({})
  expect(Object.keys(environment()).filter(key => key.startsWith('DSH_TPCOWORK_')).sort()).toEqual(['DSH_TPCOWORK_API_KEY', 'DSH_TPCOWORK_API_URL', 'DSH_TPCOWORK_PYTHON'])
  const python = environment().DSH_TPCOWORK_PYTHON
  const whoami = join(toolbox, 'resources/skills/tpcowork-api-auth/scripts/whoami.py')
  const run = async (args = [whoami]) => {
    try { return JSON.parse((await promisify(execFile)(python, args, { env: { ...process.env, ...environment() } })).stdout) }
    catch (error) { return JSON.parse(error.stdout) }
  }

  // Signed out: the demo asks the user to sign in.
  expect(await run()).toMatchObject({ signedIn: false })
  // Sign in the way the desktop does after the website hands over the login.
  await hubService().acceptBrowserSession({ token: 'token-zhangsan' })
  expect(await run()).toEqual({ signedIn: true, id: 'u1', username: 'zhangsan', name: '张三' })
  expect(Object.values(environment()).join('\n')).not.toContain('token-zhangsan')

  // A skill's own call to a registered internal API arrives as 张三.
  const crm = join(bundle, 'crm.py')
  await writeFile(crm, `import json, sys\nsys.path.insert(0, ${JSON.stringify(join(toolbox, 'resources/skills/tpcowork-api-auth/scripts'))})\nfrom tpcowork_api import call\nprint(json.dumps(call("crm", "/customers", params={"mine": 1})[1], ensure_ascii=False))\n`)
  expect(await run([crm])).toEqual({ owner: 'zhangsan', customers: ['客户A'] })
  expect(crmCalls).toEqual([{ user: 'zhangsan', url: '/crm/customers?mine=1' }])

  // Signing out stops it at once.
  await hubService().logout()
  expect(await run()).toMatchObject({ signedIn: false })
})
