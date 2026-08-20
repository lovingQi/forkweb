import { webcrypto } from 'crypto'
if (!(globalThis as any).crypto) {
  (globalThis as any).crypto = webcrypto
}
import cors from 'cors'
import express from 'express'
import fs from 'fs/promises'
import fsSync from 'fs'
import http from 'http'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

import pinoHttp from 'pino-http'
import { CACHE_DIR, CONFIG_DIR } from './paths'
import { logger } from './logger'
import { ReplaySession } from './core/session'
import { cleanExpiredFiles } from './core/storageCleaner'
import authRoutes, { ensureAdminUser } from './users/routes'
import ticketRoutes from './tickets/routes'
import siteRoutes from './sites/routes'
import statsRoutes from './stats/routes'
import vehicleRoutes from './vehicles/routes'
import { createReplayRoutes } from './replay/routes'
import { setupReplayWebSocket, buildStateSnapshot } from './replay/ws'

const app = express()
const server = http.createServer(app)
const port = Number(process.env.REPLAY_PORT || 18080)
const host = process.env.REPLAY_HOST || '127.0.0.1'
const session = new ReplaySession()

app.use(cors())
app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/api/health' } }))
app.use(express.json({ limit: '80mb' }))

app.use('/api/auth', authRoutes)
app.use('/api/tickets', ticketRoutes)
app.use('/api/sites', siteRoutes)
app.use('/api/stats', statsRoutes)
app.use('/api/vehicles', vehicleRoutes)
app.use('/api/replay', createReplayRoutes(session))

app.get('/api/state', (_req, res) => {
  res.json(buildStateSnapshot(session))
})

app.get('/api/map', (_req, res) => {
  res.json(session.data.map)
})

app.get('/api/params', (_req, res) => {
  res.json({ params: {} })
})

app.get('/api/health', async (_req, res) => {
  try {
    const [cache, config] = await Promise.all([
      getDiskUsage(CACHE_DIR),
      getDiskUsage(CONFIG_DIR)
    ])
    res.json({
      succeed: true,
      status: 'ok',
      timestamp: new Date().toISOString(),
      codeVersion: 'fix-globalindex-v2-d18e75d',
      diskUsage: { cache, config }
    })
  } catch (e) {
    res.status(500).json({
      succeed: false,
      status: 'error',
      error: e instanceof Error ? e.message : String(e)
    })
  }
})

async function getDiskUsage(dirPath: string): Promise<{ path: string; usedBytes: number; totalBytes: number }> {
  try {
    await fs.mkdir(dirPath, { recursive: true })
    const stat = await fs.statfs(dirPath)
    const totalBytes = stat.bsize * stat.blocks
    const availableBytes = stat.bsize * stat.bavail
    return { path: dirPath, usedBytes: totalBytes - availableBytes, totalBytes }
  } catch {
    return { path: dirPath, usedBytes: 0, totalBytes: 0 }
  }
}

const distDir = path.resolve(__dirname, '../../dist')
if (fsSync.existsSync(distDir)) {
  app.use(express.static(distDir))
  app.get('*', (_req, res) => {
    res.sendFile(path.join(distDir, 'index.html'))
  })
}

setupReplayWebSocket(server, session)

function scheduleDailyStorageCleanup(): void {
  const scheduleNextRun = () => {
    const now = new Date()
    const nextRun = new Date(now)
    nextRun.setHours(3, 0, 0, 0)
    if (nextRun <= now) nextRun.setDate(nextRun.getDate() + 1)
    setTimeout(async () => {
      try {
        const result = await cleanExpiredFiles()
        logger.info({ result }, '[storage-cleaner] cleanup finished')
      } catch (error) {
        logger.error({ error }, '[storage-cleaner] cleanup failed')
      } finally {
        scheduleNextRun()
      }
    }, nextRun.getTime() - now.getTime())
  }

  scheduleNextRun()
}

scheduleDailyStorageCleanup()

server.listen(port, host, async () => {
  await ensureAdminUser()
  logger.info(`replay server listening on http://${host}:${port}`)
})
