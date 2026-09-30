import { parentPort, workerData } from 'worker_threads'
import { ReplaySession } from './session'

interface SessionLoadInput {
  logDir: string
  mapDir?: string
  mapFile?: string
  forceReload?: boolean
  cacheOnly?: boolean
}

async function main(): Promise<void> {
  const input = workerData as SessionLoadInput
  try {
    const session = new ReplaySession()
    const data = await session.load({ ...input, recordKnowledgeHits: false }, (stage, progress) => {
      parentPort?.postMessage({ type: 'progress', stage, progress })
    })
    parentPort?.postMessage({ type: 'done', data })
  } catch (error) {
    parentPort?.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) })
  }
}

void main()
