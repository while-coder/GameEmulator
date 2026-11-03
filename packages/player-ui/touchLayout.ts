export interface TouchControlLayout {
  x: number
  y: number
  scale?: number
  hidden?: boolean
}

export function readTouchControl(value: unknown): TouchControlLayout | undefined {
  const saved = value as TouchControlLayout | null
  if (!saved || !Number.isFinite(saved.x) || !Number.isFinite(saved.y)) return
  return {
    x: Math.max(0, Math.min(1, saved.x)),
    y: Math.max(0, Math.min(1, saved.y)),
    scale: typeof saved.scale === 'number' && Number.isFinite(saved.scale) ? Math.max(0.75, Math.min(1.75, saved.scale)) : 1,
    hidden: saved.hidden === true,
  }
}
