import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'

// https://vite.dev/config/
export default defineConfig(({ command, isPreview, mode }) => ({
  base: command === 'build' || isPreview ? '/xf-midi-viewer/' : '/',
  plugins: [react(), ...(mode === 'https' ? [basicSsl()] : [])],
}))
