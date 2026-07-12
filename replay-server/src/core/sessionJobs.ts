import { randomUUID } from 'crypto'
import type { ReplaySession } from './session'

export interface SessionJob {
  id: string
  status: 'pending' | 'running' | 'done' | 'error'
  stage: string
  progress: number
  error?: string
  overview?: unknown
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
    update(job, 'running', '读取日志文件', 15)
    await new Promise((resolve) => setTimeout(resolve, 20))
    update(job, 'running', '解析状态帧和错误码', 45)
    const data = await session.load(input)
    update(job, 'running', '构建时间线和地图', 80)
    job.overview = data.overview
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
