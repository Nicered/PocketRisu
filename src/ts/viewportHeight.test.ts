import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { installDynamicViewportHeight } from './viewportHeight'

class FakeVisualViewport extends EventTarget {
    height: number
    offsetTop = 0
    scale = 1
    constructor(height: number) {
        super()
        this.height = height
    }
}

let vv: FakeVisualViewport
let innerHeight: number
let rafQueue: FrameRequestCallback[]
let listeners: [EventTarget, string, EventListenerOrEventListenerObject][]

const heightVar = () => document.documentElement.style.getPropertyValue('--risu-height-size')
const flushFrames = () => {
    const queued = rafQueue
    rafQueue = []
    for (const cb of queued) cb(0)
}
// Toolbars move both viewports; the keyboard moves only the visual one, except
// that iOS Safari also shrinks innerHeight by the pan that lifts the input.
const setViewport = (visual: number, layout = innerHeight, offsetTop = 0) => {
    vv.height = visual
    vv.offsetTop = offsetTop
    innerHeight = layout
    vv.dispatchEvent(new Event('resize'))
    flushFrames()
}

describe('installDynamicViewportHeight', () => {
    let textarea: HTMLTextAreaElement

    beforeEach(() => {
        innerHeight = 640
        vv = new FakeVisualViewport(640)
        rafQueue = []
        vi.stubGlobal('visualViewport', vv)
        vi.spyOn(window, 'innerHeight', 'get').mockImplementation(() => innerHeight)
        vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => rafQueue.push(cb))
        listeners = []
        for (const target of [window, document] as EventTarget[]) {
            const add = target.addEventListener.bind(target)
            vi.spyOn(target, 'addEventListener').mockImplementation((type, listener, options) => {
                if (listener) listeners.push([target, type, listener])
                add(type, listener, options)
            })
        }
        document.documentElement.style.removeProperty('--risu-height-size')
        textarea = document.createElement('textarea')
        document.body.appendChild(textarea)
    })

    afterEach(() => {
        // An earlier test's install would otherwise keep measuring its own fake viewport.
        for (const [target, type, listener] of listeners) target.removeEventListener(type, listener)
        textarea.remove()
        vi.restoreAllMocks()
        vi.unstubAllGlobals()
    })

    test('catches up when the keyboard closes but focus stays in the composer', () => {
        installDynamicViewportHeight()
        setViewport(696, 696) // toolbars hidden
        textarea.focus()
        setViewport(400) // keyboard open
        expect(heightVar()).toBe('696px')
        setViewport(640, 640) // keyboard dismissed with Back, toolbars back, still focused
        expect(heightVar()).toBe('640px')
    })

    test('re-measures when focus leaves the composer', () => {
        installDynamicViewportHeight()
        textarea.focus()
        setViewport(400) // keyboard open, skipped
        vv.height = 600 // settled without a further resize event
        textarea.blur()
        flushFrames()
        expect(heightVar()).toBe('600px')
    })

    // Values measured in iOS 18.4 Safari.
    test('skips the iOS keyboard while its pan shrinks innerHeight too', () => {
        installDynamicViewportHeight()
        setViewport(678, 678)
        textarea.focus()
        setViewport(410, 672, 6) // keyboard open, pan just started
        expect(heightVar()).toBe('678px')
        setViewport(409, 409, 269) // later keyboard step with the input lifted
        expect(heightVar()).toBe('678px')
        setViewport(410, 678) // keyboard shown again without a pan
        expect(heightVar()).toBe('678px')
    })

    test('waits for the iOS keyboard to close after focus leaves', () => {
        installDynamicViewportHeight()
        setViewport(678, 678)
        textarea.focus()
        setViewport(410, 410, 268)
        textarea.blur() // focusout lands while the keyboard is still up
        flushFrames()
        expect(heightVar()).toBe('678px')
        setViewport(700, 700) // keyboard closed with the toolbars collapsed
        expect(heightVar()).toBe('700px')
    })

    test('skips while pinch-zoomed', () => {
        installDynamicViewportHeight()
        vv.scale = 2
        setViewport(320)
        expect(heightVar()).toBe('640px')
    })
})
