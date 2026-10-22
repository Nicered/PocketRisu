import { describe, expect, test } from 'vitest'
import { normalizeOnboarding } from './onboarding'

describe('normalizeOnboarding', () => {
    test('returns undefined when a card has no onboarding', () => {
        expect(normalizeOnboarding(undefined)).toBeUndefined()
        expect(normalizeOnboarding('form')).toBeUndefined()
    })

    test('keeps a well-formed onboarding as is', () => {
        const onboarding = {
            enabled: true,
            mode: 'form',
            title: 'Start',
            description: 'Pick one',
            html: '',
            floatingButton: true,
            questions: [{
                id: 'q1',
                title: 'Class',
                description: '',
                type: 'multiple',
                varName: 'class',
                required: true,
                placeholder: '',
                options: [{ label: 'Hunter', value: 'hunter' }],
            }],
        }
        expect(normalizeOnboarding(onboarding)).toEqual(onboarding)
    })

    test('coerces malformed fields instead of dropping the onboarding', () => {
        const normalized = normalizeOnboarding({
            enabled: 'yes',
            mode: 'popup',
            title: 3,
            questions: [null, { type: 'slider', options: [null, { label: 'A' }] }],
        })
        expect(normalized).toMatchObject({
            enabled: false,
            mode: 'form',
            title: '',
            floatingButton: false,
        })
        expect(normalized!.questions).toHaveLength(1)
        expect(normalized!.questions[0]).toMatchObject({
            type: 'single',
            varName: '',
            required: false,
            options: [{ label: 'A', value: '' }],
        })
        expect(normalized!.questions[0].id).not.toBe('')
    })
})
