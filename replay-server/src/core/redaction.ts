import type { AssistantContext, LogLineRef, ParsedLogLine, RawLineReader } from '../types'
import type { LlmConfig } from './llmConfig'

export function redactText(text: string, options: LlmConfig['redaction']): string {
  if (!options.enabled) return text
  let result = text
  if (options.redactPaths) {
    result = result
      .replace(/\/(?:home|root|opt|var|tmp|mnt|media)\/[^\s'"，。；;]+/g, '[PATH]')
      .replace(/[A-Za-z]:\\[^\s'"，。；;]+/g, '[PATH]')
  }
  if (options.redactIp) {
    result = result.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[IP]')
  }
  if (options.redactLongIds) {
    result = result.replace(/\b[A-Fa-f0-9]{16,}\b/g, '[ID]').replace(/\b\d{10,}\b/g, '[ID]')
  }
  if (options.redactRobotName) {
    result = result.replace(/\b(?:robot|fork|agv|amr)[-_]?[A-Za-z0-9]{2,}\b/gi, '[ROBOT]')
  }
  return result
}

export function redactLogLine(line: ParsedLogLine, options: LlmConfig['redaction']): ParsedLogLine {
  return {
    ...line,
    file: redactText(line.file, options),
    message: redactText(line.message, options)
  }
}

export async function redactAssistantContext(context: AssistantContext, options: LlmConfig['redaction'], rawStore?: RawLineReader | null): Promise<AssistantContext> {
  if (!options.enabled) return context
  const evidenceRefMap = rawStore ? await resolveRefMap(rawStore, collectEvidenceRefs(context)) : new Map<number, ParsedLogLine>()
  const redactRef = (ref: LogLineRef): LogLineRef => {
    const line = evidenceRefMap.get(ref.globalIndex)
    if (!line) return ref
    const redacted = redactLogLine(line, options)
    return {
      ...ref,
      file: redacted.file,
      module: redacted.module
    }
  }
  return {
    ...context,
    overview: redactObject(context.overview, options) as AssistantContext['overview'],
    logExcerpts: context.logExcerpts.map((line) => redactLogLine(line, options)),
    rootCauses: context.rootCauses.map((cause) => ({
      ...cause,
      evidenceLines: cause.evidenceLines.map(redactRef)
    })),
    knowledgeMatches: context.knowledgeMatches.map((match) => ({
      ...match,
      evidenceLines: match.evidenceLines.map(redactRef)
    })),
    similarChunks: context.similarChunks.map((result) => ({
      ...result,
      chunk: {
        ...result.chunk,
        text: redactText(result.chunk.text, options),
        summary: redactText(result.chunk.summary, options)
      },
      highlights: result.highlights.map((item) => redactText(item, options))
    })),
    redaction: {
      enabled: true,
      rules: [
        options.redactPaths ? 'path' : '',
        options.redactIp ? 'ip' : '',
        options.redactLongIds ? 'long_id' : '',
        options.redactRobotName ? 'robot_name' : ''
      ].filter(Boolean)
    }
  }
}

function collectEvidenceRefs(context: AssistantContext): LogLineRef[] {
  const refs: LogLineRef[] = []
  for (const cause of context.rootCauses) refs.push(...cause.evidenceLines)
  for (const match of context.knowledgeMatches) refs.push(...match.evidenceLines)
  return refs
}

async function resolveRefMap(rawStore: RawLineReader, refs: LogLineRef[]): Promise<Map<number, ParsedLogLine>> {
  if (refs.length === 0) return new Map()
  const resolved = await rawStore.resolveRefs(refs)
  return new Map(resolved.map((line, i) => [refs[i].globalIndex, line]))
}

function redactObject(value: unknown, options: LlmConfig['redaction']): unknown {
  if (typeof value === 'string') return redactText(value, options)
  if (Array.isArray(value)) return value.map((item) => redactObject(item, options))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactObject(item, options)]))
  }
  return value
}
