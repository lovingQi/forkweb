<template>
  <div v-if="ticketStore.currentTicket" class="ticket-detail-page">
    <el-card shadow="never" class="detail-card">
      <template #header>
        <div class="detail-header">
          <div>
            <span class="ticket-no">{{ ticketStore.currentTicket.ticketNo }}</span>
            <span class="ticket-title">{{ ticketStore.currentTicket.title }}</span>
          </div>
          <el-tag :type="statusType(ticketStore.currentTicket.status)">
            {{ statusLabel(ticketStore.currentTicket.status) }}
          </el-tag>
        </div>
      </template>

      <div v-if="ticketStore.analysisVersions.length > 0" class="version-bar">
        <el-select
          :model-value="selectedVersionId"
          placeholder="选择分析版本"
          style="width: 240px"
          @change="onVersionChange"
        >
          <el-option
            v-for="v in ticketStore.analysisVersions"
            :key="v.id"
            :label="`版本 ${v.versionNo} (${formatVersionTime(v)})`"
            :value="v.id"
          />
        </el-select>
        <el-button v-if="canCompare" size="small" @click="openDiffDialog">对比差异</el-button>
      </div>

      <el-row :gutter="20">
        <el-col :span="14">
          <div class="section-title">结论摘要</div>
          <el-descriptions :column="1" border>
            <el-descriptions-item label="自动分析结论">
              {{ ticketStore.currentTicket.conclusion || '暂无' }}
            </el-descriptions-item>
            <el-descriptions-item label="描述">{{ ticketStore.currentTicket.description }}</el-descriptions-item>
            <el-descriptions-item label="项目现场">{{ ticketStore.currentTicket.siteName || '-' }}</el-descriptions-item>
            <el-descriptions-item label="问题类型">
              <div class="issue-type-cell">
                <span>{{ issueTypeLabel(ticketStore.currentTicket.issueType) || '-' }}</span>
                <el-button v-if="canEditIssueType" link size="small" @click="openIssueTypeDialog">修改</el-button>
              </div>
            </el-descriptions-item>
            <el-descriptions-item label="影响程度">
              {{ impactLevelLabel(ticketStore.currentTicket.impactLevel) || '-' }}
            </el-descriptions-item>
            <el-descriptions-item label="发生时间">
              {{ occurredTimeText(ticketStore.currentTicket) || '-' }}
            </el-descriptions-item>
            <el-descriptions-item label="创建时间">{{ ticketStore.currentTicket.createdAt }}</el-descriptions-item>
            <el-descriptions-item label="更新时间">{{ ticketStore.currentTicket.updatedAt }}</el-descriptions-item>
          </el-descriptions>

          <div class="section-title">当前分析版本</div>
          <div v-if="ticketStore.currentAnalysisVersion" class="version-info">
            <el-descriptions :column="2" border>
              <el-descriptions-item label="版本号">版本 {{ ticketStore.currentAnalysisVersion.versionNo }}</el-descriptions-item>
              <el-descriptions-item label="生成时间">{{ ticketStore.currentAnalysisVersion.createdAt }}</el-descriptions-item>
              <el-descriptions-item label="问题类型">{{ ticketStore.currentAnalysisVersion.issueType || '-' }}</el-descriptions-item>
              <el-descriptions-item label="Top 问题">
                <div v-if="ticketStore.currentAnalysisVersion.topIssues.length">
                  <div v-for="(issue, idx) in ticketStore.currentAnalysisVersion.topIssues.slice(0, 3)" :key="idx">
                    {{ idx + 1 }}. {{ issue.title || issue }}
                  </div>
                </div>
                <span v-else>-</span>
              </el-descriptions-item>
            </el-descriptions>
          </div>
          <el-alert v-else title="暂无分析版本" type="info" :closable="false" show-icon />

          <div class="section-title">AI 分析结论</div>
          <div class="ai-section">
            <el-alert
              v-if="!ticketStore.currentTicket.aiEnabled"
              title="未开启 AI 介入分析"
              type="info"
              :closable="false"
              show-icon
            />
            <el-alert
              v-else-if="ticketStore.currentTicket.status === 'analyzing' || !ticketStore.currentTicket.aiConclusion"
              title="AI 分析中或等待分析完成"
              type="warning"
              :closable="false"
              show-icon
            />
            <div v-else class="ai-conclusion">
              <div class="ai-header">
                <el-tag :type="ticketStore.currentTicket.aiOffline ? 'warning' : 'success'" size="small">
                  {{ ticketStore.currentTicket.aiOffline ? '离线回答' : 'AI 回答' }}
                </el-tag>
              </div>
              <div class="ai-body">{{ aiAnswerText }}</div>
            </div>
          </div>

          <div class="section-title">操作</div>
          <div class="actions">
            <el-button
              v-if="canResolveSelfService"
              type="success"
              :loading="loadingAction === 'resolved'"
              @click="openResolveSelfServiceDialog"
            >确认已解决</el-button>
            <el-button
              v-if="canEscalateToRd"
              type="danger"
              :loading="loadingAction === 'needs_rd'"
              @click="openEscalateDialog"
            >需要研发介入</el-button>
            <el-button
              v-if="canAssign"
              type="primary"
              :loading="loadingAction === 'assign'"
              @click="onAssign"
            >认领工单</el-button>
            <el-button
              v-if="canResolve"
              type="success"
              :loading="loadingAction === 'resolve'"
              @click="openResolveDialog"
            >标记已解决</el-button>
            <el-button
              v-if="canCreateKnowledge"
              type="primary"
              :loading="loadingAction === 'knowledge'"
              @click="openKnowledgeDialog"
            >沉淀到知识库</el-button>
            <el-button v-if="ticketStore.currentTicket.reportPath" @click="loadReport">查看报告</el-button>
          </div>

          <div v-if="reportHtml" class="report-preview">
            <pre>{{ reportHtml }}</pre>
          </div>
        </el-col>

        <el-col :span="10">
          <div class="section-title">排查向导</div>
          <TicketTroubleshootingGuide />
        </el-col>
      </el-row>

      <div class="section-title">精简证据</div>
      <TicketEvidencePanel />

      <div class="section-title">事件流</div>
      <el-timeline>
        <el-timeline-item
          v-for="event in ticketStore.currentEvents"
          :key="event.id"
          :timestamp="event.createdAt"
        >
          {{ event.action }}
          <div v-if="event.payload" class="event-payload">{{ JSON.stringify(event.payload, null, 2) }}</div>
        </el-timeline-item>
      </el-timeline>
    </el-card>

    <el-dialog v-model="resolveDialogVisible" title="填写解决方案" width="600px">
      <el-input v-model="solution" type="textarea" :rows="6" placeholder="请填写解决过程和结论" />
      <template #footer>
        <el-button @click="resolveDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="loadingAction === 'resolve'" @click="onResolve">提交</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="resolveSelfServiceDialogVisible" title="确认已解决" width="500px">
      <el-form label-width="100px">
        <el-form-item label="解决方式">
          <el-select v-model="selfServiceResult" placeholder="请选择解决方式" style="width: 100%">
            <el-option v-for="item in selfServiceResults" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="向导反馈">
          <el-select v-model="guideFeedback" placeholder="请选择向导有效性" style="width: 100%">
            <el-option v-for="item in guideFeedbacks" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="补充说明">
          <el-input v-model="selfServiceNote" type="textarea" :rows="3" placeholder="可选" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="resolveSelfServiceDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="loadingAction === 'resolved'" @click="onResolveSelfService">提交</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="escalateDialogVisible" title="升级研发" width="500px">
      <el-form label-width="100px">
        <el-form-item label="升级原因">
          <el-select v-model="escalationReason" placeholder="请选择升级原因" style="width: 100%">
            <el-option v-for="item in escalationReasons" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="escalateDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="loadingAction === 'needs_rd'" @click="onEscalateToRd">提交</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="issueTypeDialogVisible" title="修改问题类型" width="400px">
      <el-select v-model="selectedIssueType" placeholder="请选择问题类型" style="width: 100%">
        <el-option
          v-for="item in issueTypeOptions"
          :key="item.value"
          :label="item.label"
          :value="item.value"
        />
      </el-select>
      <template #footer>
        <el-button @click="issueTypeDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="loadingAction === 'issueType'" @click="onIssueTypeUpdate">提交</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="diffDialogVisible" title="分析版本差异对比" width="700px">
      <AnalysisVersionDiff
        v-if="diffBaseVersion && diffTargetVersion"
        :base="diffBaseVersion"
        :target="diffTargetVersion"
      />
    </el-dialog>

    <el-dialog v-model="knowledgeDialogVisible" title="沉淀到知识库" width="700px">
      <el-form label-width="100px">
        <el-form-item label="知识标题">
          <el-input v-model="knowledgeForm.title" placeholder="例如：激光无数据导致定位丢失" />
        </el-form-item>
        <el-form-item label="现象描述">
          <el-input v-model="knowledgeForm.description" type="textarea" :rows="3" placeholder="描述问题的现象" />
        </el-form-item>
        <el-form-item label="根因">
          <el-input v-model="knowledgeForm.rootCause" type="textarea" :rows="3" placeholder="分析出的根本原因" />
        </el-form-item>
        <el-form-item label="解决方案">
          <el-input v-model="knowledgeForm.solution" type="textarea" :rows="3" placeholder="如何解决该问题" />
        </el-form-item>
        <el-form-item label="关键词">
          <el-input v-model="knowledgeKeywords" placeholder="用逗号分隔，例如：laser,outof date,stop robot" />
        </el-form-item>
        <el-form-item label="模块">
          <el-input v-model="knowledgeModules" placeholder="用逗号分隔，例如：JActSecure,MgSrvInfoErrorCode" />
        </el-form-item>
        <el-form-item label="错误码">
          <el-input v-model="knowledgeErrorCodes" placeholder="用逗号分隔，例如：ERROR0502" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="knowledgeDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="loadingAction === 'knowledge'" @click="onCreateKnowledge">沉淀</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useTicketStore } from '@/stores/tickets'
import { getTicketReport, type AnalysisVersion, type IssueType, type Ticket, type TicketStatus } from '@/api/tickets'
import AnalysisVersionDiff from '@/components/AnalysisVersionDiff.vue'
import TicketTroubleshootingGuide from '@/components/TicketTroubleshootingGuide.vue'
import TicketEvidencePanel from '@/components/TicketEvidencePanel.vue'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const ticketStore = useTicketStore()
const ticketId = computed(() => Number(route.params.id))

const loadingAction = ref<string | null>(null)
const reportHtml = ref('')
const resolveDialogVisible = ref(false)
const solution = ref('')
const resolveSelfServiceDialogVisible = ref(false)
const escalateDialogVisible = ref(false)
const selfServiceResult = ref('')
const guideFeedback = ref('')
const selfServiceNote = ref('')
const escalationReason = ref('')
const knowledgeDialogVisible = ref(false)
const diffDialogVisible = ref(false)
const issueTypeDialogVisible = ref(false)
const selectedIssueType = ref<IssueType>('unknown')
const selfServiceResults = [
  { label: '重启恢复', value: 'reboot' },
  { label: '重新接线/供电恢复', value: 'rewire' },
  { label: '更换硬件', value: 'replace_hardware' },
  { label: '调整配置/地图', value: 'adjust_config' },
  { label: '补充/更换日志后确认', value: 'refresh_logs' },
  { label: '误报/无需处理', value: 'false_positive' },
  { label: '其他', value: 'other' }
]
const guideFeedbacks = [
  { label: '有用', value: 'useful' },
  { label: '部分有用', value: 'partial' },
  { label: '没用', value: 'useless' }
]
const escalationReasons = [
  { label: '按向导排查仍未解决', value: 'guide_unresolved' },
  { label: '缺少权限或工具', value: 'no_permission_or_tool' },
  { label: '疑似软件缺陷', value: 'software_defect' },
  { label: '诊断结论不可信', value: 'untrusted_conclusion' },
  { label: '需要远程协助', value: 'need_remote' },
  { label: '其他', value: 'other' }
]
const knowledgeForm = reactive({
  title: '',
  description: '',
  rootCause: '',
  solution: ''
})
const knowledgeKeywords = ref('')
const knowledgeModules = ref('')
const knowledgeErrorCodes = ref('')

let pollTimer: ReturnType<typeof setInterval> | null = null
let lastStatus: string | null = null

watch(
  () => ticketStore.currentTicket?.status,
  async (status) => {
    if (lastStatus === 'analyzing' && status === 'pending_field_troubleshooting') {
      await ticketStore.loadAnalysisVersions(ticketId.value)
      const versionId = ticketStore.currentAnalysisVersion?.id || ticketStore.currentTicket?.latestAnalysisVersionId
      if (versionId) {
        await ticketStore.loadTroubleshootingPaths(ticketId.value, versionId)
      }
    }
    lastStatus = status || null
  }
)

onMounted(async () => {
  await ticketStore.loadTicket(ticketId.value)
  await ticketStore.loadAnalysisVersions(ticketId.value)
  const versionId = ticketStore.currentAnalysisVersion?.id || ticketStore.currentTicket?.latestAnalysisVersionId
  if (versionId) {
    await ticketStore.loadTroubleshootingPaths(ticketId.value, versionId)
  }
  startPolling()
})

onBeforeUnmount(() => {
  stopPolling()
})

function startPolling() {
  stopPolling()
  pollTimer = setInterval(() => {
    if (!ticketStore.currentTicket) return
    if (['pending_analysis', 'analyzing'].includes(ticketStore.currentTicket.status)) {
      ticketStore.loadTicket(ticketId.value)
    }
  }, 3000)
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

const ticket = computed(() => ticketStore.currentTicket)
const selectedVersionId = computed(() => ticketStore.currentAnalysisVersion?.id)
const canCompare = computed(() => ticketStore.analysisVersions.length >= 2)
const diffBaseVersion = computed<AnalysisVersion | undefined>(() =>
  ticketStore.analysisVersions[1] ? ticketStore.analysisVersions[1] : undefined
)
const diffTargetVersion = computed<AnalysisVersion | undefined>(() =>
  ticketStore.analysisVersions[0] ? ticketStore.analysisVersions[0] : undefined
)
const aiAnswerText = computed(() => {
  if (!ticket.value?.aiConclusion) return ''
  try {
    const parsed = JSON.parse(ticket.value.aiConclusion)
    return parsed.answer || String(parsed)
  } catch {
    return ticket.value.aiConclusion
  }
})
const canResolveSelfService = computed(() => {
  if (!ticket.value) return false
  return auth.isAfterSales && ['pending_field_troubleshooting', 'field_troubleshooting'].includes(ticket.value.status)
})
const canEscalateToRd = computed(() => {
  if (!ticket.value) return false
  return auth.isAfterSales && ['pending_field_troubleshooting', 'field_troubleshooting'].includes(ticket.value.status)
})
const canAssign = computed(() => {
  if (!ticket.value) return false
  return auth.isRd && ticket.value.status === 'pending_rd'
})
const canResolve = computed(() => {
  if (!ticket.value) return false
  return auth.isRd && ticket.value.status === 'rd_working'
})
const canCreateKnowledge = computed(() => {
  if (!ticket.value) return false
  return auth.isRd && ['pending_field_troubleshooting', 'rd_working', 'resolved'].includes(ticket.value.status)
})
const canEditIssueType = computed(() => {
  if (!ticket.value) return false
  return auth.isRd || auth.isAdmin || (auth.isAfterSales && ticket.value.reporterId === auth.user?.id)
})

const issueTypeOptions = [
  { label: '定位', value: 'positioning' },
  { label: '激光', value: 'laser' },
  { label: '避障', value: 'obstacle_avoidance' },
  { label: '地图', value: 'map' },
  { label: '任务失败', value: 'task_failure' },
  { label: '充电', value: 'charging' },
  { label: '硬件通信', value: 'hardware_communication' },
  { label: '货叉/传感器', value: 'fork_sensor' },
  { label: '未知', value: 'unknown' }
]

async function onVerify(result: 'resolved' | 'needs_rd') {
  loadingAction.value = result
  try {
    await ticketStore.verifyTicket(ticketId.value, result)
  } finally {
    loadingAction.value = null
  }
}

async function onAssign() {
  loadingAction.value = 'assign'
  try {
    await ticketStore.assignTicket(ticketId.value)
  } finally {
    loadingAction.value = null
  }
}

function openResolveSelfServiceDialog() {
  selfServiceResult.value = ''
  guideFeedback.value = ''
  selfServiceNote.value = ''
  resolveSelfServiceDialogVisible.value = true
}

async function onResolveSelfService() {
  if (!selfServiceResult.value || !guideFeedback.value) return
  loadingAction.value = 'resolved'
  try {
    await ticketStore.resolveSelfService(ticketId.value, {
      result: selfServiceResult.value,
      guideFeedback: guideFeedback.value,
      note: selfServiceNote.value
    })
    resolveSelfServiceDialogVisible.value = false
  } finally {
    loadingAction.value = null
  }
}

function openEscalateDialog() {
  escalationReason.value = ''
  escalateDialogVisible.value = true
}

async function onEscalateToRd() {
  if (!escalationReason.value) return
  loadingAction.value = 'needs_rd'
  try {
    await ticketStore.escalateToRd(ticketId.value, escalationReason.value)
    escalateDialogVisible.value = false
  } finally {
    loadingAction.value = null
  }
}

function openResolveDialog() {
  solution.value = ''
  resolveDialogVisible.value = true
}

async function onResolve() {
  if (!solution.value.trim()) return
  loadingAction.value = 'resolve'
  try {
    await ticketStore.resolveTicket(ticketId.value, solution.value.trim())
    resolveDialogVisible.value = false
    // 研发解决后提示是否沉淀知识规则
    if (auth.isRd || auth.isAdmin) {
      const shouldCreateKnowledge = window.confirm('工单已解决，是否沉淀为知识规则？')
      if (shouldCreateKnowledge) {
        // 预填知识规则表单
        const ticket = ticketStore.currentTicket
        const analysisVersion = ticketStore.currentAnalysisVersion
        knowledgeForm.title = ticket?.title || ''
        knowledgeForm.description = ticket?.description || ''
        knowledgeForm.rootCause = analysisVersion?.topIssues?.[0]?.title || ''
        knowledgeForm.solution = solution.value.trim()
        // 尝试从分析版本中提取错误码和模块
        const errorCodes: string[] = []
        const modules: string[] = []
        const keywords: string[] = []
        if (analysisVersion?.evidenceSummary) {
          // 从 topIssues 中提取关键词
          analysisVersion.topIssues?.forEach((issue) => {
            if (issue.title) keywords.push(issue.title)
          })
        }
        knowledgeErrorCodes.value = errorCodes.join(',')
        knowledgeModules.value = modules.join(',')
        knowledgeKeywords.value = keywords.join(',')
        knowledgeDialogVisible.value = true
      }
    }
  } finally {
    loadingAction.value = null
  }
}

async function loadReport() {
  reportHtml.value = await getTicketReport(ticketId.value)
}

function openIssueTypeDialog() {
  selectedIssueType.value = (ticketStore.currentTicket?.issueType as IssueType) || 'unknown'
  issueTypeDialogVisible.value = true
}

async function onIssueTypeUpdate() {
  if (!selectedIssueType.value) return
  loadingAction.value = 'issueType'
  try {
    await ticketStore.updateIssueType(ticketId.value, selectedIssueType.value)
    issueTypeDialogVisible.value = false
  } finally {
    loadingAction.value = null
  }
}

async function onVersionChange(versionId: number) {
  await ticketStore.switchAnalysisVersion(ticketId.value, versionId)
  await ticketStore.loadTroubleshootingPaths(ticketId.value, versionId)
}

function openDiffDialog() {
  if (!canCompare.value) return
  diffDialogVisible.value = true
}

function formatVersionTime(v: AnalysisVersion) {
  if (!v.createdAt) return ''
  return v.createdAt.slice(0, 19).replace('T', ' ')
}

function openKnowledgeDialog() {
  knowledgeForm.title = ''
  knowledgeForm.description = ''
  knowledgeForm.rootCause = ''
  knowledgeForm.solution = ''
  knowledgeKeywords.value = ''
  knowledgeModules.value = ''
  knowledgeErrorCodes.value = ''
  knowledgeDialogVisible.value = true
}

async function onCreateKnowledge() {
  if (!knowledgeForm.title.trim() || !knowledgeForm.description.trim() || !knowledgeForm.rootCause.trim() || !knowledgeForm.solution.trim()) {
    return
  }
  loadingAction.value = 'knowledge'
  try {
    await ticketStore.createKnowledge(ticketId.value, {
      title: knowledgeForm.title.trim(),
      description: knowledgeForm.description.trim(),
      rootCause: knowledgeForm.rootCause.trim(),
      solution: knowledgeForm.solution.trim(),
      keywords: splitCsv(knowledgeKeywords.value),
      modules: splitCsv(knowledgeModules.value),
      errorCodes: splitCsv(knowledgeErrorCodes.value)
    })
    knowledgeDialogVisible.value = false
  } finally {
    loadingAction.value = null
  }
}

function splitCsv(value: string): string[] | undefined {
  const arr = value.split(',').map((s) => s.trim()).filter(Boolean)
  return arr.length ? arr : undefined
}

const statusMap: Record<TicketStatus, { label: string; type: any }> = {
  pending_analysis: { label: '待分析', type: 'info' },
  analyzing: { label: '分析中', type: 'warning' },
  pending_field_troubleshooting: { label: '待现场排查', type: 'primary' },
  field_troubleshooting: { label: '现场排查中', type: 'warning' },
  self_solved: { label: '已自助解决', type: 'success' },
  pending_rd: { label: '待研发介入', type: 'danger' },
  rd_working: { label: '研发处理中', type: 'warning' },
  resolved: { label: '已解决', type: 'success' }
}

function statusLabel(status: TicketStatus) {
  return statusMap[status]?.label || status
}

function statusType(status: TicketStatus) {
  return statusMap[status]?.type || 'info'
}

const impactLevelMap: Record<string, string> = {
  low: '低',
  medium: '中',
  high: '高',
  critical: '紧急'
}

function impactLevelLabel(level?: string) {
  return level ? impactLevelMap[level] || level : ''
}

const issueTypeMap: Record<string, string> = {
  positioning: '定位',
  laser: '激光',
  obstacle_avoidance: '避障',
  map: '地图',
  task_failure: '任务失败',
  charging: '充电',
  hardware_communication: '硬件通信',
  fork_sensor: '货叉/传感器',
  unknown: '未知'
}

function issueTypeLabel(type?: string) {
  return type ? issueTypeMap[type] || type : ''
}

function occurredTimeText(t: Ticket) {
  if (!t.occurredStartAt && !t.occurredEndAt) return ''
  if (t.occurredStartAt && t.occurredEndAt) return `${t.occurredStartAt} 至 ${t.occurredEndAt}`
  return t.occurredStartAt || t.occurredEndAt
}
</script>

<style scoped>
.detail-card {
  margin-bottom: 16px;
}
.detail-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.ticket-no {
  font-weight: 600;
  margin-right: 12px;
}
.ticket-title {
  color: #374151;
}
.section-title {
  margin: 20px 0 12px;
  font-weight: 600;
  font-size: 16px;
}
.actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}
.report-preview {
  margin-top: 16px;
  padding: 12px;
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 4px;
  max-height: 400px;
  overflow: auto;
}
.report-preview pre {
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
}
.event-payload {
  margin-top: 4px;
  font-size: 12px;
  color: #6b7280;
  white-space: pre-wrap;
}
.ai-section {
  margin-bottom: 16px;
}
.ai-conclusion {
  padding: 12px;
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 4px;
}
.ai-header {
  margin-bottom: 8px;
}
.ai-body {
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 14px;
  line-height: 1.6;
}
.version-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
  padding: 12px;
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 4px;
}
.version-info {
  margin-bottom: 16px;
}
.issue-type-cell {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
</style>
