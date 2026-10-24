import { Container, Graphics, Text } from 'pixi.js'
import { homeLayout } from './layout'

const INK = 0xf2eaf7
const ACCENT = 0xe0a33a
const BACKGROUND = 0x1a1024
const SECONDARY = 0x45325e

export interface HomeAction {
  label: string
  onTap: () => void
  primary?: boolean
}

interface ActionButton {
  view: Container
  bg: Graphics
  label: Text
  fill: number
}

export class HomeScene extends Container {
  private readonly title = new Text({
    text: 'Violin Hero',
    style: { fill: INK, fontFamily: 'system-ui, sans-serif', fontWeight: '800' },
  })
  private readonly strings = new Graphics()
  private readonly labels: Text[] = []
  private readonly buttons: ActionButton[]

  constructor(actions: HomeAction[]) {
    super()
    this.title.anchor.set(0.5, 0)
    this.addChild(this.strings, this.title)
    this.buttons = actions.map((a) => this.addButton(a))
  }

  layout(width: number, height: number): void {
    const l = homeLayout(width, height, this.buttons.length)

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

    this.buttons.forEach((button, i) => {
      const b = l.buttons[i]
      button.view.position.set(b.x, b.y)
      button.bg.clear().roundRect(0, 0, b.width, b.height, b.height / 2).fill(button.fill)
      button.label.style.fontSize = b.fontSize
      button.label.position.set(b.width / 2, b.height / 2)
    })
  }

  private addButton({ label: text, onTap, primary = false }: HomeAction): ActionButton {
    const view = new Container()
    const bg = new Graphics()
    const label = new Text({
      text,
      style: { fill: primary ? BACKGROUND : INK, fontFamily: 'system-ui, sans-serif', fontWeight: '700' },
    })
    label.anchor.set(0.5)
    view.addChild(bg, label)
    view.eventMode = 'static'
    view.cursor = 'pointer'
    view.on('pointertap', onTap)
    this.addChild(view)
    return { view, bg, label, fill: primary ? ACCENT : SECONDARY }
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
