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
        .filter((line) => /\b(map|地图|params|configure error|config fail|参数|配置)\b/i.test(line.message))
        .slice(0, 10)
      if (ctx.mapMatch.confidence >= 0.8 && configEvents.length < 3 && mapLines.length < 3) return null
      return {
        id: 'map-config',
        title: '地图匹配度较低，建议核对地图文件',
        confidence: 0.72,
        severity: ctx.mapMatch.confidence < 0.8 ? 'warning' : 'info',
        evidenceEvents: configEvents,
        evidenceLines: mapLines,
        suggestion: '未能精确匹配到日志对应的地图文件，请确认地图目录中是否包含正确版本的地图；若该日志来自测试/演示环境，可忽略本条提示。',
        triggeredRules: ['map-config'],
        positiveEvidence: [`地图匹配策略: ${ctx.mapMatch.matchStrategy}`, `地图匹配置信度 ${Math.round(ctx.mapMatch.confidence * 100)}%`],
        negativeEvidence: ctx.mapMatch.confidence >= 0.8 ? ['地图匹配置信度较高'] : [],
        confidenceFactors: [`地图匹配策略 ${ctx.mapMatch.matchStrategy}`, '地图匹配置信度']
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
        suggestion: '检查地图匹配、激光数据、定位分变化，以及异常前后车辆是否进入遮挡或反光区域。',
        triggeredRules: ['localization'],
        positiveEvidence: [`低定位分帧 ${lowScoreFrames.length} 个`, `定位异常事件 ${locEvents.length} 个`],
        negativeEvidence: [],
        confidenceFactors: ['低定位分帧数量', 'lost/定位事件数量']
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
        suggestion: '优先检查里程计、IMU、激光等设备连接状态、驱动启动顺序和现场供电/网络。',
        triggeredRules: ['device-timeout'],
        positiveEvidence: [`设备相关真实故障错误码 ${deviceErrors.length} 个`],
        negativeEvidence: [],
        confidenceFactors: ['ERROR05xx/ERROR06xx 真实故障', '错误码发生次数']
      }
    }
  },
  {
    id: 'safety',
    weight: 1,
    build(ctx) {
      const safetyEvents = ctx.events.filter((event) => ['estop'].includes(event.category || '')).slice(0, 10)
      const safetyFrames = ctx.frames.filter((frame) => frame.estop).slice(0, 10)
      const safetyLines = ctx.rawLines.filter((line) =>
        /(?:EStopHard|EStopSoft|CollisionStrip)\s*(?:=|:|is)\s*(?:1|true)\b/i.test(line.message) ||
        /(?:急停|防撞条).*(?:触发|按下)/.test(line.message)
      ).slice(0, 10)
      if (safetyEvents.length === 0 && safetyFrames.length === 0 && safetyLines.length === 0) return null
      return {
        id: 'safety',
        title: '疑似安全链路或急停触发',
        confidence: 0.7,
        severity: 'error',
        evidenceEvents: safetyEvents,
        evidenceLines: [...safetyFrames.map((frame) => frame.rawLine), ...safetyLines].slice(0, 10),
        suggestion: '检查急停、挡板、安全触边、避障输入和现场安全 PLC 状态。',
        triggeredRules: ['safety'],
        positiveEvidence: [`安全事件 ${safetyEvents.length} 个`, `急停状态帧 ${safetyFrames.length} 个`],
        negativeEvidence: [],
        confidenceFactors: ['estop 状态', '安全链路日志', 'alarm 日志']
      }
    }
  },
  {
    id: 'task-failure',
    weight: 1,
    build(ctx) {
      const failedTasks = ctx.tasks
        .filter((task) => task.lastFinishedTaskSuccess === false || task.errors.some((error) => /^E?ERROR\d{4,5}$/.test(error)))
        .slice(0, 10)
      const taskLines = ctx.rawLines
        .filter((line) =>
          /current_task_error_code\s+is\s+E?ERROR\d{4,5}\b/i.test(line.message) ||
          /task failed/i.test(line.message) ||
          /last_finished_task_is_success["']?\s*[:=]\s*false/i.test(line.message)
        )
        .slice(0, 10)
      if (failedTasks.length === 0 && taskLines.length === 0) return null
      return {
        id: 'task-failure',
        title: '疑似任务执行失败',
        confidence: failedTasks.length > 0 ? 0.76 : 0.56,
        severity: 'warning',
        evidenceEvents: ctx.events.filter((event) => event.category === 'task').slice(0, 10),
        evidenceLines: taskLines,
        suggestion: '从失败任务开始时间向前查看路径、货叉状态、定位分、错误码和未完成路径变化。',
        triggeredRules: ['task-failure'],
        positiveEvidence: [`失败候选任务 ${failedTasks.length} 个`, `任务失败相关日志 ${taskLines.length} 行`],
        negativeEvidence: failedTasks.length === 0 ? ['未解析到明确失败任务段'] : [],
        confidenceFactors: ['任务成功标记', '真实任务错误码', '任务失败日志']
      }
    }
  }
]
