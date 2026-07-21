import path from 'path'
import { readJsonStore, writeJsonStore } from '../db/jsonStore'

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

export interface MapAliasConflict {
  key: string
  detectedMapName: string
  robotName?: string
  aliases: MapAlias[]
}

export interface MapAliasImportResult {
  imported: number
  updated: number
  skipped: number
  aliases: MapAlias[]
  conflicts: MapAliasConflict[]
}

const KEY = 'mapAliases'

export async function readMapAliases(): Promise<MapAlias[]> {
  return readJsonStore<MapAlias[]>(KEY, [])
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

export async function importMapAliases(input: { aliases: Partial<MapAlias>[]; overwrite?: boolean }): Promise<MapAliasImportResult> {
  const aliases = await readMapAliases()
  const now = new Date().toISOString()
  let imported = 0
  let updated = 0
  let skipped = 0
  for (const item of input.aliases || []) {
    const detectedMapName = String(item.detectedMapName || '').trim()
    const selectedMapFile = String(item.selectedMapFile || '').trim()
    const robotName = item.robotName ? String(item.robotName) : undefined
    if (!detectedMapName || !selectedMapFile) {
      skipped++
      continue
    }
    const id = item.id || aliasId(detectedMapName, robotName)
    const existing = aliases.find((it) => it.id === id)
    if (existing) {
      if (!input.overwrite && path.resolve(existing.selectedMapFile) !== path.resolve(selectedMapFile)) {
        skipped++
        continue
      }
      existing.detectedMapName = detectedMapName
      existing.selectedMapFile = selectedMapFile
      existing.robotName = robotName
      existing.note = item.note ? String(item.note) : existing.note
      existing.updatedAt = now
      updated++
      continue
    }
    aliases.push({
      id,
      detectedMapName,
      selectedMapFile,
      robotName,
      note: item.note ? String(item.note) : undefined,
      createdAt: item.createdAt ? String(item.createdAt) : now,
      updatedAt: now
    })
    imported++
  }
  await writeMapAliases(aliases)
  return {
    imported,
    updated,
    skipped,
    aliases,
    conflicts: findMapAliasConflicts(aliases)
  }
}

export function exportMapAliasesPayload(aliases: MapAlias[]): MapAliasFile & { exportedAt: string } {
  return {
    aliases,
    exportedAt: new Date().toISOString()
  }
}

export function findMapAliasConflicts(aliases: MapAlias[]): MapAliasConflict[] {
  const groups = new Map<string, MapAlias[]>()
  for (const alias of aliases) {
    const key = aliasId(alias.detectedMapName, alias.robotName)
    const list = groups.get(key) || []
    list.push(alias)
    groups.set(key, list)
  }
  return Array.from(groups.entries())
    .map(([key, list]) => ({
      key,
      detectedMapName: list[0]?.detectedMapName || '',
      robotName: list[0]?.robotName,
      aliases: list
    }))
    .filter((group) => new Set(group.aliases.map((it) => path.resolve(it.selectedMapFile))).size > 1)
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
  await writeJsonStore(KEY, aliases)
}

function aliasId(detectedMapName: string, robotName?: string): string {
  return `${normalizeMapName(robotName || 'all')}__${normalizeMapName(detectedMapName)}`
}

function normalizeMapName(name: string): string {
  return path.basename(name || '').replace(/\.json$/i, '').toLowerCase()
}
