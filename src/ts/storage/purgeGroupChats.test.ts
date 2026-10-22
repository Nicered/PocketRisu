import { describe, it, expect, vi } from 'vitest'
import { writable } from 'svelte/store'

// The real stores module starts app-wide effects on import; the purge needs none of it.
vi.mock(import('../stores.svelte'), () => ({ DBState: { db: {} }, selectedCharID: writable(-1), selIdState: {} }) as any)

import { purgeUnsupportedGroupChats, type Database } from './database.svelte'

describe('purgeUnsupportedGroupChats', () => {
    it('drops group chats from the order but keeps every folder, empty ones included', () => {
        const db = {
            characters: [{ chaId: 'a', type: 'character' }, { chaId: 'g', type: 'group' }],
            nodeOnlyArchivedCharacters: [{ chaId: 'z' }],
            characterOrder: [
                'a', 'g',
                { id: 'f1', name: 'Groups', color: '', data: ['g'] },
                { id: 'f2', name: 'New', color: 'red', data: [] },
                { id: 'f3', name: 'Mixed', color: '', data: ['g', 'z'] },
            ],
        } as unknown as Database
        expect(purgeUnsupportedGroupChats(db)).toBe(1)
        expect(db.characterOrder).toEqual([
            'a',
            { id: 'f1', name: 'Groups', color: '', data: [] },
            { id: 'f2', name: 'New', color: 'red', data: [] },
            { id: 'f3', name: 'Mixed', color: '', data: ['z'] },
        ])
    })
})
