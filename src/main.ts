import { Application } from 'pixi.js'

const app = new Application()
await app.init({ background: '#1a1024', resizeTo: window })
document.querySelector<HTMLDivElement>('#app')!.appendChild(app.canvas)
