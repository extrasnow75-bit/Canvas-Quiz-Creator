import { describe, expect, it } from 'vitest'
import { toUserMessage } from './userMessage'

describe('toUserMessage', () => {
  it('keeps a sentence the app wrote', () => {
    expect(toUserMessage(new Error('Choose at least one course in step 4.'), 'x')).toBe('Choose at least one course in step 4.')
  })
  it('keeps the details after a sentence', () => {
    const m = 'Google is busy right now. Wait a minute and try again. Details for support: Docs 429.'
    expect(toUserMessage(new Error(m), 'x')).toBe(m)
  })
  it('replaces library errors with the fallback and keeps them for support', () => {
    const m = toUserMessage(new TypeError('fetch failed'), 'The Google Doc could not be read')
    expect(m).toMatch(/^The Google Doc could not be read\. Please try again\./)
    expect(m).toMatch(/Details for support: fetch failed$/)
  })
  it('handles things that are not errors', () => {
    expect(toUserMessage(undefined, 'It did not work.')).toMatch(/^It did not work\. Please try again\./)
  })
})
