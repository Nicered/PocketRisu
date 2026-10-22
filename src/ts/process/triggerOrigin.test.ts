import { writable } from 'svelte/store'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const trackChatForSave = vi.fn()
const requestImmediateSave = vi.fn()
const selectedCharID = writable(0)
const DBState = { db: { characters: [] as any[] } }

vi.mock('../globalApi.svelte', () => ({ requestImmediateSave, trackChatForSave }))
vi.mock('../storage/database.svelte', () => ({ normalizeChat: (chat: unknown) => chat }))
vi.mock('../stores.svelte', () => ({ DBState, selectedCharID }))

const { getTriggerOrigin, setTriggerOriginChat } = await import('./triggerOrigin')

function chat(id: string, text = id) {
    return { id, message: [{ role: 'char', data: text }] } as any
}

function char(chaId: string, chats: any[], chatPage = 0) {
    return { chaId, chats, chatPage } as any
}

beforeEach(() => {
    trackChatForSave.mockClear()
    requestImmediateSave.mockClear()
    selectedCharID.set(0)
})

describe('setTriggerOriginChat', () => {
    test('writes into the open chat when nothing moved', () => {
        const a = chat('a')
        DBState.db.characters = [char('x', [a, chat('b')])]
        const origin = getTriggerOrigin(DBState.db.characters[0])

        expect(setTriggerOriginChat(origin, chat('a', 'result'))).toBe(true)

        expect(DBState.db.characters[0].chats[0].message[0].data).toBe('result')
        expect(DBState.db.characters[0].chats[1].message[0].data).toBe('b')
        expect(trackChatForSave).not.toHaveBeenCalled()
        expect(requestImmediateSave).not.toHaveBeenCalled()
    })

    test('writes back to the original chat after another chat was opened', () => {
        DBState.db.characters = [char('x', [chat('a'), chat('b')])]
        const origin = getTriggerOrigin(DBState.db.characters[0])
        DBState.db.characters[0].chatPage = 1

        expect(setTriggerOriginChat(origin, chat('a', 'result'))).toBe(true)

        expect(DBState.db.characters[0].chats[0].message[0].data).toBe('result')
        expect(DBState.db.characters[0].chats[1].message[0].data).toBe('b')
        expect(trackChatForSave).toHaveBeenCalledWith('x', 'a')
        expect(requestImmediateSave).toHaveBeenCalled()
    })

    test('writes back to the original character after another character was opened', () => {
        DBState.db.characters = [char('x', [chat('a')]), char('y', [chat('c')])]
        const origin = getTriggerOrigin(DBState.db.characters[0])
        selectedCharID.set(1)

        expect(setTriggerOriginChat(origin, chat('a', 'result'))).toBe(true)

        expect(DBState.db.characters[0].chats[0].message[0].data).toBe('result')
        expect(DBState.db.characters[1].chats[0].message[0].data).toBe('c')
        expect(trackChatForSave).toHaveBeenCalledWith('x', 'a')
        expect(requestImmediateSave).toHaveBeenCalled()
    })

    test('follows the original chat when the chats were reordered', () => {
        const a = chat('a')
        DBState.db.characters = [char('x', [a, chat('b')])]
        const origin = getTriggerOrigin(DBState.db.characters[0])
        DBState.db.characters[0].chats = [chat('b'), a]
        DBState.db.characters[0].chatPage = 1

        expect(setTriggerOriginChat(origin, chat('a', 'result'))).toBe(true)

        expect(DBState.db.characters[0].chats[1].message[0].data).toBe('result')
        expect(DBState.db.characters[0].chats[0].message[0].data).toBe('b')
        expect(trackChatForSave).not.toHaveBeenCalled()
        expect(requestImmediateSave).not.toHaveBeenCalled()
    })

    test('finds a replaced slot by chat id', () => {
        DBState.db.characters = [char('x', [chat('b'), chat('a')], 1)]
        const origin = getTriggerOrigin(DBState.db.characters[0])
        DBState.db.characters[0].chats[1] = chat('a', 'synced')
        DBState.db.characters[0].chatPage = 0

        expect(setTriggerOriginChat(origin, chat('a', 'result'))).toBe(true)

        expect(DBState.db.characters[0].chats[1].message[0].data).toBe('result')
        expect(DBState.db.characters[0].chats[0].message[0].data).toBe('b')
        expect(trackChatForSave).toHaveBeenCalledWith('x', 'a')
        expect(requestImmediateSave).toHaveBeenCalled()
    })

    test('writes nothing when the original chat was deleted', () => {
        DBState.db.characters = [char('x', [chat('a'), chat('b')])]
        const origin = getTriggerOrigin(DBState.db.characters[0])
        DBState.db.characters[0].chats.splice(0, 1)
        DBState.db.characters[0].chatPage = 0

        expect(setTriggerOriginChat(origin, chat('a', 'result'))).toBe(false)

        expect(DBState.db.characters[0].chats).toEqual([chat('b')])
        expect(trackChatForSave).not.toHaveBeenCalled()
        expect(requestImmediateSave).not.toHaveBeenCalled()
    })

    test('writes nothing when the original character was deleted', () => {
        DBState.db.characters = [char('x', [chat('a')]), char('y', [chat('c')])]
        const origin = getTriggerOrigin(DBState.db.characters[0])
        DBState.db.characters.splice(0, 1)

        expect(setTriggerOriginChat(origin, chat('a', 'result'))).toBe(false)

        expect(DBState.db.characters[0].chats).toEqual([chat('c')])
        expect(trackChatForSave).not.toHaveBeenCalled()
        expect(requestImmediateSave).not.toHaveBeenCalled()
    })
})
