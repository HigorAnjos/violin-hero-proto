import { defineConfig } from 'vitest/config'
import basicSsl from '@vitejs/plugin-basic-ssl'

export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/violin-hero-proto/' : '/',
  plugins: command === 'serve' ? [basicSsl()] : [],
  test: {
    environment: 'node',
    passWithNoTests: true,
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
  },
}))
