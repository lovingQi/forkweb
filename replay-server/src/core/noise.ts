import type { FoldedLogGroup, ParsedLogLine } from '../types'

const RULES = [
  { id: 'sent_speed', label: '底盘速度发送', contains: 'sent: toSendV:' },
  { id: 'task_calc', label: '任务 ID 周期计算', contains: 'start calc current task id in FltTask' },
  { id: 'unfinished_null', label: '空未完成路径', contains: 'unfinshed path' },
  { id: 'invalid_empty_error', label: '空任务错误码', contains: 'Invalid task error code:' },
  { id: 'charge_state_zero', label: '充电状态轮询', contains: 'Get charging error state is: 0' },
  { id: 'battery_failed', label: '电量获取失败', contains: 'get battery failed' },
  { id: 'missing_config', label: '配置文件缺失提醒', contains: 'does not exist' },
  { id: 'missing_section', label: '配置段缺失提醒', contains: 'GetSection' },
  { id: 'json_param', label: '参数读取提醒', contains: 'get param' },
  { id: 'json_read', label: 'JSON 读取提醒', contains: 'ReadFileToJson' }
]

export function foldNoise(lines: ParsedLogLine[]): FoldedLogGroup[] {
  const groups = new Map<string, FoldedLogGroup>()
  for (const line of lines) {
    const rule = RULES.find((it) => line.message.includes(it.contains))
    if (!rule) continue
    const group = groups.get(rule.id)
    if (!group) {
      groups.set(rule.id, {
        id: rule.id,
        label: rule.label,
        count: 1,
        firstTime: line.timestamp,
        lastTime: line.timestamp,
        firstLine: line,
        lastLine: line
      })
    } else {
      group.count += 1
      group.lastTime = line.timestamp
      group.lastLine = line
    }
  }
  return Array.from(groups.values())
}

export function isNoiseLine(line: ParsedLogLine): boolean {
  return RULES.some((it) => line.message.includes(it.contains))
}

export function noiseRuleId(line: ParsedLogLine): string {
  return RULES.find((it) => line.message.includes(it.contains))?.id || ''
}
