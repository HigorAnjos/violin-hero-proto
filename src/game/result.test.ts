import { describe, expect, it } from 'vitest'
import {
  accuracyPercent,
  deviceSummary,
  formatDateTime,
  formatPercent,
  formatSignedMs,
  meanOffsetMs,
  resultView,
  shareText,
  starsFor,
  starText,
  type ShareContext,
} from './result'
import type { GameResult, Judgment, NoteJudgment } from './types'

const counts = (perfect: number, great: number, good: number, miss: number): Record<Judgment, number> => ({
  perfect,
  great,
  good,
  miss,
})

function result(judgments: [Judgment, number | null][], score = 0, maxCombo = 0): GameResult {
  const list: NoteJudgment[] = judgments.map(([judgment, offsetMs], index) => ({ index, judgment, offsetMs, points: 0 }))
  const c = counts(0, 0, 0, 0)
  for (const j of list) c[j.judgment]++
  return { judgments: list, counts: c, score, maxCombo }
}

const UA = {
  androidChrome:
    'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.6723.58 Mobile Safari/537.36',
  iphoneSafari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  iphoneChrome:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0.6668.69 Mobile/15E148 Safari/604.1',
  samsung:
    'Mozilla/5.0 (Linux; Android 13; SM-A536B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36',
  androidFirefox: 'Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0',
  windowsEdge:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
  macSafari:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  linuxChrome: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
}

describe('accuracyPercent', () => {
  it('is 100 for all Perfeito and 0 for all Errou', () => {
    expect(accuracyPercent(counts(15, 0, 0, 0))).toBe(100)
    expect(accuracyPercent(counts(0, 0, 0, 15))).toBe(0)
  })

  it('weighs each judgment by its points without multiplier', () => {
    expect(accuracyPercent(counts(1, 1, 1, 1))).toBeCloseTo((100 + 70 + 40) / 4)
    expect(accuracyPercent(counts(0, 2, 0, 0))).toBeCloseTo(70)
  })

  it('is 0 for an empty song', () => {
    expect(accuracyPercent(counts(0, 0, 0, 0))).toBe(0)
  })
})

describe('starsFor', () => {
  it.each([
    [0, 0],
    [29.9, 0],
    [30, 1],
    [50, 2],
    [69.9, 2],
    [70, 3],
    [85, 4],
    [94.9, 4],
    [95, 5],
    [100, 5],
  ])('%f%% gives %i stars', (accuracy, stars) => {
    expect(starsFor(accuracy)).toBe(stars)
  })

  it('all Ótimo is 3 stars, all Bom is 1', () => {
    expect(starsFor(accuracyPercent(counts(0, 15, 0, 0)))).toBe(3)
    expect(starsFor(accuracyPercent(counts(0, 0, 15, 0)))).toBe(1)
  })
})

describe('text helpers', () => {
  it('draws filled and empty stars out of five', () => {
    expect(starText(0)).toBe('☆☆☆☆☆')
    expect(starText(3)).toBe('★★★☆☆')
    expect(starText(5)).toBe('★★★★★')
  })

  it('floors the percent so 99.9 never reads as 100', () => {
    expect(formatPercent(99.9)).toBe('99%')
    expect(formatPercent(100)).toBe('100%')
  })

  it('signs offsets with a real minus', () => {
    expect(formatSignedMs(12.4)).toBe('+12 ms')
    expect(formatSignedMs(-30.6)).toBe('−31 ms')
    expect(formatSignedMs(0.2)).toBe('0 ms')
  })

  it('formats local date and time with zero padding', () => {
    expect(formatDateTime(new Date(2026, 0, 5, 9, 3))).toBe('2026-01-05 09:03')
    expect(formatDateTime(new Date(2026, 9, 25, 14, 30))).toBe('2026-10-25 14:30')
  })
})

describe('meanOffsetMs', () => {
  it('averages only the hit notes', () => {
    expect(meanOffsetMs(result([['perfect', 10], ['great', -110], ['miss', null], ['good', 160]]))).toBeCloseTo(20)
  })

  it('ignores a miss that still carries an offset', () => {
    expect(meanOffsetMs(result([['perfect', 20], ['miss', 400]]))).toBe(20)
  })

  it('is null when nothing was hit', () => {
    expect(meanOffsetMs(result([['miss', null]]))).toBeNull()
    expect(meanOffsetMs(result([]))).toBeNull()
  })
})

describe('deviceSummary', () => {
  it.each([
    [UA.androidChrome, 'Android 14 · Chrome 130'],
    [UA.iphoneSafari, 'iPhone iOS 18 · Safari 18'],
    [UA.iphoneChrome, 'iPhone iOS 17 · Chrome 129'],
    [UA.samsung, 'Android 13 · Samsung Internet 26'],
    [UA.androidFirefox, 'Android 14 · Firefox 131'],
    [UA.windowsEdge, 'Windows · Edge 130'],
    [UA.macSafari, 'macOS · Safari 18'],
    [UA.linuxChrome, 'Linux · Chrome 131'],
    ['', 'sistema desconhecido · navegador desconhecido'],
  ])('summarizes %s', (ua, summary) => {
    expect(deviceSummary(ua)).toBe(summary)
  })
})

describe('resultView', () => {
  it('derives accuracy and stars from the counts', () => {
    const view = resultView(result([['perfect', 0], ['perfect', 0], ['great', 100], ['miss', null]], 270, 3))
    expect(view.score).toBe(270)
    expect(view.maxCombo).toBe(3)
    expect(view.accuracy).toBeCloseTo(67.5)
    expect(view.stars).toBe(2)
  })
})

describe('shareText', () => {
  const context: ShareContext = {
    songTitle: 'Escala de Dó maior',
    date: new Date(2026, 9, 25, 14, 30),
    latencyMs: 152.4,
    a4: 442,
    userAgent: UA.androidChrome,
    backingVolume: 0.5,
    headphones: false,
  }
  const played = result([['perfect', 10], ['perfect', -10], ['great', 90], ['good', -170], ['miss', null]], 1310, 4)

  it('carries everything the Anjos needs, one fact per line', () => {
    expect(shareText(played, context)).toBe(
      [
        'Violin Hero · Escala de Dó maior',
        '2026-10-25 14:30',
        'Pontos: 1.310 · ★★☆☆☆ 62%',
        'Perfeito 2 · Ótimo 1 · Bom 1 · Errou 1',
        'Maior combo: 4',
        'Atraso calibrado: 152 ms',
        'Média das notas: −20 ms',
        'Orquestra: 50% · sem fone · Lá 442 Hz',
        'Aparelho: Android 14 · Chrome 130',
      ].join('\n'),
    )
  })

  it('says when the device was never calibrated and the accompaniment was off', () => {
    const text = shareText(played, { ...context, latencyMs: null, backingVolume: null, headphones: true })
    expect(text).toContain('Atraso calibrado: não calibrado')
    expect(text).toContain('Orquestra: desligada · de fone · Lá 442 Hz')
  })

  it('flags a simulated run on its own last line', () => {
    const text = shareText(played, { ...context, simulated: '100 ms, 3 erros' })
    expect(text.split('\n').at(-1)).toBe('Teste simulado: 100 ms, 3 erros')
  })

  it('takes the title from the song, not a fixed string', () => {
    expect(shareText(played, { ...context, songTitle: 'Outra' }).split('\n')[0]).toBe('Violin Hero · Outra')
  })

  it('stays short enough for a chat message', () => {
    expect(shareText(played, { ...context, simulated: 'x' }).length).toBeLessThan(400)
  })
})
