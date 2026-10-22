import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { assetFor, block, createFakeAccount, fakeAccountFetch, type FakeAccount } from '../../test/compat/helpers/fakeRisuAccount'

const require = createRequire(import.meta.url)
const utils = require('./utils.cjs') as typeof import('./utils.cjs')
const accountImport = require('./risu-account-import.cjs')

let stagingDir: string
let account: FakeAccount

beforeEach(async () => {
    stagingDir = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'risu-account-import-')), 'staging')
    account = createFakeAccount()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(async () => {
    vi.restoreAllMocks()
    await fs.rm(path.dirname(stagingDir), { recursive: true, force: true })
})

function createImport(overrides: Record<string, unknown> = {}) {
    return accountImport.createRisuAccountImport({
        baseUrl: 'http://account.test',
        stagingDir,
        logger: { info: () => {}, warn: () => {} },
        decodeRisuSave: utils.decodeRisuSave,
        encodeRisuSaveLegacy: utils.encodeRisuSaveLegacy,
        fetchImpl: fakeAccountFetch(account),
        requestGapMs: 0,
        retryDelaysMs: [1, 1, 1],
        ...overrides,
    })
}

async function settle(importer: ReturnType<typeof createImport>) {
    for (let i = 0; i < 500; i++) {
        const status = await importer.status()
        if (!['preparing', 'downloading', 'applying'].includes(status.state)) return status
        await new Promise((resolve) => setTimeout(resolve, 5))
    }
    throw new Error('the import did not settle')
}

// Decodes the .bin entries the import streams into the backup import.
async function collectEntries(entries: AsyncIterable<Buffer>) {
    const result: Array<{ name: string; data: Buffer }> = []
    for await (const chunk of entries) {
        const nameLength = chunk.readUInt32LE(0)
        const name = chunk.subarray(4, 4 + nameLength).toString('utf-8')
        const dataLength = chunk.readUInt32LE(4 + nameLength)
        result.push({ name, data: chunk.subarray(8 + nameLength, 8 + nameLength + dataLength) })
    }
    return result
}

const assetReads = () => account.log.filter((entry) => entry.key.startsWith('assets/') && entry.status === 200).map((entry) => entry.key)
const coldReads = () => account.log.filter((entry) => entry.path === '/hub/account/coldstorage').map((entry) => entry.key)

describe('account key listing', () => {
    it('lists the referenced assets and cold items like upstream', () => {
        const db = {
            customBackground: 'assets/bg.png',
            userIcon: 'not-an-asset',
            characters: [
                { type: 'character', image: 'assets/c.png', emotionImages: [['x', 'assets/e.png']], additionalAssets: [['y', 'assets/a.png', 'png']], vits: { files: { v: 'assets/v.bin' } }, ccAssets: [{ uri: 'assets/cc.png' }], chats: [{ message: [{ data: 'COLDSTORAGEchat-1' }] }] },
                { type: 'group', image: 'assets/g.png', additionalAssets: [['z', 'assets/skipped-for-groups.png']], chats: [] },
                { coldstorage: 'char-1', coldStoragedChats: ['chat-2'], chats: [] },
            ],
            modules: [{ assets: [['m', 'assets/m.png']], icon: 'assets/mi.png' }],
            personas: [{ icon: 'assets/p.png', embeddedModule: { assets: [['pm', 'assets/pm.png']], icon: 'assets/pmi.png' } }],
            characterOrder: ['id', { imgFile: 'assets/folder.png' }],
            pluginCustomStorage: { _coldplugin: { a: 'plugin-1' }, _coldpluginIndex: 'index-1' },
        }
        expect(accountImport.listAccountAssetKeys(db).sort()).toEqual([
            'assets/a.png', 'assets/bg.png', 'assets/c.png', 'assets/cc.png', 'assets/e.png', 'assets/folder.png',
            'assets/g.png', 'assets/m.png', 'assets/mi.png', 'assets/p.png', 'assets/pm.png', 'assets/pmi.png', 'assets/v.bin',
        ])
        expect(accountImport.listAccountColdKeys(db).sort()).toEqual(['char-1', 'chat-1', 'chat-2', 'index-1', 'plugin-1'])
        expect(accountImport.listPluginIndexColdKeys({ type: 'risu-plugin-storage-index', entries: [{ k: 'a', s: '1' }, { k: 'b', l: 'big-1' }] })).toEqual(['big-1'])
        expect(accountImport.listPluginIndexColdKeys({ entries: [{ l: 'x' }] })).toEqual([])
    })
})

describe('prepare', () => {
    it('reads the account database, resolves remote characters and drops the RisuAI login', async () => {
        const importer = createImport()
        const { summary } = await importer.prepare({ token: account.token, id: account.id })

        expect(summary).toMatchObject({ accountId: 'fake-user', characters: 3, chats: 4, assets: 5, assetsStaged: 0, cold: 3, coldStaged: 0, skipped: 0, unresolvedRemotes: 0, damaged: 0 })
        const staged = await utils.decodeRisuSave(await fs.readFile(path.join(stagingDir, 'database.risudat')))
        expect(staged.account).toBeUndefined()
        expect(staged.characters.map((c: { name: string }) => c.name).sort()).toEqual(account.expected.characterNames)
        expect(JSON.parse(await fs.readFile(path.join(stagingDir, 'meta.json'), 'utf-8')).accountId).toBe('fake-user')
        expect((await importer.status()).state).toBe('ready')
    })

    it('counts a remote character it cannot read and keeps the rest', async () => {
        account.items.delete('remotes/acc-char-b.local.bin')
        const { summary } = await createImport().prepare({ token: account.token, id: account.id })
        expect(summary).toMatchObject({ characters: 2, unresolvedRemotes: 1 })
    })

    it('rejects a wrong token, an empty account and a malformed token', async () => {
        const importer = createImport()
        expect(await importer.prepare({ token: 'wrong-token-value', id: account.id })).toMatchObject({ error: { code: 'ACCOUNT_LOGIN_FAILED' } })
        expect(await importer.status()).toMatchObject({ state: 'idle', error: { code: 'ACCOUNT_LOGIN_FAILED' } })

        account.items.delete('database/database.bin')
        expect(await importer.prepare({ token: account.token, id: account.id })).toMatchObject({ error: { code: 'ACCOUNT_NO_DATA' } })
        expect(() => importer.prepare({ token: 'a\nb-long-enough', id: account.id })).toThrow(expect.objectContaining({ code: 'ACCOUNT_TOKEN_INVALID' }))
        expect(() => importer.prepare({ token: `${account.token}\u0000`, id: account.id })).toThrow(expect.objectContaining({ code: 'ACCOUNT_TOKEN_INVALID' }))
    })
})

describe('prepare with remote characters', () => {
    it('keeps the request gap between the database and the remote read', async () => {
        const pauses: number[] = []
        const importer = createImport({ requestGapMs: 50, sleep: async (ms: number) => { pauses.push(ms) } })
        const pending = importer.prepare({ token: account.token, id: account.id })
        expect((await importer.status()).state).toBe('preparing')
        await pending
        expect(pauses).toHaveLength(1)
        expect(pauses[0]).toBeGreaterThan(0)
        expect(pauses[0]).toBeLessThanOrEqual(50)
        expect(await importer.status()).toMatchObject({ state: 'ready', progress: null })

        // and before the first download request
        importer.startDownload()
        await settle(importer)
        expect(pauses.length).toBeGreaterThan(1)
    })

    it('resolves each remote once and only for characters, so a remote pointing to a remote cannot loop', async () => {
        const loop = { v: 1, type: 6, name: 'loop' }
        account.items.set('database/database.bin', Buffer.concat([account.items.get('database/database.bin')!, block(6, 'loop', loop)]))
        account.items.set('remotes/loop.local.bin', Buffer.from(JSON.stringify(loop)))
        const { summary } = await createImport().prepare({ token: account.token, id: account.id })
        expect(summary).toMatchObject({ characters: 3, unresolvedRemotes: 1 })
        expect(account.log.filter((entry) => entry.key === 'remotes/loop.local.bin')).toEqual([])
    })

    it('lists blocks the decoder could not read instead of dropping them silently', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        account.items.set('database/database.bin', Buffer.concat([account.items.get('database/database.bin')!, block(2, 'broken-char', '{not json')]))
        const { summary } = await createImport().prepare({ token: account.token, id: account.id })
        expect(summary).toMatchObject({ characters: 3, damaged: 1, damagedNames: ['broken-char'] })
    })

    it('never puts the token into an error it reports', async () => {
        const fetchImpl = async () => { throw new TypeError(`invalid header value ${account.token}`) }
        const importer = createImport({ fetchImpl })
        const { error } = await importer.prepare({ token: account.token, id: account.id })
        expect(error).toBeDefined()
        const status = await importer.status()
        expect(status.error.code).toBe('ACCOUNT_REQUEST_FAILED')
        expect(status.error.message).not.toContain(account.token)
        expect(status.error.message).toContain('<token>')
    })

    it('fails instead of dropping a remote character when the login expires while reading it', async () => {
        // the database answers, the remote character gets 403
        account.expireAfter = 1
        const importer = createImport()
        expect(await importer.prepare({ token: account.token, id: account.id })).toMatchObject({ error: { code: 'ACCOUNT_LOGIN_EXPIRED' } })
        expect(await importer.status()).toMatchObject({ state: 'idle', error: { code: 'ACCOUNT_LOGIN_EXPIRED' } })
    })

    it('fails when a remote character keeps failing instead of leaving it out', async () => {
        account.faults.push({ key: 'remotes/acc-char-b.local.bin', status: 500, times: 9 })
        const importer = createImport()
        expect(await importer.prepare({ token: account.token, id: account.id })).toMatchObject({ error: { code: 'ACCOUNT_REQUEST_FAILED' } })
    })

    it('cancels a check that is still reading remote characters', async () => {
        let release: () => void = () => {}
        const gate = new Promise<void>((resolve) => { release = resolve })
        // the remote read has to wait out the gap, which never ends here
        const importer = createImport({ requestGapMs: 60_000, sleep: () => gate })
        const pending = importer.prepare({ token: account.token, id: account.id })
        await new Promise((resolve) => setTimeout(resolve, 20))
        expect((await importer.status()).state).toBe('preparing')

        await importer.cancel()
        release()
        expect(await pending).toMatchObject({ error: expect.any(Error) })
        expect(await importer.status()).toMatchObject({ state: 'idle', error: null, summary: null })
        await expect(fs.access(stagingDir)).rejects.toThrow()
        expect(account.log.some((entry) => entry.key.startsWith('remotes/'))).toBe(false)
    })
})

// Stands in for the server's backup import: reads every entry like it would.
function recordingApply(fail: Error | null = null) {
    const calls: Array<{ entries: Array<{ name: string; data: Buffer }>; totalBytes: number }> = []
    const applyEntries = async (entries: AsyncIterable<Buffer>, { totalBytes, onProgress }: { totalBytes: number; onProgress: (received: number, total: number) => void }) => {
        const read = await collectEntries(entries)
        onProgress(totalBytes, totalBytes)
        calls.push({ entries: read, totalBytes })
        if (fail) throw fail
        return { characters: 3 }
    }
    return { calls, applyEntries }
}

// The fake account lists one image it does not have; adding it leaves
// nothing missing.
function addMissingAsset() {
    const missing = assetFor(99)
    account.items.set(missing.key, missing.data)
}

describe('download and apply', () => {
    it('downloads the cold items, follows the plugin index, adds cold character images and streams the database last', async () => {
        const apply = recordingApply()
        const importer = createImport({ applyEntries: apply.applyEntries })
        await importer.prepare({ token: account.token, id: account.id })
        expect((await importer.status()).blocking).toBe(false)
        importer.startDownload()
        expect((await importer.status()).blocking).toBe(true)
        const status = await settle(importer)

        // An item is missing, so the user decides before anything is applied.
        expect(status).toMatchObject({ state: 'downloaded', blocking: true })
        expect(apply.calls).toEqual([])
        expect(status.missing).toEqual([{ kind: 'asset', key: account.expected.missingAsset, status: 204, reason: 'not-found' }])
        expect(coldReads()).toHaveLength(4)
        expect(assetReads().sort()).toEqual(account.expected.assets.map((asset) => asset.key).sort())

        importer.startApply()
        expect(await settle(importer)).toMatchObject({ state: 'idle', blocking: false, result: { characters: 3, missing: 1 }, staged: null })
        const [{ entries, totalBytes }] = apply.calls
        expect(entries.map((entry) => entry.name).at(-1)).toBe('database.risudat')
        expect(entries.filter((entry) => entry.name.startsWith('coldstorage/'))).toHaveLength(4)
        for (const asset of account.expected.assets) {
            expect(entries.find((entry) => entry.name === asset.key.slice('assets/'.length))?.data.equals(asset.data)).toBe(true)
        }
        expect(totalBytes).toBe(entries.reduce((sum, entry) => sum + entry.data.length, 0))
        await expect(fs.access(stagingDir)).rejects.toThrow()
    })

    it('applies by itself when nothing is missing', async () => {
        addMissingAsset()
        const apply = recordingApply()
        const importer = createImport({ applyEntries: apply.applyEntries })
        await importer.prepare({ token: account.token, id: account.id })
        importer.startDownload()

        expect(await settle(importer)).toMatchObject({ state: 'idle', blocking: false, result: { characters: 3, missing: 0 } })
        expect(apply.calls).toHaveLength(1)
        await expect(fs.access(stagingDir)).rejects.toThrow()
    })

    it('reports the progress of each step and the time left', async () => {
        let release: () => void = () => {}
        const gate = new Promise<void>((resolve) => { release = resolve })
        let blocked = false
        const importer = createImport({ sleep: () => (blocked ? gate : Promise.resolve()), requestGapMs: 1000 })
        await importer.prepare({ token: account.token, id: account.id })
        blocked = true
        importer.startDownload()
        await new Promise((resolve) => setTimeout(resolve, 20))

        const status = await importer.status()
        expect(status).toMatchObject({ state: 'downloading', phase: 'cold', steps: { cold: { done: 0, total: 3 }, assets: { done: 0, total: 5 }, apply: null } })
        expect(status.remainingSeconds).toBe(Math.ceil(8 * 1.7))
        await importer.cancel()
        release()
    })

    it('retries server errors and content that does not match its hash', async () => {
        const [a1, a2] = account.expected.assets
        account.faults.push({ key: a1.key, status: 500, times: 2 })
        account.faults.push({ key: a2.key, status: 200, times: 1, body: Buffer.from('truncated') })
        account.faults.push({ key: 'database/database.bin', status: 503, times: 1 })
        const importer = createImport()
        await importer.prepare({ token: account.token, id: account.id })
        importer.startDownload()
        const status = await settle(importer)

        expect(status.state).toBe('downloaded')
        expect(await fs.readFile(path.join(stagingDir, 'assets', a1.key.slice('assets/'.length)))).toEqual(a1.data)
        expect(await fs.readFile(path.join(stagingDir, 'assets', a2.key.slice('assets/'.length)))).toEqual(a2.data)
    })

    it('pauses when requests keep failing and resumes without downloading staged files again', async () => {
        const [a1, a2, a3] = account.expected.assets
        account.faults.push({ key: a3.key, status: 502, times: 4 })
        const importer = createImport()
        await importer.prepare({ token: account.token, id: account.id })
        importer.startDownload()
        let status = await settle(importer)
        expect(status).toMatchObject({ state: 'paused', blocking: true, error: { code: 'ACCOUNT_REQUEST_FAILED' } })

        const before = account.log.length
        importer.startDownload()
        status = await settle(importer)
        expect(status.state).toBe('downloaded')
        const resumed = account.log.slice(before).map((entry) => entry.key)
        expect(resumed).not.toContain(a1.key)
        expect(resumed).not.toContain(a2.key)
        expect(resumed.filter((key) => !key.startsWith('assets/'))).toEqual([])
    })

    it('stops for a new login when the token expires, then continues by itself and reuses the staged files', async () => {
        // database + remote character + 4 cold items + 2 assets, then 403
        account.expireAfter = 8
        const importer = createImport()
        await importer.prepare({ token: account.token, id: account.id })
        importer.startDownload()
        let status = await settle(importer)
        expect(status).toMatchObject({ state: 'needs-login', blocking: true, error: { code: 'ACCOUNT_LOGIN_EXPIRED' } })
        expect(() => importer.startDownload()).toThrow()

        const before = account.log.length
        const { summary } = await importer.prepare({ token: account.token, id: account.id })
        expect(summary).toMatchObject({ assetsStaged: 2, coldStaged: 3 })
        status = await settle(importer)
        expect(status.state).toBe('downloaded')
        expect(account.log.slice(before).filter((entry) => entry.path === '/hub/account/coldstorage')).toEqual([])
        expect(new Set(assetReads()).size).toBe(account.expected.assets.length)
        expect(assetReads()).toHaveLength(account.expected.assets.length)
    })

    it('continues a started import with the database the user approved, not a changed account copy', async () => {
        account.expireAfter = 8
        const importer = createImport()
        await importer.prepare({ token: account.token, id: account.id })
        importer.startDownload()
        expect((await settle(importer)).state).toBe('needs-login')

        // Meanwhile a block of the account copy became unreadable and the
        // remote character is gone.
        vi.spyOn(console, 'error').mockImplementation(() => {})
        account.items.set('database/database.bin', Buffer.concat([account.items.get('database/database.bin')!, block(2, 'broken-char', '{not json')]))
        account.items.delete('remotes/acc-char-b.local.bin')
        const before = account.log.length
        const { summary } = await importer.prepare({ token: account.token, id: '' })
        expect(summary).toMatchObject({ characters: 3, damaged: 0, unresolvedRemotes: 0 })
        expect(account.log.slice(before).some((entry) => entry.key.startsWith('remotes/'))).toBe(false)
        expect((await settle(importer)).state).toBe('downloaded')
        const staged = await utils.decodeRisuSave(await fs.readFile(path.join(stagingDir, 'database.risudat')))
        expect(staged.characters.map((c: { name: string }) => c.name).sort()).toEqual(account.expected.characterNames)
    })

    it('stops a new login when the approved database can no longer be read', async () => {
        account.expireAfter = 8
        const importer = createImport()
        await importer.prepare({ token: account.token, id: account.id })
        importer.startDownload()
        await settle(importer)
        await fs.rm(path.join(stagingDir, 'database.risudat'))

        expect(await importer.prepare({ token: account.token, id: account.id })).toMatchObject({ error: { code: 'ACCOUNT_STAGED_UNREADABLE' } })
        expect(await importer.status()).toMatchObject({ state: 'needs-login', blocking: true, error: { code: 'ACCOUNT_STAGED_UNREADABLE' } })
    })

    it('refuses a login to another account while an import is started, keeping its files', async () => {
        account.expireAfter = 8
        const importer = createImport()
        await importer.prepare({ token: account.token, id: account.id })
        importer.startDownload()
        await settle(importer)

        expect(await importer.prepare({ token: account.token, id: 'someone-else' })).toMatchObject({ error: { code: 'ACCOUNT_MISMATCH' } })
        expect(await importer.status()).toMatchObject({ state: 'needs-login', blocking: true, error: { code: 'ACCOUNT_MISMATCH' } })
        expect(await fs.readdir(path.join(stagingDir, 'assets'))).toHaveLength(2)
    })

    it('takes a new login only while it waits for one', async () => {
        const importer = createImport()
        await importer.prepare({ token: account.token, id: account.id })
        importer.startDownload()
        expect((await settle(importer)).state).toBe('downloaded')
        expect(() => importer.prepare({ token: account.token, id: account.id })).toThrow(expect.objectContaining({ code: 'ACCOUNT_IMPORT_STATE' }))
    })

    it('starts over when a different account is prepared before the import starts', async () => {
        const importer = createImport()
        await importer.prepare({ token: account.token, id: account.id })
        await fs.writeFile(path.join(stagingDir, 'assets', 'leftover.png'), 'x')

        const { summary } = await importer.prepare({ token: account.token, id: 'someone-else' })
        expect(summary).toMatchObject({ accountId: 'someone-else', assetsStaged: 0, coldStaged: 0 })
        expect(await fs.readdir(path.join(stagingDir, 'assets'))).toEqual([])
    })

    it('cancels a running download, removes the staged files and unblocks', async () => {
        let release: () => void = () => {}
        const gate = new Promise<void>((resolve) => { release = resolve })
        let blocked = false
        const importer = createImport({ sleep: () => (blocked ? gate : Promise.resolve()), requestGapMs: 60_000 })
        await importer.prepare({ token: account.token, id: account.id })
        blocked = true
        importer.startDownload()
        expect(await importer.status()).toMatchObject({ state: 'downloading', blocking: true })

        await new Promise((resolve) => setTimeout(resolve, 20))
        expect(account.log.filter((entry) => entry.path === '/hub/account/coldstorage')).toEqual([])
        await importer.cancel()
        release()
        expect(await importer.status()).toMatchObject({ state: 'idle', blocking: false, staged: null })
        await expect(fs.access(stagingDir)).rejects.toThrow()
        expect(() => importer.startDownload()).toThrow()
        expect(createImport().isBlocking()).toBe(false)
    })

    it('refuses a second apply', async () => {
        const importer = createImport({ applyEntries: recordingApply().applyEntries })
        await importer.prepare({ token: account.token, id: account.id })
        importer.startDownload()
        await settle(importer)
        importer.startApply()
        expect(() => importer.startApply()).toThrow(expect.objectContaining({ code: 'ACCOUNT_IMPORT_STATE' }))
        expect((await importer.status()).state).toBe('applying')
        await settle(importer)
    })

    it('stops on an unexpected status instead of calling the item missing', async () => {
        const [, , a3] = account.expected.assets
        account.faults.push({ key: a3.key, status: 401, times: 1 })
        const importer = createImport()
        await importer.prepare({ token: account.token, id: account.id })
        importer.startDownload()
        expect(await settle(importer)).toMatchObject({ state: 'paused', error: { code: 'ACCOUNT_REQUEST_FAILED' }, missingCount: 0 })
        importer.startDownload()
        expect(await settle(importer)).toMatchObject({ state: 'downloaded', missingCount: 1 })
    })

    it('retries content that cannot be read and lists it when it stays unreadable', async () => {
        const [a1, a2] = account.expected.assets
        account.faults.push({ key: '7a1c3a2e-1111-4c4c-8a8a-000000000001', status: 200, times: 1, body: Buffer.from('not gzip, not json') })
        account.faults.push({ key: a2.key, status: 200, times: 9, body: Buffer.from('wrong bytes') })
        const importer = createImport()
        await importer.prepare({ token: account.token, id: account.id })
        importer.startDownload()
        const status = await settle(importer)
        expect(status.state).toBe('downloaded')
        expect(status.missing).toEqual(expect.arrayContaining([
            { kind: 'asset', key: account.expected.missingAsset, status: 204, reason: 'not-found' },
            { kind: 'asset', key: a2.key, status: 200, reason: 'unreadable' },
        ]))
        expect(status.missingCount).toBe(2)
        await fs.access(path.join(stagingDir, 'cold', '7a1c3a2e-1111-4c4c-8a8a-000000000001'))
        await fs.access(path.join(stagingDir, 'assets', a1.key.slice('assets/'.length)))
    })

    it('leaves out a staged file that fails its check when the account copy is unreadable too', async () => {
        const [a1] = account.expected.assets
        const assetName = a1.key.slice('assets/'.length)
        const coldId = '7a1c3a2e-1111-4c4c-8a8a-000000000001'
        const apply = recordingApply()
        const importer = createImport({ applyEntries: apply.applyEntries })
        await importer.prepare({ token: account.token, id: account.id })
        await fs.writeFile(path.join(stagingDir, 'assets', assetName), 'damaged staged copy')
        await fs.writeFile(path.join(stagingDir, 'cold', coldId), 'damaged staged copy')
        account.faults.push({ key: a1.key, status: 200, times: 9, body: Buffer.from('wrong bytes') })
        account.faults.push({ key: coldId, status: 200, times: 9, body: Buffer.from('not gzip, not json') })
        importer.startDownload()
        const status = await settle(importer)

        expect(status.state).toBe('downloaded')
        expect(status.missing).toEqual(expect.arrayContaining([
            { kind: 'asset', key: a1.key, status: 200, reason: 'unreadable' },
            { kind: 'cold', key: coldId, status: 200, reason: 'unreadable' },
        ]))
        await expect(fs.access(path.join(stagingDir, 'assets', assetName))).rejects.toThrow()
        await expect(fs.access(path.join(stagingDir, 'cold', coldId))).rejects.toThrow()
        // Even a file that shows up again for a listed item is not applied.
        await fs.writeFile(path.join(stagingDir, 'assets', assetName), 'damaged staged copy')
        importer.startApply()
        await settle(importer)
        const names = apply.calls[0].entries.map((entry) => entry.name)
        expect(names).not.toContain(assetName)
        expect(names).not.toContain(`coldstorage/${coldId}`)
        expect(names.at(-1)).toBe('database.risudat')
    })

    it('fails the apply when a staged file can no longer be read', async () => {
        const [a1] = account.expected.assets
        const apply = recordingApply()
        const importer = createImport({ applyEntries: apply.applyEntries })
        await importer.prepare({ token: account.token, id: account.id })
        importer.startDownload()
        expect((await settle(importer)).state).toBe('downloaded')
        await fs.rm(path.join(stagingDir, 'assets', a1.key.slice('assets/'.length)))

        importer.startApply()
        expect(await settle(importer)).toMatchObject({ state: 'downloaded', blocking: true, error: { code: 'ENOENT' } })
        expect(apply.calls).toEqual([])
    })

    it('checks cold items like upstream: a chat item without messages is unreadable, a plugin value may be anything', async () => {
        const coldChatId = '7a1c3a2e-1111-4c4c-8a8a-000000000001'
        const pluginValueId = '7a1c3a2e-3333-4c4c-8a8a-000000000003'
        const gzipJson = (value: unknown) => zlib.gzipSync(Buffer.from(JSON.stringify(value)))
        const importer = createImport()
        await importer.prepare({ token: account.token, id: account.id })
        await fs.writeFile(path.join(stagingDir, 'cold', coldChatId), gzipJson({}))
        account.faults.push({ key: coldChatId, status: 200, times: 9, body: gzipJson({}) })
        account.faults.push({ key: pluginValueId, status: 200, times: 1, body: gzipJson(null) })
        importer.startDownload()
        const status = await settle(importer)

        expect(status.state).toBe('downloaded')
        expect(status.missing).toEqual(expect.arrayContaining([{ kind: 'cold', key: coldChatId, status: 200, reason: 'unreadable' }]))
        expect(status.missing.some((item: { key: string }) => item.key === pluginValueId)).toBe(false)
        await expect(fs.access(path.join(stagingDir, 'cold', coldChatId))).rejects.toThrow()
        expect(accountImport.parseColdItem(await fs.readFile(path.join(stagingDir, 'cold', pluginValueId)))).toBeNull()
    })

    it('reads the plugin storage index first, so an id it lists is checked as plugin storage', async () => {
        const coldChatId = '7a1c3a2e-1111-4c4c-8a8a-000000000001'
        const indexId = '7a1c3a2e-2222-4c4c-8a8a-000000000002'
        const gzipJson = (value: unknown) => zlib.gzipSync(Buffer.from(JSON.stringify(value)))
        const index = { type: 'risu-plugin-storage-index', version: 1, entries: [{ k: 'shared', l: coldChatId }], trash: [] }
        account.faults.push({ key: indexId, status: 200, times: 1, body: gzipJson(index) })
        account.faults.push({ key: coldChatId, status: 200, times: 1, body: gzipJson(null) })
        const importer = createImport()
        await importer.prepare({ token: account.token, id: account.id })
        importer.startDownload()
        const status = await settle(importer)

        expect(status.state).toBe('downloaded')
        expect(status.missing.some((item: { key: string }) => item.key === coldChatId)).toBe(false)
        expect(coldReads()[0]).toBe(indexId)
        expect(accountImport.parseColdItem(await fs.readFile(path.join(stagingDir, 'cold', coldChatId)))).toBeNull()
    })

    it('pauses instead of asking again early when the server wants a long wait', async () => {
        const [a1] = account.expected.assets
        account.faults.push({ key: a1.key, status: 429, times: 1, headers: { 'retry-after': '3600' } })
        const importer = createImport()
        await importer.prepare({ token: account.token, id: account.id })
        importer.startDownload()
        expect(await settle(importer)).toMatchObject({ state: 'paused', error: { code: 'ACCOUNT_RATE_LIMITED' } })
        expect(account.log.filter((entry) => entry.key === a1.key)).toHaveLength(1)
    })

    it('waits for a Retry-After given as a date', async () => {
        const [a1] = account.expected.assets
        account.faults.push({ key: a1.key, status: 503, times: 1, headers: { 'retry-after': new Date(Date.now() + 30_000).toUTCString() } })
        const pauses: number[] = []
        const importer = createImport({ sleep: async (ms: number) => { pauses.push(ms) } })
        await importer.prepare({ token: account.token, id: account.id })
        importer.startDownload()
        expect((await settle(importer)).state).toBe('downloaded')
        expect(Math.max(...pauses)).toBeGreaterThan(20_000)
    })

    it('pauses when the disk is running out', async () => {
        let calls = 0
        const importer = createImport({ checkDiskSpace: async () => ({ ok: calls++ < 1 }) })
        await importer.prepare({ token: account.token, id: account.id })
        importer.startDownload()
        expect(await settle(importer)).toMatchObject({ state: 'paused', error: { code: 'ACCOUNT_DISK_FULL' } })
    })

    it('stays busy until the staged files of a finished apply are removed', async () => {
        addMissingAsset()
        const importer = createImport({ applyEntries: recordingApply().applyEntries })
        await importer.prepare({ token: account.token, id: account.id })
        importer.startDownload()
        for (let i = 0; i < 500 && (await importer.status()).state !== 'applying'; i++) {
            await new Promise((resolve) => setTimeout(resolve, 1))
        }
        expect(() => importer.prepare({ token: account.token, id: account.id })).toThrow(expect.objectContaining({ code: 'ACCOUNT_IMPORT_BUSY' }))
        expect((await settle(importer)).state).toBe('idle')
        await expect(fs.access(stagingDir)).rejects.toThrow()
    })

    it('goes back to downloaded when the apply fails, keeping the staged files and the block', async () => {
        addMissingAsset()
        const importer = createImport({ applyEntries: recordingApply(new Error('disk full')).applyEntries })
        await importer.prepare({ token: account.token, id: account.id })
        importer.startDownload()

        expect(await settle(importer)).toMatchObject({ state: 'downloaded', blocking: true, error: { message: 'disk full' } })
        await fs.access(path.join(stagingDir, 'database.risudat'))
    })

    it('stays blocked across a restart until the same account logs in again', async () => {
        account.expireAfter = 8
        const first = createImport()
        await first.prepare({ token: account.token, id: account.id })
        first.startDownload()
        await settle(first)

        const restarted = createImport()
        expect(restarted.isBlocking()).toBe(true)
        expect(await restarted.status()).toMatchObject({
            state: 'needs-login',
            blocking: true,
            error: { code: 'ACCOUNT_IMPORT_INTERRUPTED' },
            accountId: 'fake-user',
            summary: { assets: 5, cold: 3 },
            // 4 cold items (one found through the plugin index) and 2 of the
            // 6 images (one found in the cold character)
            staged: { files: 6, total: 10 },
        })
        expect(() => restarted.startDownload()).toThrow()

        const before = account.log.length
        await restarted.prepare({ token: account.token, id: account.id })
        expect((await settle(restarted)).state).toBe('downloaded')
        expect(account.log.slice(before).filter((entry) => entry.path === '/hub/account/coldstorage')).toEqual([])
    })

    it('drops the files of an import that never started when the server restarts', async () => {
        await createImport().prepare({ token: account.token, id: account.id })
        const restarted = createImport()
        expect(await restarted.status()).toMatchObject({ state: 'idle', blocking: false, staged: null })
        await expect(fs.access(stagingDir)).rejects.toThrow()
    })
})
