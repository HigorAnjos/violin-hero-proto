import { Container, Graphics, Sprite, Text, Texture, type Renderer } from 'pixi.js'
import { solfegeName } from '../audio/notes'
import { LEAD_SECONDS, lowerBound, maxNotesInWindow, MISS_TAIL_SECONDS, noteY, trackLayout, type TrackLayout } from './layout'
import {
  chipName,
  comboText,
  COUNTDOWN_LABELS,
  countdownStep,
  feedbackAlpha,
  feedbackScale,
  formatScore,
  JUDGMENT_COLOR,
  JUDGMENT_LABEL,
  JUDGMENTS,
} from './present'
import type { Judgment, TimedNote } from './types'

const INK = 0xf2eaf7
const LANE_BG = 0x24182f
const FONT = 'system-ui, sans-serif'

const HIT = 1
const MISSED = 2

interface Chip {
  gem: Sprite
  label: Sprite
}

interface LaneFeedback {
  sprite: Sprite
  at: number
}

/**
 * The play field. Everything that moves is positioned from the clock passed to update(); the sprite
 * pool, textures and per-note state are allocated in setNotes()/layout(), never inside update().
 */
export class GameScene extends Container {
  private readonly lanesBg = new Graphics()
  private readonly glow = new Container()
  private readonly gems = new Container()
  private readonly labels = new Container()
  private readonly feedbackLayer = new Container()
  private readonly score = new Text({ text: '0', style: { fill: INK, fontFamily: FONT, fontWeight: '800' } })
  private readonly combo = new Text({ text: '', style: { fill: INK, fontFamily: FONT, fontWeight: '700' } })
  private readonly countdown = new Sprite()
  private readonly pauseButton = new Container()
  private readonly pauseBg = new Graphics()

  private l: TrackLayout = trackLayout(1, 1)
  private notes: readonly TimedNote[] = []
  private times = new Float64Array(0)
  private state = new Uint8Array(0)
  private noteLabel: Texture[] = []
  private chips: Chip[] = []
  private readonly feedback: LaneFeedback[] = []
  private readonly laneHitAt = [-Infinity, -Infinity, -Infinity, -Infinity]
  private readonly laneGlow: Sprite[] = []

  private gemTexture = Texture.EMPTY
  private judgmentTexture = new Map<Judgment, Texture>()
  private countdownTexture: Texture[] = []
  private labelCache = new Map<number, Texture>()

  constructor(
    private readonly renderer: Renderer,
    onPause: () => void,
  ) {
    super()
    this.score.anchor.set(0, 0.5)
    this.combo.anchor.set(0.5, 0.5)
    this.countdown.anchor.set(0.5)
    this.countdown.visible = false
    this.pauseButton.addChild(this.pauseBg)
    this.pauseButton.eventMode = 'static'
    this.pauseButton.cursor = 'pointer'
    this.pauseButton.on('pointertap', onPause)
    this.gems.eventMode = 'none'
    this.labels.eventMode = 'none'
    this.addChild(this.lanesBg, this.glow, this.gems, this.labels, this.feedbackLayer, this.score, this.combo, this.countdown, this.pauseButton)
    for (let i = 0; i < 4; i++) {
      const glow = new Sprite(Texture.WHITE)
      glow.visible = false
      this.glow.addChild(glow)
      this.laneGlow.push(glow)
      const sprite = new Sprite()
      sprite.anchor.set(0.5)
      sprite.visible = false
      this.feedbackLayer.addChild(sprite)
      this.feedback.push({ sprite, at: -Infinity })
    }
  }

  setNotes(notes: readonly TimedNote[]): void {
    this.notes = notes
    this.times = Float64Array.from(notes, (n) => n.time)
    this.state = new Uint8Array(notes.length)
    this.laneHitAt.fill(-Infinity)
    for (const f of this.feedback) f.at = -Infinity
    this.buildLabels()
    const poolSize = maxNotesInWindow(this.times, LEAD_SECONDS + MISS_TAIL_SECONDS + 0.5) + 2
    while (this.chips.length < poolSize) {
      const gem = new Sprite(this.gemTexture)
      const label = new Sprite()
      gem.anchor.set(0.5)
      label.anchor.set(0.5)
      gem.visible = label.visible = false
      this.gems.addChild(gem)
      this.labels.addChild(label)
      this.chips.push({ gem, label })
    }
  }

  layout(width: number, height: number): void {
    this.l = trackLayout(width, height)
    const l = this.l
    this.buildTextures()

    this.lanesBg.clear()
    this.lanesBg.rect(l.track.left, l.track.top, l.track.width, l.track.bottom - l.track.top).fill({ color: LANE_BG, alpha: 0.6 })
    for (const lane of l.lanes) {
      this.lanesBg.moveTo(lane.x, l.track.top).lineTo(lane.x, l.track.bottom).stroke({ width: 2, color: lane.color, alpha: 0.35 })
    }
    this.lanesBg.moveTo(l.track.left, l.hitY).lineTo(l.track.left + l.track.width, l.hitY).stroke({ width: 4, color: INK, alpha: 0.85 })
    for (const lane of l.lanes) {
      this.lanesBg
        .roundRect(lane.x - l.note.width / 2, l.hitY - l.note.height / 2, l.note.width, l.note.height, l.note.height / 3)
        .stroke({ width: 3, color: lane.color, alpha: 0.9 })
    }

    this.score.style.fontSize = l.hud.fontSize
    this.score.position.set(l.hud.scoreX, l.hud.top + l.hud.height / 2)
    this.combo.style.fontSize = Math.round(l.hud.fontSize * 0.8)
    this.combo.position.set(l.hud.comboX, l.hud.top + l.hud.height / 2)

    const p = l.pause
    this.pauseButton.position.set(p.x, p.y)
    const bar = p.width * 0.12
    this.pauseBg
      .clear()
      .circle(p.width / 2, p.height / 2, p.width / 2)
      .fill({ color: 0x45325e })
      .rect(p.width / 2 - bar * 1.5, p.height * 0.3, bar, p.height * 0.4)
      .rect(p.width / 2 + bar * 0.5, p.height * 0.3, bar, p.height * 0.4)
      .fill(INK)

    l.lanes.forEach((lane, i) => {
      const glow = this.laneGlow[i]
      glow.tint = lane.color
      glow.position.set(lane.x - lane.width / 2, l.track.top)
      glow.setSize(lane.width, l.hitY - l.track.top + l.note.height / 2)
    })

    this.countdown.position.set(width / 2, (l.track.top + l.hitY) / 2)
    for (const lane of this.feedback) lane.sprite.y = l.feedbackY
    this.feedback.forEach((f, i) => (f.sprite.x = l.lanes[i].x))
  }

  setScore(score: number, combo: number): void {
    this.score.text = formatScore(score)
    this.combo.text = comboText(combo)
  }

  /** Record a judgment; `at` is the clock time it is shown from. */
  judge(index: number, judgment: Judgment, at: number): void {
    const note = this.notes[index]
    if (!note) return
    this.state[index] = judgment === 'miss' ? MISSED : HIT
    const f = this.feedback[note.string]
    f.at = at
    f.sprite.texture = this.judgmentTexture.get(judgment) ?? Texture.EMPTY
    if (judgment !== 'miss') this.laneHitAt[note.string] = at
  }

  /** Draw the frame for clock time `now`; `startAt` is beat 0 on the same clock. */
  update(now: number, startAt: number): void {
    const l = this.l
    const first = lowerBound(this.times, now - MISS_TAIL_SECONDS)
    const last = lowerBound(this.times, now + LEAD_SECONDS + 0.2)
    let used = 0
    for (let i = first; i < last && used < this.chips.length; i++) {
      const s = this.state[i]
      if (s === HIT) continue
      const note = this.notes[i]
      const chip = this.chips[used++]
      const x = l.lanes[note.string].x
      const y = noteY(l, note.time, now)
      const alpha = s === MISSED ? 0.3 : 1
      chip.gem.visible = chip.label.visible = true
      chip.gem.position.set(x, y)
      chip.gem.tint = l.lanes[note.string].color
      chip.gem.alpha = alpha
      chip.label.texture = this.noteLabel[i]
      chip.label.position.set(x, y)
      chip.label.alpha = alpha
    }
    for (let i = used; i < this.chips.length; i++) {
      const chip = this.chips[i]
      if (!chip.gem.visible) break
      chip.gem.visible = chip.label.visible = false
    }

    for (const f of this.feedback) {
      const age = now - f.at
      const alpha = feedbackAlpha(age)
      f.sprite.visible = alpha > 0
      if (alpha > 0) {
        f.sprite.alpha = alpha
        f.sprite.scale.set(feedbackScale(age))
      }
    }

    for (let i = 0; i < 4; i++) {
      const a = feedbackAlpha(now - this.laneHitAt[i] + 0.15)
      const glow = this.laneGlow[i]
      glow.visible = a > 0
      glow.alpha = 0.18 * a
    }

    const step = countdownStep(now - startAt)
    this.countdown.visible = step >= 0
    if (step >= 0) this.countdown.texture = this.countdownTexture[step]
  }

  private bake(target: Container): Texture {
    const texture = this.renderer.generateTexture({ target, resolution: this.renderer.resolution, antialias: true })
    target.destroy()
    return texture
  }

  private textTexture(text: string, size: number, fill: number, weight: '700' | '800' = '800'): Texture {
    return this.bake(new Text({ text, style: { fill, fontFamily: FONT, fontWeight: weight, fontSize: size } }))
  }

  private buildTextures(): void {
    const l = this.l
    const old = [this.gemTexture, ...this.judgmentTexture.values(), ...this.countdownTexture]
    const g = new Graphics()
      .roundRect(0, 0, l.note.width, l.note.height, l.note.height / 3)
      .fill(0xffffff)
      .roundRect(3, 3, l.note.width - 6, l.note.height * 0.4, l.note.height / 4)
      .fill({ color: 0xffffff, alpha: 0.35 })
    this.gemTexture = this.bake(g)
    for (const chip of this.chips) chip.gem.texture = this.gemTexture

    this.judgmentTexture = new Map(JUDGMENTS.map((j) => [j, this.textTexture(JUDGMENT_LABEL[j], l.feedbackSize, JUDGMENT_COLOR[j])]))
    this.feedback.forEach((f) => (f.sprite.texture = Texture.EMPTY))
    this.countdownTexture = COUNTDOWN_LABELS.map((t) => this.textTexture(t, Math.round(l.track.width * 0.3), INK))
    for (const t of old) if (t !== Texture.EMPTY) t.destroy(true)
    this.buildLabels(true)
  }

  private buildLabels(force = false): void {
    if (force) {
      for (const t of this.labelCache.values()) t.destroy(true)
      this.labelCache.clear()
    }
    this.noteLabel = this.notes.map((n) => {
      let t = this.labelCache.get(n.midi)
      if (!t) {
        t = this.textTexture(chipName(solfegeName(n.midi)), this.l.labelSize, 0x1a1024, '800')
        this.labelCache.set(n.midi, t)
      }
      return t
    })
  }
}
