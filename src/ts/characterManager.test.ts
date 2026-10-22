import { describe, it, expect } from 'vitest'
import { buildGridSections, type ManagerEntry } from './characterManager'
import type { OrderEntry } from './characterOrder'

function entry(chaId: string, extra: Partial<ManagerEntry> = {}): ManagerEntry {
    return {
        chaId, index: 0, name: chaId, image: '', chatCount: 0, lastInteraction: 0, creationDate: 0,
        archived: false, hidden: false, trashed: false, ...extra,
    }
}

function entryMap(...list: ManagerEntry[]): Map<string, ManagerEntry> {
    return new Map(list.map((e) => [e.chaId, e]))
}

const all = () => true

function shape(sections: ReturnType<typeof buildGridSections>) {
    return sections.map((s) => ({ folder: s.folder?.id, ids: s.items.map((e) => e.chaId), start: s.start }))
}

describe('buildGridSections', () => {
    it('keeps the rail sequence: folders as sections, loose runs between them', () => {
        const order: OrderEntry[] = [
            'a', 'b',
            { id: 'f1', name: 'One', color: 'red', data: ['c', 'd'] },
            'e',
            { id: 'f2', name: 'Two', color: '', data: ['f'] },
        ]
        const entries = entryMap(...['a', 'b', 'c', 'd', 'e', 'f'].map((id) => entry(id)))
        expect(shape(buildGridSections(order, entries, all, true))).toEqual([
            { folder: undefined, ids: ['a', 'b'], start: 0 },
            { folder: 'f1', ids: ['c', 'd'], start: 2 },
            { folder: undefined, ids: ['e'], start: 4 },
            { folder: 'f2', ids: ['f'], start: 5 },
        ])
    })

    it('shows empty folders only when asked, and merges the loose runs around a dropped one', () => {
        const order: OrderEntry[] = ['a', { id: 'f1', name: 'Empty', color: '', data: [] }, 'b']
        const entries = entryMap(entry('a'), entry('b'))
        expect(shape(buildGridSections(order, entries, all, true))).toEqual([
            { folder: undefined, ids: ['a'], start: 0 },
            { folder: 'f1', ids: [], start: 1 },
            { folder: undefined, ids: ['b'], start: 1 },
        ])
        expect(shape(buildGridSections(order, entries, all, false))).toEqual([
            { folder: undefined, ids: ['a', 'b'], start: 0 },
        ])
    })

    it('skips trashed, filtered-out, unknown and repeated characters', () => {
        const order: OrderEntry[] = [
            'a', 'gone',
            { id: 'f1', name: 'One', color: '', data: ['a', 'b', 'c'] },
            'd',
        ]
        const entries = entryMap(entry('a'), entry('b', { trashed: true }), entry('c', { hidden: true }), entry('d'))
        const notHidden = (e: ManagerEntry) => !e.hidden
        // f1 ends up with nothing to show (a repeated, b trashed, c filtered out), so it drops out.
        expect(shape(buildGridSections(order, entries, notHidden, false))).toEqual([
            { folder: undefined, ids: ['a', 'd'], start: 0 },
        ])
    })

    it('gives every section a unique key', () => {
        const order: OrderEntry[] = [
            'a', { id: 'f1', name: 'One', color: '', data: ['b'] }, 'c', { id: 'f2', name: 'Two', color: '', data: [] }, 'd',
        ]
        const entries = entryMap(entry('a'), entry('b'), entry('c'), entry('d'))
        const keys = buildGridSections(order, entries, all, true).map((s) => s.key)
        expect(new Set(keys).size).toBe(keys.length)
    })
})
