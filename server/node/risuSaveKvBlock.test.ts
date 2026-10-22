import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import * as fflate from 'fflate'

const require = createRequire(import.meta.url)
const utils = require('./utils.cjs') as typeof import('./utils.cjs')

const MAGIC_RISUSAVE = Buffer.from('RISUSAVE\0', 'latin1')

// One gzip-compressed RisuSave block, as upstream encodes it.
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

afterEach(() => {
    vi.restoreAllMocks()
})

describe('RisuSave KV block (upstream SaveKV)', () => {
    it('reserves block type 12', () => {
        expect(utils.RisuSaveType.KV).toBe(12)
    })

    it('skips a KV block with a warning and decodes the rest', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const save = Buffer.concat([
            MAGIC_RISUSAVE,
            block(utils.RisuSaveType.ROOT, 'root', { apiType: 'openai', username: 'kept' }),
            block(utils.RisuSaveType.KV, 'kv:example', { a: 1 }),
            block(utils.RisuSaveType.CHARACTER_WITH_CHAT, 'char-1', { chaId: 'char-1', name: 'Alice', chats: [] }),
        ])

        const db = await utils.decodeRisuSave(save) as any

        expect(db.username).toBe('kept')
        expect(db.characters.map((c: any) => c.name)).toEqual(['Alice'])
        expect(db).not.toHaveProperty('kv:example')
        expect(warn.mock.calls.some((args) => String(args[0]).includes('SaveKV block kv:example'))).toBe(true)
    })
})
