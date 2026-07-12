import fs from 'fs/promises'
import path from 'path'
import { loadManualErrorDictionary } from '../src/core/errorDictionary'
import { parseErrorOccurrences } from '../src/parser/errorCode'
import { ReplaySession } from '../src/core/session'
import type { ParsedLogLine } from '../src/types'

interface SampleManifest {
  samples: Array<{
    name: string
    logDir: string
    mapDir?: string
    mapFile?: string
    expect?: {
      minFrames?: number
      minErrors?: number
      minTasks?: number
      minErrorDefinitions?: number
      rootCauseKeywords?: string[]
      mapDetected?: string
    }
  }>
}

async function main() {
  const manifestPath = process.argv[2] || 'replay-server/samples/manifest.example.json'
  const manifest = JSON.parse(await fs.readFile(path.resolve(process.cwd(), manifestPath), 'utf8')) as SampleManifest
  await verifyManualDictionary()
  const results = []
  for (const sample of manifest.samples || []) {
    const session = new ReplaySession()
    const data = await session.load({
      logDir: sample.logDir,
      mapDir: sample.mapDir,
      mapFile: sample.mapFile,
      forceReload: true
    })
    assert((data.frames.length || 0) >= (sample.expect?.minFrames || 0), `${sample.name}: 回放帧不足`)
    assert((data.errorOccurrences.length || 0) >= (sample.expect?.minErrors || 0), `${sample.name}: 错误发生点不足`)
    assert((data.tasks.length || 0) >= (sample.expect?.minTasks || 0), `${sample.name}: 任务数量不足`)
    assert((data.errorDefinitions.length || 0) >= (sample.expect?.minErrorDefinitions || 0), `${sample.name}: 错误码定义不足`)
    if (sample.expect?.mapDetected) {
      assert(data.overview.mapMatch.detectedMapName === sample.expect.mapDetected, `${sample.name}: 地图检测结果不匹配`)
    }
    for (const keyword of sample.expect?.rootCauseKeywords || []) {
      assert(data.overview.rootCauses.some((cause) => cause.title.includes(keyword) || cause.suggestion.includes(keyword)), `${sample.name}: 根因缺少关键字 ${keyword}`)
    }
    results.push({
      name: sample.name,
      frames: data.frames.length,
      errors: data.errorOccurrences.length,
      tasks: data.tasks.length,
      rootCauses: data.overview.rootCauses.length
    })
  }
  console.log(JSON.stringify({ samples: results }, null, 2))
}

async function verifyManualDictionary() {
  const manual = await loadManualErrorDictionary()
  assert(manual.get('ERROR00501')?.content === '机器人陀螺仪数据超时', '人工字典必须原样保留 ERROR00501')
  assert(manual.get('ERROR00509')?.screenText === 'Charge faild.', '人工字典必须原样保留 ERROR00509')
  assert(manual.get('EERROR1001')?.troubleshooting === '检查地图是否正确', '人工字典必须原样保留 EERROR1001')
  assert(!manual.has('ERROR0501'), '不得自动把 ERROR00501 改写为 ERROR0501')
  assert(!manual.has('ERROR0509'), '不得自动把 ERROR00509 改写为 ERROR0509')
  assert(!manual.has('ERROR1001'), '不得自动把 EERROR1001 改写为 ERROR1001')
  assert(Array.from(manual.values()).every((definition) => definition.manual && definition.sourceKind === 'manual'), '人工字典定义必须标记 manual 来源')

  const definitions = new Map(manual)
  const line = buildSyntheticLine('current_code is ERROR00501 ERROR00509 EERROR1001')
  const occurrences = parseErrorOccurrences(line, definitions)
  const codes = occurrences.map((item) => item.code)
  assert(codes.includes('ERROR00501'), '解析器必须识别五位错误码 ERROR00501')
  assert(codes.includes('ERROR00509'), '解析器必须识别五位错误码 ERROR00509')
  assert(codes.includes('EERROR1001'), '解析器必须识别原样错误码 EERROR1001')
  assert(occurrences.find((item) => item.code === 'ERROR00501')?.definition?.content === '机器人陀螺仪数据超时', 'ERROR00501 必须关联人工字典定义')
}

function buildSyntheticLine(message: string): ParsedLogLine {
  return {
    file: 'synthetic.log',
    line: 1,
    timestamp: '2026-07-12 00:00:00.000',
    timeMs: 0,
    module: 'verify',
    sourceLine: null,
    level: 'E',
    message,
    raw: message
  }
}

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
