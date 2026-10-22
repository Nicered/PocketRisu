import { describe, expect, test, vi } from 'vitest'

vi.mock('../alert', () => ({ alertError: vi.fn(), notifyError: vi.fn() }))
vi.mock('../globalApi.svelte', () => ({ fetchNative: vi.fn(), globalFetch: vi.fn(), readImage: vi.fn() }))
vi.mock('../storage/database.svelte', () => ({ getDatabase: vi.fn() }))
vi.mock('../stores.svelte', () => ({ CharEmotion: { set: vi.fn() } }))
vi.mock('./processzip', () => ({ processZip: vi.fn() }))
vi.mock('./request/request', () => ({ requestChatData: vi.fn() }))
vi.mock('../requestLog', () => ({ recordRequestLog: vi.fn() }))

import { applyImageOrientation } from './stableDiff'

describe('applyImageOrientation', () => {
  test('keeps configured dimensions without an orientation', () => {
    expect(applyImageOrientation(1024, 640)).toEqual({ height: 640, width: 1024 })
  })

  test('places the longer edge on the width for landscape', () => {
    expect(applyImageOrientation(640, 1024, 'landscape')).toEqual({ height: 640, width: 1024 })
  })

  test('places the longer edge on the height for portrait', () => {
    expect(applyImageOrientation(1024, 640, 'portrait')).toEqual({ height: 1024, width: 640 })
  })
})
