import type {
  ErrorOccurrence,
  MapMatchInfo,
  ParsedLogLine,
  ReplayFrame,
  RootCauseCandidate,
  TaskSegment,
  TimelineEvent
} from '../types'

export interface RootCauseContext {
  events: TimelineEvent[]
  frames: ReplayFrame[]
  occurrences: ErrorOccurrence[]
  tasks: TaskSegment[]
  rawLines: ParsedLogLine[]
  mapMatch: MapMatchInfo
}

export interface RootCauseRule {
  id: string
  weight: number
  build(ctx: RootCauseContext): RootCauseCandidate | null
}

export const ROOT_CAUSE_RULES: RootCauseRule[] = [
  {
    id: 'map-config',
    weight: 1.1,
    build(ctx) {
      const configEvents = ctx.events.filter((event) => event.category === 'config').slice(0, 10)
      const mapLines = ctx.rawLines
        .filter((line) => /map|地图|params|does not exist|configure error/i.test(line.message))
        .slice(0, 10)
      if (ctx.mapMatch.confidence >= 0.8 && configEvents.length < 5 && mapLines.length < 5) return null
      return {
        id: 'map-config',
        title: '地图或配置可信度不足',
        confidence: ctx.mapMatch.confidence < 0.8 ? 0.82 : 0.58,
        severity: ctx.mapMatch.confidence < 0.8 ? 'warning' : 'info',
        evidenceEvents: configEvents,
        evidenceLines: mapLines,
        suggestion: '确认现场地图文件是否与日志一致，并优先处理启动阶段参数缺失或错误码配置提醒。'
      }
    }
  },
  {
    id: 'localization',
    weight: 1,
    build(ctx) {
      const locEvents = ctx.events.filter((event) => ['loc_score', 'lost'].includes(event.category || '')).slice(0, 10)
      const lowScoreFrames = ctx.frames.filter((frame) => typeof frame.score === 'number' && frame.score < 60).slice(0, 10)
      if (locEvents.length === 0 && lowScoreFrames.length === 0) return null
      return {
        id: 'localization',
        title: '疑似定位异常',
        confidence: lowScoreFrames.length >= 3 ? 0.78 : 0.62,
        severity: 'warning',
        evidenceEvents: locEvents,
        evidenceLines: lowScoreFrames.map((frame) => frame.rawLine),
        suggestion: '检查地图匹配、激光数据、定位分变化，以及异常前后车辆是否进入遮挡或反光区域。'
      }
    }
  },
  {
    id: 'device-timeout',
    weight: 1,
    build(ctx) {
      const deviceErrors = ctx.occurrences
        .filter((it) => it.kind === 'real_fault' && /^ERROR0[56]\d{2}$/.test(it.code))
        .slice(0, 10)
      if (deviceErrors.length === 0) return null
      return {
        id: 'device-timeout',
        title: '疑似设备数据超时或离线',
        confidence: 0.72,
        severity: 'error',
        evidenceEvents: ctx.events.filter((event) => deviceErrors.some((err) => err.code === event.code)).slice(0, 10),
        evidenceLines: deviceErrors.map((it) => it.line),
        suggestion: '优先检查里程计、IMU、激光等设备连接状态、驱动启动顺序和现场供电/网络。'
      }
    }
  },
  {
    id: 'safety',
    weight: 1,
    build(ctx) {
      const safetyEvents = ctx.events.filter((event) => ['estop'].includes(event.category || '')).slice(0, 10)
      const safetyFrames = ctx.frames.filter((frame) => frame.estop).slice(0, 10)
      const safetyLines = ctx.rawLines.filter((line) => /estop|急停|alarm/i.test(line.message)).slice(0, 10)
      if (safetyEvents.length === 0 && safetyFrames.length === 0 && safetyLines.length === 0) return null
      return {
        id: 'safety',
        title: '疑似安全链路或急停触发',
        confidence: 0.7,
        severity: 'error',
        evidenceEvents: safetyEvents,
        evidenceLines: [...safetyFrames.map((frame) => frame.rawLine), ...safetyLines].slice(0, 10),
        suggestion: '检查急停、挡板、安全触边、避障输入和现场安全 PLC 状态。'
      }
    }
  },
  {
    id: 'task-failure',
    weight: 1,
    build(ctx) {
      const failedTasks = ctx.tasks
        .filter((task) => task.lastFinishedTaskSuccess === false || task.errors.length > 0 || hasValue(task.unfinishedPath))
        .slice(0, 10)
      const taskLines = ctx.rawLines
        .filter((line) => /current_task_error_code|unfinished_path|task failed|last_finished_task_is_success.*false/i.test(line.message))
        .slice(0, 10)
      if (failedTasks.length === 0 && taskLines.length === 0) return null
      return {
        id: 'task-failure',
        title: '疑似任务执行失败',
        confidence: failedTasks.length > 0 ? 0.76 : 0.56,
        severity: 'warning',
        evidenceEvents: ctx.events.filter((event) => event.category === 'task').slice(0, 10),
        evidenceLines: taskLines,
        suggestion: '从失败任务开始时间向前查看路径、货叉状态、定位分、错误码和未完成路径变化。'
      }
    }
  }
]

function hasValue(value: unknown): boolean {
  if (value === undefined || value === null) return false
  if (typeof value === 'string') return value !== '' && value !== 'Null' && value !== 'null'
  if (Array.isArray(value)) return value.length > 0
  return true
}
