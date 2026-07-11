import { getCacheSummary } from '../src/core/cache'
import { exportDiagnosticPackage, importDiagnosticPackage } from '../src/core/diagnosticPackage'
import { buildJsonReport, buildMarkdownReport } from '../src/core/report'
import { ReplaySession } from '../src/core/session'

async function main() {
  const session = new ReplaySession()
  const data = await session.load({
    logDir: '/home/xbl/Desktop',
    mapDir: '/home/xbl/Desktop/jarvis-fork/params/map',
    forceReload: true
  })
  assert(data.overview.hasFrames, '应解析到回放帧')
  assert(data.overview.mapMatch.matchStrategy !== 'missing', '应产生地图匹配结果')
  assert(data.errorOccurrences.every((it) => it.kind), '错误码发生点应包含 kind')
  assert(data.errorSummaries.every((it) => typeof it.realCount === 'number'), '错误码聚合应包含 realCount')
  assert(Array.isArray(data.overview.rootCauses), 'overview 应包含根因候选')
  assert(Array.isArray(data.overview.logFiles) && data.overview.logFiles.length > 0, 'overview 应包含原始日志文件列表')
  assert(data.foldedLogs.every((it) => it.firstLine && it.lastLine), '折叠日志应包含首末日志')
  const md = buildMarkdownReport(data)
  assert(md.includes('## 诊断结论'), 'Markdown 报告应包含诊断结论')
  assert(md.includes('## 地图匹配'), 'Markdown 报告应包含地图匹配')
  const json = buildJsonReport(data) as Record<string, unknown>
  assert(Array.isArray(json.rootCauses), 'JSON 报告应包含 rootCauses')
  const exported = await exportDiagnosticPackage(data)
  const imported = await importDiagnosticPackage(exported.file)
  assert(imported.logDir.endsWith('/logs'), '诊断包导入后应返回日志目录')
  assert(imported.mapFile?.endsWith('.json'), '诊断包导入后应返回地图文件')
  const importedSession = new ReplaySession()
  const importedData = await importedSession.load({
    logDir: imported.logDir,
    mapDir: imported.mapDir,
    mapFile: imported.mapFile,
    forceReload: true
  })
  assert(importedData.overview.hasFrames, '诊断包导入后应能重新解析回放帧')
  const cache = await getCacheSummary()
  assert(typeof cache.bytes === 'number' && typeof cache.files === 'number', '缓存摘要应包含文件数和大小')
  console.log(
    JSON.stringify(
      {
        frames: data.frames.length,
        mapMatch: data.overview.mapMatch,
        rootCauses: data.overview.rootCauses.length,
        errors: data.errorOccurrences.length,
        package: exported.name,
        cache
      },
      null,
      2
    )
  )
}

function assert(value: unknown, message: string) {
  if (!value) throw new Error(message)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
