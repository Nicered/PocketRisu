'use strict';

// Upstream RisuAI keeps V3 plugin storage in cold storage. Two layouts reach
// NodeOnly through .bin backups and copied save folders:
//
//  - cad8595a: pluginCustomStorage._coldplugin = { key: coldId }, one cold
//    item per value.
//  - 68b5d032c (v2026.10.210+): pluginCustomStorage._coldpluginIndex = the
//    cold id of an index item { type: 'risu-plugin-storage-index', version: 1,
//    entries: [{ k, s?, l? }], trash: [...] }. `s` is the value's JSON text,
//    `l` the cold id of a large value kept in its own item. Upstream moves
//    every user with plugin data to this layout on first boot.
//
// NodeOnly keeps plugin storage as plain keys in kv, so both layouts are
// folded back into keys here (migration only; the upstream runtime layout is
// never written). Cold items are never deleted, and whatever cannot be
// restored comes back as a recovery record for the caller to keep outside
// the plugin key space.

const LEGACY_MAP_KEY = '_coldplugin';
const INDEX_KEY = '_coldpluginIndex';
const RESERVED_KEYS = Object.freeze([INDEX_KEY, LEGACY_MAP_KEY]);
const INDEX_TYPE = 'risu-plugin-storage-index';
const INDEX_VERSION = 1;
// Shadowed values stay in their cold items, so only a sample of the keys is
// recorded as a hint.
const SHADOWED_SAMPLE_LIMIT = 200;

function hasOwn(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
}

function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isReservedKey(key) {
    return RESERVED_KEYS.includes(key);
}

function hasReservedKeys(storage) {
    return isPlainObject(storage) && RESERVED_KEYS.some((key) => hasOwn(storage, key));
}

// Throws when the index item is missing or not a layout this code knows, so
// an unknown future version is reported instead of being half-read.
function readIndexEntries(pointer, readCold) {
    const index = readCold(pointer);
    if (index === undefined) throw new Error('index item not found');
    if (!isPlainObject(index) || index.type !== INDEX_TYPE) throw new Error('not a plugin storage index');
    if (index.version !== INDEX_VERSION) throw new Error(`unsupported index version ${index.version}`);
    if (!Array.isArray(index.entries) || !Array.isArray(index.trash)) throw new Error('malformed index');
    const entries = new Map();
    for (const entry of index.entries) {
        if (typeof entry?.k !== 'string') continue;
        // Same precedence as upstream's PluginStorageStore: a large item wins
        // over inline JSON, and a repeated key keeps its last entry.
        if (typeof entry.l === 'string') entries.set(entry.k, { large: entry.l });
        else if (typeof entry.s === 'string') entries.set(entry.k, { json: entry.s });
    }
    return { entries, trashCount: index.trash.length };
}

function sample(keys) {
    return keys.length > SHADOWED_SAMPLE_LIMIT ? keys.slice(0, SHADOWED_SAMPLE_LIMIT) : keys;
}

/**
 * Folds the upstream layouts found under the reserved keys of `storage` back
 * into plain plugin keys. Nothing is written; the caller applies `assign`.
 *
 * @param {object} storage pluginCustomStorage-shaped object; only its
 *   reserved keys are read.
 * @param {object} opts
 * @param {(id: string) => unknown} opts.readCold parsed cold item, or
 *   undefined when it does not exist; may throw when it cannot be read.
 * @param {(key: string) => boolean} opts.isPresent whether `key` already holds
 *   a live value that wins over the cold copies.
 * @param {string} opts.source recorded with the recovery entry.
 * @returns {{ assign: Array<[string, unknown]>, record: object|null, restored: number, failed: number }}
 */
function resolveUpstreamPluginStorage(storage, { readCold, isPresent, source }) {
    const assign = [];
    const assigned = new Set();
    const record = { source, at: Date.now() };
    let failed = 0;
    let keepRecord = false;

    let indexEntries = new Map();
    const hasPointer = hasOwn(storage, INDEX_KEY);
    if (hasPointer) {
        const pointer = storage[INDEX_KEY];
        record.pointer = pointer;
        keepRecord = true;
        if (typeof pointer !== 'string' || !pointer) {
            record.pointerError = 'invalid pointer';
            failed++;
        } else {
            try {
                const read = readIndexEntries(pointer, readCold);
                indexEntries = read.entries;
                record.trashCount = read.trashCount;
            } catch (err) {
                record.pointerError = String(err?.message || err);
                failed++;
            }
        }
    }

    const shadowedIndex = [];
    const failedEntries = [];
    for (const [key, entry] of indexEntries) {
        if (isReservedKey(key)) continue;
        if (isPresent(key)) {
            shadowedIndex.push(key);
            continue;
        }
        try {
            let value;
            if (entry.large !== undefined) {
                value = readCold(entry.large);
                if (value === undefined) throw new Error('large item not found');
            } else {
                value = JSON.parse(entry.json);
            }
            assign.push([key, value]);
            assigned.add(key);
        } catch {
            failedEntries.push(entry.large !== undefined ? { k: key, l: entry.large } : { k: key });
            failed++;
        }
    }

    const legacyFailed = {};
    const shadowedLegacy = [];
    if (hasOwn(storage, LEGACY_MAP_KEY)) {
        const legacyMap = storage[LEGACY_MAP_KEY];
        if (!isPlainObject(legacyMap)) {
            record.invalidLegacyMap = legacyMap;
            keepRecord = true;
        } else {
            // The per-key map predates the index, and a present key of the
            // same name was written after upstream moved it (an older build,
            // a V2 plugin), so both are newer — upstream's migrateLegacy drops
            // such a legacy entry unread. Its cold row is left in place.
            for (const key of Object.keys(legacyMap)) {
                const id = legacyMap[key];
                if (isReservedKey(key)) continue;
                if (indexEntries.has(key) || assigned.has(key) || isPresent(key)) {
                    shadowedLegacy.push(key);
                    continue;
                }
                let value;
                try {
                    value = typeof id === 'string' && id ? readCold(id) : undefined;
                } catch {
                    value = undefined;
                }
                if (value === undefined) {
                    legacyFailed[key] = id;
                    failed++;
                    continue;
                }
                assign.push([key, value]);
                assigned.add(key);
            }
        }
    }

    if (failedEntries.length > 0) record.failedEntries = failedEntries;
    if (Object.keys(legacyFailed).length > 0) record.legacyFailed = legacyFailed;
    if (shadowedIndex.length > 0) {
        record.shadowedIndexCount = shadowedIndex.length;
        record.shadowedIndexKeys = sample(shadowedIndex);
    }
    if (shadowedLegacy.length > 0) {
        record.shadowedLegacyCount = shadowedLegacy.length;
        record.shadowedLegacyKeys = sample(shadowedLegacy);
    }
    if (failed > 0 || shadowedIndex.length > 0 || shadowedLegacy.length > 0) keepRecord = true;

    return { assign, record: keepRecord ? record : null, restored: assign.length, failed };
}

module.exports = {
    LEGACY_MAP_KEY,
    INDEX_KEY,
    RESERVED_KEYS,
    INDEX_TYPE,
    isReservedKey,
    hasReservedKeys,
    resolveUpstreamPluginStorage,
};
