import { randomUUID } from 'crypto'
import { recordKnowledgeHits } from './knowledgeBase'
import { SessionCacheMissError, type ReplaySession } from './session'
import { getAnalysisMaxOldMb, launchWorker } from './workerLauncher'
import type { ReplaySessionData } from '../types'

export interface SessionJob {
  id: string
  status: 'pending' | 'running' | 'done' | 'error'
  stage: string
  progress: number
  error?: string
  errorCode?: string
  overview?: unknown
  timing?: Record<string, number>
  createdAt: string
  updatedAt: string
}

export interface SessionLoadInput {
  logDir: string
  mapDir?: string
  mapFile?: string
  forceReload?: boolean
  cacheOnly?: boolean
}

const jobs = new Map<string, SessionJob>()

export function createSessionJob(session: ReplaySession, input: SessionLoadInput): SessionJob {
  const job: SessionJob = {
    id: `job-${randomUUID().slice(0, 8)}`,
    status: 'pending',
    stage: '等待解析',
    progress: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
  jobs.set(job.id, job)
  runJob(job, session, input)
  return job
}

export function getSessionJob(id: string): SessionJob | null {
  return jobs.get(id) || null
}

export async function loadSessionInWorker(
  session: ReplaySession,
  input: SessionLoadInput,
  onProgress?: (stage: string, progress: number) => void
): Promise<ReplaySessionData> {
  const maxMb = getAnalysisMaxOldMb()
  const worker = launchWorker(import.meta.url, './sessionLoadWorker', {
    workerData: input,
    resourceLimits: { maxOldGenerationSizeMb: maxMb }
  })
  const data = await new Promise<ReplaySessionData>((resolve, reject) => {
    let settled = false
    const finish = (settle: () => void) => {
      if (settled) return
      settled = true
      settle()
    }
    worker.on('message', (message: { type?: string; stage?: string; progress?: number; data?: ReplaySessionData; message?: string }) => {
      if (message?.type === 'progress') {
        onProgress?.(String(message.stage || ''), Number(message.progress || 0))
        return
      }
      finish(() => {
        if (message?.type === 'done' && message.data) resolve(message.data)
        else reject(new Error(message?.message || '解析失败'))
      })
    })
    worker.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ERR_WORKER_OUT_OF_MEMORY') {
        finish(() => reject(new Error(`解析内存超出上限（${maxMb} MB）`)))
        return
      }
      finish(() => reject(error))
    })
    worker.once('exit', (code) => {
      if (settled || code === 0) return
      finish(() => reject(new Error(`解析线程退出（code ${code}）`)))
    })
  })
  session.applyLoadedData(data)
  const knowledgeMatches = data.knowledgeMatches || []
  if (!data.overview.parseStats?.cacheHit && knowledgeMatches.length > 0) {
    await recordKnowledgeHits(knowledgeMatches, input.logDir)
  }
  return data
}

async function runJob(job: SessionJob, session: ReplaySession, input: SessionLoadInput) {
  try {
    update(job, 'running', '初始化', 2)
    await new Promise((resolve) => setTimeout(resolve, 10))
    const data = input.cacheOnly
      ? await session.load({ ...input, forceReload: false, cacheOnly: true })
      : await loadSessionInWorker(session, input, (stage, progress) => update(job, 'running', stage, progress))
    job.overview = data.overview
    job.timing = data.overview.parseStats?.stageTimings
    update(job, 'done', '完成', 100)
  } catch (e) {
    if (e instanceof SessionCacheMissError) job.errorCode = 'cache_miss'
    job.error = e instanceof Error ? e.message : String(e)
    update(job, 'error', '失败', job.progress)
  }
}

function update(job: SessionJob, status: SessionJob['status'], stage: string, progress: number) {
  job.status = status
  job.stage = stage
  job.progress = Math.max(0, Math.min(100, progress))
  job.updatedAt = new Date().toISOString()
}
