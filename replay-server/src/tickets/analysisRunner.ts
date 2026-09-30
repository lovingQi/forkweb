import { Worker } from 'worker_threads'
import { getAnalysisMaxOldMb, launchWorker } from '../core/workerLauncher'
import type { AnalysisJobInput, AnalysisJobResult } from './analysisJob'

export function startAnalysisWorker(input: AnalysisJobInput): { worker: Worker | null; result: Promise<AnalysisJobResult> } {
  const maxMb = getAnalysisMaxOldMb()
  const worker = launchWorker(import.meta.url, './analysisWorker', {
    workerData: input,
    resourceLimits: { maxOldGenerationSizeMb: maxMb }
  })
  let settled = false
  const result = new Promise<AnalysisJobResult>((resolve, reject) => {
    const finish = (settle: () => void) => {
      if (settled) return
      settled = true
      settle()
    }
    worker.once('message', (message: { type?: string; result?: AnalysisJobResult; message?: string }) => {
      finish(() => {
        if (message?.type === 'done' && message.result) resolve(message.result)
        else reject(new Error(message?.message || '分析失败'))
      })
    })
    worker.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ERR_WORKER_OUT_OF_MEMORY') {
        finish(() => reject(new Error(`分析内存超出上限（${maxMb} MB）`)))
        return
      }
      finish(() => reject(error))
    })
    worker.once('exit', (code) => {
      if (settled || code === 0) return
      finish(() => reject(new Error(`分析线程退出（code ${code}）`)))
    })
  })
  return { worker, result }
}
