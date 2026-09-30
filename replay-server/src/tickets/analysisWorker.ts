import { parentPort, workerData } from 'worker_threads'
import { runAnalysisJob, type AnalysisJobInput } from './analysisJob'

async function main(): Promise<void> {
  try {
    const result = await runAnalysisJob(workerData as AnalysisJobInput)
    parentPort?.postMessage({ type: 'done', result })
  } catch (error) {
    parentPort?.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) })
  }
}

void main()
