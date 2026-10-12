import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('../alert', () => ({
    alertInput: vi.fn(),
    waitAlert: vi.fn(),
    notifyError: vi.fn(),
}))

vi.mock('./risuSave', () => ({
    decodeRisuSave: vi.fn(),
    encodeRisuSaveLegacy: vi.fn(),
}))

vi.mock('./database.svelte', () => ({
    normalizeChat: (chat: any) => chat,
}))

const { NodeStorage } = await import('./nodeStorage')

function setUpStorage(fetchMock: ReturnType<typeof vi.fn>) {
    ;(NodeStorage as any).sessionInitialized = true
    ;(NodeStorage as any).sessionPending = null
    const storage = new NodeStorage(fetchMock as any, { baseDelayMs: 0, delay: vi.fn(async () => {}), random: () => 1 })
    storage.authChecked = true
    vi.spyOn(storage, 'createAuth').mockResolvedValue('token')
    let entry: { etag: string, data: Uint8Array } | null = null
    storage.bootCache = {
        get: vi.fn(async () => entry),
        set: vi.fn(async (next) => { entry = next }),
    }
    return { storage, cache: () => entry }
}

const sentHeaders = (fetchMock: ReturnType<typeof vi.fn>, call: number) => new Headers(fetchMock.mock.calls[call][1].headers)

describe('NodeStorage database.bin boot cache', () => {
    beforeEach(() => {
        vi.restoreAllMocks()
    })

    test('keeps the database the server sent and reuses it when the server answers 304', async () => {
        const body = new Uint8Array([1, 2, 3, 4])
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(new Response(body, { status: 200, headers: { 'x-db-etag': 'etag-1' } }))
            .mockResolvedValueOnce(new Response(null, { status: 304 }))
        const { storage, cache } = setUpStorage(fetchMock)

        const first = await storage.getItem('database/database.bin')
        expect([...first]).toEqual([1, 2, 3, 4])
        expect(sentHeaders(fetchMock, 0).get('if-none-match')).toBeNull()
        expect(cache()?.etag).toBe('etag-1')

        const second = await storage.getItem('database/database.bin')
        expect(sentHeaders(fetchMock, 1).get('if-none-match')).toBe('etag-1')
        expect([...second]).toEqual([1, 2, 3, 4])
        expect(storage._lastDbEtag).toBe('etag-1')
    })

    test('replaces the kept copy when the server sends a newer database', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(new Response(new Uint8Array([1]), { status: 200, headers: { 'x-db-etag': 'old' } }))
            .mockResolvedValueOnce(new Response(new Uint8Array([2, 2]), { status: 200, headers: { 'x-db-etag': 'new' } }))
        const { storage, cache } = setUpStorage(fetchMock)

        await storage.getItem('database/database.bin')
        const fresh = await storage.getItem('database/database.bin')
        expect([...fresh]).toEqual([2, 2])
        expect(cache()).toEqual({ etag: 'new', data: new Uint8Array([2, 2]) })
    })

    test('other keys are neither conditional nor cached', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(new Uint8Array([9]), { status: 200 }))
        const { storage, cache } = setUpStorage(fetchMock)
        await storage.getItem('assets/a.png')
        expect(sentHeaders(fetchMock, 0).get('if-none-match')).toBeNull()
        expect(cache()).toBeNull()
    })
})
