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

      <el-descriptions :column="2" border>
        <el-descriptions-item label="描述">{{ ticketStore.currentTicket.description }}</el-descriptions-item>
        <el-descriptions-item label="创建时间">{{ ticketStore.currentTicket.createdAt }}</el-descriptions-item>
        <el-descriptions-item label="更新时间">{{ ticketStore.currentTicket.updatedAt }}</el-descriptions-item>
        <el-descriptions-item label="自动分析结论">
          {{ ticketStore.currentTicket.conclusion || '暂无' }}
        </el-descriptions-item>
      </el-descriptions>

      <div class="section-title">操作</div>
      <div class="actions">
        <el-button
          v-if="canVerify"
          type="success"
          :loading="loadingAction === 'resolved'"
          @click="onVerify('resolved')"
        >确认已解决</el-button>
        <el-button
          v-if="canVerify"
          type="danger"
          :loading="loadingAction === 'needs_rd'"
          @click="onVerify('needs_rd')"
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
          v-if="canResolve"
          type="primary"
          :loading="loadingAction === 'knowledge'"
          @click="openKnowledgeDialog"
        >沉淀到知识库</el-button>
        <el-button v-if="ticketStore.currentTicket.reportPath" @click="loadReport">查看报告</el-button>
      </div>

      <div v-if="reportHtml" class="report-preview">
        <pre>{{ reportHtml }}</pre>
      </div>

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
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useTicketStore } from '@/stores/tickets'
import { getTicketReport, type TicketStatus } from '@/api/tickets'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const ticketStore = useTicketStore()
const ticketId = computed(() => Number(route.params.id))

const loadingAction = ref<string | null>(null)
const reportHtml = ref('')
const resolveDialogVisible = ref(false)
const solution = ref('')
const knowledgeDialogVisible = ref(false)
const knowledgeForm = reactive({
  title: '',
  description: '',
  rootCause: '',
  solution: ''
})
const knowledgeKeywords = ref('')
const knowledgeModules = ref('')
const knowledgeErrorCodes = ref('')

onMounted(() => {
  ticketStore.loadTicket(ticketId.value)
})

const ticket = computed(() => ticketStore.currentTicket)
const canVerify = computed(() => {
  if (!ticket.value) return false
  return auth.isAfterSales && ['analyzed', 'needs_rd'].includes(ticket.value.status)
})
const canAssign = computed(() => {
  if (!ticket.value) return false
  return auth.isRd && ticket.value.status === 'needs_rd'
})
const canResolve = computed(() => {
  if (!ticket.value) return false
  return auth.isRd && (ticket.value.status === 'verifying' || ticket.value.status === 'needs_rd')
})

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
  } finally {
    loadingAction.value = null
  }
}

async function loadReport() {
  reportHtml.value = await getTicketReport(ticketId.value)
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
  analyzed: { label: '待验证', type: 'primary' },
  verifying: { label: '处理中', type: 'warning' },
  resolved: { label: '已解决', type: 'success' },
  needs_rd: { label: '需研发介入', type: 'danger' }
}

function statusLabel(status: TicketStatus) {
  return statusMap[status]?.label || status
}

function statusType(status: TicketStatus) {
  return statusMap[status]?.type || 'info'
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
</style>
