import { randomUUID } from 'crypto'
import type { ReplaySession } from './session'

export interface SessionJob {
  id: string
  status: 'pending' | 'running' | 'done' | 'error'
  stage: string
  progress: number
  error?: string
  overview?: unknown
  timing?: Record<string, number>
  createdAt: string
  updatedAt: string
}

const jobs = new Map<string, SessionJob>()

export function createSessionJob(
  session: ReplaySession,
  input: { logDir: string; mapDir?: string; mapFile?: string; forceReload?: boolean }
): SessionJob {
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

async function runJob(
  job: SessionJob,
  session: ReplaySession,
  input: { logDir: string; mapDir?: string; mapFile?: string; forceReload?: boolean }
) {
  try {
    update(job, 'running', '初始化', 2)
    await new Promise((resolve) => setTimeout(resolve, 10))
    const data = await session.load(input, (stage, progress) => {
      update(job, 'running', stage, progress)
    })
    job.overview = data.overview
    job.timing = data.overview.parseStats?.stageTimings
    update(job, 'done', '完成', 100)
  } catch (e) {
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
