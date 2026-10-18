import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// db.cjs opens ./save/risuai.db relative to the working directory on require,
// so each probe runs in a child process inside a temp dir.
const DB_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'db.cjs')

const KEYS = [
    'assets/a.png',
    'assets/B.PNG',
    'assets/%_\\odd.png',
    'Assets/upper.png',
    'assets',
    'assets0',
    'assetsX/x.png',
    'plugin-storage/p/k',
    'plugin-storage-snapshot/1/p/k',
    'remotes/c.local.bin',
    'remotes/c.local.bin.meta',
    '한글/키',
    '한글키',
    'a%b',
    'axb',
]

let tmpDir: string

function probe(body: string): any {
    const script = `
        const { kvSet, kvList, kvListWithSizes, kvDelPrefix, db } = require(${JSON.stringify(DB_PATH)});
        const keys = ${JSON.stringify(KEYS)};
        for (const [i, key] of keys.entries()) kvSet(key, Buffer.alloc(i + 1));
        const out = (() => { ${body} })();
        process.stdout.write(JSON.stringify(out));
    `
    return JSON.parse(execFileSync(process.execPath, ['-e', script], { cwd: tmpDir, encoding: 'utf-8' }))
}

function startsWith(prefix: string) {
    return KEYS.filter((key) => key.startsWith(prefix)).sort()
}

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kv-prefix-'))
})

afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('kv prefix helpers', () => {
    const prefixes = ['assets/', 'plugin-storage/', 'remotes/', 'a%', '한글/', '한글']

    it('kvList and kvListWithSizes return exactly the keys starting with the prefix', () => {
        const result = probe(`
            const prefixes = ${JSON.stringify(prefixes)};
            return prefixes.map((p) => ({
                list: kvList(p).sort(),
                sizes: kvListWithSizes(p).sort((x, y) => x.key < y.key ? -1 : 1),
            }));
        `)
        prefixes.forEach((prefix, i) => {
            expect(result[i].list).toEqual(startsWith(prefix))
            expect(result[i].sizes.map((r: any) => r.key)).toEqual(startsWith(prefix))
            for (const row of result[i].sizes) expect(row.size).toBe(KEYS.indexOf(row.key) + 1)
        })
    })

    it('kvDelPrefix deletes exactly the keys starting with the prefix', () => {
        const remaining = probe(`
            kvDelPrefix('assets/');
            kvDelPrefix('plugin-storage/');
            return db.prepare('SELECT key FROM kv').all().map((r) => r.key).sort();
        `)
        const deleted = new Set([...startsWith('assets/'), ...startsWith('plugin-storage/')])
        expect(remaining).toEqual(KEYS.filter((key) => !deleted.has(key)).sort())
    })

    it('ASCII-terminated prefixes are answered from the key index, not a table scan', () => {
        const plans = probe(`
            const plan = (sql) => db.prepare('EXPLAIN QUERY PLAN ' + sql).all('assets/', 'assets0').map((r) => r.detail).join(' | ');
            return [
                plan('SELECT key FROM kv WHERE key >= ? AND key < ?'),
                plan('SELECT key, LENGTH(value) as size FROM kv WHERE key >= ? AND key < ?'),
            ];
        `)
        for (const plan of plans) {
            expect(plan).toMatch(/SEARCH kv USING (COVERING )?INDEX sqlite_autoindex_kv_1/)
        }
    })
})
