<template>
  <div class="replay-page">
    <el-card shadow="never" class="load-band">
      <el-form :inline="true" label-width="78px">
        <el-form-item label="日志目录">
          <el-input v-model="replay.logDir" class="path-input" />
        </el-form-item>
        <el-form-item label="地图目录">
          <el-input v-model="replay.mapDir" class="path-input" />
        </el-form-item>
        <el-form-item label="地图文件">
          <el-input v-model="replay.mapFile" class="path-input" placeholder="自动匹配失败时填写" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="replay.loading" @click="load">加载诊断</el-button>
          <el-button :loading="replay.loading" @click="load(true)">重新解析</el-button>
          <el-button :disabled="!replay.loaded" @click="openReport('md')">Markdown</el-button>
          <el-button :disabled="!replay.loaded" @click="openReport('json')">JSON</el-button>
          <el-button :disabled="!replay.loaded" @click="openPackageExport">导出诊断包</el-button>
          <el-button @click="triggerPackageImport">导入诊断包</el-button>
          <el-button @click="refreshCache">缓存 {{ cacheText }}</el-button>
          <el-button type="warning" plain @click="clearCache">清理缓存</el-button>
          <input ref="packageInput" class="hidden-input" type="file" accept=".zip" @change="onPackageSelected" />
        </el-form-item>
      </el-form>
    </el-card>

    <el-row :gutter="12" class="overview-row">
      <el-col :span="4" v-for="item in overviewItems" :key="item.label">
        <el-card shadow="never" class="metric">
          <div class="metric-label">{{ item.label }}</div>
          <div class="metric-value">{{ item.value }}</div>
        </el-card>
      </el-col>
    </el-row>

    <el-card shadow="never" class="info-band">
      <div class="info-line">
        <span>车辆：{{ replay.overview?.robotName || '-' }}</span>
        <span>地图：{{ replay.overview?.mapName || '-' }}</span>
        <span>分支：{{ replay.overview?.branch || '-' }}</span>
      </div>
      <div class="tag-line">
        <el-tag :type="replay.overview?.hasMap ? 'success' : 'danger'">地图{{ replay.overview?.hasMap ? '已加载' : '缺失' }}</el-tag>
        <el-tag :type="replay.overview?.hasFrames ? 'success' : 'danger'">回放帧{{ replay.overview?.hasFrames ? '可用' : '缺失' }}</el-tag>
        <el-tag :type="replay.overview?.hasTasks ? 'success' : 'warning'">任务 ID {{ replay.overview?.hasTasks ? '可用' : '缺失' }}</el-tag>
        <el-tag :type="replay.overview?.hasErrorDefinitions ? 'success' : 'warning'">错误码定义{{ replay.overview?.hasErrorDefinitions ? '可用' : '缺失' }}</el-tag>
        <el-tag :type="mapMatchType">地图匹配 {{ mapMatchText }}</el-tag>
        <el-tag :type="(replay.overview?.dataWarnings || []).length ? 'warning' : 'success'">数据提醒 {{ (replay.overview?.dataWarnings || []).length }}</el-tag>
        <el-tag type="info">[E] {{ replay.overview?.errorLogCount || 0 }}</el-tag>
        <el-tag type="info">[W] {{ replay.overview?.warningLogCount || 0 }}</el-tag>
      </div>
      <div v-if="(replay.overview?.dataWarnings || []).length" class="warning-line">
        <span v-for="item in replay.overview.dataWarnings" :key="item">{{ item }}</span>
        <el-button v-if="canConfirmMapAlias" size="small" type="warning" plain @click="confirmMapAlias">
          确认使用此地图
        </el-button>
      </div>
    </el-card>

    <el-card v-if="rootCauses.length" shadow="never" class="root-cause-band">
      <template #header>诊断结论</template>
      <el-collapse>
        <el-collapse-item v-for="cause in rootCauses" :key="cause.id" :name="cause.id">
          <template #title>
            <span class="cause-title">{{ cause.title }}</span>
            <el-tag size="small" :type="cause.severity === 'error' ? 'danger' : 'warning'">
              {{ Math.round((cause.confidence || 0) * 100) }}%
            </el-tag>
          </template>
          <div class="cause-body">
            <div>{{ cause.suggestion }}</div>
            <div class="cause-actions">
              <el-button size="small" @click="jumpFirstEvidence(cause)">跳转证据</el-button>
              <el-button size="small" type="success" plain @click="sendCauseFeedback(cause.id, 'useful')">有用</el-button>
              <el-button size="small" type="warning" plain @click="sendCauseFeedback(cause.id, 'false_positive')">误报</el-button>
            </div>
            <pre>{{ causeEvidenceText(cause) }}</pre>
          </div>
        </el-collapse-item>
      </el-collapse>
    </el-card>

    <el-row :gutter="12" class="main-row">
      <el-col :span="15" class="main-col">
        <el-card shadow="never" class="map-card">
          <template #header>
            <div class="play-head">
              <div class="card-head">
                <span>地图回放</span>
                <div class="play-tools">
                  <el-button size="small" :disabled="!replay.loaded" @click="onPlay">播放</el-button>
                  <el-button size="small" :disabled="!replay.loaded" @click="onPause">暂停</el-button>
                  <el-segmented
                    v-model="replay.mode"
                    size="small"
                    :options="modeOptions"
                    :disabled="!replay.loaded"
                    @change="onModeChange"
                  />
                  <el-select v-model="replay.speed" size="small" class="speed-select" @change="replay.setSpeed">
                    <el-option :value="0.5" label="0.5x" />
                    <el-option :value="1" label="1x" />
                    <el-option :value="2" label="2x" />
                    <el-option :value="5" label="5x" />
                  </el-select>
                  <el-checkbox v-model="smoothTrajectory" size="small">平滑轨迹</el-checkbox>
                </div>
              </div>
              <div class="progress-row">
                <span class="time-text">{{ currentReplayTime }}</span>
                <div class="progress-wrap">
                  <el-slider
                    v-model="progressValue"
                    :min="0"
                    :max="progressMax"
                    :step="replay.mode === 'frame_compact' ? 1 : 100"
                    :disabled="!replay.loaded"
                    :show-tooltip="false"
                    class="progress-slider"
                    @change="onProgressChange"
                  />
                  <button
                    v-for="marker in progressMarkers"
                    :key="marker.id"
                    class="progress-marker"
                    :class="marker.level"
                    :style="{ left: marker.left }"
                    :title="marker.title"
                    @click.stop="jump(marker.timeMs)"
                  >{{ marker.count > 1 ? marker.count : '' }}</button>
                </div>
                <span class="time-text">{{ totalReplayTime }}</span>
              </div>
            </div>
          </template>
          <CanvasView
            :show-map="true"
            :trajectory="trajectory"
            :event-points="eventPoints"
            @select-replay-point="onReplayPointSelect"
          />
          <div v-if="selectedReplayPoint" class="point-popover">
            <div class="point-popover-head">
              <span>轨迹点详情</span>
              <button @click="selectedReplayPoint = null">×</button>
            </div>
            <div>时间：{{ selectedReplayPoint.timestamp || '-' }}</div>
            <div>位置：{{ Number(selectedReplayPoint.x).toFixed(0) }}, {{ Number(selectedReplayPoint.y).toFixed(0) }}</div>
            <div>状态：{{ selectedReplayPoint.status || '-' }}</div>
            <div>任务：{{ selectedReplayPoint.taskId || '-' }}</div>
            <div>电量：{{ selectedReplayPoint.battery ?? '-' }}</div>
            <div>定位分：{{ selectedReplayPoint.score ?? '-' }}</div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="9" class="main-col">
        <el-card shadow="never" class="side-card">
          <template #header>当前状态 / Top 问题</template>
          <el-descriptions :column="2" size="small" border class="current-box">
            <el-descriptions-item label="时间">{{ currentFrame?.timestamp || '-' }}</el-descriptions-item>
            <el-descriptions-item label="状态">{{ currentFrame?.status || '-' }}</el-descriptions-item>
            <el-descriptions-item label="任务">{{ currentFrame?.taskId || '-' }}</el-descriptions-item>
            <el-descriptions-item label="电量">{{ currentFrame?.battery ?? '-' }}</el-descriptions-item>
            <el-descriptions-item label="定位分">{{ currentFrame?.score ?? '-' }}</el-descriptions-item>
            <el-descriptions-item label="货叉">{{ currentFrame?.forkHeight ?? '-' }}</el-descriptions-item>
          </el-descriptions>
          <el-empty v-if="topIssues.length === 0" description="暂无问题" />
          <el-timeline v-else>
            <el-timeline-item
              v-for="event in topIssues"
              :key="event.id"
              :timestamp="event.timestamp"
              :type="event.level === 'error' ? 'danger' : 'warning'"
            >
              <button class="link-btn" @click="jump(event.timeMs)">{{ event.title }}</button>
              <div class="event-detail">{{ event.detail }}</div>
            </el-timeline-item>
          </el-timeline>
        </el-card>
      </el-col>
    </el-row>

    <ReplayCharts
      v-if="replay.frames.length"
      class="charts-row"
      :frames="replay.frames"
      :errors="replay.errorOccurrences"
      @select-time="jump"
    />

    <el-card shadow="never" class="tabs-card">
      <el-tabs>
        <el-tab-pane label="时间线">
          <div class="filter-row">
            <el-select v-model="replay.eventFilter" clearable placeholder="事件类型" class="filter-item">
              <el-option v-for="type in eventTypes" :key="type" :value="type" :label="type" />
            </el-select>
            <el-tag v-if="selectedTaskId" closable @close="clearTaskSelection">任务 {{ selectedTaskId }}</el-tag>
          </div>
          <el-table :data="filteredEvents" height="320" size="small" @row-click="(row:any) => jump(row.timeMs)">
            <el-table-column type="expand">
              <template #default="{ row }">
                <div class="context-box">
                  <div class="context-title">前后日志</div>
                  <pre>{{ contextText(row) }}</pre>
                </div>
              </template>
            </el-table-column>
            <el-table-column prop="timestamp" label="时间" width="180" />
            <el-table-column prop="level" label="级别" width="80" />
            <el-table-column prop="category" label="类型" width="120" />
            <el-table-column prop="title" label="标题" width="180" />
            <el-table-column prop="detail" label="详情" show-overflow-tooltip />
          </el-table>
        </el-tab-pane>
        <el-tab-pane label="错误码中心">
          <el-table :data="replay.errorSummaries" height="160" size="small" @row-click="selectErrorSummary">
            <el-table-column prop="code" label="错误码" width="110" />
            <el-table-column prop="count" label="次数" width="70" />
            <el-table-column prop="realCount" label="真实" width="70" />
            <el-table-column prop="configNoticeCount" label="配置" width="70" />
            <el-table-column prop="level" label="等级" width="70" />
            <el-table-column label="来源" width="90">
              <template #default="{ row }">{{ row.occurrences?.[0]?.definition?.source || '-' }}</template>
            </el-table-column>
            <el-table-column label="置信度" width="80">
              <template #default="{ row }">{{ confidenceText(row.occurrences?.[0]?.definition?.dictionaryConfidence) }}</template>
            </el-table-column>
            <el-table-column prop="firstTime" label="首次" width="180" />
            <el-table-column prop="lastTime" label="末次" width="180" />
            <el-table-column prop="description" label="描述" show-overflow-tooltip />
          </el-table>
          <el-table :data="selectedErrorOccurrences" height="160" size="small" @row-click="(row:any) => jump(row.timeMs)">
            <el-table-column prop="timestamp" label="时间" width="180" />
            <el-table-column prop="code" label="错误码" width="110" />
            <el-table-column prop="source" label="来源" width="170" />
            <el-table-column prop="kind" label="类型" width="110" />
            <el-table-column prop="definition.description" label="说明" show-overflow-tooltip />
          </el-table>
        </el-tab-pane>
        <el-tab-pane label="任务视角">
          <el-table :data="replay.tasks" height="320" size="small" @row-click="selectTask">
            <el-table-column prop="id" label="任务" width="160" />
            <el-table-column prop="startTime" label="开始" width="180" />
            <el-table-column prop="endTime" label="结束" width="180" />
            <el-table-column prop="status" label="状态" width="120" />
            <el-table-column prop="lastFinishedTaskId" label="完成任务" width="120" />
            <el-table-column prop="lastFinishedTaskSuccess" label="成功" width="80" />
            <el-table-column prop="unfinishedPath" label="未完成路径" show-overflow-tooltip />
            <el-table-column prop="failureReasonCandidates" label="失败候选" show-overflow-tooltip />
            <el-table-column prop="errors" label="错误" show-overflow-tooltip />
          </el-table>
        </el-tab-pane>
        <el-tab-pane label="原始日志/过滤">
          <div class="filter-row">
            <el-select v-model="replay.logFilter.level" clearable placeholder="级别" class="filter-item">
              <el-option value="E" label="E" />
              <el-option value="W" label="W" />
              <el-option value="I" label="I" />
              <el-option value="D" label="D" />
            </el-select>
            <el-input v-model="replay.logFilter.module" placeholder="模块" class="filter-item" />
            <el-input v-model="replay.logFilter.keyword" placeholder="关键词" class="filter-item" />
            <el-input v-model="replay.logFilter.errorCode" placeholder="错误码" class="filter-item" />
            <el-input v-model="replay.logFilter.taskId" placeholder="任务 ID" class="filter-item" />
            <el-input-number
              v-model="replay.logFilter.startMs"
              :min="0"
              :controls="false"
              placeholder="开始时间戳"
              class="number-filter"
            />
            <el-input-number
              v-model="replay.logFilter.endMs"
              :min="0"
              :controls="false"
              placeholder="结束时间戳"
              class="number-filter"
            />
            <el-input-number
              v-model="replay.logFilter.aroundTimeMs"
              :min="0"
              :controls="false"
              placeholder="中心时间戳"
              class="number-filter"
            />
            <el-input-number
              v-model="replay.logFilter.aroundLines"
              :min="0"
              :max="500"
              :controls="false"
              placeholder="上下文行"
              class="number-filter"
            />
            <el-select v-model="replay.logFilter.noise" clearable placeholder="噪声" class="filter-item">
              <el-option value="true" label="只看噪声" />
              <el-option value="false" label="排除噪声" />
            </el-select>
            <el-select v-model="replay.logFilter.important" clearable placeholder="关键事件" class="filter-item">
              <el-option value="true" label="只看关键" />
            </el-select>
            <el-button @click="replay.refreshLogs">过滤</el-button>
            <el-button @click="loadCurrentTimeLogs">当前时间上下文</el-button>
            <el-button :disabled="!replay.logCopyText" @click="copyLogContext">复制上下文</el-button>
          </div>
          <div class="fold-row">
            <el-tag v-for="fold in replay.folded" :key="fold.id" type="info" class="fold-tag" @click="openFoldDetail(fold)">
              {{ fold.label }} x{{ fold.count }}
            </el-tag>
          </div>
          <el-table :data="replay.logs" height="260" size="small">
            <el-table-column prop="timestamp" label="时间" width="180" />
            <el-table-column prop="level" label="级别" width="70" />
            <el-table-column prop="module" label="模块" width="130" />
            <el-table-column prop="message" label="内容" show-overflow-tooltip />
          </el-table>
          <el-pagination
            class="pager"
            layout="prev, pager, next, total"
            :total="replay.logTotal"
            :page-size="replay.logFilter.limit"
            @current-change="replay.changeLogPage"
          />
        </el-tab-pane>
      </el-tabs>
    </el-card>

    <el-dialog v-model="foldDialogVisible" title="折叠日志详情" width="720px">
      <el-descriptions v-if="selectedFold" :column="2" size="small" border>
        <el-descriptions-item label="类型">{{ selectedFold.label }}</el-descriptions-item>
        <el-descriptions-item label="数量">{{ selectedFold.count }}</el-descriptions-item>
        <el-descriptions-item label="首次">{{ selectedFold.firstTime }}</el-descriptions-item>
        <el-descriptions-item label="末次">{{ selectedFold.lastTime }}</el-descriptions-item>
      </el-descriptions>
      <div v-if="selectedFold" class="fold-detail">
        <div class="context-title">首条日志</div>
        <pre>{{ selectedFold.firstLine?.raw || '-' }}</pre>
        <div class="context-title">末条日志</div>
        <pre>{{ selectedFold.lastLine?.raw || '-' }}</pre>
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { ElMessage } from 'element-plus'
import CanvasView from '@/components/CanvasView.vue'
import ReplayCharts from '@/components/replay/ReplayCharts.vue'
import { getReplayMap, replayPackageUrl, replayReportUrl } from '@/api/replay'
import { useReplayStore } from '@/stores/replay'
import { useRobotStore } from '@/stores/robot'

const replay = useReplayStore()
const robot = useRobotStore()
const progressValue = ref(0)
const selectedTaskId = ref('')
const selectedReplayPoint = ref<any>(null)
const selectedFold = ref<any>(null)
const foldDialogVisible = ref(false)
const smoothTrajectory = ref(false)
const packageInput = ref<HTMLInputElement | null>(null)
let progressTimer = 0

const overviewItems = computed(() => {
  const o = replay.overview || {}
  return [
    { label: '时间范围', value: o.startTime ? `${o.startTime.slice(11)}-${o.endTime?.slice(11)}` : '-' },
    { label: '日志文件', value: o.files ?? '-' },
    { label: '回放帧', value: o.frameCount ?? '-' },
    { label: '任务数', value: o.taskCount ?? '-' },
    { label: '错误事件', value: o.errorCount ?? '-' },
    { label: '错误码', value: o.errorCodeCount ?? '-' }
  ]
})

const topIssues = computed(() => (replay.overview?.topIssues || []).slice(0, 5))
const rootCauses = computed(() => (replay.overview?.rootCauses || []).slice(0, 3))
const cacheText = computed(() => {
  const cache = replay.cacheSummary
  if (!cache) return '-'
  return `${cache.files || 0} 个 / ${formatBytes(cache.bytes || 0)}`
})
const mapMatchText = computed(() => {
  const match = replay.overview?.mapMatch
  if (!match) return '-'
  return `${matchLabel(match.matchStrategy)} ${Math.round((match.confidence || 0) * 100)}%`
})
const mapMatchType = computed(() => {
  const confidence = replay.overview?.mapMatch?.confidence || 0
  if (confidence >= 0.8) return 'success'
  if (confidence > 0) return 'warning'
  return 'danger'
})
const canConfirmMapAlias = computed(() => {
  const match = replay.overview?.mapMatch
  return !!match?.detectedMapName && !!match?.selectedMapFile && !match.aliasMatched && (match.confidence || 0) < 0.8
})
const modeOptions = [
  { label: '真实时间', value: 'realtime' },
  { label: '按状态帧', value: 'frame_compact' }
]
const progressMax = computed(() =>
  replay.mode === 'frame_compact' ? Math.max(0, replay.frames.length - 1) : Math.max(0, replay.durationMs)
)
const currentReplayTime = computed(() =>
  replay.mode === 'frame_compact'
    ? `${Math.min(replay.currentFrameIndex + 1, replay.frames.length)}/${replay.frames.length || 0}`
    : formatDuration(Math.max(0, replay.currentMs - replay.startMs))
)
const totalReplayTime = computed(() => (replay.mode === 'frame_compact' ? '帧' : formatDuration(replay.durationMs)))
const trajectory = computed(() =>
  (smoothTrajectory.value ? smoothFrames(replay.frames) : replay.frames)
    .map((it, index) => ({ x: it.x, y: it.y, timeMs: it.timeMs, frameIndex: index, taskId: it.taskId }))
    .filter((it) => !selectedTaskId.value || it.taskId === selectedTaskId.value)
)
const eventTypes = computed(() => Array.from(new Set(replay.events.map((it) => it.category || it.type).filter(Boolean))))
const progressMarkers = computed(() =>
  aggregateMarkers(replay.events
    .filter((event) => event.level === 'error' || event.type === 'task' || ['lost', 'estop', 'loc_score'].includes(event.category))
  )
)
const filteredEvents = computed(() =>
  replay.events
    .filter((it) => !replay.eventFilter || (it.category || it.type) === replay.eventFilter)
    .filter((it) => !selectedTaskId.value || it.taskId === selectedTaskId.value)
)
const currentFrame = computed(() => {
  if (replay.frames.length === 0) return null
  let best = replay.frames[0]
  for (const frame of replay.frames) {
    if (frame.timeMs <= replay.currentMs) best = frame
    else break
  }
  return best
})
const eventPoints = computed(() =>
  replay.events
    .filter((it) => it.level === 'error' || it.type === 'task')
    .map((event) => {
      const frame = nearestFrame(event.timeMs) as any
      return frame ? { ...frame, title: event.title, level: event.level } : null
    })
    .filter(Boolean)
    .map((frame: any) => ({ x: frame.x, y: frame.y, timeMs: frame.timeMs, frameIndex: frame.frameIndex, title: frame.title, level: frame.level }))
)
const selectedErrorOccurrences = computed(() => {
  return replay.errorOccurrences
    .filter((it) => !replay.selectedErrorCode || it.code === replay.selectedErrorCode)
    .filter((it) => !selectedTaskId.value || it.taskId === selectedTaskId.value)
})

async function load(forceReload = false) {
  try {
    robot.disconnectWs()
    await replay.loadSession(forceReload)
    robot.map = await getReplayMap()
    robot.connectWs('replay')
    syncProgressValue()
    startProgressTimer()
    ElMessage.success('日志诊断已加载')
  } catch (e: any) {
    ElMessage.error(e && e.message ? e.message : String(e))
  }
}

async function confirmMapAlias() {
  try {
    await replay.saveCurrentMapAlias()
    ElMessage.success('地图别名已保存，正在重新解析')
    await load(true)
  } catch (e: any) {
    ElMessage.error(e && e.message ? e.message : String(e))
  }
}

async function refreshCache() {
  try {
    await replay.refreshCacheSummary()
  } catch (e: any) {
    ElMessage.error(e && e.message ? e.message : String(e))
  }
}

async function clearCache() {
  try {
    await replay.clearCache()
    ElMessage.success('缓存已清理')
  } catch (e: any) {
    ElMessage.error(e && e.message ? e.message : String(e))
  }
}

function jumpFirstEvidence(cause: any) {
  const event = cause.evidenceEvents?.[0]
  const line = cause.evidenceLines?.[0]
  if (event?.timeMs) jump(event.timeMs)
  else if (line?.timeMs) jump(line.timeMs)
}

async function sendCauseFeedback(id: string, verdict: 'useful' | 'false_positive') {
  try {
    await replay.sendRootCauseFeedback(id, verdict)
    ElMessage.success('反馈已记录')
  } catch (e: any) {
    ElMessage.error(e && e.message ? e.message : String(e))
  }
}

function causeEvidenceText(cause: any) {
  const events = (cause.evidenceEvents || []).slice(0, 3).map((event: any) => `${event.timestamp} ${event.title}: ${event.detail}`)
  const lines = (cause.evidenceLines || []).slice(0, 3).map((line: any) => line.raw)
  return [...events, ...lines].join('\n')
}

function jump(timeMs: number) {
  replay.seek(timeMs)
  syncProgressValue()
}

async function selectTask(row: any) {
  selectedTaskId.value = row.id
  replay.logFilter.taskId = row.id
  await replay.refreshLogs()
  jump(row.startMs)
}

async function clearTaskSelection() {
  selectedTaskId.value = ''
  replay.logFilter.taskId = ''
  await replay.refreshLogs()
}

async function loadCurrentTimeLogs() {
  replay.logFilter.aroundTimeMs = replay.currentMs
  replay.logFilter.aroundLines = replay.logFilter.aroundLines || 20
  replay.logFilter.offset = 0
  await replay.refreshLogs()
}

async function copyLogContext() {
  try {
    await navigator.clipboard.writeText(replay.logCopyText || '')
    ElMessage.success('日志上下文已复制')
  } catch (e: any) {
    ElMessage.error(e && e.message ? e.message : String(e))
  }
}

function openFoldDetail(fold: any) {
  selectedFold.value = fold
  foldDialogVisible.value = true
}

async function onReplayPointSelect(point: any) {
  selectedReplayPoint.value = nearestFrame(point.timeMs) || point
  if (Number.isFinite(Number(point.frameIndex)) && replay.mode === 'frame_compact') {
    await replay.seekFrame(Number(point.frameIndex))
  } else if (Number.isFinite(Number(point.timeMs))) {
    await replay.seek(Number(point.timeMs))
  }
  syncProgressValue()
}

function openReport(kind: 'md' | 'json') {
  window.open(replayReportUrl(kind), '_blank')
}

function openPackageExport() {
  window.open(replayPackageUrl(), '_blank')
}

function triggerPackageImport() {
  packageInput.value?.click()
}

async function onPackageSelected(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  try {
    const content = await fileToBase64(file)
    const res = await replay.importPackage(file.name, content)
    robot.map = await getReplayMap()
    robot.connectWs('replay')
    syncProgressValue()
    ElMessage.success(`诊断包已导入：${res.package?.manifest?.robotName || file.name}`)
  } catch (e: any) {
    ElMessage.error(e && e.message ? e.message : String(e))
  } finally {
    input.value = ''
  }
}

function selectErrorSummary(row: any) {
  replay.selectedErrorCode = row.code
}

function contextText(row: any) {
  const before = row.contextBefore || []
  const after = row.contextAfter || []
  return [...before, row.line, ...after]
    .filter(Boolean)
    .map((line: any) => line.raw)
    .join('\n')
}

function nearestFrame(timeMs: number) {
  if (replay.frames.length === 0) return null
  let best = { ...replay.frames[0], frameIndex: 0 }
  for (let i = 0; i < replay.frames.length; i++) {
    const frame = replay.frames[i]
    if (Math.abs(frame.timeMs - timeMs) < Math.abs(best.timeMs - timeMs)) best = { ...frame, frameIndex: i }
    if (frame.timeMs > timeMs) break
  }
  return best
}

function markerPercent(timeMs: number) {
  if (replay.mode === 'frame_compact') {
    const frame = nearestFrame(timeMs) as any
    const index = frame?.frameIndex ?? replay.frames.findIndex((it) => it.timeMs === frame?.timeMs)
    return progressMax.value > 0 ? Math.max(0, Math.min(100, (index / progressMax.value) * 100)) : 0
  }
  return replay.durationMs > 0 ? Math.max(0, Math.min(100, ((timeMs - replay.startMs) / replay.durationMs) * 100)) : 0
}

function aggregateMarkers(events: any[]) {
  const bucketCount = Math.max(1, Math.min(120, Math.floor(progressMax.value / (replay.mode === 'frame_compact' ? 5 : 3000)) || 80))
  const buckets = new Map<number, any[]>()
  for (const event of events) {
    const percent = markerPercent(event.timeMs)
    const bucket = Math.floor((percent / 100) * bucketCount)
    const list = buckets.get(bucket) || []
    list.push(event)
    buckets.set(bucket, list)
  }
  return Array.from(buckets.entries()).map(([bucket, list]) => {
    const primary = list.find((event) => event.level === 'error') || list[0]
    return {
      id: `marker-${bucket}-${primary.id}`,
      timeMs: primary.timeMs,
      level: list.some((event) => event.level === 'error') ? 'error' : primary.level,
      title: list.map((event) => `${event.timestamp} ${event.title}`).slice(0, 5).join('\n'),
      left: `${markerPercent(primary.timeMs)}%`,
      count: list.length
    }
  })
}

async function onPlay() {
  await replay.play()
  startProgressTimer()
}

async function onPause() {
  await replay.pause()
  stopProgressTimer()
}

async function onProgressChange(value: number | number[]) {
  const offset = Array.isArray(value) ? value[0] : value
  if (replay.mode === 'frame_compact') await replay.seekFrame(offset)
  else await replay.seek(replay.startMs + offset)
  progressValue.value = offset
}

async function onModeChange(value: string | number | boolean) {
  await replay.setMode(value === 'frame_compact' ? 'frame_compact' : 'realtime')
  syncProgressValue()
}

function startProgressTimer() {
  stopProgressTimer()
  progressTimer = window.setInterval(async () => {
    await replay.refreshSession()
    syncProgressValue()
    if (!replay.playing) stopProgressTimer()
  }, 500)
}

function syncProgressValue() {
  progressValue.value =
    replay.mode === 'frame_compact' ? replay.currentFrameIndex : Math.max(0, replay.currentMs - replay.startMs)
}

function stopProgressTimer() {
  if (progressTimer) {
    clearInterval(progressTimer)
    progressTimer = 0
  }
}

function formatDuration(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`
  return `${m}:${pad(s)}`
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`
}

function pad(v: number) {
  return String(v).padStart(2, '0')
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '')
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

function matchLabel(strategy: string) {
  const labels: Record<string, string> = {
    manual: '手动',
    detected_exact: '精确',
    detected_contains: '近似',
    fallback_first_json: '回退',
    missing: '缺失'
  }
  return labels[strategy] || strategy || '-'
}

function confidenceText(value: unknown) {
  const n = Number(value)
  return Number.isFinite(n) ? `${Math.round(n * 100)}%` : '-'
}

function smoothFrames(frames: any[]) {
  if (frames.length < 3) return frames
  return frames.map((frame, index) => {
    if (index === 0 || index === frames.length - 1) return frame
    const prev = frames[index - 1]
    const next = frames[index + 1]
    return {
      ...frame,
      x: (prev.x + frame.x + next.x) / 3,
      y: (prev.y + frame.y + next.y) / 3
    }
  })
}

onBeforeUnmount(() => {
  stopProgressTimer()
  robot.disconnectWs()
})
</script>

<style scoped>
.replay-page {
  min-height: 100%;
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow: visible;
}
.load-band,
.info-band,
.root-cause-band,
.tabs-card {
  flex: none;
}
.root-cause-band :deep(.el-card__body) {
  padding-top: 8px;
  padding-bottom: 8px;
}
.path-input {
  width: 280px;
}
.hidden-input {
  display: none;
}
.overview-row {
  flex: none;
}
.info-line,
.tag-line {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}
.info-line {
  margin-bottom: 8px;
  color: #374151;
  font-size: 13px;
}
.warning-line {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 8px;
  color: #92400e;
  font-size: 12px;
}
.cause-title {
  margin-right: 8px;
  font-weight: 600;
}
.cause-body {
  color: #374151;
  font-size: 13px;
}
.cause-actions {
  display: flex;
  gap: 8px;
  margin: 8px 0;
}
.cause-body pre {
  max-height: 96px;
  overflow: auto;
  margin: 0;
  white-space: pre-wrap;
  color: #6b7280;
  font-size: 12px;
  line-height: 1.5;
}
.charts-row {
  flex: none;
  margin-top: 2px;
}
.metric {
  height: 76px;
}
.metric-label {
  color: #6b7280;
  font-size: 13px;
}
.metric-value {
  margin-top: 8px;
  font-size: 20px;
  font-weight: 600;
  color: #111827;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.main-row {
  flex: none;
  min-height: 560px;
}
.main-col,
.map-card,
.side-card {
  height: 100%;
  min-height: 560px;
}
.map-card :deep(.el-card__body),
.side-card :deep(.el-card__body) {
  height: calc(100% - 112px);
  min-height: 430px;
}
.map-card :deep(.el-card__body) {
  display: flex;
  flex-direction: column;
}
.map-card {
  position: relative;
}
.map-card :deep(.canvas-wrap) {
  flex: 1;
  min-height: 430px;
}
.point-popover {
  position: absolute;
  right: 16px;
  bottom: 16px;
  width: 220px;
  padding: 10px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.96);
  color: #374151;
  font-size: 12px;
  line-height: 1.7;
  box-shadow: 0 8px 20px rgba(15, 23, 42, 0.14);
}
.point-popover-head {
  display: flex;
  justify-content: space-between;
  margin-bottom: 4px;
  font-weight: 600;
}
.point-popover-head button {
  border: 0;
  background: transparent;
  cursor: pointer;
}
.play-head,
.card-head,
.play-tools,
.filter-row,
.fold-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.play-head {
  align-items: stretch;
  flex-direction: column;
}
.card-head {
  justify-content: space-between;
}
.progress-row {
  display: grid;
  grid-template-columns: 56px minmax(160px, 1fr) 56px;
  align-items: center;
  gap: 10px;
}
.progress-slider {
  width: 100%;
}
.progress-wrap {
  position: relative;
  min-width: 0;
}
.progress-marker {
  position: absolute;
  top: 18px;
  width: 6px;
  height: 12px;
  padding: 0;
  border: 0;
  border-radius: 3px;
  transform: translateX(-50%);
  background: #f59e0b;
  cursor: pointer;
  color: #fff;
  font-size: 9px;
  line-height: 12px;
  text-align: center;
}
.progress-marker.error {
  background: #dc2626;
}
.progress-marker.warning {
  background: #f59e0b;
}
.progress-marker.info {
  background: #2563eb;
}
.time-text {
  color: #6b7280;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  text-align: center;
}
.speed-select {
  width: 90px;
}
.link-btn {
  border: 0;
  padding: 0;
  color: #2563eb;
  background: transparent;
  cursor: pointer;
}
.event-detail {
  color: #6b7280;
  font-size: 12px;
  margin-top: 4px;
}
.current-box {
  margin-bottom: 12px;
}
.context-box {
  padding: 8px 16px;
}
.context-title {
  color: #374151;
  font-weight: 600;
  margin-bottom: 6px;
}
.context-box pre {
  white-space: pre-wrap;
  margin: 0;
  color: #4b5563;
  font-size: 12px;
  line-height: 1.5;
}
.filter-row {
  margin-bottom: 8px;
}
.filter-item {
  width: 160px;
}
.number-filter {
  width: 150px;
}
.fold-row {
  flex-wrap: wrap;
  margin-bottom: 8px;
}
.fold-tag {
  cursor: pointer;
}
.fold-detail {
  margin-top: 12px;
}
.fold-detail pre {
  max-height: 180px;
  overflow: auto;
  white-space: pre-wrap;
  color: #4b5563;
  font-size: 12px;
  line-height: 1.5;
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  padding: 8px;
}
.pager {
  margin-top: 8px;
  justify-content: flex-end;
}
</style>
