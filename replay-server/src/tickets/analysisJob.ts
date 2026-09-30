import fs from 'fs/promises'
import path from 'path'
import { exportDiagnosticPackage } from '../core/diagnosticPackage'
import { buildJsonReport, buildMarkdownReportAsync } from '../core/report'
import { ReplaySession } from '../core/session'
import type { KnowledgeMatch, ReplaySessionData } from '../types'

export interface AnalysisJobInput {
  logDir: string
  mapDir?: string
  mapFile?: string
  vehicleCategoryId?: number
  ticketDir: string
}

export interface AnalysisJobResult {
  data: ReplaySessionData
  hitMatches: KnowledgeMatch[]
  mdPath: string
  pkgDest: string
}

export async function runAnalysisJob(input: AnalysisJobInput): Promise<AnalysisJobResult> {
  const session = new ReplaySession()
  await session.load({
    logDir: input.logDir,
    mapDir: input.mapDir,
    mapFile: input.mapFile,
    forceReload: true,
    recordKnowledgeHits: false
  })
  const hitMatches = [...(session.data.knowledgeMatches || [])]
  if (input.vehicleCategoryId) {
    const catId = input.vehicleCategoryId
    session.data.knowledgeMatches = (session.data.knowledgeMatches || []).filter((match) => {
      const ids = match.ruleSnapshot?.vehicleCategoryIds || []
      return ids.length === 0 || ids.includes(catId)
    })
    const keptRuleIds = new Set(session.data.knowledgeMatches.map((match) => match.ruleId))
    session.data.overview.rootCauses = (session.data.overview.rootCauses || []).filter((cause) => {
      if (cause.source !== 'knowledge_base') return true
      if (!cause.knowledgeRuleId) return false
      return keptRuleIds.has(cause.knowledgeRuleId)
    })
  }

  await fs.mkdir(input.ticketDir, { recursive: true })
  const mdReport = await buildMarkdownReportAsync(session.data)
  const mdPath = path.join(input.ticketDir, 'report.md')
  await fs.writeFile(mdPath, mdReport, 'utf8')
  const jsonReport = buildJsonReport(session.data)
  const jsonPath = path.join(input.ticketDir, 'report.json')
  await fs.writeFile(jsonPath, JSON.stringify(jsonReport, null, 2), 'utf8')
  const pkg = await exportDiagnosticPackage(session.data, { includeReports: true })
  const pkgDest = path.join(input.ticketDir, 'package.zip')
  await fs.copyFile(pkg.file, pkgDest)
  return { data: session.data, hitMatches, mdPath, pkgDest }
}
