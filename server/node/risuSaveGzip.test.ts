import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import * as fflate from 'fflate'

const require = createRequire(import.meta.url)
const utils = require('./utils.cjs') as typeof import('./utils.cjs')

const MAGIC_RISUSAVE = Buffer.from('RISUSAVE\0', 'latin1')
const NOT_GZIP = Buffer.from('this is not a gzip stream at all')

// One RisuSave block flagged gzip-compressed, with the given payload.
function block(type: number, name: string, payload: Buffer) {
    const nameBuf = Buffer.from(name, 'utf-8')
    const head = Buffer.alloc(3 + nameBuf.length + 4)
    head[0] = type
    head[1] = 1
    head[2] = nameBuf.length
    nameBuf.copy(head, 3)
    head.writeUInt32LE(payload.length, 3 + nameBuf.length)
    return Buffer.concat([head, payload])
}

const gzipJson = (value: unknown) => Buffer.from(fflate.gzipSync(Buffer.from(JSON.stringify(value), 'utf-8')))

// The server exits on an unhandled rejection (logs.cjs), so a decode of
// corrupt gzip must not leave one behind.
async function unhandledDuring(run: () => Promise<unknown>) {
    const unhandled: unknown[] = []
    const onRejection = (reason: unknown) => { unhandled.push(reason) }
    process.on('unhandledRejection', onRejection)
    let error: unknown = null
    try {
        await run().catch((caught) => { error = caught })
        await new Promise((resolve) => setTimeout(resolve, 50))
    } finally {
        process.off('unhandledRejection', onRejection)
    }
    return { unhandled, error }
}

describe('RisuSave gzip decoding', () => {
    it('reports a block whose gzip is corrupt and decodes the rest', async () => {
        const save = Buffer.concat([
            MAGIC_RISUSAVE,
            block(utils.RisuSaveType.ROOT, 'root', gzipJson({ username: 'kept' })),
            block(utils.RisuSaveType.CHARACTER_WITH_CHAT, 'broken', NOT_GZIP),
            block(utils.RisuSaveType.CHARACTER_WITH_CHAT, 'char-1', gzipJson({ chaId: 'char-1', name: 'Alice', chats: [] })),
        ])
        const damaged: string[] = []
        let db: any
        const { unhandled, error } = await unhandledDuring(async () => {
            db = await utils.decodeRisuSave(save, { onBlockError: ({ name }: { name: string }) => damaged.push(name) })
        })

        expect(unhandled).toEqual([])
        expect(error).toBeNull()
        expect(damaged).toEqual(['broken'])
        expect(db.username).toBe('kept')
        expect(db.characters.map((c: any) => c.name)).toEqual(['Alice'])
    })

    it('fails a corrupt stream-compressed save without an unhandled rejection', async () => {
        const save = Buffer.concat([Buffer.from(utils.magicStreamCompressedHeader), NOT_GZIP])
        const { unhandled, error } = await unhandledDuring(() => utils.decodeRisuSave(save))

        expect(unhandled).toEqual([])
        expect(error).toBeInstanceOf(Error)
    })
})
