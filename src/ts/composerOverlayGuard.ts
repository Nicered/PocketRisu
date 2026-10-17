// Keeps floating UI off the chat composer while the user is typing.
//
// Plugins often pin their own buttons with position:fixed near the bottom of
// the screen (e.g. an illustration toggle injected via getRootDocument()). When
// the on-screen keyboard opens, the composer moves up and lands under those
// buttons, so taps meant for the textarea hit the plugin instead. While focus
// is inside the composer we hit-test its area, and every fixed-position element
// painted *above* it gets a temporary `translate` that parks it just over the
// composer's top edge. Everything is restored once focus leaves.
//
// Only "small" floaters are moved: anything covering a large share of the
// viewport is a modal/backdrop/panel and is left alone.
//
// Plugins that instead inject *into* the composer (found via the
// .plugin-compat-items-stretch hook) and absolutely position themselves over it
// are re-flowed as ordinary flex items: any direct child that computes to
// absolute/fixed gets REFLOW_CLASS (styled in DefaultChatScreen.svelte), so it
// sits in the button row instead of on top of the text.

const REFLOW_CLASS = 'composer-plugin-reflow'

const GAP_PX = 8
const MAX_AREA_RATIO = 0.25
const RECHECK_MS = 400
// Restoring right on focusout would yank a lifted button back down between the
// tap that blurs the textarea and the click it should receive.
const RESTORE_DELAY_MS = 350

type Lifted = { prevTranslate: string }

export function liftOverlaysOffComposer(node: HTMLElement) {
    const lifted = new Map<HTMLElement, Lifted>()
    let active = false
    let timer: ReturnType<typeof setInterval> | null = null
    let restoreTimer: ReturnType<typeof setTimeout> | null = null
    let raf = 0

    const restoreAll = () => {
        for (const [el, { prevTranslate }] of lifted) {
            el.style.translate = prevTranslate
        }
        lifted.clear()
    }

    const findFixedRoot = (el: Element): HTMLElement | null => {
        let cur: Element | null = el
        while (cur && cur !== document.body && cur !== document.documentElement) {
            // Never move the composer itself or anything wrapping it.
            if (cur === node || cur.contains(node)) return null
            if (cur instanceof HTMLElement && getComputedStyle(cur).position === 'fixed') return cur
            cur = cur.parentElement
        }
        return null
    }

    const evaluate = () => {
        raf = 0
        if (!active) return
        // Measure from the un-lifted layout so the offset doesn't compound.
        restoreAll()

        const rect = node.getBoundingClientRect()
        if (rect.width <= 0 || rect.height <= 0) return
        const vw = window.innerWidth
        const vh = window.innerHeight
        const maxArea = vw * vh * MAX_AREA_RATIO

        const covering = new Set<HTMLElement>()
        const cols = 10
        const ys = [rect.top + 4, rect.top + rect.height / 2, rect.bottom - 4]
        for (const y of ys) {
            if (y < 0 || y >= vh) continue
            for (let i = 0; i < cols; i++) {
                const x = rect.left + (rect.width * (i + 0.5)) / cols
                if (x < 0 || x >= vw) continue
                // Stack is top-most first; stop once we reach the composer —
                // anything after it is painted underneath and can't cover it.
                for (const hit of document.elementsFromPoint(x, y)) {
                    if (hit === node || node.contains(hit) || hit.contains(node)) break
                    const root = findFixedRoot(hit)
                    if (root) covering.add(root)
                }
            }
        }

        for (const el of covering) {
            const r = el.getBoundingClientRect()
            if (r.width * r.height > maxArea) continue
            const dy = r.bottom - rect.top + GAP_PX
            if (dy <= 0) continue
            lifted.set(el, { prevTranslate: el.style.translate })
            el.style.translate = `0 ${-Math.round(dy)}px`
        }
    }

    const schedule = () => {
        if (active && !raf) raf = requestAnimationFrame(evaluate)
    }

    const start = () => {
        if (restoreTimer) { clearTimeout(restoreTimer); restoreTimer = null }
        if (active) { schedule(); return }
        active = true
        timer = setInterval(schedule, RECHECK_MS)
        window.visualViewport?.addEventListener('resize', schedule)
        window.visualViewport?.addEventListener('scroll', schedule)
        window.addEventListener('resize', schedule)
        schedule()
    }

    const stop = () => {
        active = false
        if (timer) { clearInterval(timer); timer = null }
        if (raf) { cancelAnimationFrame(raf); raf = 0 }
        window.visualViewport?.removeEventListener('resize', schedule)
        window.visualViewport?.removeEventListener('scroll', schedule)
        window.removeEventListener('resize', schedule)
        restoreAll()
    }

    const onFocusIn = (e: FocusEvent) => {
        const t = e.target as HTMLElement | null
        if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.isContentEditable)) start()
    }
    const onFocusOut = (e: FocusEvent) => {
        if (!active) return
        if (e.relatedTarget instanceof Node && node.contains(e.relatedTarget)) return
        if (restoreTimer) clearTimeout(restoreTimer)
        restoreTimer = setTimeout(() => {
            restoreTimer = null
            if (!node.contains(document.activeElement)) stop()
        }, RESTORE_DELAY_MS)
    }

    let reflowRaf = 0
    const reflowInjected = () => {
        reflowRaf = 0
        for (const child of node.children) {
            if (!(child instanceof HTMLElement) || child.classList.contains(REFLOW_CLASS)) continue
            const pos = getComputedStyle(child).position
            if (pos === 'absolute' || pos === 'fixed') child.classList.add(REFLOW_CLASS)
        }
    }
    // Plugins may append first and set their positioning styles afterwards,
    // so watch child attributes as well as the child list.
    const observer = new MutationObserver(() => {
        if (!reflowRaf) reflowRaf = requestAnimationFrame(reflowInjected)
    })
    observer.observe(node, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] })
    reflowInjected()

    node.addEventListener('focusin', onFocusIn)
    node.addEventListener('focusout', onFocusOut)
    // Composer grows/shrinks while typing multi-line input.
    node.addEventListener('input', schedule)

    return {
        destroy() {
            node.removeEventListener('focusin', onFocusIn)
            node.removeEventListener('focusout', onFocusOut)
            node.removeEventListener('input', schedule)
            if (restoreTimer) clearTimeout(restoreTimer)
            observer.disconnect()
            if (reflowRaf) cancelAnimationFrame(reflowRaf)
            stop()
        },
    }
}
