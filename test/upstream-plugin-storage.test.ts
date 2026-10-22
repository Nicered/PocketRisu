// @vitest-environment node
/**
 * Upstream plugin storage layouts folded back into plain plugin keys:
 * cad8595a's `_coldplugin` key -> cold id map, and 68b5d032c's
 * (v2026.10.210+) `_coldpluginIndex` pointer to one index item.
 *
 * Unit tests drive resolveUpstreamPluginStorage directly. Integration tests
 * spawn a real server and feed it upstream-shaped data: a v2026.10.210 .bin
 * (RisuSave block format with a PLUGIN_STORAGE block and
 * coldstorage_<uuid>.json entries), and a save folder that reproduces the kv
 * rows left by builds that moved the index pointer into kv as a plain key.
 */
import { describe, test, expect, afterAll } from 'vitest'
import { Packr } from 'msgpackr'
import * as fflate from 'fflate'
import { spawnServer, type ServerHandle } from './compat/helpers/spawnServer.js'
import { createClient, type RisuClient } from './compat/helpers/client.js'
import { encodeBackup } from './compat/helpers/encode.js'
import { decodeBackup } from './compat/helpers/decode.js'
import { normalizeBackup } from './compat/helpers/normalize.js'

const upstream = require('../server/node/upstream-plugin-storage.cjs')
const storeMod = require('../server/node/plugin-storage-store.cjs')
const utils = require('../server/node/utils.cjs') as typeof import('../server/node/utils.cjs')
const { resolveUpstreamPluginStorage, INDEX_KEY, LEGACY_MAP_KEY, INDEX_TYPE } = upstream
const { encodeKey, PREFIX, MIGRATED_MARKER_KEY } = storeMod

const IDX = '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d'
const BIG = '1f2e3d4c-5b6a-4978-8a9b-0c1d2e3f4a5b'
const OLD_IDX = '2b3c4d5e-6f70-4182-9a3b-4c5d6e7f8091'
const LEGACY = '3c4d5e6f-7081-4293-8b4c-5d6e7f809102'

const index = (entries: unknown[], trash: unknown[] = []) => ({ type: INDEX_TYPE, version: 1, entries, trash })

// ─── Unit ──────────────────────────────────────────────────────────────────

function resolve(storage: Record<string, unknown>, cold: Record<string, unknown>, opts: Record<string, unknown> = {}) {
    const reads: string[] = []
    const result = resolveUpstreamPluginStorage(storage, {
        readCold: (id: string) => {
            reads.push(id)
            if (id === 'unreadable') throw new Error('corrupt item')
            return Object.prototype.hasOwnProperty.call(cold, id) ? cold[id] : undefined
        },
        isPresent: (key: string) => key !== INDEX_KEY && key !== LEGACY_MAP_KEY
            && Object.prototype.hasOwnProperty.call(storage, key),
        source: 'test',
        ...opts,
    })
    return { ...result, values: new Map<string, unknown>(result.assign), reads }
}

describe('resolveUpstreamPluginStorage (unit)', () => {
    test('restores inline JSON and large items from the index exactly', () => {
        const values: Record<string, unknown> = {
            zero: 0, no: false, empty: '', nothing: null,
            nested: { a: [1, { b: 'c' }] }, list: [1, 2, 3], text: '한글 값',
        }
        const entries = Object.entries(values).map(([k, v]) => ({ k, s: JSON.stringify(v) }))
        entries.push({ k: 'big', l: BIG } as any)
        const r = resolve({ [INDEX_KEY]: IDX }, { [IDX]: index(entries, [{ id: OLD_IDX, at: 1, index: true }]), [BIG]: { huge: 'x'.repeat(1000) } })

        expect(r.failed).toBe(0)
        expect(Object.fromEntries(r.values)).toEqual({ ...values, big: { huge: 'x'.repeat(1000) } })
        expect(r.record).toMatchObject({ source: 'test', pointer: IDX, trashCount: 1 })
        expect(r.reads).not.toContain(OLD_IDX)
    })

    test('a missing or unreadable large item is recorded and the rest restores', () => {
        const r = resolve({ [INDEX_KEY]: IDX }, {
            [IDX]: index([{ k: 'ok', s: '"fine"' }, { k: 'lost', l: BIG }, { k: 'broken', l: 'unreadable' }]),
        })
        expect(Object.fromEntries(r.values)).toEqual({ ok: 'fine' })
        expect(r.failed).toBe(2)
        expect(r.record.failedEntries).toEqual([{ k: 'lost', l: BIG }, { k: 'broken', l: 'unreadable' }])
    })

    test('an unusable index is reported without throwing, legacy keys still restore', () => {
        const cases: Array<[unknown, string]> = [
            [undefined, 'index item not found'],
            [{ type: 'something-else', version: 1, entries: [], trash: [] }, 'not a plugin storage index'],
            [{ type: INDEX_TYPE, version: 2, entries: [], trash: [] }, 'unsupported index version 2'],
            [{ type: INDEX_TYPE, version: 1, entries: {}, trash: [] }, 'malformed index'],
        ]
        for (const [item, error] of cases) {
            const cold: Record<string, unknown> = { [LEGACY]: 'legacy value' }
            if (item !== undefined) cold[IDX] = item
            const r = resolve({ [INDEX_KEY]: IDX, [LEGACY_MAP_KEY]: { old: LEGACY } }, cold)
            expect(r.record.pointerError).toBe(error)
            expect(Object.fromEntries(r.values)).toEqual({ old: 'legacy value' })
            expect(r.failed).toBe(1)
        }
        const thrown = resolve({ [INDEX_KEY]: 'unreadable' }, {})
        expect(thrown.record.pointerError).toBe('corrupt item')
        const invalid = resolve({ [INDEX_KEY]: 42 }, {})
        expect(invalid.record).toMatchObject({ pointer: 42, pointerError: 'invalid pointer' })
    })

    test('unparsable s, repeated keys, l over s and non-string keys follow upstream', () => {
        const r = resolve({ [INDEX_KEY]: IDX }, {
            [IDX]: index([
                { k: 'bad', s: '{not json' },
                { k: 'dup', s: '"first"' },
                { k: 'dup', s: '"second"' },
                { k: 'both', s: '"inline"', l: BIG },
                { k: 42, s: '"ignored"' },
                { s: '"no key"' },
            ]),
            [BIG]: 'large wins',
        })
        expect(Object.fromEntries(r.values)).toEqual({ dup: 'second', both: 'large wins' })
        expect(r.record.failedEntries).toEqual([{ k: 'bad' }])
    })

    test('with an index: present keys win over the index, and both win over the legacy map', () => {
        const r = resolve({
            [INDEX_KEY]: IDX,
            [LEGACY_MAP_KEY]: { fromIndex: LEGACY, present: LEGACY, legacyOnly: LEGACY },
            present: 'written after upstream loaded',
        }, {
            [IDX]: index([{ k: 'fromIndex', s: '"index"' }, { k: 'present', s: '"older index copy"' }]),
            [LEGACY]: 'legacy',
        })
        expect(Object.fromEntries(r.values)).toEqual({ fromIndex: 'index', legacyOnly: 'legacy' })
        expect(r.record.shadowedIndexKeys).toEqual(['present'])
        expect(r.record.shadowedLegacyKeys).toEqual(['fromIndex', 'present'])
        expect(r.reads.filter(id => id === LEGACY)).toHaveLength(1)
    })

    // upstream v210 migrateLegacy: a leftover legacy entry is older than an
    // inline value written by an older build, so it is dropped unread.
    test('cad8595a data (no index): an inline value wins over the legacy map', () => {
        const r = resolve({ [LEGACY_MAP_KEY]: { memory: LEGACY }, memory: 'written after the move' }, { [LEGACY]: 'cold value' })
        expect(r.values.size).toBe(0)
        expect(r.reads).toEqual([])
        expect(r.record.shadowedLegacyKeys).toEqual(['memory'])
    })

    test('reserved names inside the layouts and a non-object legacy map never become plugin keys', () => {
        const r = resolve({ [INDEX_KEY]: IDX, [LEGACY_MAP_KEY]: 'not a map' }, {
            [IDX]: index([{ k: INDEX_KEY, s: '"x"' }, { k: LEGACY_MAP_KEY, s: '{}' }, { k: 'real', s: '1' }]),
        })
        expect(Object.fromEntries(r.values)).toEqual({ real: 1 })
        expect(r.record.invalidLegacyMap).toBe('not a map')
    })

    test('a "__proto__" key is returned as a plain entry', () => {
        const r = resolve({ [INDEX_KEY]: IDX }, { [IDX]: index([{ k: '__proto__', s: '"polluted?"' }]) })
        expect(r.assign).toEqual([['__proto__', 'polluted?']])
    })
})

// ─── Integration ───────────────────────────────────────────────────────────

const MAGIC_RAW = Buffer.from([0, 82, 73, 83, 85, 83, 65, 86, 69, 0, 7])
const MAGIC_RISUSAVE = Buffer.from('RISUSAVE\0', 'latin1')
const packr = new Packr({ useRecords: false })
const DB_KEY = 'database/database.bin'
const hex = (s: string) => Buffer.from(s, 'utf-8').toString('hex')

const baseDb = {
    characters: [], apiType: 'openai', botPresets: [], botPresetsId: 0, personas: [],
    moduleIntergration: [], selectedCharacter: 0,
}

// One RisuSave block, gzip-compressed like upstream's encodeRisuSave.
function block(type: number, name: string, content: unknown) {
    const nameBuf = Buffer.from(name, 'utf-8')
    const data = Buffer.from(fflate.gzipSync(Buffer.from(JSON.stringify(content), 'utf-8')))
    const head = Buffer.alloc(3 + nameBuf.length + 4)
    head[0] = type
    head[1] = 1
    head[2] = nameBuf.length
    nameBuf.copy(head, 3)
    head.writeUInt32LE(data.length, 3 + nameBuf.length)
    return Buffer.concat([head, data])
}

// The shape upstream v2026.10.210 writes: ROOT (which also repeats
// pluginCustomStorage) followed by the PLUGIN_STORAGE block.
function upstreamDatabase(pluginCustomStorage: Record<string, unknown>) {
    return Buffer.concat([
        MAGIC_RISUSAVE,
        block(1, 'root', { ...baseDb, pluginCustomStorage }),
        block(11, 'pluginStorage', pluginCustomStorage),
    ])
}

function upstreamBackup(pluginCustomStorage: Record<string, unknown>, cold: Record<string, unknown>) {
    return encodeBackup([
        ...Object.entries(cold).map(([id, value]) => ({ name: `coldstorage_${id}.json`, data: Buffer.from(JSON.stringify(value)) })),
        { name: 'database.risudat', data: upstreamDatabase(pluginCustomStorage) },
    ])
}

function legacyDbBlob(pluginCustomStorage: Record<string, unknown>) {
    return Buffer.concat([MAGIC_RAW, packr.encode({ ...baseDb, pluginCustomStorage })])
}

function saveFolderZip(entries: Record<string, Buffer>) {
    const zippable: Record<string, Uint8Array> = {}
    for (const [key, value] of Object.entries(entries)) zippable[hex(key)] = new Uint8Array(value)
    return Buffer.from(fflate.zipSync(zippable))
}

const servers: ServerHandle[] = []
afterAll(async () => { await Promise.allSettled(servers.map(s => s.cleanup())) })

async function boot() {
    const srv = await spawnServer()
    servers.push(srv)
    return createClient(srv.port, srv.password)
}

async function readDb(client: RisuClient) {
    const res = await client.fetch('/api/read', { headers: { 'file-path': hex(DB_KEY) } })
    expect(res.status).toBe(200)
    return utils.normalizeJSON(await utils.decodeRisuSave(Buffer.from(await res.arrayBuffer()))) as any
}

async function pluginKeys(client: RisuClient) {
    const res = await client.fetch('/api/plugin-storage/index')
    expect(res.status).toBe(200)
    const body = await res.json() as { entries: { key: string }[] }
    return body.entries.map(e => e.key).sort()
}

async function readPluginKey(client: RisuClient, key: string) {
    const res = await client.fetch('/api/read', { headers: { 'file-path': hex(`${PREFIX}${encodeKey(key)}`) } })
    const text = res.status === 200 ? await res.text() : ''
    return text ? JSON.parse(text) : null
}

describe('upstream v2026.10.210 plugin storage (integration)', () => {
    const memory = { entries: [{ id: 1, text: '기억' }], version: 3 }
    const bigValue = { chunks: 'y'.repeat(300 * 1024) }
    const coldIndex = index([
        { k: 'ltm/memory', s: JSON.stringify(memory) },
        { k: 'ltm/big', l: BIG },
        { k: 'v2/written', s: '"older index copy"' },
    ], [{ id: OLD_IDX, at: 1, index: true }])

    test('a .bin import restores the index into plain keys and keeps no reserved key', async () => {
        const client = await boot()
        const result = await client.importBackup(upstreamBackup(
            // A key written after upstream loaded its index stays inline and wins.
            { [INDEX_KEY]: IDX, 'v2/written': 'newer inline value' },
            { [IDX]: coldIndex, [BIG]: bigValue },
        )) as Record<string, unknown>
        expect(result.ok).toBe(true)
        expect(result.pluginStorageColdFailed).toBe(0)

        expect(await pluginKeys(client)).toEqual(['ltm/big', 'ltm/memory', 'v2/written'])
        expect(await readPluginKey(client, 'ltm/memory')).toEqual(memory)
        expect(await readPluginKey(client, 'ltm/big')).toEqual(bigValue)
        expect(await readPluginKey(client, 'v2/written')).toBe('newer inline value')

        const db = await readDb(client)
        expect(db.nodeOnlyPluginStorageRecovery).toEqual([expect.objectContaining({
            source: 'database', pointer: IDX, trashCount: 1, shadowedIndexKeys: ['v2/written'],
        })])

        // Exports carry the values inline, never the pointer, and the cold
        // rows are still there for manual recovery.
        const exported = await client.exportBackup()
        const { raw } = normalizeBackup(exported)
        expect(Object.keys(raw.pluginCustomStorage as object).sort()).toEqual(['ltm/big', 'ltm/memory', 'v2/written'])
        const names = decodeBackup(exported).map(e => e.name)
        expect(names.some(n => n.includes(IDX))).toBe(true)
        expect(names.some(n => n.includes(BIG))).toBe(true)
    })

    test('a missing large item is reported and recorded, the other keys restore', async () => {
        const client = await boot()
        const result = await client.importBackup(upstreamBackup({ [INDEX_KEY]: IDX }, { [IDX]: coldIndex })) as Record<string, unknown>
        expect(result.ok).toBe(true)
        expect(result.pluginStorageColdFailed).toBe(1)

        expect(await pluginKeys(client)).toEqual(['ltm/memory', 'v2/written'])
        const db = await readDb(client)
        expect(db.nodeOnlyPluginStorageRecovery[0].failedEntries).toEqual([{ k: 'ltm/big', l: BIG }])
    })

    test('a pointer that an older build moved into kv is resolved on the next load, kv values win', async () => {
        const client = await boot()
        // What a v1.15.x import of upstream v210 data left behind: the blob is
        // split, the pointer is an ordinary plugin key, and the plugin has
        // since written a fresh value for one of the indexed keys.
        const up = await client.fetch('/api/migrate/save-folder/upload', {
            method: 'POST', headers: { 'content-type': 'application/zip' },
            body: new Uint8Array(saveFolderZip({
                [DB_KEY]: legacyDbBlob({}),
                [`${PREFIX}${encodeKey(INDEX_KEY)}`]: Buffer.from(JSON.stringify(IDX)),
                [`${PREFIX}${encodeKey('ltm/memory')}`]: Buffer.from('"re-initialized by the plugin"'),
                [MIGRATED_MARKER_KEY]: Buffer.from('{"version":1}'),
                [`coldstorage/${IDX}`]: Buffer.from(fflate.gzipSync(Buffer.from(JSON.stringify(coldIndex)))),
                [`coldstorage/${BIG}`]: Buffer.from(fflate.gzipSync(Buffer.from(JSON.stringify(bigValue)))),
            })),
        })
        expect(up.status).toBe(200)

        const db = await readDb(client)
        expect(db.nodeOnlyPluginStorageRecovery).toEqual([expect.objectContaining({
            source: 'leaked-kv', pointer: IDX, shadowedIndexKeys: ['ltm/memory'],
        })])
        expect(await pluginKeys(client)).toEqual(['ltm/big', 'ltm/memory', 'v2/written'])
        expect(await readPluginKey(client, INDEX_KEY)).toBeNull()
        expect(await readPluginKey(client, 'ltm/memory')).toBe('re-initialized by the plugin')
        expect(await readPluginKey(client, 'ltm/big')).toEqual(bigValue)
        expect(await readPluginKey(client, 'v2/written')).toBe('older index copy')
    })
})
