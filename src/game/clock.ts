export interface OutputStamp {
  contextTime: number
  performanceTime: number
}

/**
 * Maps performance.now() to the AudioContext output clock. Resynced from getOutputTimestamp a few
 * times per second, so each frame reads the clock without allocating; never runs backwards.
 */
export class AudioClock {
  private contextTime = 0
  private performanceTime = 0
  private synced = false
  private last = -Infinity

  sync(stamp: OutputStamp): void {
    this.contextTime = stamp.contextTime
    this.performanceTime = stamp.performanceTime
    this.synced = true
  }

  /** Forget the monotonic floor, e.g. after the context was suspended and resumed. */
  reset(): void {
    this.synced = false
    this.last = -Infinity
  }

  get isSynced(): boolean {
    return this.synced
  }

  now(performanceNow: number): number {
    const t = this.contextTime + (performanceNow - this.performanceTime) / 1000
    if (t > this.last) this.last = t
    return this.last
  }
}

/** Seconds of output latency to subtract from currentTime when getOutputTimestamp is missing or not yet running. */
export function fallbackStamp(
  currentTime: number,
  outputLatency: number | undefined,
  baseLatency: number | undefined,
  performanceNow: number,
): OutputStamp {
  return {
    contextTime: currentTime - (outputLatency ?? 0) - (baseLatency ?? 0),
    performanceTime: performanceNow,
  }
}

/** getOutputTimestamp reports zeros until audio actually flows. */
export function isUsableStamp(stamp: Partial<OutputStamp> | undefined): stamp is OutputStamp {
  return !!stamp && typeof stamp.contextTime === 'number' && typeof stamp.performanceTime === 'number' && stamp.performanceTime > 0
}
