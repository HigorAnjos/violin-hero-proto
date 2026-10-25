import { describe, expect, it } from 'vitest'
import { FpsMeter, parseFpsFlag } from './fps'

describe('FpsMeter', () => {
  it('reports average fps and the worst frame when the window closes', () => {
    const meter = new FpsMeter(990)
    let report = null
    for (let i = 0; i < 59; i++) report = meter.frame(i === 10 ? 50 : 16)
    expect(report).toBeNull()
    report = meter.frame(16)
    expect(report).not.toBeNull()
    expect(report!.frames).toBe(60)
    expect(report!.averageFps).toBeCloseTo((60 * 1000) / (59 * 16 + 50))
    expect(report!.worstMs).toBe(50)
  })

  it('starts a fresh window after reporting, reusing the report object', () => {
    const meter = new FpsMeter(100)
    const first = meter.frame(100)
    const worst = first!.worstMs
    expect(worst).toBe(100)
    meter.frame(20)
    const second = meter.frame(80)
    expect(second).toBe(first)
    expect(second!.frames).toBe(2)
    expect(second!.worstMs).toBe(80)
  })
})

describe('parseFpsFlag', () => {
  it.each([
    ['?fps=1', true],
    ['?fps=true', true],
    ['?fps=0', false],
    ['', false],
    ['?simular=80&fps=1', true],
  ])('%s → %s', (search, expected) => {
    expect(parseFpsFlag(search)).toBe(expected)
  })
})
