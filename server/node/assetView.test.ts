import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { createAssetView, isRemoteRequest } = require('./assetView.cjs')
const Vips = require('wasm-vips')

// A noisy PNG compresses poorly as PNG and well as WebP, and is above the 64KB floor
async function makePng(side = 400): Promise<Buffer> {
    const vips = await Vips()
    const raw = crypto.randomBytes(side * side * 3)
    const smooth = Buffer.alloc(raw.length)
    for (let i = 0; i < raw.length; i++) smooth[i] = (raw[i] & 0x0f) + ((i / 3) % side)
    const image = vips.Image.newFromMemory(smooth, side, side, 3, 'uchar')
    try {
        return Buffer.from(image.writeToBuffer('.png'))
    } finally {
        image.delete()
    }
}

let dir = ''
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'asset-view-')) })
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

describe('isRemoteRequest', () => {
    it('treats tunnel headers and non-loopback addresses as remote', () => {
        expect(isRemoteRequest({ headers: { 'cf-connecting-ip': '1.2.3.4' }, socket: { remoteAddress: '::ffff:127.0.0.1' } })).toBe(true)
        expect(isRemoteRequest({ headers: {}, socket: { remoteAddress: '::ffff:192.168.0.20' } })).toBe(true)
        expect(isRemoteRequest({ headers: {}, socket: { remoteAddress: '::ffff:127.0.0.1' } })).toBe(false)
        expect(isRemoteRequest({ headers: {}, socket: { remoteAddress: '::1' } })).toBe(false)
    })
})

describe('getRemoteView', () => {
    it('serves a smaller WebP copy of a PNG and reuses it from disk', async () => {
        const png = await makePng()
        expect(png.length).toBeGreaterThan(64 * 1024)
        const view = createAssetView({ cacheDir: dir })
        const first = await view.getRemoteView('assets/abc.png', png)
        expect(first).not.toBeNull()
        expect(first.subarray(8, 12).toString('latin1')).toBe('WEBP')
        expect(first.length).toBeLessThan(png.length * 0.85)
        expect(fs.existsSync(path.join(dir, 'abc.png.webp'))).toBe(true)

        // A fresh instance (server restart) finds the cached copy without converting again
        const again = await createAssetView({ cacheDir: dir }).getRemoteView('assets/abc.png', Buffer.from('not an image'))
        expect(again?.equals(first)).toBe(true)
    })

    it('keeps the original for small files, WebP/GIF (maybe animated) and non-asset keys', async () => {
        const view = createAssetView({ cacheDir: dir })
        expect(await view.getRemoteView('assets/small.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]))).toBeNull()
        const webp = Buffer.concat([Buffer.from('RIFF0000WEBP', 'latin1'), Buffer.alloc(100 * 1024)])
        expect(await view.getRemoteView('assets/anim.webp', webp)).toBeNull()
        const gif = Buffer.concat([Buffer.from('GIF89a', 'latin1'), Buffer.alloc(100 * 1024)])
        expect(await view.getRemoteView('assets/anim.gif', gif)).toBeNull()
        expect(await view.getRemoteView('inlay/x', await makePng())).toBeNull()
        expect(await view.getRemoteView('assets/../evil', await makePng())).toBeNull()
        expect(fs.existsSync(path.join(dir, 'anim.webp.skip'))).toBe(true)
    })
})
