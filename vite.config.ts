import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

// 开发期把 /api 与 /ws 代理到车上内嵌服务，地址由环境变量 VITE_CAR_TARGET 指定，默认 localhost:8080
const carTarget = process.env.VITE_CAR_TARGET || 'http://127.0.0.1:8080'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        target: carTarget,
        changeOrigin: true
      },
      '/ws': {
        target: carTarget,
        ws: true,
        changeOrigin: true
      }
    }
  }
})
