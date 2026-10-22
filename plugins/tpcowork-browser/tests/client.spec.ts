// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as React from 'react'
import * as ReactDom from 'react-dom'
import * as jsx from 'react/jsx-runtime'
import { render, fireEvent, cleanup } from '@testing-library/react'
import * as stores from '@deepseek-ai/dsh-client-store'
import { ClientRoster, createClientTest, webApp } from '../../../../deepseek-harness/packages/test-support/client-runtime/src/assembly/index.ts'
import * as CordisUI from '../../../../deepseek-harness/packages/extensions/ui-cordis/src/client/index.ts'
import { BrowserClient } from '../src/client-controller.js'

const ID = '@tpcowork/dsh-browser'
let plugin
const modules = { react: React, 'react-dom': ReactDom, 'react/jsx-runtime': jsx, '@deepseek-ai/dsh-client-store': stores }
window.__ModuleLoader__ = { load: registration => { plugin = registration.factory(name => {
  if (!(name in modules)) throw new Error(`Unexpected client external ${name}`)
  return modules[name]
}) } }
// Load the distributable through the same factory used by the desktop Client Loader.
new Function(readFileSync(resolve(import.meta.dirname, '..', process.env.BROWSER_TEST_OUTPUT ?? 'lib', 'client.js'), 'utf8'))()
delete window.__ModuleLoader__
const assembled = createClientTest({ roster: ClientRoster.of([...webApp.rows, {name:ID,inject:[],immediately:false}]), provide: {[ID]:plugin, '@deepseek-ai/dsh-client-ui-cordis':CordisUI} })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

assembled('loads the browser in the real client roster, renders its durable result and retracts on unload', async ({ start }) => {
  const listeners = new Set()
  vi.stubGlobal('dshDesktop', { browserAutomation: {
    subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn) },
    request: async () => ({enabled:true,tabs:[],downloads:[],permissions:{},requests:[]}),
  } })
  const c = await start()
  expect(c.ctx.sidebarRightTabs.get('browser').id).toBe(ID)
  expect(c.ctx.slots.entries('tool.call.toolview').filter(row=>row.locale==='tpcoworkBrowser')).toHaveLength(9)
  const entry = c.ctx.slots.entries('tool.call.toolview').find(row => row.options.key==='browser_screenshot')
  const openFile = vi.fn()
  const view = render(React.createElement(entry.component, {
    phase:'result',toolName:'browser_screenshot',sessionId:'one',
    block:{isError:false,meta:{path:'evidence/page.png',page:{tabId:'native',url:'https://example.com/'}},content:[{type:'text',text:'{"ok":true}'}]},
    useBrowser: select=>select({tabs:[]}),openFile,t:c.ctx.locale.bind('tpcoworkBrowser'),
  }))
  expect(view.container.textContent).toMatchSnapshot('browser screenshot result card')
  fireEvent.click(view.getByRole('button'))
  expect(openFile).toHaveBeenCalledWith('evidence/page.png')
  view.unmount()
  await c.reload(ID)
  expect(listeners.size).toBe(1)
  expect(document.querySelectorAll(`style[data-plugin="${ID}"]`)).toHaveLength(1)
  await c.unload(ID)
  expect(listeners.size).toBe(0)
  expect(c.ctx.sidebarRightTabs.get('browser')?.id).not.toBe(ID)
  expect(c.ctx.slots.entries('tool.call.toolview').some(row=>row.locale==='tpcoworkBrowser')).toBe(false)
  expect(document.querySelectorAll(`style[data-plugin="${ID}"]`)).toHaveLength(0)
}, 60000)

function controller() {
  const mounted = stores.createSnapshotStore('one')
  const openTabs = stores.createSnapshotStore([{tabId:'ui',sessionId:'one'}])
  const sidebarRight = {mounted,openTabs,focus:vi.fn(),openTab:vi.fn(),close:vi.fn(),isExpanded:()=>true,toggleExpanded:vi.fn()}
  const request = vi.fn(async op => op==='snapshot' ? {enabled:true,tabs:[{id:'native',sessionId:'one'}]} : {})
  const stop = vi.fn()
  const client = new BrowserClient({sidebarRight},{request,subscribe:()=>stop})
  return {client,sidebarRight,request,stop}
}

it('keeps guests across view remount and plugin unload, and closes them on tab removal', async () => {
  const {client,sidebarRight,request,stop} = controller()
  const signal = new AbortController()
  const value = {uiId:'ui',sessionId:'one',nativeId:'native',element:document.body,signal:signal.signal,save:vi.fn()}
  await client.mount(value)
  client.unmount('ui')
  await client.mount(value)
  expect(request.mock.calls.filter(([op])=>op==='humanOpen')).toHaveLength(0)
  sidebarRight.openTabs.set([])
  signal.abort()
  await vi.waitFor(()=>expect(request).toHaveBeenCalledWith('close',{sessionId:'one',tabId:'native'}))
  client.dispose()
  expect(stop).toHaveBeenCalledOnce()

  const second=controller()
  const unload=new AbortController()
  await second.client.mount({...value,signal:unload.signal})
  second.client.dispose()
  unload.abort()
  expect(second.request.mock.calls.some(([op])=>op==='close')).toBe(false)
})

it('closes a page when its UI tab disappears during asynchronous creation', async () => {
  const {client,sidebarRight,request} = controller()
  let created
  request.mockImplementation(async op => op==='humanOpen' ? new Promise(resolve=>{created=resolve}) : op==='snapshot' ? {enabled:true,tabs:[]} : {})
  const signal = new AbortController()
  const mounting=client.mount({uiId:'ui',sessionId:'one',element:document.body,signal:signal.signal,save:vi.fn()})
  await vi.waitFor(()=>expect(created).toBeTypeOf('function'))
  sidebarRight.openTabs.set([]); signal.abort(); created({tabId:'new-native'})
  await mounting
  expect(request).toHaveBeenCalledWith('close',{sessionId:'one',tabId:'new-native'})
  expect(client.state.getSnapshot().bindings).toEqual({})
  client.dispose()
})

it('defers background reveals and never focuses a removed UI binding', () => {
  const {client,sidebarRight} = controller()
  client.receive({kind:'activate',payload:{visible:true,tabId:'background',sessionId:'two'}})
  expect(sidebarRight.openTab).not.toHaveBeenCalled()
  client.state.update(draft=>{draft.bindings.ui='native'})
  sidebarRight.openTabs.set([])
  client.reveal('one','native')
  expect(sidebarRight.focus).not.toHaveBeenCalled()
  expect(sidebarRight.openTab).toHaveBeenCalledWith('browser',{params:{nativeId:'native'}})
  client.dispose()
})
