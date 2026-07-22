<template>
  <div class="troubleshooting-guide">
    <el-alert
      v-if="showEscalationHint"
      title="关键步骤仍未解决，建议升级研发"
      type="warning"
      :closable="false"
      show-icon
      class="escalation-hint"
    />

    <el-empty v-if="!hasPaths" description="暂无排查路径" :image-size="60">
      <template #description>
        <div>
          <div>未匹配到已验证排查规则</div>
          <div v-if="evidenceSummary" class="basic-evidence">
            <div class="evidence-title">基础证据摘要</div>
            <el-descriptions :column="2" size="small" border>
              <el-descriptions-item label="错误事件">{{ evidenceSummary.errorCount ?? 0 }}</el-descriptions-item>
              <el-descriptions-item label="警告事件">{{ evidenceSummary.warningCount ?? 0 }}</el-descriptions-item>
              <el-descriptions-item label="错误码数">{{ evidenceSummary.errorCodeCount ?? 0 }}</el-descriptions-item>
              <el-descriptions-item label="任务数">{{ evidenceSummary.taskCount ?? 0 }}</el-descriptions-item>
              <el-descriptions-item label="地图">{{ evidenceSummary.hasMap ? '已加载' : '缺失' }}</el-descriptions-item>
              <el-descriptions-item label="机器人">{{ evidenceSummary.robotName || '-' }}</el-descriptions-item>
            </el-descriptions>
            <el-alert
              title="建议补充材料或升级研发"
              type="warning"
              :closable="false"
              show-icon
              class="upgrade-hint"
            />
          </div>
        </div>
      </template>
    </el-empty>

    <div v-else class="guide-actions">
      <el-button
        v-if="canStartTroubleshooting"
        type="primary"
        size="small"
        @click="onStartTroubleshooting"
      >开始排查</el-button>
      <el-button
        v-if="ticketStatus === 'field_troubleshooting'"
        size="small"
        @click="onPauseTroubleshooting"
      >稍后继续</el-button>
    </div>

    <el-collapse v-if="hasPaths" v-model="expandedNames">
      <el-collapse-item
        v-for="path in paths"
        :key="path.id"
        :name="String(path.id)"
      >
        <template #title>
          <div class="path-header">
            <span class="path-title">{{ path.title }}</span>
            <el-tag :type="severityTagType(path.severity)" size="small">{{ path.severity }}</el-tag>
            <span class="path-confidence">置信度 {{ Math.round(path.confidence * 100) }}%</span>
          </div>
        </template>
        <div class="path-body">
          <div
            v-for="step in path.steps"
            :key="step.id"
            class="step-row"
            :class="{ critical: step.isCritical, [stepStatus(step.id)]: true }"
          >
            <div class="step-header">
              <span class="step-no">{{ step.stepNo }}</span>
              <span class="step-title">{{ step.title }}</span>
              <el-tag v-if="step.isCritical" type="danger" size="small">关键</el-tag>
              <el-tag size="small" type="info">{{ stepTypeText(step.stepType) }}</el-tag>
              <el-tag v-if="step.estimatedTime" size="small" type="info">{{ estimatedTimeText(step.estimatedTime) }}</el-tag>
              <el-tag v-if="stepStatusLabel(step.id)" :type="stepStatusType(step.id)" size="small">{{ stepStatusLabel(step.id) }}</el-tag>
            </div>
            <div v-if="step.instruction" class="step-instruction">
              <strong>操作说明：</strong>{{ step.instruction }}
            </div>
            <div v-if="step.criteria" class="step-criteria">
              <strong>判断标准：</strong>{{ step.criteria }}
            </div>
            <div v-if="step.failureAction" class="step-failure">
              <strong>未通过动作：</strong>{{ step.failureAction }}
            </div>
            <el-collapse v-if="step.evidenceConfig" class="step-evidence">
              <el-collapse-item title="关联证据" :name="`evidence-${step.id}`">
                <pre>{{ JSON.stringify(step.evidenceConfig, null, 2) }}</pre>
              </el-collapse-item>
            </el-collapse>

            <div v-if="canExecuteSteps" class="step-actions">
              <el-radio-group :model-value="stepStatusMap[step.id]" size="small" @change="(val: string) => onStepStatusChange(step, val)">
                <el-radio-button label="passed">已通过</el-radio-button>
                <el-radio-button label="failed">未通过</el-radio-button>
                <el-radio-button label="not_applicable">不适用</el-radio-button>
              </el-radio-group>
            </div>
          </div>
        </div>
      </el-collapse-item>
    </el-collapse>

    <el-dialog v-model="safetyDialogVisible" title="安全确认" width="400px">
      <p>该步骤为现场操作，执行前请确认现场环境安全，已采取必要的安全防护措施。</p>
      <template #footer>
        <el-button @click="safetyDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="confirmSafety">已确认安全</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="reasonDialogVisible" title="选择不适用原因" width="400px">
      <el-select v-model="selectedReason" placeholder="请选择原因" style="width: 100%">
        <el-option v-for="item in notApplicableReasons" :key="item.value" :label="item.label" :value="item.value" />
      </el-select>
      <template #footer>
        <el-button @click="reasonDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="confirmNotApplicable">提交</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useTicketStore } from '@/stores/tickets'
import type { TroubleshootingStep } from '@/api/tickets'

const ticketStore = useTicketStore()
const auth = useAuthStore()
const paths = computed(() => ticketStore.troubleshootingPaths)
const hasPaths = computed(() => paths.value.length > 0)
const evidenceSummary = computed(() => ticketStore.currentAnalysisVersion?.evidenceSummary)
const ticketStatus = computed(() => ticketStore.currentTicket?.status)
const isLatestAnalysisVersion = computed(() =>
  ticketStore.currentAnalysisVersion?.id === ticketStore.currentTicket?.latestAnalysisVersionId
)

const canStartTroubleshooting = computed(() =>
  auth.isAfterSales && ticketStatus.value === 'pending_field_troubleshooting'
)
const canExecuteSteps = computed(() =>
  auth.isAfterSales && isLatestAnalysisVersion.value && ticketStatus.value === 'field_troubleshooting'
)

const expandedNames = ref<string[]>([])

const stepStatusMap = reactive<Record<number, string>>({})
const safetyDialogVisible = ref(false)
const reasonDialogVisible = ref(false)
const pendingStep = ref<TroubleshootingStep | null>(null)
const pendingStatus = ref('')
const selectedReason = ref('')
const confirmedFieldOperationSteps = reactive<Set<number>>(new Set())

watch(paths, (nextPaths) => {
  if (nextPaths.length > 0 && expandedNames.value.length === 0) {
    expandedNames.value = [String(nextPaths[0].id)]
  }
  for (const path of nextPaths) {
    for (const step of path.steps) {
      stepStatusMap[step.id] = step.status || 'unchecked'
    }
  }
}, { immediate: true })

const notApplicableReasons = [
  { label: '现场无该传感器', value: 'no_sensor' },
  { label: '无权限操作', value: 'no_permission' },
  { label: '工具不可用', value: 'no_tool' },
  { label: '已由客户确认', value: 'confirmed_by_customer' },
  { label: '其他', value: 'other' }
]

function stepStatus(stepId: number) {
  return stepStatusMap[stepId] || 'unchecked'
}

function stepStatusLabel(stepId: number) {
  const map: Record<string, string> = {
    passed: '已通过',
    failed: '未通过',
    not_applicable: '不适用'
  }
  return map[stepStatus(stepId)]
}

function stepStatusType(stepId: number) {
  const status = stepStatus(stepId)
  if (status === 'passed') return 'success'
  if (status === 'failed') return 'danger'
  if (status === 'not_applicable') return 'info'
  return ''
}

const showEscalationHint = computed(() => {
  if (!paths.value.length) return false
  // 只考虑有关键步骤的路径
  const pathsWithCritical = paths.value.filter((path) =>
    path.steps.some((s) => s.isCritical)
  )
  if (pathsWithCritical.length === 0) return false
  // 所有关键步骤都已检查（passed/failed/not_applicable）
  const allCriticalChecked = pathsWithCritical.every((path) =>
    path.steps
      .filter((s) => s.isCritical)
      .every((s) => ['passed', 'failed', 'not_applicable'].includes(stepStatusMap[s.id] || ''))
  )
  // 任意关键步骤失败
  const anyCriticalFailed = pathsWithCritical.some((path) =>
    path.steps.some((s) => s.isCritical && stepStatusMap[s.id] === 'failed')
  )
  return allCriticalChecked && anyCriticalFailed
})

async function onStartTroubleshooting() {
  if (!ticketStore.currentTicket) return
  await ticketStore.startFieldTroubleshooting(ticketStore.currentTicket.id)
}

function onPauseTroubleshooting() {
  // 仅保存当前步骤状态，不改变工单状态
  // 步骤状态已在每次切换时实时提交
}

async function onStepStatusChange(step: TroubleshootingStep, value: string) {
  if (!ticketStore.currentTicket) return
  if (step.stepType === 'field_operation' && value !== 'unchecked' && !confirmedFieldOperationSteps.has(step.id)) {
    pendingStep.value = step
    pendingStatus.value = value
    safetyDialogVisible.value = true
    return
  }
  if (value === 'not_applicable') {
    pendingStep.value = step
    pendingStatus.value = value
    reasonDialogVisible.value = true
    return
  }
  await submitStepStatus(step, value)
}

function confirmSafety() {
  if (!pendingStep.value) return
  confirmedFieldOperationSteps.add(pendingStep.value.id)
  safetyDialogVisible.value = false
  if (pendingStatus.value === 'not_applicable') {
    reasonDialogVisible.value = true
  } else {
    submitStepStatus(pendingStep.value, pendingStatus.value)
  }
}

async function confirmNotApplicable() {
  if (!pendingStep.value || !selectedReason.value) return
  reasonDialogVisible.value = false
  await submitStepStatus(pendingStep.value, 'not_applicable', selectedReason.value)
  pendingStep.value = null
  selectedReason.value = ''
}

async function submitStepStatus(step: TroubleshootingStep, status: string, reason?: string) {
  if (!ticketStore.currentTicket) return
  const path = paths.value.find((p) => p.steps.some((s) => s.id === step.id))
  if (!path) return
  await ticketStore.recordStepStatus(ticketStore.currentTicket.id, path.id, step.id, {
    status,
    reason,
    analysisVersionId: path.analysisVersionId
  })
  stepStatusMap[step.id] = status
}

function severityTagType(severity: string) {
  if (severity === 'error') return 'danger'
  if (severity === 'warning') return 'warning'
  return 'info'
}

function stepTypeText(type: string) {
  const map: Record<string, string> = {
    readonly_check: '只读检查',
    field_operation: '现场操作',
    rd_required: '需研发处理'
  }
  return map[type] || type
}

function estimatedTimeText(value: string) {
  const map: Record<string, string> = {
    '3_5_min': '3-5 分钟',
    '10_min': '约 10 分钟',
    long: '需要较长时间'
  }
  return map[value] || value
}
</script>

<style scoped>
.troubleshooting-guide {
  min-height: 200px;
}
.guide-actions {
  margin-bottom: 12px;
}
.escalation-hint {
  margin-bottom: 12px;
}
.path-header {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
}
.path-title {
  font-weight: 600;
}
.path-confidence {
  margin-left: auto;
  color: #6b7280;
  font-size: 13px;
}
.path-body {
  padding: 8px 0;
}
.step-row {
  padding: 10px;
  margin-bottom: 8px;
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 4px;
}
.step-row.critical {
  border-color: #fde2e2;
  background: #fef2f2;
}
.step-row.passed {
  border-left: 4px solid #67c23a;
}
.step-row.failed {
  border-left: 4px solid #f56c6c;
}
.step-row.not_applicable {
  border-left: 4px solid #909399;
}
.step-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.step-no {
  width: 22px;
  height: 22px;
  line-height: 22px;
  text-align: center;
  background: #e5e7eb;
  border-radius: 50%;
  font-size: 12px;
}
.step-title {
  font-weight: 500;
}
.step-instruction,
.step-criteria,
.step-failure {
  font-size: 13px;
  color: #4b5563;
  margin-top: 4px;
}
.step-actions {
  margin-top: 10px;
}
.step-evidence {
  margin-top: 8px;
}
.step-evidence pre {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
}
.basic-evidence {
  margin-top: 12px;
  text-align: left;
}
.evidence-title {
  font-weight: 600;
  margin-bottom: 8px;
}
.upgrade-hint {
  margin-top: 10px;
}
</style>
