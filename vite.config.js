import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // Relative base so the build works at any mount path
  // (githubuser.github.io/the-whole-truth/, Firebase Hosting root, etc.)
  base: './',
  plugins: [react()],
  server: {
    port: 5200,
    host: true,
  },
})
