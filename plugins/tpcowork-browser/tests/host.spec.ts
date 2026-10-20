import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import Tools from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import * as Browser from '../src/host.js'

let context: Context | undefined
let directory: string | undefined
const originalSend = Object.getOwnPropertyDescriptor(process, 'send')
const originalConnected = Object.getOwnPropertyDescriptor(process, 'connected')
afterEach(async () => {
  await context?.fiber.dispose()
  for (const [key, value] of [['send', originalSend], ['connected', originalConnected]] as const) {
    if (value) Object.defineProperty(process, key, value)
    else Reflect.deleteProperty(process, key)
  }
  if (directory) await rm(directory, {recursive:true,force:true})
  vi.restoreAllMocks()
})

it('loads tools through a Cordis profile, observes policy and retracts tools on unload', async () => {
  directory = await mkdtemp(join(tmpdir(), 'dsh-browser-loader-'))
  const messages: {op:string; payload?:{sessionId?:string;command?:{method?:string}}}[] = []
  Object.defineProperty(process, 'connected', {configurable:true,value:true})
  Object.defineProperty(process, 'send', {configurable:true,value:(message: Record<string, unknown>, callback: (error?:Error)=>void) => {
    messages.push(message as never)
    queueMicrotask(() => process.emit('message', {...message, kind:'result', value: message.op === 'enable' ? {version:1} : message.op === 'disable' ? {} : {ok:true, tabs:[]}}, undefined))
    callback()
  }})
  const config = join(directory, 'cordis.yml')
  await writeFile(config, '- name: prompt\n- name: tools\n- name: fixtures\n- name: browser\n')
  context = new Context()
  context.baseUrl = pathToFileURL(directory).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['prompt', SystemPrompt], ['tools', Tools], ['browser', Browser],
    ['fixtures', {apply(ctx:Context) {
      ctx.provide('workingDirectory', {get:()=>directory} as never)
      ctx.provide('attachments', {saveImage:()=>{throw new Error('Unexpected image')}} as never)
    }}],
  ])
  context.loader.internal = {version:'v2',import:async (id:string)=>{
    if (!modules.has(id)) throw new Error(`Missing test module ${id}`)
    return modules.get(id)
  }} as never
  await context.loader.create({name:'cordis:include', config:{path:pathToFileURL(config).href}})
  await context.loader.await()
  expect(context.tools.get('browser_tabs')).toBeDefined()
  const agent = {session:Session.create(SessionId('browser-owner'))}
  const invoke = (command:unknown, name = 'browser_tabs') => context!.tools.execute({agent:agent as never,signal:new AbortController().signal,callId:ToolCallId('browser-test'),name,arguments:{command}})
  const result = await invoke({method:'list'})
  expect(result.isError).toBe(false)
  expect(result.content).toMatchSnapshot('browser tabs model output')
  expect(messages.at(-1)).toMatchObject({op:'command',payload:{sessionId:'browser-owner',command:{method:'list'}}})
  // The real Step model encoded this nested object as JSON in the failed desktop turns.
  expect((await invoke('{"method":"list"}')).isError).toBe(false)
  expect(messages.at(-1)).toMatchObject({op:'command',payload:{command:{method:'list'}}})
  expect((await invoke('{"method":"navigate","url":"https://juejin.cn"}', 'browser_navigate')).isError).toBe(false)
  expect(messages.at(-1)).toMatchObject({op:'command',payload:{command:{method:'navigate',url:'https://juejin.cn'}}})
  expect(context.tools.get('browser_navigate')!.presentCall!({command:'{"method":"navigate","url":"https://juejin.cn"}'})).toMatchObject({title:'browser_navigate: navigate'})
  expect(context.tools.get('browser_tabs')!.presentCall!({command:'not JSON'})).toMatchObject({title:'browser_tabs'})
  const beforeInvalid = messages.length
  for (const command of ['not JSON', 'null', '[]', '{"method":"navigate","url":"https://juejin.cn"}', '{"method":"list","unexpected":true}']) {
    expect((await invoke(command)).isError).toBe(true)
  }
  expect(messages.length).toBe(beforeInvalid)
  expect((await context.systemPrompt.assemble()).sections.find(section => section.name === 'tpcowork-browser:usage')?.text).toContain('Use an external browser only when the user explicitly requests one.')
  expect((await invoke({method:'navigate',url:'https://example.com'})).isError).toBe(true)
  const count = messages.length
  const off = context.on('tools/pre-execute', async () => ({kind:'deny',reason:'Browser blocked by test policy'}))
  expect((await invoke({method:'newTab'})).isError).toBe(true)
  expect(messages.length).toBe(count)
  off()
  const entry = [...context.loader.entries()].find(entry=>entry.options.name==='browser')!
  await entry.update({disabled:true})
  expect(context.tools.get('browser_tabs')).toBeUndefined()
  expect((await context.systemPrompt.assemble()).sections.some(section => section.name === 'tpcowork-browser:usage')).toBe(false)
  expect(messages.at(-1)?.op).toBe('disable')
})
