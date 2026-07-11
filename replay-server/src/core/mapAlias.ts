import fs from 'fs/promises'
import path from 'path'

export interface MapAlias {
  id: string
  detectedMapName: string
  selectedMapFile: string
  robotName?: string
  note?: string
  createdAt: string
  updatedAt: string
}

interface MapAliasFile {
  aliases: MapAlias[]
}

const ALIAS_FILE = path.resolve(process.cwd(), 'replay-server/config/map-alias.json')

export async function readMapAliases(): Promise<MapAlias[]> {
  try {
    const text = await fs.readFile(ALIAS_FILE, 'utf8')
    const data = JSON.parse(text) as MapAliasFile
    return Array.isArray(data.aliases) ? data.aliases : []
  } catch {
    return []
  }
}

export async function upsertMapAlias(input: {
  detectedMapName: string
  selectedMapFile: string
  robotName?: string
  note?: string
}): Promise<MapAlias> {
  const aliases = await readMapAliases()
  const now = new Date().toISOString()
  const id = aliasId(input.detectedMapName, input.robotName)
  const existing = aliases.find((it) => it.id === id)
  if (existing) {
    existing.selectedMapFile = input.selectedMapFile
    existing.note = input.note
    existing.updatedAt = now
    await writeMapAliases(aliases)
    return existing
  }
  const alias: MapAlias = {
    id,
    detectedMapName: input.detectedMapName,
    selectedMapFile: input.selectedMapFile,
    robotName: input.robotName,
    note: input.note,
    createdAt: now,
    updatedAt: now
  }
  aliases.push(alias)
  await writeMapAliases(aliases)
  return alias
}

export async function deleteMapAlias(id: string): Promise<boolean> {
  const aliases = await readMapAliases()
  const next = aliases.filter((it) => it.id !== id)
  if (next.length === aliases.length) return false
  await writeMapAliases(next)
  return true
}

export function matchMapAlias(arg: {
  aliases: MapAlias[]
  detectedMapName: string
  robotName?: string
  candidates: string[]
}): MapAlias | null {
  const detected = normalizeMapName(arg.detectedMapName)
  if (!detected) return null
  const robotName = (arg.robotName || '').trim()
  const candidates = arg.aliases.filter((alias) => normalizeMapName(alias.detectedMapName) === detected)
  const robotMatched = candidates.find((alias) => alias.robotName && alias.robotName === robotName)
  const alias = robotMatched || candidates.find((it) => !it.robotName) || candidates[0]
  if (!alias) return null
  if (!arg.candidates.some((file) => path.resolve(file) === path.resolve(alias.selectedMapFile))) return null
  return alias
}

async function writeMapAliases(aliases: MapAlias[]): Promise<void> {
  await fs.mkdir(path.dirname(ALIAS_FILE), { recursive: true })
  await fs.writeFile(ALIAS_FILE, `${JSON.stringify({ aliases }, null, 2)}\n`, 'utf8')
}

function aliasId(detectedMapName: string, robotName?: string): string {
  return `${normalizeMapName(robotName || 'all')}__${normalizeMapName(detectedMapName)}`
}

function normalizeMapName(name: string): string {
  return path.basename(name || '').replace(/\.json$/i, '').toLowerCase()
}
