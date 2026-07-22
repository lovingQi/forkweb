<template>
  <div class="evidence-panel">
    <el-empty v-if="!hasEvidence" description="暂无证据数据" :image-size="60" />

    <div v-else class="evidence-content">
      <!-- 证据概览 -->
      <div class="evidence-overview">
        <el-descriptions :column="3" size="small" border>
          <el-descriptions-item label="错误事件">{{ summary.errorCount ?? 0 }}</el-descriptions-item>
          <el-descriptions-item label="警告事件">{{ summary.warningCount ?? 0 }}</el-descriptions-item>
          <el-descriptions-item label="错误码数">{{ summary.errorCodeCount ?? 0 }}</el-descriptions-item>
          <el-descriptions-item label="任务数">{{ summary.taskCount ?? 0 }}</el-descriptions-item>
          <el-descriptions-item label="帧数">{{ summary.frameCount ?? 0 }}</el-descriptions-item>
          <el-descriptions-item label="时长">{{ formatDuration(summary.durationMs) }}</el-descriptions-item>
          <el-descriptions-item label="地图">{{ summary.hasMap ? '已加载' : '缺失' }}</el-descriptions-item>
          <el-descriptions-item label="地图匹配">{{ summary.mapMatch ?? '-' }}</el-descriptions-item>
          <el-descriptions-item label="机器人">{{ summary.robotName || '-' }}</el-descriptions-item>
        </el-descriptions>
      </div>

      <!-- Top 问题摘要 -->
      <div v-if="topIssues.length" class="evidence-section">
        <div class="section-title">Top 问题</div>
        <el-table :data="topIssues" size="small" stripe>
          <el-table-column prop="title" label="问题" />
          <el-table-column prop="severity" label="严重度" width="100">
            <template #default="{ row }">
              <el-tag :type="severityTagType(row.severity)" size="small">{{ row.severity }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="confidence" label="置信度" width="100">
            <template #default="{ row }">
              {{ Math.round((row.confidence || 0) * 100) }}%
            </template>
          </el-table-column>
        </el-table>
      </div>

      <!-- 关键时间线 -->
      <div v-if="timeline.length" class="evidence-section">
        <div class="section-title">关键时间线</div>
        <el-timeline>
          <el-timeline-item
            v-for="(item, idx) in timeline"
            :key="idx"
            :timestamp="item.time"
            placement="top"
          >
            <el-tag :type="item.type" size="small">{{ item.label }}</el-tag>
            <span class="timeline-text">{{ item.text }}</span>
          </el-timeline-item>
        </el-timeline>
      </div>

      <!-- 错误码摘要 -->
      <div v-if="errorCodes.length" class="evidence-section">
        <div class="section-title">错误码</div>
        <div class="error-codes">
          <el-tag
            v-for="(code, idx) in errorCodes"
            :key="idx"
            type="danger"
            size="small"
            class="error-code-tag"
          >
            {{ code }}
          </el-tag>
        </div>
      </div>

      <!-- 任务摘要 -->
      <div v-if="tasks.length" class="evidence-section">
        <div class="section-title">任务</div>
        <el-table :data="tasks" size="small" stripe>
          <el-table-column prop="name" label="任务名" />
          <el-table-column prop="status" label="状态" width="100" />
          <el-table-column prop="duration" label="耗时" width="100" />
        </el-table>
      </div>

      <!-- 原始日志上下文 -->
      <div v-if="logContext" class="evidence-section">
        <div class="section-title">原始日志上下文</div>
        <pre class="log-context">{{ logContext }}</pre>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useTicketStore } from '@/stores/tickets'

const ticketStore = useTicketStore()

const analysisVersion = computed(() => ticketStore.currentAnalysisVersion)
const hasEvidence = computed(() => !!analysisVersion.value?.evidenceSummary)
const summary = computed(() => analysisVersion.value?.evidenceSummary || {})
const topIssues = computed(() => analysisVersion.value?.topIssues || [])

// 从证据摘要构建时间线
const timeline = computed(() => {
  const items: Array<{ time: string; label: string; text: string; type: string }> = []
  const s = summary.value
  if (s.errorCount > 0) {
    items.push({
      time: '日志开始',
      label: '错误',
      text: `发现 ${s.errorCount} 个错误事件`,
      type: 'danger'
    })
  }
  if (s.warningCount > 0) {
    items.push({
      time: '日志开始',
      label: '警告',
      text: `发现 ${s.warningCount} 个警告事件`,
      type: 'warning'
    })
  }
  if (s.hasMap) {
    items.push({
      time: '日志开始',
      label: '地图',
      text: `地图已加载，匹配度 ${s.mapMatch || '未知'}`,
      type: 'success'
    })
  } else {
    items.push({
      time: '日志开始',
      label: '地图',
      text: '地图文件缺失',
      type: 'danger'
    })
  }
  if (s.robotName) {
    items.push({
      time: '日志开始',
      label: '机器人',
      text: `机器人名称：${s.robotName}`,
      type: 'info'
    })
  }
  return items
})

// 从 topIssues 提取错误码
const errorCodes = computed(() => {
  const codes: string[] = []
  topIssues.value.forEach((issue) => {
    if (issue.errorCodes && Array.isArray(issue.errorCodes)) {
      codes.push(...issue.errorCodes)
    }
  })
  return [...new Set(codes)]
})

// 任务摘要（如果有）
const tasks = computed(() => {
  return (analysisVersion.value as any)?.tasks || []
})

// 日志上下文（如果有）
const logContext = computed(() => {
  return (analysisVersion.value as any)?.logContext || null
})

function formatDuration(ms?: number): string {
  if (!ms) return '-'
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return `${minutes}m ${remainingSeconds}s`
}

function severityTagType(severity: string): string {
  if (severity === 'error') return 'danger'
  if (severity === 'warning') return 'warning'
  return 'info'
}
</script>

<style scoped>
.evidence-panel {
  padding: 16px;
  background: #fff;
  border-radius: 4px;
}

.evidence-content {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.evidence-overview {
  margin-bottom: 8px;
}

.evidence-section {
  border-top: 1px solid #e5e7eb;
  padding-top: 16px;
}

.section-title {
  font-size: 14px;
  font-weight: 600;
  color: #374151;
  margin-bottom: 12px;
}

.timeline-text {
  margin-left: 8px;
  color: #6b7280;
  font-size: 13px;
}

.error-codes {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.error-code-tag {
  font-family: 'Courier New', monospace;
}

.log-context {
  background: #1f2937;
  color: #e5e7eb;
  padding: 12px;
  border-radius: 4px;
  font-size: 12px;
  font-family: 'Courier New', monospace;
  max-height: 300px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
