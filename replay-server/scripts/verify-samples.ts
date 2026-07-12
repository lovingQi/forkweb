import fs from 'fs/promises'
import path from 'path'
import { ReplaySession } from '../src/core/session'

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

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
