import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { mount, tick, unmount } from 'svelte'

const getStatus = vi.fn()
const cancel = vi.fn(async () => {})
const apply = vi.fn(async () => {})
const retry = vi.fn(async () => {})
vi.mock('src/ts/globalApi.svelte', () => ({
    forageStorage: {
        getRisuAccountImportStatus: () => getStatus(),
        cancelRisuAccountImport: () => cancel(),
        applyRisuAccountImport: () => apply(),
        startRisuAccountDownload: () => retry(),
    },
}))
vi.mock('src/ts/storage/nodeStorage', () => ({
    RisuAccountImportError: class extends Error {},
}))
vi.mock('src/ts/alert', () => ({
    alertConfirm: vi.fn(async () => false),
    alertError: vi.fn(),
    alertStore: { set: vi.fn() },
    waitAlert: vi.fn(async () => {}),
}))
// Every string renders as its key; function entries return their key too.
vi.mock('src/lang', () => ({
    language: new Proxy({}, {
        get: (_target, key) => Object.assign(() => String(key), { toString: () => String(key) }),
    }),
}))

import { alertConfirm, alertError, alertStore } from 'src/ts/alert'
import RisuAccountImportScreen from './RisuAccountImportScreen.svelte'

const summary = {
    accountId: 'account', characters: 3, chats: 42, assets: 1240, assetsStaged: 0, cold: 18, coldStaged: 0,
    skipped: 0, unresolvedRemotes: 0, damaged: 0, damagedNames: [], estimatedSeconds: 1500,
}
const base = {
    state: 'downloading', blocking: true, error: null, accountId: 'account', summary, progress: null,
    phase: 'assets', remainingSeconds: 840, missingCount: 0, missing: [], result: null, staged: null,
    steps: { cold: { done: 18, total: 18, bytes: 100 }, assets: { done: 412, total: 1240, bytes: 40_000_000 }, apply: null },
}
const downloading = { ...base }
const done = { ...base, state: 'idle', blocking: false, phase: null, steps: null, remainingSeconds: null, result: { missing: 0, coldStorageFailed: 0 } }

let component: ReturnType<typeof mount> | undefined
let reload: ReturnType<typeof vi.fn>

function mountScreen() {
    const target = document.createElement('div')
    document.body.appendChild(target)
    component = mount(RisuAccountImportScreen, { target })
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
    apply.mockClear()
    vi.mocked(alertConfirm).mockReset().mockResolvedValue(false)
    vi.mocked(alertError).mockClear()
    vi.mocked(alertStore.set).mockClear()
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

describe('RisuAI account import screen', () => {
    test('follows the download and reloads once the import is applied', async () => {
        getStatus.mockResolvedValueOnce(downloading)
        getStatus.mockResolvedValueOnce({ ...downloading, state: 'applying', phase: 'apply', remainingSeconds: null, steps: { ...downloading.steps, apply: { done: 5, total: 10 } } })
        getStatus.mockResolvedValue(done)
        const target = mountScreen()
        await vi.advanceTimersByTimeAsync(0)
        expect(target.textContent).toContain('risuAccountStepAssets')
        expect(target.textContent).toContain('412/1,240')
        expect(target.textContent).toContain('risuAccountRemaining')

        await vi.advanceTimersByTimeAsync(1_500)
        expect(target.textContent).toContain('risuAccountApplyingTitle')
        expect(target.textContent).toContain('50.0%')

        await vi.advanceTimersByTimeAsync(1_500)
        expect(vi.mocked(alertStore.set).mock.calls.map(([alert]) => `${alert.type}:${alert.msg}`)).toEqual(['wait:risuAccountDone'])
        expect(reload).toHaveBeenCalledTimes(1)
    })

    test('warns about cold storage items that could not be restored before reloading', async () => {
        getStatus.mockResolvedValue({ ...done, result: { missing: 0, coldStorageFailed: 2 } })
        mountScreen()
        await vi.advanceTimersByTimeAsync(0)
        expect(alertError).toHaveBeenCalledWith(expect.stringContaining('2 character(s)'))
        expect(reload).toHaveBeenCalledTimes(1)
    })

    test('reads the status again after a failed read', async () => {
        getStatus.mockRejectedValueOnce(new DOMException('No complete answer', 'AbortError'))
        getStatus.mockResolvedValue(downloading)
        const target = mountScreen()
        await vi.advanceTimersByTimeAsync(0)
        expect(target.textContent).not.toContain('risuAccountScreenTitle')

        await vi.advanceTimersByTimeAsync(5_000)
        await tick()
        expect(target.textContent).toContain('risuAccountScreenTitle')
    })

    test('asks before replacing the data without the missing items', async () => {
        getStatus.mockResolvedValue({
            ...base, state: 'downloaded', remainingSeconds: null, missingCount: 3,
            missing: [
                { kind: 'asset', key: 'assets/a.png', status: 204, reason: 'not-found' },
                { kind: 'asset', key: 'assets/b.png', status: 204, reason: 'not-found' },
                { kind: 'cold', key: 'c', status: 200, reason: 'unreadable' },
            ],
        })
        const target = mountScreen()
        await vi.advanceTimersByTimeAsync(0)
        expect([...target.querySelectorAll('li')].map((li) => li.textContent.replace(/\s+/g, ' ').trim())).toEqual([
            'risuAccountMissingAssets, risuAccountMissingNotFound',
            'risuAccountMissingCold, risuAccountMissingUnreadable',
        ])
        button(target, 'risuAccountApplyWithout').click()
        await vi.advanceTimersByTimeAsync(0)
        expect(apply).toHaveBeenCalledTimes(1)
    })

    test('cancels only after a confirmation, then reloads into the app', async () => {
        getStatus.mockResolvedValueOnce(downloading)
        getStatus.mockResolvedValue({ ...done, result: null })
        const target = mountScreen()
        await vi.advanceTimersByTimeAsync(0)

        button(target, 'risuAccountCancel').click()
        await vi.advanceTimersByTimeAsync(0)
        expect(cancel).not.toHaveBeenCalled()

        vi.mocked(alertConfirm).mockResolvedValueOnce(true)
        button(target, 'risuAccountCancel').click()
        await vi.advanceTimersByTimeAsync(0)
        expect(cancel).toHaveBeenCalledTimes(1)
        expect(alertStore.set).not.toHaveBeenCalled()
        expect(reload).toHaveBeenCalledTimes(1)
    })

    test('a pause names the cause and offers a retry', async () => {
        getStatus.mockResolvedValue({ ...base, state: 'paused', remainingSeconds: null, error: { message: 'HTTP 502', code: 'ACCOUNT_REQUEST_FAILED' } })
        const target = mountScreen()
        await vi.advanceTimersByTimeAsync(0)
        expect(target.textContent).toContain('risuAccountPaused')
        expect(target.textContent).toContain('risuAccountKeptFiles')
        button(target, 'risuAccountRetry').click()
        await vi.advanceTimersByTimeAsync(0)
        expect(retry).toHaveBeenCalledTimes(1)
    })

    test('after a restart it offers a login to continue', async () => {
        getStatus.mockResolvedValue({
            ...base, state: 'needs-login', phase: null, steps: null, remainingSeconds: null, staged: { files: 1180, total: 1240 },
            error: { message: 'restarted', code: 'ACCOUNT_IMPORT_INTERRUPTED' },
        })
        const target = mountScreen()
        await vi.advanceTimersByTimeAsync(0)
        expect(target.textContent).toContain('risuAccountInterruptedTitle')
        expect(target.textContent).toContain('risuAccountStagedFiles')
        expect(target.textContent).toContain('risuAccountDataUnchanged')
        button(target, 'risuAccountReloginResume')
    })

    test('stops polling once the screen is gone', async () => {
        getStatus.mockResolvedValue(downloading)
        mountScreen()
        await vi.advanceTimersByTimeAsync(0)
        await unmount(component!)
        component = undefined

        await vi.advanceTimersByTimeAsync(1_500 * 4)
        expect(getStatus).toHaveBeenCalledTimes(1)
    })
})
