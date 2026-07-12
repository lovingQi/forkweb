import { randomUUID } from 'crypto'
import { execFile } from 'child_process'
import fs from 'fs/promises'
import path from 'path'
import { promisify } from 'util'
import type { ReplayCaseMeta, ReplaySessionData } from '../types'
import { exportMapAliasesPayload, findMapAliasConflicts, readMapAliases, type MapAlias, type MapAliasConflict } from './mapAlias'
import { buildJsonReport, buildMarkdownReportAsync } from './report'
import { readRootCauseFeedback, type RootCauseFeedback } from './rootCauseFeedback'
import { readBookmarks } from './bookmarks'
import { readCaseMeta } from './caseMeta'

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
  extras?: {
    reportMarkdown: string
    reportJson: string
    mapAliases: string
    rootCauseFeedback: string
    bookmarks: string
  }
  caseMeta?: ReplayCaseMeta
}

export interface ImportedDiagnosticPackage {
  id: string
  rootDir: string
  logDir: string
  mapDir?: string
  mapFile?: string
  manifest: DiagnosticPackageManifest
  mapAliases: MapAlias[]
  aliasConflicts: MapAliasConflict[]
  rootCauseFeedback: RootCauseFeedback[]
  bookmarks: Awaited<ReturnType<typeof readBookmarks>>
}

export interface ExportDiagnosticPackageOptions {
  startMs?: number
  endMs?: number
  includeMap?: boolean
  includeReports?: boolean
  includeAliases?: boolean
  includeFeedback?: boolean
}

export async function exportDiagnosticPackage(data: ReplaySessionData, options: ExportDiagnosticPackageOptions = {}): Promise<{ file: string; name: string; manifest: DiagnosticPackageManifest }> {
  const id = packageId()
  const rootDir = path.join(PACKAGE_DIR, id)
  const logDir = path.join(rootDir, 'logs')
  const mapDir = path.join(rootDir, 'maps')
  const reportsDir = path.join(rootDir, 'reports')
  const configDir = path.join(rootDir, 'config')
  await fs.rm(rootDir, { recursive: true, force: true })
  await fs.mkdir(logDir, { recursive: true })
  await fs.mkdir(mapDir, { recursive: true })
  await fs.mkdir(reportsDir, { recursive: true })
  await fs.mkdir(configDir, { recursive: true })

  const includeMap = options.includeMap !== false
  const includeReports = options.includeReports !== false
  const includeAliases = options.includeAliases !== false
  const includeFeedback = options.includeFeedback !== false
  const copiedLogs: string[] = []
  for (const file of data.overview.logFiles || []) {
    const target = path.join(logDir, path.basename(file))
    await fs.copyFile(file, target)
    copiedLogs.push(path.relative(rootDir, target))
  }

  let copiedMap: string | undefined
  const selectedMapFile = data.overview.mapMatch?.selectedMapFile
  if (includeMap && selectedMapFile) {
    const target = path.join(mapDir, path.basename(selectedMapFile))
    await fs.copyFile(selectedMapFile, target)
    copiedMap = path.relative(rootDir, target)
  }

  const reportMarkdown = 'reports/report.md'
  const reportJson = 'reports/report.json'
  const mapAliasesFile = 'config/map-alias.json'
  const rootCauseFeedbackFile = 'config/root-cause-feedback.json'
  const bookmarksFile = 'config/bookmarks.json'
  if (includeReports) {
    await fs.writeFile(path.join(rootDir, reportMarkdown), await buildMarkdownReportAsync(data), 'utf8')
    await fs.writeFile(path.join(rootDir, reportJson), `${JSON.stringify(buildJsonReport(data), null, 2)}\n`, 'utf8')
  }
  if (includeAliases) await fs.writeFile(path.join(rootDir, mapAliasesFile), `${JSON.stringify(exportMapAliasesPayload(await readMapAliases()), null, 2)}\n`, 'utf8')
  if (includeFeedback) await fs.writeFile(path.join(rootDir, rootCauseFeedbackFile), `${JSON.stringify(await readRootCauseFeedback(), null, 2)}\n`, 'utf8')
  await fs.writeFile(path.join(rootDir, bookmarksFile), `${JSON.stringify(await readBookmarks(), null, 2)}\n`, 'utf8')

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
    },
    extras: {
      reportMarkdown: includeReports ? reportMarkdown : '',
      reportJson: includeReports ? reportJson : '',
      mapAliases: includeAliases ? mapAliasesFile : '',
      rootCauseFeedback: includeFeedback ? rootCauseFeedbackFile : '',
      bookmarks: bookmarksFile
    },
    caseMeta: await readCaseMeta()
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
  const mapAliases = await readPackageMapAliases(rootDir, manifest)
  const rootCauseFeedback = await readPackageRootCauseFeedback(rootDir, manifest)
  const bookmarks = await readPackageBookmarks(rootDir, manifest)
  return {
    id,
    rootDir,
    logDir,
    mapDir,
    mapFile,
    manifest,
    mapAliases,
    aliasConflicts: findMapAliasConflicts([...(await readMapAliases()), ...mapAliases]),
    rootCauseFeedback,
    bookmarks
  }
}

function packageId(): string {
  return `diagnostic-${Date.now()}-${randomUUID().slice(0, 8)}`
}

async function readPackageMapAliases(rootDir: string, manifest: DiagnosticPackageManifest): Promise<MapAlias[]> {
  const relative = manifest.extras?.mapAliases
  if (!relative) return []
  try {
    const text = await fs.readFile(path.join(rootDir, relative), 'utf8')
    const data = JSON.parse(text)
    return Array.isArray(data.aliases) ? data.aliases : []
  } catch {
    return []
  }
}

async function readPackageRootCauseFeedback(rootDir: string, manifest: DiagnosticPackageManifest): Promise<RootCauseFeedback[]> {
  const relative = manifest.extras?.rootCauseFeedback
  if (!relative) return []
  try {
    const text = await fs.readFile(path.join(rootDir, relative), 'utf8')
    const data = JSON.parse(text)
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

async function readPackageBookmarks(rootDir: string, manifest: DiagnosticPackageManifest) {
  const relative = manifest.extras?.bookmarks
  if (!relative) return []
  try {
    const text = await fs.readFile(path.join(rootDir, relative), 'utf8')
    const data = JSON.parse(text)
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}
