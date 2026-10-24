import { Application } from 'pixi.js'
import { HomeScene } from './home/scene'
import './style.css'

const host = document.querySelector<HTMLDivElement>('#app')!

const app = new Application()
await app.init({
  background: '#1a1024',
  resizeTo: host,
  antialias: true,
  autoDensity: true,
  resolution: Math.min(window.devicePixelRatio, 2),
})
host.appendChild(app.canvas)

const go = (page: string) => () => {
  window.location.href = `${import.meta.env.BASE_URL}${page}`
}

const home = new HomeScene([
  { label: 'Afinador', onTap: go('tuner.html'), primary: true },
  { label: 'Calibrar', onTap: go('calibrar.html') },
  { label: 'Microfone', onTap: go('mic.html') },
])
app.stage.addChild(home)

const relayout = () => home.layout(app.screen.width, app.screen.height)
app.renderer.on('resize', relayout)
relayout()
