import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

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

const REQUEST_TIMEOUT_MS = 30_000

function setUpStorage(fetchMock: ReturnType<typeof vi.fn>) {
    ;(NodeStorage as any).sessionInitialized = true
    ;(NodeStorage as any).sessionPending = null
    const storage = new NodeStorage(fetchMock as any, { baseDelayMs: 0, delay: vi.fn(async () => {}), random: () => 1 })
    storage.authChecked = true
    vi.spyOn(storage, 'createAuth').mockResolvedValue('token')
    return storage
}

/** A response whose body the test writes. */
function streamResponse() {
    const encoder = new TextEncoder()
    let controller!: ReadableStreamDefaultController<Uint8Array>
    const body = new ReadableStream<Uint8Array>({ start(c) { controller = c } })
    return {
        response: new Response(body, { status: 200, headers: { 'content-type': 'application/x-ndjson' } }),
        push: (line: string) => controller.enqueue(encoder.encode(line + '\n')),
        end: () => controller.close(),
        fail: (error: Error) => controller.error(error),
    }
}

describe('NodeStorage RisuAI account import', () => {
    beforeEach(() => { vi.useFakeTimers() })
    afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

    test('a refused write tells the app why', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'busy', code: 'ACCOUNT_IMPORT_ACTIVE' }), { status: 423 }))
            .mockResolvedValueOnce(new Response('locked', { status: 423 }))
        const storage = setUpStorage(fetchMock)
        const reasons: unknown[] = []
        const listener = (event: Event) => reasons.push((event as CustomEvent).detail?.code)
        window.addEventListener('risu-session-deactivated', listener)
        try {
            await expect(storage.applyRisuAccountImport()).rejects.toMatchObject({ status: 423, code: 'ACCOUNT_IMPORT_ACTIVE' })
            await expect(storage.applyRisuAccountImport()).rejects.toMatchObject({ status: 423 })
        } finally {
            window.removeEventListener('risu-session-deactivated', listener)
        }
        expect(reasons).toEqual(['ACCOUNT_IMPORT_ACTIVE', null])
    })

    test('a login prompt before the first request does not count against its time limit', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ state: 'idle', blocking: false }), { status: 200 }))
        const storage = setUpStorage(fetchMock)
        storage.authChecked = false
        let login: () => void = () => {}
        const loggedIn = new Promise<void>((resolve) => { login = resolve })
        vi.spyOn(storage as any, 'checkAuth').mockImplementationOnce(async () => {
            await loggedIn
            storage.authChecked = true
        })

        const settled = storage.getRisuAccountImportStatus().then((status) => status, (error) => error)
        await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS * 2)
        login()
        expect(await settled).toMatchObject({ state: 'idle', blocking: false })
    })

    test('a session check that hangs after the login counts against the time limit', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
        const storage = setUpStorage(fetchMock)
        vi.spyOn(storage as any, 'checkAuth').mockImplementation(() => new Promise(() => {}))

        const settled = storage.getRisuAccountImportStatus().then(() => 'resolved', (error) => error)
        await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS + 1)
        expect((await settled as DOMException).name).toBe('AbortError')
    })

    test('a status read with no answer fails instead of hanging', async () => {
        const fetchMock = vi.fn(() => new Promise<Response>(() => {}))
        const storage = setUpStorage(fetchMock)

        const settled = storage.getRisuAccountImportStatus().then(() => 'resolved', (error) => error)
        await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS + 1)

        expect((await settled as DOMException).name).toBe('AbortError')
        expect((fetchMock.mock.calls[0] as any[])[1].signal.aborted).toBe(true)
    })

    test('a status read whose body is cut off fails instead of reading as an empty status', async () => {
        const truncated = streamResponse()
        const broken = streamResponse()
        const fetchMock = vi.fn().mockResolvedValueOnce(truncated.response).mockResolvedValueOnce(broken.response)
        const storage = setUpStorage(fetchMock)

        truncated.push('{"state":')
        truncated.end()
        await expect(storage.getRisuAccountImportStatus()).rejects.toBeInstanceOf(SyntaxError)

        const pending = storage.getRisuAccountImportStatus()
        broken.push('{"state":')
        broken.fail(new TypeError('network error'))
        await expect(pending).rejects.toThrow()
    })

    test('a status read whose body stops after the headers fails instead of hanging', async () => {
        const stream = streamResponse()
        const fetchMock = vi.fn().mockResolvedValue(stream.response)
        const storage = setUpStorage(fetchMock)

        const settled = storage.getRisuAccountImportStatus().then(() => 'resolved', (error) => error)
        stream.push('{"state":')
        await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS + 1)

        expect((await settled as DOMException).name).toBe('AbortError')
    })
})

// The authentication requests (test_auth, password hashing, login, token
// refresh, session cookie) go through the global fetch, not the injected one.
describe('NodeStorage authentication with no answer', () => {
    const AUTH_TIMEOUT_MS = 30_000
    const idle = () => new Response(JSON.stringify({ state: 'idle', blocking: false }), { status: 200 })
    /** Requests by path; a handler returning undefined leaves the request unanswered. */
    function stubAuthFetch(handlers: Record<string, () => Response | undefined>) {
        const calls: { url: string, signal: AbortSignal | undefined }[] = []
        const authFetch = vi.fn((url: string, init: RequestInit = {}) => {
            calls.push({ url, signal: init.signal ?? undefined })
            const handler = handlers[url]
            if (!handler) throw new Error(`unexpected request ${url}`)
            const response = handler()
            return response ? Promise.resolve(response) : new Promise<Response>(() => {})
        })
        vi.stubGlobal('fetch', authFetch)
        return { calls: (url: string) => calls.filter((call) => call.url === url) }
    }
    function freshStorage() {
        ;(NodeStorage as any).sessionInitialized = false
        ;(NodeStorage as any).sessionPending = null
        return new NodeStorage(vi.fn(async () => idle()) as any, { baseDelayMs: 0, delay: vi.fn(async () => {}), random: () => 1 })
    }
    function loggedIn(storage: InstanceType<typeof NodeStorage>, expiresInMs = 5 * 60_000) {
        storage.authChecked = true
        ;(storage as any).cachedJwt = { token: 'token', expiresAt: Date.now() + expiresInMs }
    }

    beforeEach(() => { vi.useFakeTimers() })
    afterEach(() => {
        vi.useRealTimers()
        vi.unstubAllGlobals()
        vi.restoreAllMocks()
        ;(NodeStorage as any).sessionInitialized = false
        ;(NodeStorage as any).sessionPending = null
    })

    test('a session request with no answer at boot is dropped, and the read sends a new one', async () => {
        let sessionAnswers = false
        const requests = stubAuthFetch({
            '/api/test_auth': () => new Response(JSON.stringify({ status: 'success', token: 'token' })),
            '/api/session': () => sessionAnswers ? new Response('', { status: 200 }) : undefined,
        })
        const storage = freshStorage()

        const first = storage.getRisuAccountImportStatus().then((status) => status, (error) => error)
        await vi.advanceTimersByTimeAsync(0)
        expect(requests.calls('/api/session')).toHaveLength(1)
        sessionAnswers = true
        await vi.advanceTimersByTimeAsync(AUTH_TIMEOUT_MS + 1)

        expect(await first).toMatchObject({ state: 'idle', blocking: false })
        expect(requests.calls('/api/session')[0].signal?.aborted).toBe(true)
        expect(requests.calls('/api/session')).toHaveLength(2)
        expect((NodeStorage as any).sessionInitialized).toBe(true)
    })

    test('a session request with no answer after the login is not shared by the next read', async () => {
        let sessionAnswers = false
        const requests = stubAuthFetch({
            '/api/session': () => sessionAnswers ? new Response('', { status: 200 }) : undefined,
        })
        const storage = freshStorage()
        loggedIn(storage)

        const first = storage.getRisuAccountImportStatus().then(() => 'resolved', (error) => error)
        await vi.advanceTimersByTimeAsync(AUTH_TIMEOUT_MS + 1)
        expect((await first as DOMException).name).toBe('AbortError')
        expect(requests.calls('/api/session')[0].signal?.aborted).toBe(true)

        sessionAnswers = true
        await expect(storage.getRisuAccountImportStatus()).resolves.toMatchObject({ state: 'idle' })
        expect(requests.calls('/api/session')).toHaveLength(2)
    })

    test('a test_auth with no answer at boot fails, and the next read checks again', async () => {
        let authAnswers = false
        const requests = stubAuthFetch({
            '/api/test_auth': () => authAnswers ? new Response(JSON.stringify({ status: 'success', token: 'token' })) : undefined,
            '/api/session': () => new Response('', { status: 200 }),
        })
        const storage = freshStorage()

        const first = storage.getRisuAccountImportStatus().then(() => 'resolved', (error) => error)
        await vi.advanceTimersByTimeAsync(AUTH_TIMEOUT_MS + 1)
        expect((await first as DOMException).name).toBe('TimeoutError')

        authAnswers = true
        await expect(storage.getRisuAccountImportStatus()).resolves.toMatchObject({ state: 'idle' })
        expect(requests.calls('/api/test_auth')).toHaveLength(2)
    })

    test('a token refresh with no answer is not shared by the next read', async () => {
        let refreshAnswers = false
        const requests = stubAuthFetch({
            '/api/token/refresh': () => refreshAnswers ? new Response(JSON.stringify({ token: 'token2' })) : undefined,
        })
        const storage = freshStorage()
        ;(NodeStorage as any).sessionInitialized = true
        loggedIn(storage, 10_000)

        const first = storage.getRisuAccountImportStatus().then(() => 'resolved', (error) => error)
        await vi.advanceTimersByTimeAsync(AUTH_TIMEOUT_MS + 1)
        expect((await first as DOMException).name).toBe('AbortError')

        refreshAnswers = true
        await expect(storage.getRisuAccountImportStatus()).resolves.toMatchObject({ state: 'idle' })
        expect(requests.calls('/api/token/refresh')).toHaveLength(2)
    })

    test('the password prompt waits without a limit, and the login after it is bounded', async () => {
        const { alertInput } = await import('../alert')
        let typePassword: (value: string) => void = () => {}
        vi.mocked(alertInput).mockImplementationOnce(() => new Promise((resolve) => { typePassword = resolve }))
        const requests = stubAuthFetch({
            '/api/test_auth': () => new Response(JSON.stringify({ status: 'incorrect' })),
            '/api/crypto': () => new Response('digest'),
            '/api/login': () => undefined,
        })
        const storage = freshStorage()

        const first = storage.getRisuAccountImportStatus().then(() => 'resolved', (error) => error)
        await vi.advanceTimersByTimeAsync(AUTH_TIMEOUT_MS * 3)
        expect(requests.calls('/api/login')).toHaveLength(0)

        typePassword('password')
        await vi.advanceTimersByTimeAsync(AUTH_TIMEOUT_MS + 1)
        expect((await first as DOMException).name).toBe('TimeoutError')
        expect(requests.calls('/api/login')[0].signal?.aborted).toBe(true)
    })
})
