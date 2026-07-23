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
            <el-descriptions-item label="车型">
              <span v-if="ticketStore.currentTicket.vehicleModelName">
                {{ ticketStore.currentTicket.vehicleCategoryName ? `${ticketStore.currentTicket.vehicleCategoryName} - ` : '' }}{{ ticketStore.currentTicket.vehicleModelName }}
              </span>
              <span v-else>-</span>
            </el-descriptions-item>
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
            <template v-if="ticketStore.currentTicket.status === 'self_solved'">
              <el-descriptions-item label="自助解决方式">{{ selfServiceResultLabel(ticketStore.currentTicket.selfServiceResult) || '-' }}</el-descriptions-item>
              <el-descriptions-item label="向导反馈">{{ guideFeedbackLabel(ticketStore.currentTicket.guideFeedback) || '-' }}</el-descriptions-item>
              <el-descriptions-item label="补充说明">{{ ticketStore.currentTicket.selfServiceNote || '-' }}</el-descriptions-item>
            </template>
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
            <el-button
              v-if="canReanalyze"
              :loading="loadingAction === 'reanalyze'"
              @click="onReanalyze"
            >重新分析</el-button>
            <el-button
              v-if="canAppendFiles"
              @click="openAppendDialog"
            >补充上传</el-button>
            <el-button
              v-if="canEditBasicInfo"
              @click="openBasicInfoDialog"
            >编辑基本信息</el-button>
            <el-button
              v-if="canCancelTicket"
              type="danger"
              :loading="loadingAction === 'cancel'"
              @click="openCancelDialog"
            >取消工单</el-button>
            <el-button
              v-if="auth.isAdmin"
              type="danger"
              plain
              :loading="loadingAction === 'delete'"
              @click="openDeleteDialog"
            >删除工单</el-button>
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
          <template v-if="event.action === 'comment'">
            <div class="event-comment">评论：{{ event.payload?.content }}</div>
          </template>
          <template v-else>
            {{ event.action }}
            <div v-if="event.payload" class="event-payload">{{ JSON.stringify(event.payload, null, 2) }}</div>
          </template>
        </el-timeline-item>
      </el-timeline>

      <div v-if="canComment" class="comment-section">
        <el-input
          v-model="commentContent"
          type="textarea"
          :rows="3"
          placeholder="输入评论内容"
          maxlength="2000"
          show-word-limit
        />
        <div class="comment-actions">
          <el-button type="primary" :loading="loadingAction === 'comment'" @click="onAddComment">发表评论</el-button>
        </div>
      </div>
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

    <el-dialog v-model="cancelDialogVisible" title="确认取消工单" width="400px">
      <p>取消后工单将变为“已取消”状态，不可再编辑或操作。是否确认？</p>
      <template #footer>
        <el-button @click="cancelDialogVisible = false">再想想</el-button>
        <el-button type="danger" :loading="loadingAction === 'cancel'" @click="onCancelTicket">确认取消</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="deleteDialogVisible" title="确认删除工单" width="450px">
      <p>工单 <strong>{{ ticketStore.currentTicket?.ticketNo }}</strong> 将被永久删除，不可恢复。</p>
      <p>关联的日志、报告、分析版本、排查路径等数据将全部清空。</p>
      <p>是否确认删除？</p>
      <template #footer>
        <el-button @click="deleteDialogVisible = false">再想想</el-button>
        <el-button type="danger" :loading="loadingAction === 'delete'" @click="onDeleteTicket">确认删除</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="basicInfoDialogVisible" title="编辑基本信息" width="600px">
      <el-form label-width="100px">
        <el-form-item label="标题">
          <el-input v-model="basicInfoForm.title" placeholder="一句话概括问题" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="basicInfoForm.description" type="textarea" :rows="4" placeholder="请简要描述当前遇到的问题" />
        </el-form-item>
        <el-form-item label="项目现场">
          <el-select v-model="basicInfoForm.siteId" placeholder="请选择项目现场" clearable style="width: 100%" :loading="loadingSites">
            <el-option v-for="site in sites" :key="site.id" :label="site.name" :value="site.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="影响程度">
          <el-select v-model="basicInfoForm.impactLevel" placeholder="请选择影响程度" clearable style="width: 100%">
            <el-option v-for="item in impactLevelOptions" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="发生时间">
          <el-date-picker
            v-model="basicInfoOccurredRange"
            type="datetimerange"
            range-separator="至"
            start-placeholder="开始时间"
            end-placeholder="结束时间"
            value-format="YYYY-MM-DDTHH:mm:ss"
            clearable
            style="width: 100%"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="basicInfoDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="loadingAction === 'basicInfo'" @click="onUpdateBasicInfo">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="appendDialogVisible" title="补充上传日志" width="600px">
      <el-upload
        v-model:file-list="appendFileList"
        action="#"
        :auto-upload="false"
        multiple
        :show-file-list="true"
        drag
        style="width: 100%"
      >
        <el-icon class="el-icon--upload"><upload-filled /></el-icon>
        <div class="el-upload__text">
          拖拽文件到此处或 <em>点击上传</em>
        </div>
        <template #tip>
          <div class="upload-tip">
            支持 .log、.zip、.tar.gz 格式，追加后日志总量不超过 200MB。
          </div>
        </template>
      </el-upload>
      <el-checkbox v-model="appendReanalyze" style="margin-top: 16px">上传后重新分析</el-checkbox>
      <template #footer>
        <el-button @click="appendDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="loadingAction === 'appendFiles'" @click="onAppendFiles">上传</el-button>
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
        <el-button type="primary" plain :loading="loadingAction === 'aiSuggest'" @click="onAiSuggestKnowledge">AI 预填</el-button>
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
import { listSites, type Site } from '@/api/sites'
import type { UploadUserFile } from 'element-plus'
import { ElMessage } from 'element-plus'
import AnalysisVersionDiff from '@/components/AnalysisVersionDiff.vue'
import TicketTroubleshootingGuide from '@/components/TicketTroubleshootingGuide.vue'
import TicketEvidencePanel from '@/components/TicketEvidencePanel.vue'
import { UploadFilled } from '@element-plus/icons-vue'

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
const cancelDialogVisible = ref(false)
const deleteDialogVisible = ref(false)
const basicInfoDialogVisible = ref(false)
const commentContent = ref('')
const commentError = ref('')
const appendDialogVisible = ref(false)
const appendFileList = ref<UploadUserFile[]>([])
const appendReanalyze = ref(false)
const loadingSites = ref(false)
const sites = ref<Site[]>([])
const basicInfoForm = reactive({
  title: '',
  description: '',
  siteId: undefined as number | undefined,
  impactLevel: undefined as string | undefined
})
const basicInfoOccurredRange = ref<[string, string] | null>(null)
const impactLevelOptions = [
  { label: '低', value: 'low' },
  { label: '中', value: 'medium' },
  { label: '高', value: 'high' },
  { label: '紧急', value: 'critical' }
]
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
  return (auth.isRd || auth.isAdmin) &&
    ['pending_field_troubleshooting', 'rd_working', 'resolved', 'self_solved'].includes(ticket.value.status)
})
const canReanalyze = computed(() => {
  if (!ticket.value) return false
  if (auth.isAfterSales) return ticket.value.reporterId === auth.user?.id && ['pending_analysis', 'pending_field_troubleshooting', 'field_troubleshooting', 'self_solved', 'resolved'].includes(ticket.value.status)
  return auth.isRd && ['pending_analysis', 'pending_field_troubleshooting', 'field_troubleshooting', 'self_solved', 'resolved'].includes(ticket.value.status)
})
const canEditIssueType = computed(() => {
  if (!ticket.value) return false
  return auth.isRd || auth.isAdmin || (auth.isAfterSales && ticket.value.reporterId === auth.user?.id)
})

const isTerminal = computed(() => {
  if (!ticket.value) return false
  return ['resolved', 'self_solved', 'cancelled'].includes(ticket.value.status)
})

const canCancelTicket = computed(() => {
  if (!ticket.value) return false
  return (
    ticket.value.reporterId === auth.user?.id &&
    ticket.value.status !== 'analyzing' &&
    !isTerminal.value
  )
})

const canEditBasicInfo = computed(() => {
  if (!ticket.value) return false
  return canEditIssueType.value && !isTerminal.value
})

const canComment = computed(() => {
  if (!ticket.value) return false
  return canEditIssueType.value
})

const canAppendFiles = computed(() => {
  if (!ticket.value) return false
  return canEditIssueType.value && !isTerminal.value
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

async function onReanalyze() {
  loadingAction.value = 'reanalyze'
  try {
    await ticketStore.analyzeTicket(ticketId.value)
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

function openCancelDialog() {
  cancelDialogVisible.value = true
}

async function onCancelTicket() {
  loadingAction.value = 'cancel'
  try {
    await ticketStore.cancelTicket(ticketId.value)
    cancelDialogVisible.value = false
  } finally {
    loadingAction.value = null
  }
}

function openDeleteDialog() {
  deleteDialogVisible.value = true
}

async function onDeleteTicket() {
  loadingAction.value = 'delete'
  try {
    await ticketStore.deleteTicket(ticketId.value)
    deleteDialogVisible.value = false
    router.push('/tickets')
  } finally {
    loadingAction.value = null
  }
}

async function loadSitesForEdit() {
  loadingSites.value = true
  try {
    sites.value = await listSites()
  } catch (e) {
    console.error('加载现场列表失败', e)
  } finally {
    loadingSites.value = false
  }
}

function openBasicInfoDialog() {
  const t = ticketStore.currentTicket
  if (!t) return
  basicInfoForm.title = t.title
  basicInfoForm.description = t.description
  basicInfoForm.siteId = t.siteId
  basicInfoForm.impactLevel = t.impactLevel
  basicInfoOccurredRange.value = t.occurredStartAt && t.occurredEndAt ? [t.occurredStartAt, t.occurredEndAt] : null
  void loadSitesForEdit()
  basicInfoDialogVisible.value = true
}

async function onUpdateBasicInfo() {
  if (!basicInfoForm.title.trim() || !basicInfoForm.description.trim()) return
  loadingAction.value = 'basicInfo'
  try {
    await ticketStore.updateTicketBasicInfo(ticketId.value, {
      title: basicInfoForm.title.trim(),
      description: basicInfoForm.description.trim(),
      siteId: basicInfoForm.siteId,
      impactLevel: basicInfoForm.impactLevel,
      occurredStartAt: basicInfoOccurredRange.value?.[0],
      occurredEndAt: basicInfoOccurredRange.value?.[1]
    })
    basicInfoDialogVisible.value = false
  } finally {
    loadingAction.value = null
  }
}

async function onAddComment() {
  const text = commentContent.value.trim()
  if (!text) {
    commentError.value = '评论内容不能为空'
    return
  }
  commentError.value = ''
  loadingAction.value = 'comment'
  try {
    await ticketStore.addTicketComment(ticketId.value, text)
    commentContent.value = ''
  } finally {
    loadingAction.value = null
  }
}

function openAppendDialog() {
  appendFileList.value = []
  appendReanalyze.value = false
  appendDialogVisible.value = true
}

async function onAppendFiles() {
  const rawFiles = appendFileList.value.map((f) => f.raw).filter(Boolean) as File[]
  if (rawFiles.length === 0) return
  loadingAction.value = 'appendFiles'
  try {
    await ticketStore.appendFiles(ticketId.value, rawFiles, appendReanalyze.value)
    appendDialogVisible.value = false
    appendFileList.value = []
    appendReanalyze.value = false
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
  const ticket = ticketStore.currentTicket
  const analysisVersion = ticketStore.currentAnalysisVersion

  knowledgeForm.title = ticket?.title || ''
  knowledgeForm.description = ticket?.description || ''
  knowledgeForm.rootCause = analysisVersion?.topIssues?.[0]?.title || ''
  if (ticket?.status === 'self_solved') {
    const resultText = selfServiceResultLabel(ticket.selfServiceResult) || ticket.selfServiceResult || ''
    const noteText = ticket.selfServiceNote || ''
    knowledgeForm.solution = [resultText, noteText].filter(Boolean).join('；')
  } else {
    knowledgeForm.solution = ticket?.conclusion || ''
  }

  const keywords: string[] = []
  analysisVersion?.topIssues?.forEach((issue: { title?: string }) => {
    if (issue.title) keywords.push(issue.title)
  })
  knowledgeKeywords.value = keywords.join(',')
  knowledgeModules.value = ''
  knowledgeErrorCodes.value = ''
  knowledgeDialogVisible.value = true
}

async function onAiSuggestKnowledge() {
  loadingAction.value = 'aiSuggest'
  try {
    const suggestion = await ticketStore.getKnowledgeSuggestions(ticketId.value)
    if (suggestion.title && !knowledgeForm.title.trim()) {
      knowledgeForm.title = suggestion.title
    }
    if (suggestion.description && !knowledgeForm.description.trim()) {
      knowledgeForm.description = suggestion.description
    }
    if (suggestion.rootCause && !knowledgeForm.rootCause.trim()) {
      knowledgeForm.rootCause = suggestion.rootCause
    }
    if (suggestion.solution && !knowledgeForm.solution.trim()) {
      knowledgeForm.solution = suggestion.solution
    }
    if (suggestion.keywords?.length) {
      const existing = splitCsv(knowledgeKeywords.value) || []
      const merged = Array.from(new Set([...existing, ...suggestion.keywords]))
      knowledgeKeywords.value = merged.join(',')
    }
    if (suggestion.modules?.length) {
      const existing = splitCsv(knowledgeModules.value) || []
      const merged = Array.from(new Set([...existing, ...suggestion.modules]))
      knowledgeModules.value = merged.join(',')
    }
    if (suggestion.errorCodes?.length) {
      const existing = splitCsv(knowledgeErrorCodes.value) || []
      const merged = Array.from(new Set([...existing, ...suggestion.errorCodes]))
      knowledgeErrorCodes.value = merged.join(',')
    }
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : 'AI 预填失败')
  } finally {
    loadingAction.value = null
  }
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
  analyzing: { label: '分析中', type: '' },
  pending_field_troubleshooting: { label: '待现场排查', type: 'warning' },
  field_troubleshooting: { label: '现场排查中', type: 'warning' },
  self_solved: { label: '已自助解决', type: 'success' },
  pending_rd: { label: '待研发介入', type: 'danger' },
  rd_working: { label: '研发处理中', type: 'danger' },
  resolved: { label: '已解决', type: 'success' },
  cancelled: { label: '已取消', type: 'info' }
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

function selfServiceResultLabel(value?: string) {
  return selfServiceResults.find((item) => item.value === value)?.label || value
}

function guideFeedbackLabel(value?: string) {
  return guideFeedbacks.find((item) => item.value === value)?.label || value
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
  font-weight: 700;
  font-size: 15px;
  color: #2563eb;
  margin-right: 12px;
}
.ticket-title {
  color: #1e293b;
  font-weight: 500;
}
.section-title {
  margin: 24px 0 12px;
  font-weight: 600;
  font-size: 15px;
  color: #1e293b;
  padding-left: 10px;
  border-left: 3px solid #2563eb;
}
.section-title:first-child {
  margin-top: 0;
}
.actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}
.report-preview {
  margin-top: 16px;
  padding: 14px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
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
  color: #64748b;
  white-space: pre-wrap;
}
.ai-section {
  margin-bottom: 16px;
}
.ai-conclusion {
  padding: 16px;
  background: linear-gradient(135deg, #f0f9ff 0%, #f8fafc 100%);
  border: 1px solid #bfdbfe;
  border-radius: 8px;
}
.ai-header {
  margin-bottom: 8px;
}
.ai-body {
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 14px;
  line-height: 1.7;
  color: #334155;
}
.version-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
  padding: 12px 16px;
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  border-radius: 8px;
}
.version-info {
  margin-bottom: 16px;
}
.issue-type-cell {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.comment-section {
  margin-top: 16px;
  padding: 14px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
}
.comment-actions {
  margin-top: 12px;
  display: flex;
  justify-content: flex-end;
}
.event-comment {
  color: #374151;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
