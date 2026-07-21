<template>
  <div class="assistant-panel">
    <div class="assistant-toolbar">
      <el-tag :type="replay.assistantStatus?.enabled ? 'success' : 'warning'" size="small">
        {{ replay.assistantStatus?.enabled ? '模型在线' : '离线模式' }}
      </el-tag>
      <span class="muted">{{ providerLabel(replay.assistantStatus?.provider) }}</span>
      <span class="muted">{{ replay.assistantStatus?.model || '-' }}</span>
      <span class="muted">{{ replay.assistantStatus?.apiKeyMasked || '未配置 Key' }}</span>
      <span class="muted">向量块 {{ replay.assistantStatus?.vectorStore?.chunks || 0 }}</span>
      <el-button size="small" @click="refresh">刷新</el-button>
      <el-button size="small" @click="openConfigDialog">配置模型</el-button>
      <el-button size="small" @click="reindex">重建索引</el-button>
    </div>

    <div class="assistant-grid">
      <section class="assistant-section">
        <div class="quick-row">
          <el-button v-for="item in quickQuestions" :key="item" size="small" @click="useQuestion(item)">
            {{ item }}
          </el-button>
        </div>
        <el-input
          v-model="question"
          type="textarea"
          :rows="4"
          placeholder="输入你想问的日志问题"
        />
        <div class="assistant-options">
          <el-checkbox v-model="includeLogs">包含相关日志片段</el-checkbox>
          <span>日志行</span>
          <el-input-number v-model="maxLogLines" :min="0" :max="300" :step="20" size="small" />
          <span>知识块</span>
          <el-input-number v-model="maxKnowledge" :min="1" :max="20" size="small" />
        </div>
        <div class="assistant-actions">
          <el-button @click="previewContext">上下文预览</el-button>
          <el-button type="primary" :loading="replay.assistantLoading" @click="ask">提问</el-button>
          <el-button @click="replay.clearAssistantAnswer()">清空</el-button>
        </div>
        <el-alert
          v-if="replay.assistantError"
          type="error"
          :closable="false"
          :title="replay.assistantError"
        />
      </section>

      <section class="assistant-section">
        <div class="section-title">相似历史问题</div>
        <el-table :data="replay.assistantSimilarCases" height="300" size="small">
          <el-table-column label="相似度" width="78">
            <template #default="{ row }">{{ Math.round((row.score || 0) * 100) }}%</template>
          </el-table-column>
          <el-table-column label="标题" min-width="160" show-overflow-tooltip>
            <template #default="{ row }">{{ row.chunk?.source?.title || row.chunk?.summary || '-' }}</template>
          </el-table-column>
          <el-table-column label="来源" width="110">
            <template #default="{ row }">{{ sourceLabel(row.chunk?.source?.type) }}</template>
          </el-table-column>
          <el-table-column label="处理办法" min-width="180" show-overflow-tooltip>
            <template #default="{ row }">{{ row.chunk?.source?.solution || row.chunk?.metadata?.solution || '-' }}</template>
          </el-table-column>
          <el-table-column label="相似证据" min-width="220" show-overflow-tooltip>
            <template #default="{ row }">{{ similarEvidence(row) }}</template>
          </el-table-column>
        </el-table>
      </section>
    </div>

    <section v-if="replay.assistantAnswer" class="assistant-section">
      <div class="section-title">
        AI 辅助建议
        <el-tag v-if="replay.assistantAnswer.offline" size="small" type="warning">离线</el-tag>
        <el-tag v-else size="small" type="success">{{ providerLabel(replay.assistantAnswer.provider) }}</el-tag>
      </div>
      <p class="answer-text">{{ replay.assistantAnswer.answer }}</p>
      <el-descriptions :column="1" size="small" border>
        <el-descriptions-item label="可能根因">{{ joinList(replay.assistantAnswer.rootCauseCandidates) }}</el-descriptions-item>
        <el-descriptions-item label="处理建议">{{ joinList(replay.assistantAnswer.suggestions) }}</el-descriptions-item>
        <el-descriptions-item label="不确定点">{{ joinList(replay.assistantAnswer.uncertainties) }}</el-descriptions-item>
      </el-descriptions>
      <el-table :data="replay.assistantAnswer.evidence || []" height="220" size="small" class="assistant-table">
        <el-table-column prop="title" label="证据" width="180" show-overflow-tooltip />
        <el-table-column prop="source" label="来源" width="110" />
        <el-table-column prop="excerpt" label="片段" show-overflow-tooltip />
      </el-table>
      <div class="assistant-actions">
        <el-button size="small" @click="$emit('create-knowledge', buildKnowledgeDraftFromAnswer())">
          转为知识
        </el-button>
      </div>
    </section>

    <section v-if="replay.assistantContextPreview" class="assistant-section">
      <div class="section-title">上下文预览</div>
      <el-descriptions :column="4" size="small" border>
        <el-descriptions-item label="根因">{{ replay.assistantContextPreview.rootCauses?.length || 0 }}</el-descriptions-item>
        <el-descriptions-item label="知识命中">{{ replay.assistantContextPreview.knowledgeMatches?.length || 0 }}</el-descriptions-item>
        <el-descriptions-item label="相似块">{{ replay.assistantContextPreview.similarChunks?.length || 0 }}</el-descriptions-item>
        <el-descriptions-item label="日志片段">{{ replay.assistantContextPreview.logExcerpts?.length || 0 }}</el-descriptions-item>
      </el-descriptions>
      <pre class="context-preview">{{ previewText }}</pre>
    </section>

    <el-dialog v-model="configVisible" title="配置问诊模型" width="640px">
      <el-form label-width="110px" class="assistant-config-form">
        <el-form-item label="Provider">
          <el-select v-model="configForm.provider" @change="onProviderChange">
            <el-option value="deepseek" label="DeepSeek" />
            <el-option value="openai_compatible" label="OpenAI Compatible" />
          </el-select>
        </el-form-item>
        <el-form-item label="API Key">
          <el-input
            v-model="configForm.apiKey"
            type="password"
            show-password
            :placeholder="replay.assistantConfig?.apiKeyMasked ? `已配置：${replay.assistantConfig.apiKeyMasked}，留空不修改` : '请输入 API Key'"
          />
        </el-form-item>
        <el-form-item label="Base URL">
          <el-input v-model="configForm.baseUrl" />
        </el-form-item>
        <el-form-item label="Model">
          <el-input v-model="configForm.model" />
        </el-form-item>
        <el-form-item label="Timeout">
          <el-input-number v-model="configForm.timeoutMs" :min="1000" :step="1000" />
        </el-form-item>
        <el-form-item label="Max Tokens">
          <el-input-number v-model="configForm.maxTokens" :min="80" :step="100" />
        </el-form-item>
        <el-form-item label="Temperature">
          <el-input-number v-model="configForm.temperature" :min="0" :max="2" :step="0.1" />
        </el-form-item>
        <el-alert
          v-if="replay.assistantConfigTestResult"
          :type="replay.assistantConfigTestResult.succeed ? 'success' : 'error'"
          :closable="false"
          :title="replay.assistantConfigTestResult.succeed ? '测试连接成功' : replay.assistantConfigTestResult.error || '测试连接失败'"
        />
      </el-form>
      <template #footer>
        <el-button @click="configVisible = false">取消</el-button>
        <el-button type="warning" @click="clearConfig">清空本地配置</el-button>
        <el-button :loading="replay.assistantConfigTesting" @click="testConfig">测试连接</el-button>
        <el-button type="primary" :loading="replay.assistantConfigSaving" @click="saveConfig">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useReplayStore } from '@/stores/replay'

defineEmits<{
  (e: 'create-knowledge', draft: Record<string, any>): void
}>()

const replay = useReplayStore()
const question = ref('这次问题最可能是什么？')
const includeLogs = ref(true)
const maxLogLines = ref(80)
const maxKnowledge = ref(8)
const configVisible = ref(false)
const configForm = ref({
  provider: 'deepseek',
  apiKey: '',
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-chat',
  timeoutMs: 30000,
  maxTokens: 1200,
  temperature: 0.2
})
const quickQuestions = [
  '这次问题最可能是什么？',
  '帮我总结这份日志的问题链路',
  '这些错误码应该怎么处理？',
  '有没有历史相似案例？'
]

const previewText = computed(() => JSON.stringify(replay.assistantContextPreview, null, 2).slice(0, 6000))

onMounted(async () => {
  await refresh()
})

async function refresh() {
  try {
    await replay.refreshAssistantStatus()
    await replay.refreshAssistantConfig()
    await replay.refreshSimilarCases(question.value)
  } catch (e: any) {
    ElMessage.error(e && e.message ? e.message : String(e))
  }
}

async function openConfigDialog() {
  await replay.refreshAssistantConfig()
  const cfg = replay.assistantConfig || {}
  configForm.value = {
    provider: cfg.provider || 'deepseek',
    apiKey: '',
    baseUrl: cfg.baseUrl || 'https://api.deepseek.com',
    model: cfg.model || 'deepseek-chat',
    timeoutMs: cfg.timeoutMs || 30000,
    maxTokens: cfg.maxTokens || 1200,
    temperature: cfg.temperature ?? 0.2
  }
  replay.assistantConfigTestResult = null
  configVisible.value = true
}

function onProviderChange() {
  if (configForm.value.provider === 'deepseek') {
    configForm.value.baseUrl = 'https://api.deepseek.com'
    configForm.value.model = 'deepseek-chat'
  } else {
    configForm.value.baseUrl = 'https://api.openai.com/v1'
    configForm.value.model = 'gpt-4o-mini'
  }
}

async function testConfig() {
  try {
    await replay.testAssistantConfig(configPayload(true))
    ElMessage.success('测试连接成功')
  } catch (e: any) {
    ElMessage.error(e && e.message ? e.message : String(e))
  }
}

async function saveConfig() {
  try {
    await replay.saveAssistantConfig(configPayload(false))
    configVisible.value = false
    ElMessage.success('模型配置已保存')
  } catch (e: any) {
    ElMessage.error(e && e.message ? e.message : String(e))
  }
}

async function clearConfig() {
  await replay.clearAssistantConfig()
  configVisible.value = false
  ElMessage.success('本地模型配置已清空')
}

function configPayload(requireKey: boolean) {
  const payload: Record<string, any> = { ...configForm.value }
  if (!payload.apiKey && !requireKey) delete payload.apiKey
  return payload
}

async function reindex() {
  try {
    await replay.reindexAssistant()
    await replay.refreshSimilarCases(question.value)
    ElMessage.success('向量索引已重建')
  } catch (e: any) {
    ElMessage.error(e && e.message ? e.message : String(e))
  }
}

function useQuestion(value: string) {
  question.value = value
}

async function previewContext() {
  await replay.previewAssistantContext(question.value, buildOptions())
}

async function ask() {
  if (!question.value.trim()) {
    ElMessage.warning('请输入问题')
    return
  }
  await replay.askAssistant(question.value, buildOptions())
}

function buildOptions() {
  return {
    includeLogs: includeLogs.value,
    maxLogLines: maxLogLines.value,
    maxKnowledge: maxKnowledge.value
  }
}

function buildKnowledgeDraftFromAnswer() {
  const answer = replay.assistantAnswer || {}
  return {
    title: (answer.rootCauseCandidates || [])[0] || 'AI 辅助诊断知识',
    description: answer.answer || '',
    rootCause: (answer.rootCauseCandidates || []).join('\n'),
    solution: (answer.suggestions || []).join('\n'),
    severity: 'warning',
    tags: ['assistant'],
    enabled: true,
    verificationStatus: 'pending',
    examples: [{
      id: `assistant-${Date.now()}`,
      title: 'AI 证据',
      note: '由问诊助手建议生成，需人工确认后保存。',
      lines: (answer.evidence || []).map((item: any, index: number) => ({
        file: item.source || 'assistant',
        line: index + 1,
        timestamp: item.timestamp || '',
        timeMs: 0,
        module: item.source || 'assistant',
        sourceLine: null,
        level: 'UNKNOWN',
        message: item.excerpt || '',
        raw: item.excerpt || ''
      })),
      createdAt: new Date().toISOString()
    }],
    pattern: {
      requiredLineRegexes: [],
      requiredVehicleStates: [],
      requiredKeywords: [],
      anyKeywords: [],
      excludedKeywords: [],
      modules: [],
      levels: [],
      errorCodes: [],
      windowSeconds: 10,
      minOccurrences: 1,
      confidenceBase: 0.6,
      confidenceWeights: []
    }
  }
}

function sourceLabel(value: string) {
  const labels: Record<string, string> = {
    knowledge_rule: '知识规则',
    case_meta: '人工结论',
    knowledge_match: '当前命中',
    log_excerpt: '日志片段'
  }
  return labels[value] || value || '-'
}

function providerLabel(value: string) {
  const labels: Record<string, string> = {
    deepseek: 'DeepSeek',
    openai_compatible: 'OpenAI Compatible',
    offline: '离线'
  }
  return labels[value] || value || '-'
}

function joinList(value: string[]) {
  return (value || []).join('；') || '-'
}

function similarEvidence(row: any) {
  return (row.chunk?.source?.evidence || row.highlights || []).join('；') || row.chunk?.summary || '-'
}
</script>

<style scoped>
.assistant-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.assistant-toolbar,
.assistant-actions,
.assistant-options,
.quick-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.assistant-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(320px, 0.9fr);
  gap: 12px;
}

.assistant-section {
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  padding: 12px;
  background: #fff;
}

.section-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  margin-bottom: 10px;
}

.muted {
  color: #6b7280;
  font-size: 12px;
}

.answer-text {
  white-space: pre-wrap;
  line-height: 1.6;
  margin: 0 0 12px;
}

.assistant-table {
  margin-top: 12px;
}

.context-preview {
  max-height: 280px;
  overflow: auto;
  margin: 10px 0 0;
  padding: 10px;
  background: #f7f8fa;
  border-radius: 4px;
  font-size: 12px;
}

@media (max-width: 1100px) {
  .assistant-grid {
    grid-template-columns: 1fr;
  }
}
</style>
