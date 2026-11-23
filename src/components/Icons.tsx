/**
 * The app's own icons, drawn to match the design mockups.
 *
 * The two rockets tell the quiz engines apart the way the mockups do: an outline rocket for
 * Classic Quizzes and a solid one for New Quizzes. They are the app's drawings, not Instructure's
 * artwork. Each tile colour follows Canvas Extractor Tools' Google-colour tiles.
 */
import type { QuizEngine } from '../types'

const ROCKET_PATHS = (
  <>
    <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
    <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
    <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
    <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
  </>
)

export function Rocket({ engine, size = 24, color, label }: { engine: QuizEngine; size?: number; color?: string; label?: string }) {
  const solid = engine === 'new'
  const stroke = color ?? (solid ? '#ffffff' : '#1f2937')
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={solid ? stroke : 'none'}
      stroke={stroke}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {ROCKET_PATHS}
      {solid && <circle cx="15.5" cy="8.5" r="1.4" fill={ENGINE_TILE.new} stroke="none" />}
    </svg>
  )
}

export const ENGINE_TILE: Record<QuizEngine, string> = { classic: '#FBBC05', new: '#4285F4' }

/** A coloured icon square, as on the extractor's tool cards. */
export function IconTile({ color, size = 38, children }: { color: string; size?: number; children: React.ReactNode }) {
  return (
    <span className="flex items-center justify-center flex-shrink-0" style={{ width: size, height: size, borderRadius: size * 0.27, background: color }} aria-hidden="true">
      {children}
    </span>
  )
}

const line = { fill: 'none', stroke: '#ffffff', strokeWidth: 1.9, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }

export function DocIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...line} aria-hidden="true">
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="M8 13h8" />
      <path d="M8 17h5" />
    </svg>
  )
}

export function CheckFixIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...line} aria-hidden="true">
      <path d="M9 11l3 3L22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  )
}

/**
 * The Canvas mark, in white for the red tile: the same drawing Canvas Extractor Tools uses on its
 * course content card (from Canvas Rubric Creator's CanvasLogo).
 */
export function CoursesIcon({ size = 25 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="#fff" aria-hidden="true" focusable="false">
      <path d="M 38 14 A 12 12 0 0 0 62 14 Z" />
      <path d="M 38 14 A 12 12 0 0 0 62 14 Z" transform="rotate(45,50,50)" />
      <path d="M 38 14 A 12 12 0 0 0 62 14 Z" transform="rotate(90,50,50)" />
      <path d="M 38 14 A 12 12 0 0 0 62 14 Z" transform="rotate(135,50,50)" />
      <path d="M 38 14 A 12 12 0 0 0 62 14 Z" transform="rotate(180,50,50)" />
      <path d="M 38 14 A 12 12 0 0 0 62 14 Z" transform="rotate(225,50,50)" />
      <path d="M 38 14 A 12 12 0 0 0 62 14 Z" transform="rotate(270,50,50)" />
      <path d="M 38 14 A 12 12 0 0 0 62 14 Z" transform="rotate(315,50,50)" />
      <circle cx="50" cy="28" r="5" transform="rotate(22.5,50,50)" />
      <circle cx="50" cy="28" r="5" transform="rotate(67.5,50,50)" />
      <circle cx="50" cy="28" r="5" transform="rotate(112.5,50,50)" />
      <circle cx="50" cy="28" r="5" transform="rotate(157.5,50,50)" />
      <circle cx="50" cy="28" r="5" transform="rotate(202.5,50,50)" />
      <circle cx="50" cy="28" r="5" transform="rotate(247.5,50,50)" />
      <circle cx="50" cy="28" r="5" transform="rotate(292.5,50,50)" />
      <circle cx="50" cy="28" r="5" transform="rotate(337.5,50,50)" />
    </svg>
  )
}

export const STEP_TILE = { doc: '#4285F4', engine: '#FBBC05', check: '#34A853', courses: '#EA4335' }
