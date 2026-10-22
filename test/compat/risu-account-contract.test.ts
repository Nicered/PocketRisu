/**
 * Checks that the fake account server (helpers/fakeRisuAccount.ts) answers
 * like the real risuai.xyz account API, for the requests the account import
 * makes. Runs only when RISU_ACCOUNT_SESSION names a file holding a login
 * message captured from the account login page ({ message: { msg: { id,
 * token } } }); it then sends about six requests to the real server, one per
 * second. Never commit that file.
 *
 *   RISU_ACCOUNT_SESSION=/path/to/session.json pnpm test:compat risu-account-contract
 */
import { describe, expect, test } from 'vitest'
import { readFile } from 'node:fs/promises'
import { createFakeAccount, handleFakeAccountRequest } from './helpers/fakeRisuAccount.js'

const utils = require('../../server/node/utils.cjs') as typeof import('../../server/node/utils.cjs')
const accountImport = require('../../server/node/risu-account-import.cjs')

const sessionFile = process.env.RISU_ACCOUNT_SESSION
const baseUrl = process.env.RISU_ACCOUNT_URL || 'https://sv.risuai.xyz'

const pause = () => new Promise((resolve) => setTimeout(resolve, 1000))

function readPath(key: string) {
  const suffix = key.includes('database') ? `|${crypto.randomUUID()}` : ''
  return `/api/account/read/${Buffer.from(key, 'utf-8').toString('hex')}${suffix}`
}

describe.skipIf(!sessionFile)('RisuAI account API contract', () => {
  test('the fake account server answers like the real one', { timeout: 60_000 }, async () => {
    const session = JSON.parse(await readFile(sessionFile!, 'utf-8'))
    const login = session.message?.msg ?? session.msg ?? session
    expect(typeof login.token).toBe('string')

    const fake = createFakeAccount()
    const real = async (urlPath: string, headers: Record<string, string>) => {
      await pause()
      const res = await fetch(baseUrl + urlPath, { headers, redirect: 'manual' })
      return { status: res.status, headers: res.headers, body: Buffer.from(await res.arrayBuffer()) }
    }
    const both = async (urlPath: string, headers: (token: string) => Record<string, string>) => {
      const realAnswer = await real(urlPath, headers(login.token))
      const fakeAnswer = handleFakeAccountRequest(fake, 'GET', urlPath, headers(fake.token))
      return { real: realAnswer, fake: fakeAnswer }
    }

    // The database: 200 with x-body-size, upstream block format, and the
    // RisuAI login kept in `account`.
    const database = await both(readPath('database/database.bin'), (token) => ({ 'x-risu-auth': token, 'x-risu-key': 'database/database.bin', 'x-risu-save-date': '0' }))
    expect(database.real.status).toBe(200)
    expect(database.fake.status).toBe(200)
    expect(Number(database.real.headers.get('x-body-size'))).toBe(database.real.body.length)
    expect(database.fake.headers['x-body-size']).toBe(String(database.fake.body!.length))
    const db = await utils.decodeRisuSave(new Uint8Array(database.real.body), { resolveRemote: async () => null }) as any
    expect(Array.isArray(db.characters)).toBe(true)
    expect(db.account?.id).toBe(login.id)

    // A key the account does not have: 204, no body.
    const missingKey = 'assets/pocketrisu-contract-missing.png'
    const missing = await both(readPath(missingKey), (token) => ({ 'x-risu-auth': token, 'x-risu-key': missingKey, 'x-risu-save-date': '0' }))
    expect([missing.real.status, missing.real.body.length]).toEqual([204, 0])
    expect(missing.fake.status).toBe(204)

    // A token the account does not know: 403.
    const rejected = await both(readPath('database/database.bin'), () => ({ 'x-risu-auth': 'pocketrisu-contract-wrong-token', 'x-risu-key': 'database/database.bin', 'x-risu-save-date': '0' }))
    expect(rejected.real.status).toBe(403)
    expect(rejected.fake.status).toBe(403)

    // A cold storage id the account does not have: 404, the only status the
    // import lists as missing (anything else stops the download).
    const coldMissing = await both('/hub/account/coldstorage', (token) => ({ 'x-risu-auth': token, 'x-risu-key': 'pocketrisu-contract-missing' }))
    expect(coldMissing.real.status).toBe(404)
    expect(coldMissing.fake.status).toBe(404)

    // One cold item the account lists, when it has any: gzipped JSON.
    const coldIds = accountImport.listAccountColdKeys(db) as string[]
    if (coldIds.length > 0) {
      const item = await real('/hub/account/coldstorage', { 'x-risu-auth': login.token, 'x-risu-key': coldIds[0] })
      expect(item.status).toBe(200)
      expect(accountImport.parseColdItem(item.body)).toBeTypeOf('object')
    }
    console.info(`[contract] real cold-missing status ${coldMissing.real.status}; account lists ${coldIds.length} cold item(s), ${accountImport.listAccountAssetKeys(db).length} asset(s)`)
  })
})
