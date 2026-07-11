import type { ReplaySessionData } from '../types'

export function buildMarkdownReport(data: ReplaySessionData): string {
  const o = data.overview
  const lines = [
    '# 叉车日志诊断报告',
    '',
    '## 概览',
    '',
    `- 日志目录: ${o.logDir || '-'}`,
    `- 地图文件: ${o.mapPath || '-'}`,
    `- 时间范围: ${o.startTime || '-'} ~ ${o.endTime || '-'}`,
    `- 车辆: ${o.robotName || '-'}`,
    `- 版本: ${o.version || '-'}`,
    `- 分支: ${o.branch || '-'}`,
    `- 回放帧: ${o.frameCount}`,
    `- 任务数: ${o.taskCount}`,
    `- 错误码: ${o.errorCodeCount}`,
    `- 错误事件: ${o.errorCount}`,
    `- 关键告警: ${o.warningCount}`,
    '',
    '## Top 问题',
    ''
  ]
  for (const issue of o.topIssues) {
    lines.push(`- ${issue.timestamp} ${issue.title}: ${issue.detail}`)
  }
  lines.push('', '## 错误码', '')
  for (const occurrence of data.errorOccurrences.slice(0, 50)) {
    lines.push(
      `- ${occurrence.timestamp} ${occurrence.code} ${occurrence.definition?.description || occurrence.source}`
    )
  }
  lines.push('', '## 任务视角', '')
  for (const task of data.tasks) {
    lines.push(
      `- ${task.id}: ${task.startTime} ~ ${task.endTime}, 状态 ${task.status || '-'}, 错误 ${task.errors.join(',') || '-'}`
    )
  }
  return `${lines.join('\n')}\n`
}

export function buildJsonReport(data: ReplaySessionData): unknown {
  return {
    overview: data.overview,
    topIssues: data.overview.topIssues,
    errorCodes: data.errorDefinitions,
    errorOccurrences: data.errorOccurrences,
    tasks: data.tasks,
    foldedLogs: data.foldedLogs
  }
}
