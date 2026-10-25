import { describe, expect, it } from 'vitest'
import { AudioClock, fallbackStamp, isUsableStamp } from './clock'

describe('AudioClock', () => {
  it('extrapolates the output clock from the last stamp', () => {
    const clock = new AudioClock()
    clock.sync({ contextTime: 3, performanceTime: 1000 })
    expect(clock.now(1500)).toBeCloseTo(3.5)
  })

  it('never runs backwards when a resync lands slightly behind', () => {
    const clock = new AudioClock()
    clock.sync({ contextTime: 3, performanceTime: 1000 })
    expect(clock.now(1500)).toBeCloseTo(3.5)
    clock.sync({ contextTime: 3.49, performanceTime: 1500 })
    expect(clock.now(1500)).toBeCloseTo(3.5)
    expect(clock.now(1520)).toBeCloseTo(3.51)
  })

  it('accepts an earlier time after reset', () => {
    const clock = new AudioClock()
    clock.sync({ contextTime: 3, performanceTime: 1000 })
    clock.now(2000)
    clock.reset()
    expect(clock.isSynced).toBe(false)
    clock.sync({ contextTime: 3.2, performanceTime: 9000 })
    expect(clock.now(9000)).toBeCloseTo(3.2)
  })
})

describe('fallbackStamp', () => {
  it('subtracts output and base latency from currentTime', () => {
    const stamp = fallbackStamp(10, 0.04, 0.01, 777)
    expect(stamp.contextTime).toBeCloseTo(9.95)
    expect(stamp.performanceTime).toBe(777)
  })

  it('treats missing latencies as zero', () => {
    expect(fallbackStamp(10, undefined, undefined, 1).contextTime).toBe(10)
  })
})

describe('isUsableStamp', () => {
  it('rejects the zero stamp reported before audio flows', () => {
    expect(isUsableStamp({ contextTime: 0, performanceTime: 0 })).toBe(false)
    expect(isUsableStamp(undefined)).toBe(false)
    expect(isUsableStamp({ contextTime: 0.2, performanceTime: 123 })).toBe(true)
  })
})
