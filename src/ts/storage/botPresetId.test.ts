import { describe, test, expect, beforeEach, vi } from 'vitest'

// Mock heavy dependencies so importing database.svelte doesn't drag in the
// full Svelte/forage/globalApi stack. We do NOT mock database.svelte itself —
// these tests exercise the real botPreset id helpers and the active-preset
// stability invariant that PR S3 establishes.

vi.mock('../stores.svelte', () => {
    const state: { db: any } = { db: {} }
    const noopStore = { subscribe: () => () => {}, set: () => {}, update: () => {} }
    return {
        DBState: state,
        selectedCharID: noopStore,
        selIdState: { selId: -1 },
    }
})

vi.mock('../globalApi.svelte', () => ({
    forageStorage: { realStorage: null },
    downloadFile: () => {},
    saveAsset: () => Promise.resolve(''),
}))

vi.mock('../alert', () => ({
    notifySuccess: () => {},
    notifyWarning: vi.fn(),
    alertError: () => {},
}))

vi.mock('../../lang', () => ({
    language: { recoveredPresetName: 'Recovered Preset', recoveredPresetNotice: 'recovered' },
    changeLanguage: () => {},
}))

const databaseModule = await import('./database.svelte')
const storesModule = await import('../stores.svelte')
const alertModule = await import('../alert')
const {
    changeToPreset,
    saveCurrentPreset,
    createBotPresetTemplate,
    getActiveBotPreset,
    getActiveBotPresetId,
    getBotPresetById,
    getBotPresetIndexById,
    setActiveBotPresetById,
    withStableActivePreset,
} = databaseModule
const { DBState } = storesModule as any

function makePreset(id: string, name: string) {
    return { id, name, mainPrompt: '', jailbreak: '', globalNote: '', temperature: 0, maxContext: 0, maxResponse: 0, frequencyPenalty: 0, PresensePenalty: 0, formatingOrder: [], bias: [], promptPreprocess: false }
}

beforeEach(() => {
    DBState.db = {
        botPresets: [
            makePreset('id-a', 'A'),
            makePreset('id-b', 'B'),
            makePreset('id-c', 'C'),
        ],
        botPresetsId: 1,
    }
})

describe('createBotPresetTemplate', () => {
    test('assigns a unique UUID on each call', () => {
        const a = createBotPresetTemplate()
        const b = createBotPresetTemplate()
        expect(a.id).toBeTruthy()
        expect(b.id).toBeTruthy()
        expect(a.id).not.toBe(b.id)
    })

    test('returns a deep-cloned template (mutating one does not affect another)', () => {
        const a = createBotPresetTemplate()
        const b = createBotPresetTemplate()
        a.name = 'Mutated'
        expect(b.name).not.toBe('Mutated')
    })
})

describe('id lookup helpers', () => {
    test('getActiveBotPreset returns the entry at botPresetsId', () => {
        expect(getActiveBotPreset()?.id).toBe('id-b')
    })

    test('getActiveBotPresetId returns the active id', () => {
        expect(getActiveBotPresetId()).toBe('id-b')
    })

    test('getBotPresetById finds by id', () => {
        expect(getBotPresetById('id-c')?.name).toBe('C')
    })

    test('getBotPresetIndexById returns -1 when not found', () => {
        expect(getBotPresetIndexById('id-missing')).toBe(-1)
    })

    test('setActiveBotPresetById updates botPresetsId via findIndex', () => {
        setActiveBotPresetById('id-c')
        expect(DBState.db.botPresetsId).toBe(2)
    })

    test('setActiveBotPresetById(undefined) sets the no-active sentinel', () => {
        setActiveBotPresetById(undefined)
        expect(DBState.db.botPresetsId).toBe(-1)
    })
})

describe('withStableActivePreset', () => {
    test('preserves active id when array is reordered', () => {
        // botPresetsId=1 (id-b) is active. Move 'B' from index 1 to index 0.
        withStableActivePreset(() => {
            const arr = DBState.db.botPresets
            const moved = arr.splice(1, 1)[0]
            arr.splice(0, 0, moved)
            DBState.db.botPresets = arr
        })
        // After reorder, B is at index 0. botPresetsId should follow.
        expect(DBState.db.botPresetsId).toBe(0)
        expect(getActiveBotPresetId()).toBe('id-b')
    })

    test('preserves active id when a non-active preset is removed', () => {
        // botPresetsId=1 (id-b). Remove id-a (index 0).
        withStableActivePreset(() => {
            DBState.db.botPresets.splice(0, 1)
        })
        // B should still be active (now at index 0).
        expect(getActiveBotPresetId()).toBe('id-b')
        expect(DBState.db.botPresetsId).toBe(0)
    })

    test('clamps to 0 when the active preset itself is removed', () => {
        // botPresetsId=1 (id-b). Remove id-b.
        withStableActivePreset(() => {
            DBState.db.botPresets.splice(1, 1)
        })
        // active id was id-b which no longer exists → fall back to 0.
        expect(DBState.db.botPresetsId).toBe(0)
        expect(getActiveBotPresetId()).toBe('id-a')
    })

    test('handles append (length grows) without losing active', () => {
        withStableActivePreset(() => {
            DBState.db.botPresets.push(makePreset('id-d', 'D'))
        })
        expect(getActiveBotPresetId()).toBe('id-b')
        expect(DBState.db.botPresetsId).toBe(1)
    })
})

describe('id migration safety', () => {
    test('helpers cope with presets missing an id (treat as not findable)', () => {
        DBState.db.botPresets = [
            { name: 'no-id-preset' },
            makePreset('id-x', 'X'),
        ]
        DBState.db.botPresetsId = 0
        // Active preset has no id → getActiveBotPresetId returns undefined,
        // setupping the migration path (setDatabase will fix it on next load).
        expect(getActiveBotPresetId()).toBeUndefined()
        // Lookup by id still works for the indexed entry.
        expect(getBotPresetIndexById('id-x')).toBe(1)
    })
})

describe('active index with no preset behind it (#100)', () => {
    test('saveCurrentPreset keeps the active settings as a new preset instead of throwing', () => {
        DBState.db.botPresetsId = 5
        DBState.db.mainPrompt = 'live edits'
        expect(() => saveCurrentPreset()).not.toThrow()
        expect(DBState.db.botPresets.map((p: any) => p.name)).toEqual(['A', 'B', 'C', 'Recovered Preset'])
        const recovered = DBState.db.botPresets[3]
        expect(recovered.mainPrompt).toBe('live edits')
        expect(recovered.id).toBeTruthy()
        expect(['id-a', 'id-b', 'id-c']).not.toContain(recovered.id)
        expect(DBState.db.botPresetsId).toBe(3)
        expect(DBState.db.botPresets.slice(0, 3).map((p: any) => p.mainPrompt)).toEqual(['', '', ''])
        expect(alertModule.notifyWarning).toHaveBeenCalledWith('recovered')
    })

    test('changeToPreset recovers the active settings, then switches without overwriting the target', () => {
        // setPreset falls back to db.NAIsettings, which setDatabase always fills.
        DBState.db.NAIsettings = {}
        DBState.db.botPresetsId = 3
        DBState.db.mainPrompt = 'live edits'
        expect(() => changeToPreset(0)).not.toThrow()
        expect(DBState.db.botPresetsId).toBe(0)
        expect(DBState.db.botPresets).toHaveLength(4)
        expect(DBState.db.botPresets[0].mainPrompt).toBe('')
        expect(DBState.db.botPresets[3].mainPrompt).toBe('live edits')
        expect(DBState.db.mainPrompt).toBe('')
    })

    test('changeToPreset ignores a target index with no preset', () => {
        expect(() => changeToPreset(9, false)).not.toThrow()
        expect(DBState.db.botPresetsId).toBe(1)
    })

    test('a valid index still saves into the active preset in place', () => {
        DBState.db.botPresets[1].folderId = 'folder-1'
        DBState.db.mainPrompt = 'edited'
        saveCurrentPreset()
        expect(DBState.db.botPresets).toHaveLength(3)
        expect(DBState.db.botPresets[1]).toMatchObject({ id: 'id-b', name: 'B', mainPrompt: 'edited', folderId: 'folder-1' })
        expect(DBState.db.botPresetsId).toBe(1)
    })

    test('botPresetsId -1 still skips saving', () => {
        DBState.db.botPresetsId = -1
        saveCurrentPreset()
        expect(DBState.db.botPresets).toHaveLength(3)
        expect(DBState.db.botPresetsId).toBe(-1)
    })
})
