'use strict';

// Import from a RisuAI account (risuai.xyz account sync). Upstream's web build
// encrypts full backups with a key only risuai.xyz can fetch, so account users
// cannot bring their data over as a .bin; the account API itself has no such
// restriction (it only needs the login token).
//
// The user logs in and sees the plan (prepare), then confirms that all data
// will be replaced. From that moment the import is "started": PocketRisu is
// blocked (status().blocking; the server refuses data writes and the app
// shows the import screen) until the import is applied or cancelled, also
// across a server restart (meta.json keeps startedAt).
//
// Two phases after the confirmation:
//  - download: the account's database, the assets it references and its cold
//    storage items are saved as files under stagingDir, one request at a time.
//    This can take hours for large accounts, so it never touches the live data
//    or holds a SQLite transaction, and a restart or an expired token resumes
//    from the files already there (asset names are content hashes).
//  - apply: starts by itself when nothing is missing, otherwise once the user
//    accepts the missing items. entries() streams the staged files in .bin
//    backup entry format into applyEntries (the server's backup import), which
//    brings the pre-import snapshot, replace semantics, cleanup on failure, the
//    database decode check and the plugin/character cold storage restores.
//
// The account token lives only in memory and is dropped when the import ends,
// is cancelled or the account rejects it. It is never written or logged.

const path = require('node:path');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const { createHash, randomUUID } = require('node:crypto');
const zlib = require('node:zlib');

const DEFAULT_ACCOUNT_URL = 'https://sv.risuai.xyz';
const COLD_STORAGE_HEADER = '\uEF01COLDSTORAGE\uEF01';
const PLUGIN_STORAGE_INDEX_TYPE = 'risu-plugin-storage-index';
const DATABASE_KEY = 'database/database.bin';
// Staged files are named after asset basenames and cold ids, and the same
// names become backup entry names, so only plain names are accepted.
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;
const HASHED_ASSET = /^([0-9a-f]{64})\.[A-Za-z0-9]+$/;
const REQUEST_TIMEOUT_MS = 120_000;
const MAX_LISTED_MISSING = 200;
// The token goes into a request header as is; anything but printable ASCII
// would make fetch throw an error that quotes it.
const TOKEN_PATTERN = /^[\x21-\x7e]{8,4096}$/;
// Upstream keeps only characters in remote items (encodeBlock remote:'prefer').
const REMOTE_CHARACTER_TYPES = new Set([2, 7]); // CHARACTER_WITH_CHAT, CHARACTER_WITHOUT_CHAT
const MAX_COLD_ITEM_BYTES = 512 * 1024 * 1024;
// Free space left for the live database while downloading.
const DISK_RESERVE_BYTES = 256 * 1024 * 1024;

// Failures caused by the account server use 4xx statuses: the client retries
// 502-504 on its own, and a proxy in front may replace a 5xx body.
class AccountImportError extends Error {
    constructor(message, code, status = 400) {
        super(message);
        this.code = code;
        this.status = status;
    }
}

// Same fields as upstream getUncleanablesSync(db, 'pure'): everything a full
// account backup carries besides the database.
function listAccountAssetKeys(db) {
    const keys = new Set();
    const add = (value) => {
        if (typeof value === 'string' && value.startsWith('assets/')) keys.add(value);
    };
    add(db?.customBackground);
    add(db?.userIcon);
    for (const character of db?.characters ?? []) {
        addCharacterAssets(character, add);
    }
    for (const module of db?.modules ?? []) {
        for (const asset of module?.assets ?? []) add(asset?.[1]);
        add(module?.icon);
    }
    for (const persona of db?.personas ?? []) {
        add(persona?.icon);
        const embedded = persona?.embeddedModule;
        for (const asset of embedded?.assets ?? []) add(asset?.[1]);
        add(embedded?.icon);
    }
    for (const item of db?.characterOrder ?? []) {
        if (item && typeof item === 'object') add(item.imgFile);
    }
    return [...keys];
}

function addCharacterAssets(character, add) {
    if (!character || typeof character !== 'object') return;
    add(character.image);
    for (const emotion of character.emotionImages ?? []) add(emotion?.[1]);
    if (character.type === 'group') return;
    for (const asset of character.additionalAssets ?? []) add(asset?.[1]);
    for (const file of Object.values(character.vits?.files ?? {})) add(file);
    for (const asset of character.ccAssets ?? []) add(asset?.uri);
}

// Same as upstream listColdDataKeysFromDb. The large plugin values listed only
// inside the plugin storage index item are added once that item is read.
function listAccountColdKeys(db) {
    const keys = new Set();
    for (const character of db?.characters ?? []) {
        if (!character) continue;
        if (character.coldstorage) {
            keys.add(character.coldstorage);
            for (const id of character.coldStoragedChats ?? []) keys.add(id);
        }
        for (const chat of character.chats ?? []) {
            const data = chat?.message?.[0]?.data;
            if (typeof data === 'string' && data.startsWith(COLD_STORAGE_HEADER)) {
                keys.add(data.slice(COLD_STORAGE_HEADER.length));
            }
        }
    }
    for (const id of listAccountPluginColdKeys(db)) keys.add(id);
    return [...keys].filter((key) => typeof key === 'string' && key !== '');
}

// The plugin storage cold ids among those: the legacy `_coldplugin` values and
// the index item (upstream's first restore pass treats them as plugin storage).
function listAccountPluginColdKeys(db) {
    const keys = [];
    const coldPlugin = db?.pluginCustomStorage?._coldplugin;
    if (coldPlugin && typeof coldPlugin === 'object') keys.push(...Object.values(coldPlugin));
    const pointer = db?.pluginCustomStorage?._coldpluginIndex;
    if (typeof pointer === 'string') keys.push(pointer);
    return keys.filter((key) => typeof key === 'string' && key !== '');
}

// Same rule as upstream isValidColdStorageItem: a plugin storage item may be
// any JSON value; a character or chat item is an array or an object holding
// `character` or `message`.
function isValidColdItem(item, isPluginStorage) {
    if (item === undefined) return false;
    if (isPluginStorage) return true;
    return Array.isArray(item) || (!!item && typeof item === 'object' && ('character' in item || 'message' in item));
}

function listPluginIndexColdKeys(item) {
    if (item?.type !== PLUGIN_STORAGE_INDEX_TYPE || !Array.isArray(item.entries)) return [];
    return item.entries
        .map((entry) => entry?.l)
        .filter((id) => typeof id === 'string' && id !== '');
}

// Cold items arrive gzipped (upstream stores them that way); plain JSON is
// accepted too. Returns undefined when the bytes are neither.
function parseColdItem(buffer) {
    for (const read of [() => zlib.gunzipSync(buffer, { maxOutputLength: MAX_COLD_ITEM_BYTES }), () => buffer]) {
        try {
            return JSON.parse(read().toString('utf-8'));
        } catch {
            // try the next form
        }
    }
    return undefined;
}

// .bin backup entry: [u32le name length][name][u32le data length][data]
function encodeBackupEntry(name, data) {
    const nameBuffer = Buffer.from(name, 'utf-8');
    const header = Buffer.alloc(8 + nameBuffer.length);
    header.writeUInt32LE(nameBuffer.length, 0);
    nameBuffer.copy(header, 4);
    header.writeUInt32LE(data.length, 4 + nameBuffer.length);
    return Buffer.concat([header, data]);
}

function sha256(buffer) {
    return createHash('sha256').update(buffer).digest('hex');
}

function createRisuAccountImport({
    baseUrl = DEFAULT_ACCOUNT_URL,
    stagingDir,
    logger = console,
    decodeRisuSave,
    encodeRisuSaveLegacy,
    fetchImpl = (...args) => fetch(...args),
    requestGapMs = 1000,
    retryDelaysMs = [2000, 5000, 15000],
    maxRetryAfterMs = 60_000,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    checkDiskSpace = null,
    // async (entries, { totalBytes, onProgress }) => result; without it the
    // import stops at downloaded.
    applyEntries = null,
} = {}) {
    const accountOrigin = new URL(baseUrl).origin;
    const assetsDir = path.join(stagingDir, 'assets');
    const coldDir = path.join(stagingDir, 'cold');
    const databasePath = path.join(stagingDir, 'database.risudat');
    const metaPath = path.join(stagingDir, 'meta.json');

    // idle → preparing → ready → downloading → downloaded → applying → idle.
    // downloading can also end in paused (requests kept failing) or
    // needs-login (the account rejected the token); both resume from the
    // staged files, needs-login through a new prepare.
    let state = 'idle';
    let token = null;
    let job = null;
    let preparing = null;
    let cancelling = false;
    let lastError = null;
    let lastResult = null;
    let nextRequestAt = 0;
    // { accountId, startedAt, summary, files } from the confirmation until the
    // import is applied or cancelled. files: how many files the import has.
    let started = null;

    // A restart forgets the token and the plan: a started import waits for a
    // login to the same account, and files of one never started are dropped.
    {
        let meta = null;
        try {
            meta = JSON.parse(fsSync.readFileSync(metaPath, 'utf-8'));
        } catch {
            // nothing staged
        }
        if (meta?.startedAt) {
            started = { accountId: meta.accountId, startedAt: meta.startedAt, summary: meta.summary ?? null, files: meta.files ?? null };
            state = 'needs-login';
            lastError = { message: 'The server restarted during the import. Log in again to continue.', code: 'ACCOUNT_IMPORT_INTERRUPTED' };
        } else if (meta) {
            fsSync.rmSync(stagingDir, { recursive: true, force: true });
        }
    }

    // sleep that a cancel cuts short
    function pauseFor(ms, signal) {
        if (!signal) return sleep(ms);
        if (signal.aborted) return Promise.reject(signal.reason ?? new Error('aborted'));
        return new Promise((resolve, reject) => {
            const onAbort = () => reject(signal.reason ?? new Error('aborted'));
            signal.addEventListener('abort', onAbort, { once: true });
            sleep(ms).then(() => {
                signal.removeEventListener('abort', onAbort);
                resolve();
            });
        });
    }

    function assertNotBusy() {
        if (cancelling || state === 'preparing' || state === 'downloading' || state === 'applying') {
            throw new AccountImportError(`An account import is ${cancelling ? 'cancelling' : state}`, 'ACCOUNT_IMPORT_BUSY', 409);
        }
    }

    // Every account request goes through here, one at a time, and starts at
    // least requestGapMs after the previous one ended.
    async function request(urlPath, headers, signal) {
        const wait = nextRequestAt - Date.now();
        if (wait > 0) await pauseFor(wait, signal);
        try {
            const response = await fetchImpl(baseUrl + urlPath, {
                headers: { 'x-risu-auth': token, ...headers },
                redirect: 'manual',
                signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]) : AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            });
            const body = Buffer.from(await response.arrayBuffer());
            return { status: response.status, headers: response.headers, body };
        } finally {
            nextRequestAt = Date.now() + requestGapMs;
        }
    }

    function redact(message) {
        const text = String(message ?? '');
        return token ? text.split(token).join('<token>') : text;
    }

    function errorInfo(error) {
        return { message: redact(error?.message || String(error)), code: error?.code ?? null };
    }

    function parseRetryAfter(value) {
        if (value === null || value === undefined || value === '') return null;
        const seconds = Number(value);
        if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
        const at = Date.parse(value);
        return Number.isFinite(at) ? Math.max(0, at - Date.now()) : null;
    }

    function estimateSeconds(requests) {
        return Math.ceil(requests * (requestGapMs + 700) / 1000);
    }

    function unexpectedStatus(label, status) {
        return new AccountImportError(`RisuAI account returned HTTP ${status} (${label})`, 'ACCOUNT_REQUEST_FAILED', 424);
    }

    async function ensureDiskSpace(bytes) {
        if (!checkDiskSpace) return;
        const disk = await checkDiskSpace(bytes + DISK_RESERVE_BYTES);
        if (!disk.ok) {
            throw new AccountImportError('Not enough free disk space to keep downloading', 'ACCOUNT_DISK_FULL', 507);
        }
    }

    function readKey(key, signal) {
        const suffix = key.includes('database') ? `|${randomUUID()}` : '';
        return request(`/api/account/read/${Buffer.from(key, 'utf-8').toString('hex')}${suffix}`, {
            'x-risu-key': key,
            'x-risu-save-date': '0',
        }, signal);
    }

    function readCold(id, signal) {
        return request('/hub/account/coldstorage', { 'x-risu-key': id }, signal);
    }

    // Network errors, 5xx and 429 are retried, then fail. A 200 whose content
    // `check` rejects is retried too, then comes back marked unreadable:
    // asking again would not repair it. Anything else is the answer.
    async function withRetry(label, send, signal, check) {
        for (let attempt = 0; ; attempt++) {
            let result = null;
            let failure = null;
            let badContent = false;
            try {
                result = await send();
                if (result.status === 200 && check && !check(result)) badContent = true;
            } catch (error) {
                if (signal?.aborted) throw error;
                failure = error;
            }
            const retryable = failure || badContent || result.status === 429 || result.status >= 500;
            if (!retryable) return result;
            if (attempt >= retryDelaysMs.length) {
                if (badContent) return { ...result, unreadable: true };
                const reason = failure ? redact(failure.message || String(failure)) : `HTTP ${result.status}`;
                throw new AccountImportError(`RisuAI account request failed (${label}): ${reason}`, 'ACCOUNT_REQUEST_FAILED', 424);
            }
            let delay = retryDelaysMs[attempt];
            const retryAfterMs = parseRetryAfter(result?.headers?.get('retry-after'));
            if (retryAfterMs !== null) {
                // Asking earlier than the server said would only add load.
                if (retryAfterMs > maxRetryAfterMs) {
                    throw new AccountImportError(`RisuAI asked to wait ${Math.ceil(retryAfterMs / 60000)} min before more requests`, 'ACCOUNT_RATE_LIMITED', 424);
                }
                delay = Math.max(delay, retryAfterMs);
            }
            logger.warn?.(`[AccountImport] ${label}: ${failure ? 'request error' : badContent ? 'unreadable content' : `HTTP ${result.status}`}, retrying in ${delay}ms`);
            await pauseFor(delay, signal);
        }
    }

    function loginExpired() {
        return new AccountImportError('The RisuAI account rejected the login. Log in again to continue.', 'ACCOUNT_LOGIN_EXPIRED', 409);
    }

    async function readStagedMeta() {
        try {
            return JSON.parse(await fs.readFile(metaPath, 'utf-8'));
        } catch {
            return null;
        }
    }

    async function writeFileAtomic(filePath, data) {
        const temp = `${filePath}.${process.pid}.tmp`;
        await fs.writeFile(temp, data);
        await fs.rename(temp, filePath);
    }

    // Synchronous so that the blocking flag and the state change together.
    function writeStartedMeta(next) {
        const temp = `${metaPath}.${process.pid}.tmp`;
        fsSync.writeFileSync(temp, JSON.stringify({ preparedAt: Date.now(), ...next }));
        fsSync.renameSync(temp, metaPath);
    }

    async function stagedAssetMatches(name) {
        const hash = HASHED_ASSET.exec(name)?.[1];
        if (!hash) return false;
        try {
            return sha256(await fs.readFile(path.join(assetsDir, name))) === hash;
        } catch {
            return false;
        }
    }

    // Upstream never changes a cold item in place (every write gets a new
    // id), so one staged by an earlier attempt is still the current copy.
    async function readStagedCold(id) {
        try {
            return parseColdItem(await fs.readFile(path.join(coldDir, id)));
        } catch {
            return undefined;
        }
    }

    async function countStagedFiles() {
        let count = 0;
        for (const dir of [assetsDir, coldDir]) {
            try {
                count += (await fs.readdir(dir)).filter((name) => !name.endsWith('.tmp')).length;
            } catch {
                // not created yet
            }
        }
        return count;
    }

    function remainingSeconds() {
        const steps = job?.steps;
        if (state !== 'downloading' || !steps) return null;
        return estimateSeconds(steps.cold.total - steps.cold.done + steps.assets.total - steps.assets.done);
    }

    function config() {
        return { loginUrl: `${baseUrl}/hub/login`, loginOrigin: accountOrigin };
    }

    async function status() {
        return {
            state,
            blocking: started !== null,
            error: lastError,
            accountId: job?.accountId ?? started?.accountId ?? null,
            summary: job?.summary ?? started?.summary ?? null,
            // the account check (database, remote characters)
            progress: preparing?.progress ?? null,
            phase: job?.phase ?? null,
            steps: job?.steps ?? null,
            remainingSeconds: remainingSeconds(),
            missingCount: job?.missing.length ?? 0,
            missing: job?.missing.slice(0, MAX_LISTED_MISSING) ?? [],
            result: lastResult,
            // files already downloaded by a started import this server no
            // longer has a plan for (after a restart)
            staged: started && !job ? { files: await countStagedFiles(), total: started.files } : null,
        };
    }

    // Validates the token, then reads the account database and plans the
    // download in the background: an account saved by the desktop app keeps
    // every character in its own remote item, one request each. status()
    // reports the outcome. The returned promise resolves with { summary } or
    // { error } and never rejects.
    function prepare({ token: newToken, id } = {}) {
        assertNotBusy();
        // A started import takes a new login only to continue downloading.
        if (started && state !== 'needs-login') {
            throw new AccountImportError(`Cannot log in again while ${state}`, 'ACCOUNT_IMPORT_STATE', 409);
        }
        if (typeof newToken !== 'string' || !TOKEN_PATTERN.test(newToken)) {
            throw new AccountImportError('Invalid RisuAI login token', 'ACCOUNT_TOKEN_INVALID');
        }

        const current = preparing = {
            abort: new AbortController(),
            progress: { phase: 'database', done: 0, total: null, bytes: 0 },
            promise: null,
        };
        // Any earlier plan is replaced; its staged files stay for reuse.
        job = null;
        state = 'preparing';
        lastError = null;
        lastResult = null;
        token = newToken;
        current.promise = runPrepare(id, current).then(
            (summary) => ({ summary }),
            (error) => {
                if (preparing === current) {
                    lastError = errorInfo(error);
                    preparing = null;
                    token = null;
                    state = started ? 'needs-login' : 'idle';
                }
                return { error };
            },
        );
        return current.promise;
    }

    async function runPrepare(id, current) {
        const { signal } = current.abort;
        const databaseResponse = await withRetry('database', () => readKey(DATABASE_KEY, signal), signal);
        if (databaseResponse.status === 403) {
            throw new AccountImportError('The RisuAI account rejected the login.', 'ACCOUNT_LOGIN_FAILED');
        }
        if (databaseResponse.status === 204) {
            throw new AccountImportError('This RisuAI account has no saved data. Turn on "Save data in account" in RisuAI first.', 'ACCOUNT_NO_DATA');
        }
        if (databaseResponse.status !== 200) throw unexpectedStatus('database', databaseResponse.status);

        const plan = started
            ? await readApprovedDatabase(id, databaseResponse.body, signal)
            : await readAccountDatabase(id, databaseResponse.body, current);
        const { db, accountId } = plan;

        const assets = [];
        const skipped = [];
        for (const key of listAccountAssetKeys(db)) {
            (SAFE_NAME.test(key.slice('assets/'.length)) ? assets : skipped).push(key);
        }
        const cold = [];
        for (const key of listAccountColdKeys(db)) {
            (SAFE_NAME.test(key) ? cold : skipped).push(key);
        }

        if (!started) {
            const meta = await readStagedMeta();
            if (meta?.accountId !== accountId) {
                await fs.rm(stagingDir, { recursive: true, force: true });
            }
        }
        await fs.mkdir(assetsDir, { recursive: true });
        await fs.mkdir(coldDir, { recursive: true });
        if (!started) {
            const encoded = Buffer.from(encodeRisuSaveLegacy(db, 'compression'));
            await ensureDiskSpace(encoded.length);
            await writeFileAtomic(databasePath, encoded);
        }

        const isStaged = (filePath) => fs.access(filePath).then(() => true, () => false);
        let assetsStaged = 0;
        for (const key of assets) {
            if (await isStaged(path.join(assetsDir, key.slice('assets/'.length)))) assetsStaged += 1;
        }
        let coldStaged = 0;
        for (const coldId of cold) {
            if (await isStaged(path.join(coldDir, coldId))) coldStaged += 1;
        }

        const requests = assets.length - assetsStaged + cold.length - coldStaged;
        const summary = {
            accountId,
            characters: db.characters.length,
            chats: db.characters.reduce((sum, character) => sum + (character?.chats?.length ?? 0), 0),
            assets: assets.length,
            assetsStaged,
            cold: cold.length,
            coldStaged,
            skipped: skipped.length,
            unresolvedRemotes: plan.unresolvedRemotes,
            damaged: plan.damagedCount,
            damagedNames: plan.damagedNames,
            estimatedSeconds: estimateSeconds(requests),
        };
        await writeFileAtomic(metaPath, JSON.stringify({
            accountId,
            preparedAt: Date.now(),
            ...(started ? { startedAt: started.startedAt, summary, files: started.files } : {}),
        }));
        // Nothing below awaits, so a cancel cannot slip in past this point.
        if (signal.aborted) throw signal.reason ?? new Error('aborted');
        if (started) started.summary = summary;
        job = {
            accountId,
            assets: new Set(assets),
            cold,
            pluginCold: new Set(listAccountPluginColdKeys(db)),
            skipped,
            summary,
            phase: null,
            steps: null,
            missing: [],
            abort: null,
            loop: null,
        };
        preparing = null;
        state = 'ready';
        logger.info?.(`[AccountImport] Prepared: ${summary.characters} characters, ${assets.length} assets (${assetsStaged} staged), ${cold.length} cold items`);
        // A new login to a started import continues it.
        if (started) startDownload();
        return summary;
    }

    // The account database with its remote characters, as the user will see
    // it in the plan.
    async function readAccountDatabase(id, body, current) {
        const { signal } = current.abort;
        // The decoder logs and skips a block whose resolver throws, so a
        // failure is kept here and rethrown after decoding; dropping the
        // character silently would lose it from the import. Each remote is
        // read once and must name a character, so a remote item that points
        // to another remote cannot make the decoder loop.
        let unresolvedRemotes = 0;
        let remoteFailure = null;
        const resolvedRemotes = new Set();
        const damaged = [];
        const db = await decodeRisuSave(new Uint8Array(body), {
            resolveRemote: async (name, type) => {
                if (remoteFailure) return null;
                if (!SAFE_NAME.test(name) || !REMOTE_CHARACTER_TYPES.has(type) || resolvedRemotes.has(name)) {
                    unresolvedRemotes += 1;
                    return null;
                }
                resolvedRemotes.add(name);
                try {
                    const response = await withRetry(`remote ${name}`, () => readKey(`remotes/${name}.local.bin`, signal), signal);
                    current.progress = { phase: 'remotes', done: current.progress.done + 1, total: null, bytes: current.progress.bytes + response.body.length };
                    if (response.status === 403) throw loginExpired();
                    if (response.status === 204) {
                        unresolvedRemotes += 1;
                        return null;
                    }
                    if (response.status !== 200) throw unexpectedStatus(`remote ${name}`, response.status);
                    return new Uint8Array(response.body);
                } catch (error) {
                    remoteFailure = error;
                    return null;
                }
            },
            // A block the decoder cannot read is left out of the import; it
            // is listed so the user sees it before applying.
            onBlockError: ({ name, type }) => {
                if (!remoteFailure) damaged.push(name || `#${type}`);
            },
        });
        if (remoteFailure) throw remoteFailure;
        if (signal.aborted) throw signal.reason ?? new Error('aborted');
        if (!db || typeof db !== 'object' || Array.isArray(db) || !Array.isArray(db.characters)) {
            throw new AccountImportError('The RisuAI account database could not be read.', 'ACCOUNT_DB_UNREADABLE', 422);
        }

        const accountId = String((typeof id === 'string' && id) || db.account?.id || '').slice(0, 100);
        // The account copy of the database carries the RisuAI login
        // (id, token) in `account`; PocketRisu has no use for it.
        delete db.account;
        return { db, accountId, unresolvedRemotes, damagedCount: damaged.length, damagedNames: damaged.slice(0, 20) };
    }

    // A new login to a started import only proves the login and names the
    // account. The plan comes from the database the user approved, staged
    // when the import started: a change on the account since then (a block
    // that became unreadable, a character gone) cannot alter what replaces
    // the data without the user seeing it.
    async function readApprovedDatabase(id, body, signal) {
        let accountId = typeof id === 'string' ? id : '';
        if (!accountId) {
            // The login is in the root block; remote characters are not needed.
            const accountDb = await decodeRisuSave(new Uint8Array(body), { resolveRemote: async () => null, onBlockError: () => {} });
            accountId = String(accountDb?.account?.id ?? '');
        }
        accountId = accountId.slice(0, 100);
        if (accountId !== started.accountId) {
            throw new AccountImportError('This is not the account the import started with', 'ACCOUNT_MISMATCH', 409);
        }
        let db = null;
        try {
            db = await decodeRisuSave(new Uint8Array(await fs.readFile(databasePath)));
        } catch {
            // reported below
        }
        if (signal.aborted) throw signal.reason ?? new Error('aborted');
        if (!db || typeof db !== 'object' || Array.isArray(db) || !Array.isArray(db.characters)) {
            throw new AccountImportError('The downloaded account data cannot be read. Cancel the import and start again.', 'ACCOUNT_STAGED_UNREADABLE', 409);
        }
        return {
            db,
            accountId,
            unresolvedRemotes: started.summary?.unresolvedRemotes ?? 0,
            damagedCount: started.summary?.damaged ?? 0,
            damagedNames: started.summary?.damagedNames ?? [],
        };
    }

    async function downloadCold(signal) {
        // Plugin storage items first: the index names the other plugin
        // storage ids, and those are checked by the plugin storage rule.
        const queue = [...job.cold].sort((a, b) => Number(job.pluginCold.has(b)) - Number(job.pluginCold.has(a)));
        const seen = new Set(queue);
        job.phase = 'cold';
        const progress = job.steps.cold;
        while (queue.length > 0) {
            if (signal.aborted) throw signal.reason ?? new Error('aborted');
            const id = queue.shift();
            const isPluginStorage = job.pluginCold.has(id);
            let item = await readStagedCold(id);
            if (!isValidColdItem(item, isPluginStorage)) {
                // A staged copy that is not a valid item must not reach the apply.
                item = undefined;
                await fs.rm(path.join(coldDir, id), { force: true });
                const response = await withRetry(`cold ${id}`, () => readCold(id, signal), signal, (result) => {
                    item = parseColdItem(result.body);
                    return isValidColdItem(item, isPluginStorage);
                });
                if (response.status === 403) throw loginExpired();
                if (response.status === 404) {
                    item = undefined;
                    job.missing.push({ kind: 'cold', key: id, status: 404, reason: 'not-found' });
                } else if (response.status !== 200) {
                    throw unexpectedStatus(`cold ${id}`, response.status);
                } else if (response.unreadable) {
                    item = undefined;
                    job.missing.push({ kind: 'cold', key: id, status: 200, reason: 'unreadable' });
                } else {
                    await ensureDiskSpace(response.body.length);
                    await writeFileAtomic(path.join(coldDir, id), response.body);
                    progress.bytes += response.body.length;
                }
            }
            if (item !== undefined) {
                for (const ref of listPluginIndexColdKeys(item)) {
                    if (!SAFE_NAME.test(ref)) continue;
                    job.pluginCold.add(ref);
                    if (seen.has(ref)) continue;
                    seen.add(ref);
                    queue.push(ref);
                    job.cold.push(ref);
                }
                // A character moved to cold storage keeps its images listed
                // only inside the cold item.
                if (item && typeof item === 'object' && item.character) {
                    addCharacterAssets(item.character, (key) => {
                        if (typeof key === 'string' && key.startsWith('assets/') && SAFE_NAME.test(key.slice('assets/'.length))) {
                            job.assets.add(key);
                        }
                    });
                }
            }
            progress.done += 1;
            progress.total = progress.done + queue.length;
            job.steps.assets.total = job.assets.size;
        }
    }

    async function downloadAssets(signal) {
        const keys = [...job.assets];
        job.phase = 'assets';
        const progress = job.steps.assets = { done: 0, total: keys.length, bytes: 0 };
        for (const key of keys) {
            if (signal.aborted) throw signal.reason ?? new Error('aborted');
            const name = key.slice('assets/'.length);
            if (await stagedAssetMatches(name)) {
                progress.done += 1;
                continue;
            }
            await fs.rm(path.join(assetsDir, name), { force: true });
            const hash = HASHED_ASSET.exec(name)?.[1];
            const response = await withRetry(`asset ${name}`, () => readKey(key, signal), signal,
                (result) => !hash || sha256(result.body) === hash);
            if (response.status === 403) throw loginExpired();
            if (response.status === 204) {
                job.missing.push({ kind: 'asset', key, status: 204, reason: 'not-found' });
            } else if (response.status !== 200) {
                throw unexpectedStatus(`asset ${name}`, response.status);
            } else if (response.unreadable) {
                job.missing.push({ kind: 'asset', key, status: 200, reason: 'unreadable' });
            } else {
                await ensureDiskSpace(response.body.length);
                await writeFileAtomic(path.join(assetsDir, name), response.body);
                progress.bytes += response.body.length;
            }
            progress.done += 1;
        }
    }

    // Starts (or resumes) the download in the background. The first start is
    // the user's confirmation that all data will be replaced.
    function startDownload() {
        if (!job || !['ready', 'paused'].includes(state)) {
            throw new AccountImportError(`Cannot start downloading while ${state}`, 'ACCOUNT_IMPORT_STATE', 409);
        }
        if (!token) throw loginExpired();
        if (!started) {
            const next = { accountId: job.accountId, startedAt: Date.now(), summary: job.summary, files: job.cold.length + job.assets.size };
            writeStartedMeta(next);
            started = next;
            logger.info?.('[AccountImport] Started; PocketRisu is blocked until the import ends');
        }
        state = 'downloading';
        lastError = null;
        job.missing = [];
        job.steps = {
            cold: { done: 0, total: job.cold.length, bytes: 0 },
            assets: { done: 0, total: job.assets.size, bytes: 0 },
            apply: null,
        };
        const abort = job.abort = new AbortController();
        const current = job;
        job.loop = (async () => {
            try {
                await downloadCold(abort.signal);
                // The cold items name more images and plugin values, so the
                // number of files is known only now.
                if (started && job === current) {
                    started.files = current.cold.length + current.assets.size;
                    writeStartedMeta(started);
                }
                await downloadAssets(abort.signal);
            } catch (error) {
                if (job !== current || abort.signal.aborted) return;
                lastError = errorInfo(error);
                if (error.code === 'ACCOUNT_LOGIN_EXPIRED') {
                    token = null;
                    state = 'needs-login';
                } else {
                    state = 'paused';
                }
                logger.warn?.(`[AccountImport] Download stopped (${state}): ${lastError.message}`);
                return;
            }
            if (job !== current) return;
            state = 'downloaded';
            logger.info?.(`[AccountImport] Downloaded; ${current.missing.length} item(s) missing on the account`);
            // Nothing is left for the user to decide.
            if (current.missing.length === 0 && applyEntries) startApply();
        })();
        return { ok: true };
    }

    // What the apply streams: everything listed except what the download
    // found missing or unreadable.
    function applyKeys(current) {
        const missing = new Set(current.missing.map((item) => `${item.kind}:${item.key}`));
        return {
            assets: [...current.assets].filter((key) => !missing.has(`asset:${key}`)),
            cold: current.cold.filter((id) => !missing.has(`cold:${id}`)),
        };
    }

    // The staged import as .bin entries: assets, cold items, then the
    // database (the backup import keeps the database until the stream ends).
    // Every item left after applyKeys was staged by the download, so a file
    // that cannot be read now fails the apply instead of being left out.
    async function* entries(keys) {
        for (const key of keys.assets) {
            const name = key.slice('assets/'.length);
            yield encodeBackupEntry(name, await fs.readFile(path.join(assetsDir, name)));
        }
        for (const id of keys.cold) {
            yield encodeBackupEntry(`coldstorage/${id}`, await fs.readFile(path.join(coldDir, id)));
        }
        yield encodeBackupEntry('database.risudat', await fs.readFile(databasePath));
    }

    // Replaces the data with the downloaded import in the background. A
    // failure goes back to downloaded with the error, staged files kept.
    function startApply() {
        if (!job || state !== 'downloaded') {
            throw new AccountImportError(`Nothing downloaded to apply (${state})`, 'ACCOUNT_IMPORT_STATE', 409);
        }
        if (!applyEntries) throw new AccountImportError('Applying is not available', 'ACCOUNT_IMPORT_STATE', 409);
        state = 'applying';
        lastError = null;
        const current = job;
        current.phase = 'apply';
        current.applying = (async () => {
            let result;
            try {
                const keys = applyKeys(current);
                const sizeOf = (filePath) => fs.stat(filePath).then((stat) => stat.size, () => 0);
                let totalBytes = await sizeOf(databasePath);
                for (const key of keys.assets) totalBytes += await sizeOf(path.join(assetsDir, key.slice('assets/'.length)));
                for (const id of keys.cold) totalBytes += await sizeOf(path.join(coldDir, id));
                const progress = current.steps.apply = { done: 0, total: totalBytes };
                result = await applyEntries(entries(keys), {
                    totalBytes,
                    onProgress: (received) => { progress.done = received; },
                });
            } catch (error) {
                state = 'downloaded';
                lastError = errorInfo(error);
                logger.warn?.(`[AccountImport] Apply failed: ${lastError.message}`);
                return;
            }
            lastResult = { ...result, missing: current.missing.length };
            token = null;
            job = null;
            try {
                fsSync.rmSync(metaPath, { force: true });
            } catch (rmError) {
                logger.warn?.(`[AccountImport] Could not remove the import marker: ${rmError.message}`);
            }
            started = null;
            logger.info?.('[AccountImport] Applied');
            // Stays applying until the files are gone, so a new prepare cannot
            // stage files that this cleanup would then delete.
            try {
                await fs.rm(stagingDir, { recursive: true, force: true });
            } catch (rmError) {
                logger.warn?.(`[AccountImport] Could not remove the staged files: ${rmError.message}`);
            } finally {
                state = 'idle';
            }
        })();
        return { ok: true };
    }

    // Stops a check or download and forgets the import: the token and the
    // staged files. Unblocks PocketRisu at once; the current data was never
    // touched.
    async function cancel() {
        if (state === 'applying' || cancelling) {
            throw new AccountImportError(`Cannot cancel while ${cancelling ? 'cancelling' : state}`, 'ACCOUNT_IMPORT_BUSY', 409);
        }
        fsSync.rmSync(metaPath, { force: true });
        started = null;
        const current = job;
        const checking = preparing;
        job = null;
        preparing = null;
        token = null;
        state = 'idle';
        lastError = null;
        lastResult = null;
        // No new import starts until the old one stopped writing to staging.
        cancelling = true;
        try {
            if (checking) {
                checking.abort.abort(new Error('cancelled'));
                await checking.promise;
            }
            if (current?.abort) {
                current.abort.abort(new Error('cancelled'));
                await current.loop?.catch(() => {});
            }
            await fs.rm(stagingDir, { recursive: true, force: true });
        } finally {
            cancelling = false;
        }
    }

    return {
        config,
        status,
        prepare,
        startDownload,
        startApply,
        cancel,
        isBlocking: () => started !== null,
    };
}

module.exports = {
    createRisuAccountImport,
    AccountImportError,
    listAccountAssetKeys,
    listAccountColdKeys,
    listPluginIndexColdKeys,
    parseColdItem,
    encodeBackupEntry,
};
