import { createHash, randomBytes } from 'node:crypto'
import { describe, expect, test } from 'vitest'
import { md5Hex } from './md5'

describe('md5Hex', () => {
    test('matches node crypto across padding boundaries', () => {
        for (const size of [0, 1, 55, 56, 63, 64, 65, 119, 120, 128, 1000, 100_003]) {
            const data = new Uint8Array(randomBytes(size))
            expect(md5Hex(data)).toBe(createHash('md5').update(data).digest('hex'))
        }
    })
})
