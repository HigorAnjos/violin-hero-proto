import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import basicSsl from '@vitejs/plugin-basic-ssl'

export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? '/violin-hero-proto/' : '/',
  plugins: command === 'serve' ? [basicSsl()] : [],
  build: {
    rolldownOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        mic: fileURLToPath(new URL('./mic.html', import.meta.url)),
        tuner: fileURLToPath(new URL('./tuner.html', import.meta.url)),
        calibrar: fileURLToPath(new URL('./calibrar.html', import.meta.url)),
      },
    },
  },
}))
