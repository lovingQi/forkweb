#!/usr/bin/env node
import { execFileSync } from 'child_process'
import fs from 'fs'
import path from 'path'

const args = parseArgs(process.argv.slice(2))
const logDir = args.logDir || args.logs
const mapDir = args.mapDir || args.maps
const out = args.out || path.resolve(process.cwd(), `replay-case-${Date.now()}`)
if (!logDir) {
  console.error('Usage: npm run replay:collect -- --logDir <dir> [--mapDir <dir>] [--out <dir>] [--startMs <ms>] [--endMs <ms>]')
  process.exit(1)
}

fs.rmSync(out, { recursive: true, force: true })
fs.mkdirSync(path.join(out, 'logs'), { recursive: true })
fs.mkdirSync(path.join(out, 'maps'), { recursive: true })

const copiedLogs = copyFiles(logDir, path.join(out, 'logs'), (file) => file.endsWith('.log'))
const copiedMaps = mapDir ? copyFiles(mapDir, path.join(out, 'maps'), (file) => file.endsWith('.json')) : []
const selectedMap = args.mapFile
  ? copiedMaps.find((file) => path.basename(file) === path.basename(args.mapFile))
  : copiedMaps[0]
const manifest = {
  version: 1,
  createdAt: new Date().toISOString(),
  robotName: args.robotName || '',
  logDir,
  logFiles: copiedLogs.map((file) => path.relative(out, file)),
  mapFile: selectedMap ? path.relative(out, selectedMap) : undefined,
  overview: {
    startTime: args.startTime || '',
    endTime: args.endTime || '',
    files: copiedLogs.length,
    lines: 0,
    mapName: selectedMap ? path.basename(selectedMap) : '',
    frameCount: 0,
    taskCount: 0,
    errorCount: 0
  },
  extras: {
    reportMarkdown: '',
    reportJson: '',
    mapAliases: '',
    rootCauseFeedback: '',
    bookmarks: ''
  },
  caseMeta: {
    robotName: args.robotName || '',
    site: args.site || '',
    testRound: args.testRound || '',
    note: `采集来源：${logDir}${mapDir ? `；地图目录：${mapDir}` : ''}${args.startMs || args.endMs ? `；时间范围：${args.startMs || '-'} ~ ${args.endMs || '-'}` : ''}`
  }
}
fs.writeFileSync(path.join(out, 'diagnostic-package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
const zipFile = `${out}.zip`
execFileSync('zip', ['-qr', zipFile, '.'], { cwd: out })
console.log(zipFile)

function copyFiles(from, to, filter) {
  if (!fs.existsSync(from)) return []
  const result = []
  for (const name of fs.readdirSync(from)) {
    const source = path.join(from, name)
    const stat = fs.statSync(source)
    if (!stat.isFile() || !filter(name)) continue
    const target = path.join(to, name)
    fs.copyFileSync(source, target)
    result.push(target)
  }
  return result
}

function parseArgs(list) {
  const result = {}
  for (let i = 0; i < list.length; i++) {
    const item = list[i]
    if (!item.startsWith('--')) continue
    result[item.slice(2)] = list[i + 1] && !list[i + 1].startsWith('--') ? list[++i] : 'true'
  }
  return result
}
