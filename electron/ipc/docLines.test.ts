import { describe, expect, it } from 'vitest'
import { isWorkflowColor } from './docLines'

const hex = (h: string) => ({ red: parseInt(h.slice(1, 3), 16) / 255, green: parseInt(h.slice(3, 5), 16) / 255, blue: parseInt(h.slice(5, 7), 16) / 255 })

describe('highlight colours that mean something else', () => {
  it('ignores green and purple, from light to strong', () => {
    // Google Docs palette: light green 3, light green 1, green; light purple 3, purple, magenta.
    for (const c of ['#d9ead3', '#93c47d', '#00ff00', '#d9d2e9', '#9900ff', '#ff00ff']) expect(isWorkflowColor(hex(c))).toBe(true)
    // The app's own Gemini purple.
    expect(isWorkflowColor({ red: 0.91, green: 0.86, blue: 1 })).toBe(true)
  })

  it('still reads yellow, orange and other highlights', () => {
    for (const c of ['#ffff00', '#fff2cc', '#ffe599', '#ff9900', '#fce5cd', '#cfe2f3', '#00ffff', '#f4cccc']) expect(isWorkflowColor(hex(c))).toBe(false)
  })
})
