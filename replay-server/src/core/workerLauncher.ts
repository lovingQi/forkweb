import { createRequire } from 'module'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import { Worker, type WorkerOptions } from 'worker_threads'

export function getAnalysisMaxOldMb(): number {
  return Number(process.env.FORKWEB_ANALYSIS_MAX_OLD_MB || 384)
}

export function launchWorker(callerUrl: string, entryName: string, options: WorkerOptions = {}): Worker {
  const ext = path.extname(fileURLToPath(callerUrl))
  const entryUrl = new URL(`${entryName}${ext}`, callerUrl)
  if (ext === '.js') return new Worker(entryUrl, options)

  const tsxEsmPath = createRequire(callerUrl).resolve('tsx/esm')
  const tsxEsmUrl = pathToFileURL(tsxEsmPath).href
  const bootstrap = `
    import { MessageChannel } from 'node:worker_threads'
    import { register } from 'node:module'
    const { port1, port2 } = new MessageChannel()
    port1.unref()
    register(${JSON.stringify(tsxEsmUrl)}, {
      parentURL: ${JSON.stringify(tsxEsmUrl)},
      data: { port: port2 },
      transferList: [port2]
    })
    await import(${JSON.stringify(entryUrl.href)})
  `
  return new Worker(bootstrap, { ...options, eval: true })
}
