import { randomUUID } from 'crypto'
import { execFile } from 'child_process'
import fs from 'fs/promises'
import path from 'path'
import { promisify } from 'util'
import type { ReplaySessionData } from '../types'

const execFileAsync = promisify(execFile)
const PACKAGE_DIR = path.resolve(process.cwd(), 'replay-server/.cache/packages')
const IMPORT_DIR = path.resolve(process.cwd(), 'replay-server/.cache/imports')
const MANIFEST_NAME = 'diagnostic-package.json'

export interface DiagnosticPackageManifest {
  version: 1
  createdAt: string
  robotName: string
  logDir: string
  logFiles: string[]
  mapFile?: string
  overview: {
    startTime: string
    endTime: string
    files: number
    lines: number
    mapName: string
    frameCount: number
    taskCount: number
    errorCount: number
  }
}

export interface ImportedDiagnosticPackage {
  id: string
  rootDir: string
  logDir: string
  mapDir?: string
  mapFile?: string
  manifest: DiagnosticPackageManifest
}

export async function exportDiagnosticPackage(data: ReplaySessionData): Promise<{ file: string; name: string; manifest: DiagnosticPackageManifest }> {
  const id = packageId()
  const rootDir = path.join(PACKAGE_DIR, id)
  const logDir = path.join(rootDir, 'logs')
  const mapDir = path.join(rootDir, 'maps')
  await fs.rm(rootDir, { recursive: true, force: true })
  await fs.mkdir(logDir, { recursive: true })
  await fs.mkdir(mapDir, { recursive: true })

  const copiedLogs: string[] = []
  for (const file of data.overview.logFiles || []) {
    const target = path.join(logDir, path.basename(file))
    await fs.copyFile(file, target)
    copiedLogs.push(path.relative(rootDir, target))
  }

  let copiedMap: string | undefined
  const selectedMapFile = data.overview.mapMatch?.selectedMapFile
  if (selectedMapFile) {
    const target = path.join(mapDir, path.basename(selectedMapFile))
    await fs.copyFile(selectedMapFile, target)
    copiedMap = path.relative(rootDir, target)
  }

  const manifest: DiagnosticPackageManifest = {
    version: 1,
    createdAt: new Date().toISOString(),
    robotName: data.overview.robotName || '',
    logDir: data.overview.logDir,
    logFiles: copiedLogs,
    mapFile: copiedMap,
    overview: {
      startTime: data.overview.startTime,
      endTime: data.overview.endTime,
      files: data.overview.files,
      lines: data.overview.lines,
      mapName: data.overview.mapName,
      frameCount: data.overview.frameCount,
      taskCount: data.overview.taskCount,
      errorCount: data.overview.errorCount
    }
  }
  await fs.writeFile(path.join(rootDir, MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

  const zipName = `${id}.zip`
  const zipFile = path.join(PACKAGE_DIR, zipName)
  await execFileAsync('zip', ['-qr', zipFile, '.'], { cwd: rootDir })
  return { file: zipFile, name: zipName, manifest }
}

export async function importDiagnosticPackage(zipFile: string): Promise<ImportedDiagnosticPackage> {
  const id = packageId()
  const rootDir = path.join(IMPORT_DIR, id)
  await fs.rm(rootDir, { recursive: true, force: true })
  await fs.mkdir(rootDir, { recursive: true })
  await execFileAsync('unzip', ['-q', zipFile, '-d', rootDir])
  const manifestText = await fs.readFile(path.join(rootDir, MANIFEST_NAME), 'utf8')
  const manifest = JSON.parse(manifestText) as DiagnosticPackageManifest
  if (manifest.version !== 1) throw new Error('不支持的诊断包版本')
  const logDir = path.join(rootDir, 'logs')
  const mapFile = manifest.mapFile ? path.join(rootDir, manifest.mapFile) : undefined
  const mapDir = mapFile ? path.dirname(mapFile) : undefined
  return { id, rootDir, logDir, mapDir, mapFile, manifest }
}

function packageId(): string {
  return `diagnostic-${Date.now()}-${randomUUID().slice(0, 8)}`
}
