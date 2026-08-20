import { parentPort, workerData } from 'worker_threads'
import { ReplaySession } from './session'

export interface AnalysisWorkerInput {
  logDir: string
  mapDir?: string
  mapFile?: string
  forceReload?: boolean
}

export interface AnalysisWorkerResult {
  type: 'progress' | 'done' | 'error'
  stage?: string
  progress?: number
  data?: unknown
  error?: string
}

async function run() {
  if (!parentPort) {
    throw new Error('analysisWorker must be run as a Worker thread')
  }

  const input = workerData as AnalysisWorkerInput
  const session = new ReplaySession()

  try {
    const data = await session.load(input, (stage, progress) => {
      parentPort!.postMessage({ type: 'progress', stage, progress } satisfies AnalysisWorkerResult)
    })

    parentPort.postMessage({
      type: 'done',
      data: {
        overview: data.overview,
        knowledgeMatches: data.knowledgeMatches,
        errorSummaries: data.errorSummaries,
        errorOccurrences: data.errorOccurrences,
        events: data.events,
        tasks: data.tasks,
        frames: data.frames,
        foldedLogs: data.foldedLogs,
        rawLinesPath: data.rawLinesPath
      }
    } satisfies AnalysisWorkerResult)
  } catch (e) {
    parentPort.postMessage({
      type: 'error',
      error: e instanceof Error ? e.message : String(e)
    } satisfies AnalysisWorkerResult)
  }
}

run()
