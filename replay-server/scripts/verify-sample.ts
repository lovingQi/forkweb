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
  const md = buildMarkdownReport(data)
  assert(md.includes('## 诊断结论'), 'Markdown 报告应包含诊断结论')
  assert(md.includes('## 地图匹配'), 'Markdown 报告应包含地图匹配')
  const json = buildJsonReport(data) as Record<string, unknown>
  assert(Array.isArray(json.rootCauses), 'JSON 报告应包含 rootCauses')
  console.log(
    JSON.stringify(
      {
        frames: data.frames.length,
        mapMatch: data.overview.mapMatch,
        rootCauses: data.overview.rootCauses.length,
        errors: data.errorOccurrences.length
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
