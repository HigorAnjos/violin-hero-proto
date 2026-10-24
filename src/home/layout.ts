export interface StringLine {
  name: string
  color: number
  x: number
  top: number
  bottom: number
  thickness: number
}

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

export interface HomeLayout {
  title: { x: number; y: number; fontSize: number }
  strings: StringLine[]
  labelSize: number
  buttons: (Box & { fontSize: number })[]
}

export const STRINGS = [
  { name: 'Sol', color: 0xe5484d },
  { name: 'Ré', color: 0xe0a33a },
  { name: 'Lá', color: 0x4cc38a },
  { name: 'Mi', color: 0x3e9bf4 },
] as const

const MAX_CONTENT_WIDTH = 480

const BUTTON_GAP = 12

export function homeLayout(width: number, height: number, buttonCount = 1): HomeLayout {
  const contentWidth = Math.min(width - 32, MAX_CONTENT_WIDTH)
  const left = (width - contentWidth) / 2
  const unit = Math.min(contentWidth, height * 0.6)

  const titleSize = Math.round(Math.max(28, Math.min(64, unit * 0.12)))
  const titleY = Math.max(24, height * 0.08)

  const buttonHeight = Math.max(52, Math.min(72, height * 0.09))
  const buttonWidth = Math.min(contentWidth, 320)
  const buttonY =
    height - Math.max(24, height * 0.08) - buttonCount * buttonHeight - (buttonCount - 1) * BUTTON_GAP

  const labelSize = Math.round(Math.max(14, Math.min(22, unit * 0.045)))
  const top = titleY + titleSize * 1.6
  const bottom = buttonY - labelSize * 2.5
  const gap = contentWidth / STRINGS.length

  return {
    title: { x: width / 2, y: titleY, fontSize: titleSize },
    strings: STRINGS.map((s, i) => ({
      ...s,
      x: left + gap * (i + 0.5),
      top,
      bottom,
      thickness: 6 - i * 1.2,
    })),
    labelSize,
    buttons: Array.from({ length: buttonCount }, (_, i) => ({
      x: (width - buttonWidth) / 2,
      y: buttonY + i * (buttonHeight + BUTTON_GAP),
      width: buttonWidth,
      height: buttonHeight,
      fontSize: Math.round(buttonHeight * 0.34),
    })),
  }
}
