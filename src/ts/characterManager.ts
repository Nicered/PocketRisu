/**
 * Row model for the character manager: one entry per live, deactivated or
 * trashed character, keyed by chaId. Pure; the Svelte component derives it
 * from the DB and re-derives on change.
 */
import type { Database, folder } from './storage/database.svelte'
import { isFolderEntry, type OrderEntry } from './characterOrder'

export interface ManagerEntry {
    chaId: string
    /** Index into db.characters, or -1 for deactivated stubs. */
    index: number
    name: string
    image: string
    chatCount: number
    lastInteraction: number
    creationDate: number
    archived: boolean
    hidden: boolean
    trashed: boolean
}

export type ManagerSort = 'order' | 'recent' | 'name' | 'created' | 'chats'
export type ManagerFilter = 'all' | 'hidden' | 'archived'

export function buildManagerEntries(db: Database): Map<string, ManagerEntry> {
    const hidden = new Set(db.nodeOnlyHiddenCharacterIds ?? [])
    const out = new Map<string, ManagerEntry>()
    for (let i = 0; i < db.characters.length; i++) {
        const c = db.characters[i]
        if (!c?.chaId || c.chaId === '§temp' || c.chaId === '§playground') continue
        out.set(c.chaId, {
            chaId: c.chaId,
            index: i,
            name: c.name || 'Unnamed',
            image: c.image ?? '',
            chatCount: c.chats?.length ?? 0,
            lastInteraction: c.lastInteraction ?? 0,
            creationDate: c.creation_date ?? 0,
            archived: false,
            hidden: hidden.has(c.chaId),
            trashed: !!c.trashTime,
        })
    }
    for (const stub of db.nodeOnlyArchivedCharacters ?? []) {
        if (!stub?.chaId || out.has(stub.chaId)) continue
        out.set(stub.chaId, {
            chaId: stub.chaId,
            index: -1,
            name: stub.name || 'Unnamed',
            image: stub.image ?? '',
            chatCount: stub.chatCount ?? 0,
            lastInteraction: stub.lastInteraction ?? 0,
            creationDate: stub.creation_date ?? 0,
            archived: true,
            hidden: hidden.has(stub.chaId),
            trashed: !!stub.trashedAt,
        })
    }
    return out
}

export function matchesSearch(name: string, search: string): boolean {
    const q = search.replace(/ /g, '').toLocaleLowerCase()
    if (!q) return true
    return (name ?? '').replace(/ /g, '').toLocaleLowerCase().includes(q)
}

export function matchesFilter(entry: ManagerEntry, filter: ManagerFilter): boolean {
    if (filter === 'hidden') return entry.hidden
    if (filter === 'archived') return entry.archived
    return true
}

/** Flat sort for every mode except 'order' (which follows characterOrder). */
export function sortEntries(entries: ManagerEntry[], sort: ManagerSort): ManagerEntry[] {
    const list = [...entries]
    const byName = (a: ManagerEntry, b: ManagerEntry) => a.name.localeCompare(b.name)
    switch (sort) {
        case 'recent':
            return list.sort((a, b) => (b.lastInteraction - a.lastInteraction) || byName(a, b))
        case 'name':
            return list.sort(byName)
        case 'created':
            return list.sort((a, b) => (b.creationDate - a.creationDate) || byName(a, b))
        case 'chats':
            return list.sort((a, b) => (b.chatCount - a.chatCount) || byName(a, b))
        default:
            return list
    }
}

/** One block of the grid's 'order' view: a folder, or a run of loose characters between folders. */
export interface GridSection {
    key: string
    folder?: folder
    items: ManagerEntry[]
    /** Offset of the first item in the flattened grid, so a paging window can cut across sections. */
    start: number
}

/**
 * The rail sequence as grid sections: one per folder (empty ones only when
 * `keepEmptyFolders`) and untitled runs of loose characters between them.
 * Trashed, invisible and repeated characters are skipped.
 */
export function buildGridSections(
    order: OrderEntry[],
    entries: Map<string, ManagerEntry>,
    visible: (entry: ManagerEntry) => boolean,
    keepEmptyFolders: boolean,
): GridSection[] {
    const sections: Omit<GridSection, 'start'>[] = []
    const seen = new Set<string>()
    const take = (id: string, into: ManagerEntry[]) => {
        const e = entries.get(id)
        if (e && !e.trashed && !seen.has(id) && visible(e)) { seen.add(id); into.push(e) }
    }
    for (const entry of order) {
        if (isFolderEntry(entry)) {
            const items: ManagerEntry[] = []
            entry.data.forEach((id) => take(id, items))
            if (items.length > 0 || keepEmptyFolders) sections.push({ key: `folder:${entry.id}`, folder: entry, items })
        } else {
            let last = sections[sections.length - 1]
            if (!last || last.folder) sections.push(last = { key: `loose:${sections.length}`, items: [] })
            take(entry, last.items)
        }
    }
    let start = 0
    return sections.filter((s) => s.folder || s.items.length > 0).map((s) => {
        const out = { ...s, start }
        start += s.items.length
        return out
    })
}
