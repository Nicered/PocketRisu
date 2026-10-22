/**
 * Chat bodies the chat store holds ahead of disk must survive every rebuild
 * of that store. Right after a restart or a backup import the database cache
 * is cold; a body saved then sits only in fullChatStore until the debounced
 * persist, and the first request that cold-loaded the cache rebuilt the
 * store from disk and dropped it. A chat whose body arrives before the patch
 * that adds its entry has no copy on disk at all.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import { fileURLToPath } from 'node:url'
import { writeFile, rm, access } from 'node:fs/promises'
import path from 'node:path'
import { Packr } from 'msgpackr'
import { spawnServer, type ServerHandle } from './helpers/spawnServer.js'
import { createClient, type RisuClient } from './helpers/client.js'
import { createSeedBackup } from './helpers/seed.js'
import { normalizeBackup } from './helpers/normalize.js'

const utils = require('../../server/node/utils.cjs') as typeof import('../../server/node/utils.cjs')

const MAGIC_RAW = Buffer.from([0, 82, 73, 83, 85, 83, 65, 86, 69, 0, 7])
const packr = new Packr({ useRecords: false })
const encode = (data: unknown) => new Uint8Array(Buffer.concat([MAGIC_RAW, packr.encode(data)]))

const DB_KEY_HEX = Buffer.from('database/database.bin').toString('hex')
const CHA = 'test-char-0'
const CHAT = 'chat-0-0'

let srv: ServerHandle
let client: RisuClient

beforeAll(async () => {
  const preloads = ['slow-decode-preload.cjs', 'fail-db-persist-preload.cjs', 'fail-import-swap-preload.cjs']
    .map((name) => `--require ${JSON.stringify(fileURLToPath(new URL(`./helpers/${name}`, import.meta.url)))}`)
  srv = await spawnServer({ env: { NODE_OPTIONS: preloads.join(' ') } })
  client = await createClient(srv.port, srv.password)
})
afterAll(async () => { await srv?.cleanup() })

// Test-only switches read by the preloads above.
async function withFlag<T>(name: string, run: () => Promise<T>): Promise<T> {
  const flag = path.join(srv.cwd, name)
  await writeFile(flag, '')
  try {
    return await run()
  } finally {
    await rm(flag, { force: true })
  }
}

// An import leaves the server as a restart does: no database cache, chat
// store built from disk.
async function coldStart(messagesPerChat = 2) {
  const result = await client.importBackup(createSeedBackup({ characterCount: 1, messagesPerChat }))
  expect(result.ok).toBe(true)
}

async function getChat(chatId = CHAT, index = 0) {
  const res = await client.fetch(`/api/chat-content/${CHA}/${index}`, { headers: { 'x-chat-id': chatId } })
  if (res.status !== 200) return { status: res.status, chat: null as any }
  return { status: 200, chat: await utils.decodeRisuSave(Buffer.from(await res.arrayBuffer())) as any }
}

async function lastMessage(chatId = CHAT, index = 0) {
  const { status, chat } = await getChat(chatId, index)
  expect(status).toBe(200)
  return chat.message.at(-1).data
}

async function postChat(chat: any, chatId = CHAT, index = 0) {
  const res = await client.fetch(`/api/chat-content/${CHA}/${index}`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream', 'x-chat-id': chatId },
    body: encode(chat),
  })
  expect(res.status).toBe(200)
}

async function saveChatWith(text: string) {
  const { chat } = await getChat()
  await postChat({ ...chat, message: [...chat.message, { role: 'user', data: text }] })
}

// A chat created on the client: its body goes up first, its entry in the
// database only with the patch that follows.
const NEW = 'chat-new'
async function postNewChat(text: string) {
  await postChat({ id: NEW, name: 'New', message: [{ role: 'user', data: text }], note: '', localLore: [] }, NEW, 1)
}

function patch(ops: unknown[], expectedHash: string) {
  return client.fetch('/api/patch', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'file-path': DB_KEY_HEX },
    body: JSON.stringify({ patch: ops, expectedHash }),
  })
}

const stalePatch = () => patch([], 'stale')

async function readDb() {
  const res = await client.fetch('/api/read', { headers: { 'file-path': DB_KEY_HEX } })
  expect(res.status).toBe(200)
  return utils.normalizeJSON(await utils.decodeRisuSave(Buffer.from(await res.arrayBuffer()))) as any
}

async function addNewChatEntry() {
  const db = await readDb()
  const res = await patch([{ op: 'add', path: '/characters/0/chats/1', value: { id: NEW, name: 'New', _stub: true } }], utils.calculateHash(db).toString(16))
  expect(res.status).toBe(200)
}

async function lastMessageOnDisk(chatId = CHAT) {
  // Export flushes the pending persist and reads database.bin from disk.
  const { raw } = normalizeBackup(await client.exportBackup()) as any
  const chat = raw.characters.find((c: any) => c.chaId === CHA).chats.find((c: any) => c.id === chatId)
  return chat?.message.at(-1).data
}

describe('chat body saved while the database cache is cold', () => {
  test('survives the cold load of the first /api/patch', async () => {
    await coldStart()
    await saveChatWith('saved before the first patch')

    // The client's patch after a restart carries its old hash: 409, but the
    // server cold-loads the cache first.
    expect((await stalePatch()).status).toBe(409)

    expect(await lastMessage()).toBe('saved before the first patch')
    expect(await lastMessageOnDisk()).toBe('saved before the first patch')
  })

  test('survives any other request that cold-loads the cache', async () => {
    await coldStart()
    await saveChatWith('saved before a manifest update')

    // Loads the cache before it finds the owner missing.
    const update = await client.fetch('/api/asset-manifests/owner/character/missing-owner', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(update.ok).toBe(false)

    expect(await lastMessage()).toBe('saved before a manifest update')
    expect(await lastMessageOnDisk()).toBe('saved before a manifest update')
  })

  test('a new chat saved before the first patch keeps its body once the client adds it to the database', async () => {
    await coldStart()
    await postNewChat('first message of a new chat')
    expect((await stalePatch()).status).toBe(409)

    await addNewChatEntry()

    expect(await lastMessage(NEW, 1)).toBe('first message of a new chat')
    expect(await lastMessageOnDisk(NEW)).toBe('first message of a new chat')
  })

  test('survives a cold load that starts while another request is still flushing', async () => {
    await coldStart()
    await saveChatWith('saved while a read flushes')

    // /api/read flushes outside the storage queue. With decoding slowed, the
    // patch's cold load starts once that flush is inside its decode, before
    // it has written.
    const entered = path.join(srv.cwd, 'decode-entered')
    await rm(entered, { force: true })
    await withFlag('slow-decode', async () => {
      const read = client.fetch('/api/read', { headers: { 'file-path': DB_KEY_HEX } })
      let inDecode = false
      for (let i = 0; i < 100 && !inDecode; i++) {
        inDecode = await access(entered).then(() => true, () => false)
        if (!inDecode) await new Promise((resolve) => setTimeout(resolve, 10))
      }
      expect(inDecode).toBe(true)
      const [readRes, patchRes] = await Promise.all([read, stalePatch()])
      expect(readRes.status).toBe(200)
      expect(patchRes.status).toBe(409)
    })

    expect(await lastMessage()).toBe('saved while a read flushes')
    expect(await lastMessageOnDisk()).toBe('saved while a read flushes')
  })

  test('a flush that fails keeps the body for the next attempt instead of loading without it', async () => {
    await coldStart()
    await saveChatWith('kept while the disk refuses')

    await withFlag('fail-db-persist', async () => {
      // Both cold loads must fail: the second one used to find no pending
      // persist and rebuild the store from disk.
      expect((await stalePatch()).status).toBeGreaterThanOrEqual(500)
      expect((await stalePatch()).status).toBeGreaterThanOrEqual(500)
      expect(await lastMessage()).toBe('kept while the disk refuses')
    })

    expect((await stalePatch()).status).toBe(409)
    expect(await lastMessage()).toBe('kept while the disk refuses')
    expect(await lastMessageOnDisk()).toBe('kept while the disk refuses')
  })

  test('a debounced persist that fails keeps the body for the next cold load', async () => {
    await coldStart()
    await withFlag('fail-db-persist', async () => {
      await saveChatWith('kept after the debounce failed')
      // Let the chat save's own 5 s persist run and fail with no cache.
      await new Promise((resolve) => setTimeout(resolve, 5600))
      expect((await stalePatch()).status).toBeGreaterThanOrEqual(500)
      expect(await lastMessage()).toBe('kept after the debounce failed')
    })

    expect((await stalePatch()).status).toBe(409)
    expect(await lastMessage()).toBe('kept after the debounce failed')
    expect(await lastMessageOnDisk()).toBe('kept after the debounce failed')
  }, 20_000)
})

describe('chat body saved before the database lists the chat', () => {
  test('a new chat survives a persist that runs before its entry arrives', async () => {
    await coldStart()
    await readDb() // warm cache

    await postNewChat('posted before its entry')
    // Any persist rebuilds the chat store from what it wrote; export runs one.
    await client.exportBackup()

    await addNewChatEntry()

    expect(await lastMessage(NEW, 1)).toBe('posted before its entry')
    expect(await lastMessageOnDisk(NEW)).toBe('posted before its entry')
  })

  test('a new chat deleted again before the next persist stays deleted', async () => {
    await coldStart()
    const db = await readDb() // warm cache

    await postNewChat('posted, listed, then deleted')
    const stub = { id: NEW, name: 'New', _stub: true }
    expect((await patch([{ op: 'add', path: '/characters/0/chats/1', value: stub }], utils.calculateHash(db).toString(16))).status).toBe(200)
    db.characters[0].chats.splice(1, 0, stub)
    expect((await patch([{ op: 'remove', path: '/characters/0/chats/1' }], utils.calculateHash(db).toString(16))).status).toBe(200)

    // The persist that export runs rebuilds the store from a database
    // without the chat; the post must not bring the body back.
    expect(await lastMessageOnDisk(NEW)).toBeUndefined()
    expect((await getChat(NEW, 1)).status).toBe(404)
  })
})

describe('writes that replace database.bin', () => {
  test('bulk-write refuses database.bin', async () => {
    await coldStart()
    const { raw: seeded } = normalizeBackup(createSeedBackup({ characterCount: 1, messagesPerChat: 3 })) as any
    const res = await client.fetch('/api/assets/bulk-write', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify([{ key: 'database/database.bin', value: Buffer.from(utils.encodeRisuSaveLegacy(seeded)).toString('base64') }]),
    })
    expect(res.status).toBe(400)
    expect(await lastMessageOnDisk()).toBe('Message 1 in chat 0 of char 0')
  })

  test('an import that fails after committing its database leaves no older chat in memory', async () => {
    await coldStart()
    expect(await lastMessage()).toBe('Message 1 in chat 0 of char 0')

    await withFlag('fail-import-swap', async () => {
      const result = await client.importBackup(createSeedBackup({ characterCount: 1, messagesPerChat: 3 }))
      expect(result.ok).not.toBe(true)
    })

    // The imported database is on disk; the chat must come from it.
    expect(await lastMessage()).toBe('Message 2 in chat 0 of char 0')
    expect((await stalePatch()).status).toBe(409)
    expect(await lastMessageOnDisk()).toBe('Message 2 in chat 0 of char 0')
  })
})
