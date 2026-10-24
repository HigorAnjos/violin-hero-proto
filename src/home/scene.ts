import { Container, Graphics, Text } from 'pixi.js'
import { homeLayout } from './layout'

const INK = 0xf2eaf7
const ACCENT = 0xe0a33a
const BACKGROUND = 0x1a1024

export class HomeScene extends Container {
  private readonly title = new Text({
    text: 'Violin Hero',
    style: { fill: INK, fontFamily: 'system-ui, sans-serif', fontWeight: '800' },
  })
  private readonly strings = new Graphics()
  private readonly labels: Text[] = []
  private readonly button = new Container()
  private readonly buttonBg = new Graphics()
  private readonly buttonLabel = new Text({
    text: 'Microfone',
    style: { fill: BACKGROUND, fontFamily: 'system-ui, sans-serif', fontWeight: '700' },
  })

  constructor(onStart: () => void) {
    super()
    this.title.anchor.set(0.5, 0)
    this.buttonLabel.anchor.set(0.5)
    this.button.addChild(this.buttonBg, this.buttonLabel)
    this.button.eventMode = 'static'
    this.button.cursor = 'pointer'
    this.button.on('pointertap', onStart)
    this.addChild(this.strings, this.title, this.button)
  }

  layout(width: number, height: number): void {
    const l = homeLayout(width, height)

    this.title.style.fontSize = l.title.fontSize
    this.title.position.set(l.title.x, l.title.y)

    this.strings.clear()
    l.strings.forEach((s, i) => {
      this.strings
        .moveTo(s.x, s.top)
        .lineTo(s.x, s.bottom)
        .stroke({ width: s.thickness, color: s.color, cap: 'round' })

      const label = (this.labels[i] ??= this.addLabel(s.name, s.color))
      label.style.fontSize = l.labelSize
      label.position.set(s.x, s.bottom + l.labelSize * 0.6)
    })

    const b = l.button
    this.button.position.set(b.x, b.y)
    this.buttonBg.clear().roundRect(0, 0, b.width, b.height, b.height / 2).fill(ACCENT)
    this.buttonLabel.style.fontSize = b.fontSize
    this.buttonLabel.position.set(b.width / 2, b.height / 2)
  }

  private addLabel(text: string, color: number): Text {
    const label = new Text({
      text,
      style: { fill: color, fontFamily: 'system-ui, sans-serif', fontWeight: '600' },
    })
    label.anchor.set(0.5, 0)
    this.addChild(label)
    return label
  }
}
