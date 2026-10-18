import { beforeEach, describe, expect, test, vi } from 'vitest'
import { get, writable, type Writable } from 'svelte/store'

vi.mock('./stores.svelte', () => ({
    alertStore: writable({ type: 'none', msg: '' }),
    togglePresetsOpenStore: writable(false),
}))
vi.mock('./storage/database.svelte', () => ({ getDatabase: () => ({}), nodeOnlyVer: 'test' }))
vi.mock('../lang', () => ({ language: {} }))
vi.mock('./util', () => ({ sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)) }))
vi.mock('./log', () => ({ addLog: () => {} }))
vi.mock('./log-capture', () => ({ nativeConsoleError: () => {} }))
vi.mock('svelte-sonner', () => ({ toast: Object.assign(() => {}, { error: () => {}, success: () => {}, info: () => {}, warning: () => {} }) }))

const { alertTOS, RISU_TOS_ACCEPT_RESULT, risuTosAccepted } = await import('./alert')
const alertStore = (await import('./stores.svelte')).alertStore as unknown as Writable<{ type: string, msg: string }>

const STORAGE_KEY = 'nodeOnlyRisuTos'

// Resolve the open terms dialog the way a dialog would: a final store write
// with type 'none' and the clicked result.
async function answer(msg: string) {
    await vi.waitFor(() => expect(get(alertStore).type).toBe('tos'))
    alertStore.set({ type: 'none', msg })
}

beforeEach(() => {
    localStorage.clear()
    alertStore.set({ type: 'none', msg: '' })
    risuTosAccepted.set(false)
})

describe('alertTOS', () => {
    test('a plain yes from another dialog that replaced it is not consent', async () => {
        const pending = alertTOS()
        await vi.waitFor(() => expect(get(alertStore).type).toBe('tos'))
        alertStore.set({ type: 'ask', msg: 'Allow plugin access?' })
        alertStore.set({ type: 'none', msg: 'yes' })
        expect(await pending).toBe(false)
        expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
        expect(get(risuTosAccepted)).toBe(false)
    })

    test('declining stores nothing', async () => {
        const pending = alertTOS()
        await answer('no')
        expect(await pending).toBe(false)
        expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
    })

    test('the terms dialog accept result stores the current revision', async () => {
        const pending = alertTOS()
        await answer(RISU_TOS_ACCEPT_RESULT)
        expect(await pending).toBe(true)
        expect(localStorage.getItem(STORAGE_KEY)).toBe('2026-04-11')
        expect(get(risuTosAccepted)).toBe(true)
        // Already accepted: no dialog the next time.
        expect(await alertTOS()).toBe(true)
        expect(get(alertStore).type).toBe('none')
    })
})
