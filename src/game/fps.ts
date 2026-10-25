export interface FpsReport {
  frames: number
  averageFps: number
  worstMs: number
}

/** Frame statistics over fixed wall-clock windows; reuses one report object. */
export class FpsMeter {
  private frames = 0
  private elapsed = 0
  private worst = 0
  private readonly report: FpsReport = { frames: 0, averageFps: 0, worstMs: 0 }

  constructor(private readonly windowMs: number) {}

  /** Feed one frame duration; returns the report when a window closes, otherwise null. */
  frame(deltaMs: number): FpsReport | null {
    this.frames++
    this.elapsed += deltaMs
    if (deltaMs > this.worst) this.worst = deltaMs
    if (this.elapsed < this.windowMs) return null
    this.report.frames = this.frames
    this.report.averageFps = (this.frames * 1000) / this.elapsed
    this.report.worstMs = this.worst
    this.frames = 0
    this.elapsed = 0
    this.worst = 0
    return this.report
  }
}

export function parseFpsFlag(search: string): boolean {
  const value = new URLSearchParams(search).get('fps')
  return value === '1' || value === 'true'
}
