import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { mount, tick, unmount } from 'svelte'

const getStatus = vi.fn()
const cancel = vi.fn(async () => {})
const startDownload = vi.fn(async () => {})
const flushSaves = vi.fn(async () => true)
vi.mock('src/ts/globalApi.svelte', () => ({
    forageStorage: {
        getRisuAccountImportStatus: () => getStatus(),
        cancelRisuAccountImport: () => cancel(),
        startRisuAccountDownload: () => startDownload(),
    },
    flushSaves: () => flushSaves(),
}))
vi.mock('src/ts/storage/nodeStorage', () => ({
    RisuAccountImportError: class extends Error {},
}))
vi.mock('src/ts/alert', () => ({
    alertConfirmMulti: vi.fn(async () => -1),
    alertError: vi.fn(),
    alertTOS: vi.fn(async () => false),
}))
// Every string renders as its key; function entries return their key too.
vi.mock('src/lang', () => ({
    language: new Proxy({}, {
        get: (_target, key) => Object.assign(() => String(key), { toString: () => String(key) }),
    }),
}))

import { alertConfirmMulti, alertError } from 'src/ts/alert'
import RisuAccountImport from './RisuAccountImport.svelte'

const base = {
    state: 'idle', blocking: false, error: null, accountId: null, summary: null, progress: null,
    phase: null, steps: null, remainingSeconds: null, missingCount: 0, missing: [], result: null, staged: null,
}
const idle = { ...base }
const preparing = { ...base, state: 'preparing', progress: { phase: 'database', done: 0, total: null, bytes: 0 } }
const ready = {
    ...base,
    state: 'ready',
    accountId: 'account',
    summary: {
        accountId: 'account', characters: 3, chats: 42, assets: 1240, assetsStaged: 0, cold: 18, coldStaged: 0,
        skipped: 0, unresolvedRemotes: 0, damaged: 0, damagedNames: [], estimatedSeconds: 1500,
    },
}

let component: ReturnType<typeof mount> | undefined
let reload: ReturnType<typeof vi.fn>

function mountCard() {
    const target = document.createElement('div')
    document.body.appendChild(target)
    component = mount(RisuAccountImport, { target })
    return target
}

function button(target: HTMLElement, label: string) {
    const found = [...target.querySelectorAll<HTMLButtonElement>('button')].find((element) => element.textContent.trim() === label)
    expect(found).toBeDefined()
    return found!
}

beforeEach(() => {
    vi.useFakeTimers()
    getStatus.mockReset()
    cancel.mockClear()
    startDownload.mockClear()
    flushSaves.mockClear()
    vi.mocked(alertError).mockClear()
    vi.mocked(alertConfirmMulti).mockReset().mockResolvedValue(-1)
    reload = vi.fn()
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, reload } as Location)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(async () => {
    if (component) await unmount(component)
    component = undefined
    document.body.replaceChildren()
    vi.useRealTimers()
    vi.restoreAllMocks()
})

describe('RisuAI account import card', () => {
    test('asks twice before starting, saves pending edits, then reloads into the import screen', async () => {
        getStatus.mockResolvedValue(ready)
        const target = mountCard()
        await vi.advanceTimersByTimeAsync(0)
        expect(target.querySelectorAll('li')).toHaveLength(5)

        vi.mocked(alertConfirmMulti).mockResolvedValueOnce(0).mockResolvedValueOnce(-1)
        button(target, 'risuAccountStart').click()
        await vi.advanceTimersByTimeAsync(0)
        expect(alertConfirmMulti).toHaveBeenCalledTimes(2)
        expect(startDownload).not.toHaveBeenCalled()

        vi.mocked(alertConfirmMulti).mockResolvedValueOnce(0).mockResolvedValueOnce(0)
        button(target, 'risuAccountStart').click()
        await vi.advanceTimersByTimeAsync(0)
        expect(flushSaves).toHaveBeenCalledTimes(1)
        expect(startDownload).toHaveBeenCalledTimes(1)
        expect(reload).toHaveBeenCalledTimes(1)
    })

    test('does not start while edits cannot be saved', async () => {
        getStatus.mockResolvedValue(ready)
        flushSaves.mockResolvedValueOnce(false)
        const target = mountCard()
        await vi.advanceTimersByTimeAsync(0)

        vi.mocked(alertConfirmMulti).mockResolvedValueOnce(0).mockResolvedValueOnce(0)
        button(target, 'risuAccountStart').click()
        await vi.advanceTimersByTimeAsync(0)
        expect(vi.mocked(alertError).mock.calls.map(([message]) => String(message))).toEqual(['risuAccountSaveFailed'])
        expect(startDownload).not.toHaveBeenCalled()
        expect(reload).not.toHaveBeenCalled()
    })

    test('reloads into the import screen when one was started elsewhere', async () => {
        getStatus.mockResolvedValue({ ...ready, state: 'downloading', blocking: true })
        mountCard()
        await vi.advanceTimersByTimeAsync(0)
        expect(reload).toHaveBeenCalledTimes(1)
    })

    test('reads the status again after a failed first read', async () => {
        getStatus.mockRejectedValueOnce(new DOMException('No complete answer', 'AbortError'))
        getStatus.mockResolvedValue(ready)
        const target = mountCard()
        await vi.advanceTimersByTimeAsync(0)
        expect(target.textContent).not.toContain('risuAccountStart')

        await vi.advanceTimersByTimeAsync(5_000)
        await tick()
        expect(getStatus).toHaveBeenCalledTimes(2)
        expect(target.textContent).toContain('risuAccountStart')
    })

    test('ignores a status answer that comes back after a newer one', async () => {
        let answerLate: (value: unknown) => void = () => {}
        getStatus.mockResolvedValueOnce(preparing)
        getStatus.mockReturnValueOnce(new Promise((resolve) => { answerLate = resolve }))
        getStatus.mockResolvedValue(idle)
        const target = mountCard()
        await vi.advanceTimersByTimeAsync(0)
        expect(target.textContent).toContain('risuAccountChecking')

        // The poll's read hangs; cancelling runs a newer read that answers first.
        await vi.advanceTimersByTimeAsync(1_500)
        expect(getStatus).toHaveBeenCalledTimes(2)
        button(target, 'cancel').click()
        await vi.advanceTimersByTimeAsync(0)
        expect(cancel).toHaveBeenCalledTimes(1)
        expect(getStatus).toHaveBeenCalledTimes(3)
        expect(target.textContent).not.toContain('risuAccountChecking')

        answerLate(preparing)
        await vi.advanceTimersByTimeAsync(1_500 * 2)
        expect(target.textContent).not.toContain('risuAccountChecking')
        expect(getStatus).toHaveBeenCalledTimes(3)
    })

    test('stops polling once the card is gone', async () => {
        getStatus.mockResolvedValue(preparing)
        mountCard()
        await vi.advanceTimersByTimeAsync(0)
        await unmount(component!)
        component = undefined

        await vi.advanceTimersByTimeAsync(1_500 * 4)
        expect(getStatus).toHaveBeenCalledTimes(1)
    })
})
