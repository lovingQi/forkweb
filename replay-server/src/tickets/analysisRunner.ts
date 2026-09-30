import path from 'path'
import { fileURLToPath } from 'url'
import { Worker } from 'worker_threads'
import { runAnalysisJob, type AnalysisJobInput, type AnalysisJobResult } from './analysisJob'

export function startAnalysisWorker(input: AnalysisJobInput): { worker: Worker | null; result: Promise<AnalysisJobResult> } {
  const ext = path.extname(fileURLToPath(import.meta.url))
  const maxMb = Number(process.env.FORKWEB_ANALYSIS_MAX_OLD_MB || 384)
  const worker = new Worker(new URL(`./analysisWorker${ext}`, import.meta.url), {
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
      if (ext === '.ts' && error.code === 'ERR_UNKNOWN_FILE_EXTENSION') {
        console.warn('[analysis] 工作线程无法加载 TypeScript，改为在主线程执行')
        finish(() => {
          resolve(runAnalysisJob(input))
        })
        return
      }
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
