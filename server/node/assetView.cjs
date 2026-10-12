'use strict';
// Display copies of image assets for remote devices. A phone reaching the server through a tunnel
// or the LAN gets a WebP copy (often a tenth of the PNG) instead of the original from
// /api/asset/:hexKey. Originals are never touched: /api/read keeps serving them byte for byte, so
// plugins, exports and backups see the real files. Copies are cached on disk under the asset's own
// name; asset names are content hashes, so a copy never goes stale.

const path = require('path');
const fsp = require('fs/promises');
const { existsSync, mkdirSync, readdirSync, statSync, rmSync } = require('fs');
const { Worker } = require('worker_threads');

// Smaller files gain little and cost a conversion
const MIN_CONVERT_BYTES = 64 * 1024;
// Huge inputs (or decompression bombs) are not worth the memory
const MAX_INPUT_BYTES = 40 * 1024 * 1024;
// Keep the original when the copy does not save at least this much
const MAX_KEEP_RATIO = 0.85;
// A request waits this long for its copy, then gets the original while the conversion finishes
const FOREGROUND_WAIT_MS = 4000;
const CACHE_LIMIT_BYTES = (Number(process.env.POCKETRISU_ASSET_VIEW_CACHE_MB) || 2048) * 1024 * 1024;

function sniffConvertible(data) {
    if (data.length >= 8 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) return true; // PNG
    if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return true; // JPEG
    // GIF and WebP may be animated; audio, video and anything else keep their bytes
    return false;
}

/** True when the request came from another device: through a tunnel/proxy, or from a non-loopback address */
function isRemoteRequest(req) {
    if (req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.headers['x-real-ip']) return true;
    const addr = (req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
    return !(addr === '127.0.0.1' || addr === '::1' || addr === 'localhost');
}

function createAssetView({ cacheDir, logger = console } = {}) {
    if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true });

    // name -> { size, used }; size 0 marks "keep the original"
    let index = null;
    let cacheBytes = 0;
    const inFlight = new Map();
    let worker = null;
    let nextId = 1;
    const pending = new Map();

    function loadIndex() {
        if (index) return index;
        index = new Map();
        for (const file of readdirSync(cacheDir)) {
            const full = path.join(cacheDir, file);
            if (file.endsWith('.tmp')) { rmSync(full, { force: true }); continue; }
            const skip = file.endsWith('.skip');
            if (!skip && !file.endsWith('.webp')) continue;
            try {
                const stat = statSync(full);
                const size = skip ? 0 : stat.size;
                index.set(file.slice(0, -5), { size, used: stat.mtimeMs });
                cacheBytes += size;
            } catch { /* removed meanwhile */ }
        }
        return index;
    }

    function getWorker() {
        if (worker) return worker;
        worker = new Worker(path.join(__dirname, 'assetViewWorker.cjs'));
        worker.unref();
        worker.on('message', ({ id, output, error }) => {
            const job = pending.get(id);
            if (!job) return;
            pending.delete(id);
            if (error) logger.warn(`[AssetView] conversion failed: ${error}`);
            job.resolve(output ? Buffer.from(output.buffer, output.byteOffset, output.byteLength) : null);
        });
        worker.on('error', (error) => {
            logger.warn(`[AssetView] worker error: ${error?.message || error}`);
            for (const job of pending.values()) job.resolve(null);
            pending.clear();
            worker = null;
        });
        worker.on('exit', () => { worker = null; });
        return worker;
    }

    function convertInWorker(input) {
        return new Promise((resolve) => {
            const id = nextId++;
            pending.set(id, { resolve });
            getWorker().postMessage({ id, input });
        });
    }

    async function evictIfNeeded() {
        if (cacheBytes <= CACHE_LIMIT_BYTES) return;
        const target = CACHE_LIMIT_BYTES * 0.9;
        const entries = [...index.entries()].filter(([, e]) => e.size > 0).sort((a, b) => a[1].used - b[1].used);
        for (const [name, entry] of entries) {
            if (cacheBytes <= target) break;
            index.delete(name);
            cacheBytes -= entry.size;
            await fsp.rm(path.join(cacheDir, `${name}.webp`), { force: true }).catch(() => {});
        }
    }

    async function record(name, output) {
        const file = path.join(cacheDir, `${name}${output ? '.webp' : '.skip'}`);
        const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
        await fsp.writeFile(tmp, output || '');
        await fsp.rename(tmp, file);
        const size = output ? output.length : 0;
        cacheBytes -= index.get(name)?.size ?? 0;
        index.set(name, { size, used: Date.now() });
        cacheBytes += size;
        if (size) await evictIfNeeded();
    }

    async function convert(name, data) {
        if (data.length < MIN_CONVERT_BYTES || data.length > MAX_INPUT_BYTES || !sniffConvertible(data)) {
            await record(name, null);
            return null;
        }
        const output = await convertInWorker(data);
        const keep = output && output.length <= data.length * MAX_KEEP_RATIO ? output : null;
        await record(name, keep);
        return keep;
    }

    /**
     * WebP copy of an `assets/` value for a remote device, or null to serve the original
     * (not convertible, no gain, or the conversion is still running after FOREGROUND_WAIT_MS).
     */
    async function getRemoteView(key, data) {
        const match = /^assets\/([A-Za-z0-9_.-]+)$/.exec(key);
        if (!match || match[1].includes('..')) return null;
        const name = match[1];
        const entry = loadIndex().get(name);
        if (entry) {
            entry.used = Date.now();
            if (!entry.size) return null;
            try {
                return await fsp.readFile(path.join(cacheDir, `${name}.webp`));
            } catch {
                index.delete(name);
                cacheBytes -= entry.size;
            }
        }
        let job = inFlight.get(name);
        if (!job) {
            job = convert(name, data)
                .catch((error) => { logger.warn(`[AssetView] ${name}: ${error?.message || error}`); return null; })
                .finally(() => inFlight.delete(name));
            inFlight.set(name, job);
        }
        let timer;
        const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(null), FOREGROUND_WAIT_MS); });
        try {
            return await Promise.race([job, timeout]);
        } finally {
            clearTimeout(timer);
        }
    }

    return { getRemoteView };
}

module.exports = { createAssetView, isRemoteRequest };
