'use strict';
// Worker for assetView.cjs: converts one image to WebP per message, off the main event loop
// (wasm-vips runs synchronously, so converting on the main thread would stall every request).

const { parentPort } = require('worker_threads');
const Vips = require('wasm-vips');

const MAX_INPUT_PIXELS = 50 * 1000 * 1000;
const WEBP_QUALITY = 90;

const vipsReady = Vips();

parentPort.on('message', async ({ id, input }) => {
    let image = null;
    try {
        const vips = await vipsReady;
        image = vips.Image.newFromBuffer(input);
        let pages = 1;
        try { pages = image.getInt('n-pages'); } catch { /* single page */ }
        if (pages > 1 || image.width * image.height > MAX_INPUT_PIXELS) {
            parentPort.postMessage({ id, output: null });
            return;
        }
        const output = image.writeToBuffer('.webp', { Q: WEBP_QUALITY });
        parentPort.postMessage({ id, output });
    } catch (error) {
        parentPort.postMessage({ id, output: null, error: error?.message || String(error) });
    } finally {
        try { image?.delete(); } catch { /* already released */ }
    }
});
