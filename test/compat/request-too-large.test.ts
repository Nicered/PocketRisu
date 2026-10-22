/**
 * A body over the express.json limit (100mb) must come back as 413, not as the
 * generic 500 from the final error handler, so the client can tell the user the
 * request was too large.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import { spawnServer, type ServerHandle } from './helpers/spawnServer.js'

let srv: ServerHandle

beforeAll(async () => {
    srv = await spawnServer()
})

afterAll(async () => {
    await srv?.cleanup()
})

describe('oversized request body', () => {
    test('JSON body over the limit returns 413 with an error message', async () => {
        const body = Buffer.alloc(100 * 1024 * 1024 + 1, 'a')
        const res = await fetch(`http://127.0.0.1:${srv.port}/api/patch`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body,
        })
        expect(res.status).toBe(413)
        const data = await res.json()
        expect(typeof data.error).toBe('string')
    })
})
