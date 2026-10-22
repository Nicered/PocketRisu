/**
 * A fake risuai.xyz account (sv.risuai.xyz account API) for the account import
 * tests. The responses follow what the real server returned for a test account
 * (2026-10-22): database and assets from /api/account/read/<hex key>, 204 for
 * a key the account does not have, 403 "Bad Login" for a wrong token, cold
 * storage items gzipped from /hub/account/coldstorage, and a login page that
 * posts {msg: {id, token, data: {vaild: true}}} to its parent three times.
 *
 * The account database is written the way upstream writes it: RisuSave blocks,
 * one character stored as a REMOTE block, one moved to cold storage (its
 * emotion image is listed only inside the cold item), and the RisuAI login
 * kept in `account`.
 */
import { createHash } from 'node:crypto'
import http from 'node:http'
import * as fflate from 'fflate'

const MAGIC_RISUSAVE = Buffer.from([82, 73, 83, 85, 83, 65, 86, 69, 0]) // 'RISUSAVE\0'
const COLD_HEADER = '\uEF01COLDSTORAGE\uEF01'

/** One gzipped RisuSave block, as upstream encodes it. */
export function block(type: number, name: string, content: unknown) {
  const nameBuf = Buffer.from(name, 'utf-8')
  const data = Buffer.from(fflate.gzipSync(Buffer.from(typeof content === 'string' ? content : JSON.stringify(content), 'utf-8')))
  const head = Buffer.alloc(3 + nameBuf.length + 4)
  head[0] = type
  head[1] = 1
  head[2] = nameBuf.length
  nameBuf.copy(head, 3)
  head.writeUInt32LE(data.length, 3 + nameBuf.length)
  return Buffer.concat([head, data])
}

const gzipJson = (value: unknown) => Buffer.from(fflate.gzipSync(Buffer.from(JSON.stringify(value), 'utf-8')))

export function assetFor(seed: number) {
  const data = Buffer.from(`fake-png-${seed}-${'x'.repeat(seed * 37)}`)
  return { key: `assets/${createHash('sha256').update(data).digest('hex')}.png`, data }
}

export interface FakeAccountFault {
  /** Matched against the account key (read) or cold id (coldstorage). */
  key: string
  status: number
  /** How many requests get this answer before the real one. */
  times: number
  /** Optional replacement body, e.g. bytes that do not match the asset hash. */
  body?: Buffer
  headers?: Record<string, string>
}

export interface FakeAccount {
  id: string
  token: string
  items: Map<string, Buffer>
  cold: Map<string, Buffer>
  faults: FakeAccountFault[]
  /** Reads (database, assets, remotes, cold) answered so far, in order. */
  log: Array<{ path: string; key: string; status: number }>
  /** After this many answered reads the token stops working (403). */
  expireAfter: number | null
  expected: {
    characterNames: string[]
    assets: Array<{ key: string; data: Buffer }>
    missingAsset: string
    coldChatMessages: string[]
    pluginStorage: Record<string, unknown>
  }
}

export function createFakeAccount(): FakeAccount {
  const a1 = assetFor(1), a2 = assetFor(2), a3 = assetFor(3), a4 = assetFor(4), a5 = assetFor(5)
  const missing = assetFor(99)
  const coldChatId = '7a1c3a2e-1111-4c4c-8a8a-000000000001'
  const indexId = '7a1c3a2e-2222-4c4c-8a8a-000000000002'
  const bigId = '7a1c3a2e-3333-4c4c-8a8a-000000000003'
  const coldCharacterId = '7a1c3a2e-4444-4c4c-8a8a-000000000004'

  const characterA = {
    chaId: 'acc-char-a', name: 'Account A', type: 'character', desc: '', firstMessage: '', chatPage: 0,
    image: a1.key,
    emotionImages: [['smile', a2.key]],
    additionalAssets: [['background', a3.key, 'png']],
    ccAssets: [{ type: 'icon', uri: a1.key, name: 'main', ext: 'png' }],
    chats: [
      { id: 'chat-a1', name: 'A1', note: '', localLore: [], message: [{ role: 'user', data: 'hello from the account' }, { role: 'char', data: 'hi there' }] },
      { id: 'chat-a2', name: 'A2', note: '', localLore: [], message: [{ role: 'char', data: COLD_HEADER + coldChatId }] },
    ],
  }
  const characterB = {
    chaId: 'acc-char-b', name: 'Account B', type: 'character', desc: '', firstMessage: '', chatPage: 0,
    image: missing.key,
    chats: [{ id: 'chat-b1', name: 'B1', note: '', localLore: [], message: [{ role: 'user', data: 'remote character chat' }] }],
  }
  const characterC = {
    chaId: 'acc-char-c', name: 'Account C', type: 'character', desc: 'kept in cold storage', firstMessage: '', chatPage: 0,
    image: a1.key,
    emotionImages: [['sad', a5.key]],
    chats: [{ id: 'chat-c1', name: 'C1', note: '', localLore: [], message: [{ role: 'char', data: 'cold character chat' }] }],
  }
  // What upstream leaves in the database after moving a character to cold storage.
  const characterCStub = {
    type: 'character', image: a1.key, name: characterC.name, chaId: characterC.chaId, chatPage: 0, firstMsgIndex: 0,
    chats: [{ message: [{ time: 1, data: '', role: 'char' }], note: '', name: '', localLore: [] }],
    coldstorage: coldCharacterId, coldStoragedChats: [],
  }
  const id = 'fake-user'
  const token = 'fake-account-token-0001'
  const root = {
    characters: [], botPresets: [], botPresetsId: 0, selectedCharacter: 0, moduleIntergration: '',
    personas: [{ name: 'Account persona', icon: a4.key, personaPrompt: '' }],
    pluginCustomStorage: { _coldpluginIndex: indexId },
    account: { id, token, data: { vaild: true } },
    didFirstSetup: true,
  }
  const database = Buffer.concat([
    MAGIC_RISUSAVE,
    block(1, 'root', root),
    block(9, 'plugins', []),
    block(11, 'pluginStorage', { _coldpluginIndex: indexId }),
    block(2, characterA.chaId, characterA),
    block(6, characterB.chaId, { v: 1, type: 2, name: characterB.chaId }),
    block(2, characterCStub.chaId, characterCStub),
    block(0, 'config', { version: 1 }),
  ])

  const items = new Map<string, Buffer>([
    ['database/database.bin', database],
    [`remotes/${characterB.chaId}.local.bin`, Buffer.from(JSON.stringify(characterB), 'utf-8')],
    [a1.key, a1.data], [a2.key, a2.data], [a3.key, a3.data], [a4.key, a4.data], [a5.key, a5.data],
  ])
  const cold = new Map<string, Buffer>([
    [coldChatId, gzipJson({ message: [{ role: 'char', data: 'cold message one' }, { role: 'user', data: 'cold message two' }] })],
    [indexId, gzipJson({ type: 'risu-plugin-storage-index', version: 1, entries: [{ k: 'small', s: JSON.stringify('small value') }, { k: 'big', l: bigId }], trash: [] })],
    [bigId, gzipJson({ nested: ['big', 'plugin', 'value'] })],
    [coldCharacterId, gzipJson({ character: characterC })],
  ])

  return {
    id, token, items, cold, faults: [], log: [], expireAfter: null,
    expected: {
      characterNames: ['Account A', 'Account B', 'Account C'],
      assets: [a1, a2, a3, a4, a5],
      missingAsset: missing.key,
      coldChatMessages: ['cold message one', 'cold message two'],
      pluginStorage: { small: 'small value', big: { nested: ['big', 'plugin', 'value'] } },
    },
  }
}

export interface FakeResponse {
  status: number
  headers: Record<string, string>
  body: Buffer | null
}

const LOGIN_PAGE = (account: FakeAccount) => `<!DOCTYPE html>
<html><body>
<form id="login"><h1>Login with Risu Account</h1>
<label>ID <input id="id" name="id"></label>
<label>Password <input type="password" id="password" name="password"></label>
<button type="submit">Login</button></form>
<script>
document.getElementById('login').addEventListener('submit', (e) => {
  e.preventDefault()
  const msg = { msg: { data: { vaild: true }, token: ${JSON.stringify(account.token)}, id: ${JSON.stringify(account.id)} } }
  for (let i = 0; i < 3; i++) window.parent.postMessage(msg, '*')
  document.body.textContent = 'Logged in'
})
</script>
</body></html>`

function takeFault(account: FakeAccount, key: string): FakeAccountFault | null {
  const fault = account.faults.find((f) => f.key === key && f.times > 0)
  if (!fault) return null
  fault.times -= 1
  return fault
}

/** Answers one request the way the account API does. */
export function handleFakeAccountRequest(account: FakeAccount, method: string, url: string, headers: Record<string, string | undefined>): FakeResponse {
  const { pathname } = new URL(url, 'http://fake')
  if (method === 'GET' && pathname === '/hub/login') {
    return { status: 200, headers: { 'content-type': 'text/html' }, body: Buffer.from(LOGIN_PAGE(account)) }
  }
  if (pathname === '/api/account/getsessionnumber') {
    return { status: 200, headers: { 'content-type': 'application/json' }, body: Buffer.from('{"sessionNumber":1}') }
  }

  let key: string
  let kind: 'read' | 'cold'
  if (pathname.startsWith('/api/account/read/')) {
    kind = 'read'
    key = Buffer.from(decodeURIComponent(pathname.slice('/api/account/read/'.length)).split('|')[0], 'hex').toString('utf-8')
    if (headers['x-risu-key'] !== key) return { status: 400, headers: {}, body: Buffer.from('key mismatch') }
  } else if (pathname === '/hub/account/coldstorage') {
    kind = 'cold'
    key = headers['x-risu-key'] ?? ''
  } else {
    return { status: 404, headers: {}, body: Buffer.from('not found') }
  }

  const answer = (response: FakeResponse) => {
    account.log.push({ path: pathname, key, status: response.status })
    return response
  }
  if (account.expireAfter !== null && account.log.filter((e) => e.status !== 403).length >= account.expireAfter) {
    account.token = `${account.token}-renewed`
    account.expireAfter = null
  }
  if (headers['x-risu-auth'] !== account.token) {
    return answer({ status: 403, headers: { 'content-type': 'text/plain' }, body: Buffer.from('Bad Login') })
  }
  const fault = takeFault(account, key)
  if (fault) {
    return answer({ status: fault.status, headers: fault.headers ?? {}, body: fault.body ?? Buffer.from(`fault ${fault.status}`) })
  }
  const data = kind === 'read' ? account.items.get(key) : account.cold.get(key)
  if (!data) {
    return answer(kind === 'read' ? { status: 204, headers: {}, body: null } : { status: 404, headers: {}, body: Buffer.from('not found') })
  }
  const extra: Record<string, string> = key.startsWith('database/') ? { 'x-body-size': String(data.length) } : {}
  return answer({ status: 200, headers: extra, body: data })
}

/** In-process fetch for unit tests. */
export function fakeAccountFetch(account: FakeAccount): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers: Record<string, string> = {}
    new Headers(init?.headers).forEach((value, name) => { headers[name] = value })
    const res = handleFakeAccountRequest(account, init?.method ?? 'GET', String(input), headers)
    return new Response(res.body && res.status !== 204 ? new Uint8Array(res.body) : null, { status: res.status, headers: res.headers })
  }) as typeof fetch
}

export interface FakeAccountServer {
  url: string
  close: () => Promise<void>
}

/** The same answers over HTTP, for spawned servers and real browsers. */
export async function startFakeAccountServer(account: FakeAccount, port = 0): Promise<FakeAccountServer> {
  const server = http.createServer((req, res) => {
    const headers: Record<string, string | undefined> = {}
    for (const [name, value] of Object.entries(req.headers)) headers[name] = Array.isArray(value) ? value[0] : value
    const answer = handleFakeAccountRequest(account, req.method ?? 'GET', req.url ?? '/', headers)
    res.writeHead(answer.status, answer.headers)
    res.end(answer.body ?? undefined)
  })
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve))
  const address = server.address()
  const actualPort = typeof address === 'object' && address ? address.port : port
  return {
    url: `http://127.0.0.1:${actualPort}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
}
