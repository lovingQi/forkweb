<template>
  <div class="analysis-version-diff">
    <el-descriptions :column="2" border>
      <el-descriptions-item label="对比项">{{ `版本 ${base.versionNo} → 版本 ${target.versionNo}` }}</el-descriptions-item>
      <el-descriptions-item label="生成时间">
        <span :class="{ changed: base.createdAt !== target.createdAt }">
          {{ formatTime(base.createdAt) }} → {{ formatTime(target.createdAt) }}
        </span>
      </el-descriptions-item>
      <el-descriptions-item label="问题类型">
        <span :class="{ changed: base.issueType !== target.issueType }">
          {{ base.issueType || '-' }} → {{ target.issueType || '-' }}
        </span>
      </el-descriptions-item>
      <el-descriptions-item label="错误码数量">
        <span :class="{ changed: baseErrorCount !== targetErrorCount }">
          {{ baseErrorCount }} → {{ targetErrorCount }}
        </span>
      </el-descriptions-item>
      <el-descriptions-item label="任务数量">
        <span :class="{ changed: baseTaskCount !== targetTaskCount }">
          {{ baseTaskCount }} → {{ targetTaskCount }}
        </span>
      </el-descriptions-item>
      <el-descriptions-item label="地图匹配">
        <span :class="{ changed: baseMapMatch !== targetMapMatch }">
          {{ baseMapMatch || '-' }} → {{ targetMapMatch || '-' }}
        </span>
      </el-descriptions-item>
    </el-descriptions>

    <div class="diff-section">
      <div class="diff-title">Top 3 变化</div>
      <div class="diff-row header">
        <div>版本 {{ base.versionNo }}</div>
        <div>版本 {{ target.versionNo }}</div>
      </div>
      <div class="diff-row">
        <div class="diff-list">
          <div v-for="(issue, idx) in baseTopIssues" :key="`base-${idx}`">
            {{ idx + 1 }}. {{ issue.title || issue }}
          </div>
          <span v-if="!baseTopIssues.length">-</span>
        </div>
        <div class="diff-list">
          <div v-for="(issue, idx) in targetTopIssues" :key="`target-${idx}`">
            {{ idx + 1 }}. {{ issue.title || issue }}
          </div>
          <span v-if="!targetTopIssues.length">-</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { AnalysisVersion } from '@/api/tickets'

const props = defineProps<{
  base: AnalysisVersion
  target: AnalysisVersion
}>()

const baseEvidence = computed(() => props.base.evidenceSummary || {})
const targetEvidence = computed(() => props.target.evidenceSummary || {})

const baseErrorCount = computed(() => baseEvidence.value.errorCodeCount ?? '-')
const targetErrorCount = computed(() => targetEvidence.value.errorCodeCount ?? '-')
const baseTaskCount = computed(() => baseEvidence.value.taskCount ?? '-')
const targetTaskCount = computed(() => targetEvidence.value.taskCount ?? '-')
const baseMapMatch = computed(() => baseEvidence.value.mapMatch?.matchStrategy || baseEvidence.value.mapMatch?.detectedMapName || '')
const targetMapMatch = computed(() => targetEvidence.value.mapMatch?.matchStrategy || targetEvidence.value.mapMatch?.detectedMapName || '')

const baseTopIssues = computed(() => (props.base.topIssues || []).slice(0, 3))
const targetTopIssues = computed(() => (props.target.topIssues || []).slice(0, 3))

function formatTime(value?: string) {
  if (!value) return '-'
  return value.slice(0, 19).replace('T', ' ')
}
</script>

<style scoped>
.analysis-version-diff {
  font-size: 14px;
}
.changed {
  color: #e6a23c;
  font-weight: 600;
}
.diff-section {
  margin-top: 16px;
}
.diff-title {
  font-weight: 600;
  margin-bottom: 8px;
}
.diff-row {
  display: flex;
  gap: 12px;
}
.diff-row.header {
  font-weight: 600;
  color: #6b7280;
  margin-bottom: 4px;
}
.diff-row > div {
  flex: 1;
}
.diff-list {
  padding: 8px;
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 4px;
  min-height: 60px;
}
</style>
