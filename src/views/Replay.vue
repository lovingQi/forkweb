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
          <el-button :disabled="!replay.loaded" @click="openReport('md')">Markdown</el-button>
          <el-button :disabled="!replay.loaded" @click="openReport('json')">JSON</el-button>
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
        <el-tag type="info">[E] {{ replay.overview?.errorLogCount || 0 }}</el-tag>
        <el-tag type="info">[W] {{ replay.overview?.warningLogCount || 0 }}</el-tag>
      </div>
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
                  <el-select v-model="replay.speed" size="small" class="speed-select" @change="replay.setSpeed">
                    <el-option :value="0.5" label="0.5x" />
                    <el-option :value="1" label="1x" />
                    <el-option :value="2" label="2x" />
                    <el-option :value="5" label="5x" />
                  </el-select>
                </div>
              </div>
              <div class="progress-row">
                <span class="time-text">{{ currentReplayTime }}</span>
                <el-slider
                  v-model="progressValue"
                  :min="0"
                  :max="progressMax"
                  :step="100"
                  :disabled="!replay.loaded"
                  :show-tooltip="false"
                  class="progress-slider"
                  @change="onProgressChange"
                />
                <span class="time-text">{{ totalReplayTime }}</span>
              </div>
            </div>
          </template>
          <CanvasView :show-map="true" :trajectory="trajectory" :event-points="eventPoints" />
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

    <el-card shadow="never" class="tabs-card">
      <el-tabs>
        <el-tab-pane label="时间线">
          <div class="filter-row">
            <el-select v-model="replay.eventFilter" clearable placeholder="事件类型" class="filter-item">
              <el-option v-for="type in eventTypes" :key="type" :value="type" :label="type" />
            </el-select>
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
            <el-table-column prop="level" label="等级" width="70" />
            <el-table-column prop="firstTime" label="首次" width="180" />
            <el-table-column prop="lastTime" label="末次" width="180" />
            <el-table-column prop="description" label="描述" show-overflow-tooltip />
          </el-table>
          <el-table :data="selectedErrorOccurrences" height="160" size="small" @row-click="(row:any) => jump(row.timeMs)">
            <el-table-column prop="timestamp" label="时间" width="180" />
            <el-table-column prop="code" label="错误码" width="110" />
            <el-table-column prop="source" label="来源" width="170" />
            <el-table-column prop="definition.description" label="说明" show-overflow-tooltip />
          </el-table>
        </el-tab-pane>
        <el-tab-pane label="任务视角">
          <el-table :data="replay.tasks" height="320" size="small" @row-click="(row:any) => jump(row.startMs)">
            <el-table-column prop="id" label="任务" width="160" />
            <el-table-column prop="startTime" label="开始" width="180" />
            <el-table-column prop="endTime" label="结束" width="180" />
            <el-table-column prop="status" label="状态" width="120" />
            <el-table-column prop="lastFinishedTaskId" label="完成任务" width="120" />
            <el-table-column prop="lastFinishedTaskSuccess" label="成功" width="80" />
            <el-table-column prop="unfinishedPath" label="未完成路径" show-overflow-tooltip />
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
            <el-select v-model="replay.logFilter.noise" clearable placeholder="噪声" class="filter-item">
              <el-option value="true" label="只看噪声" />
              <el-option value="false" label="排除噪声" />
            </el-select>
            <el-select v-model="replay.logFilter.important" clearable placeholder="关键事件" class="filter-item">
              <el-option value="true" label="只看关键" />
            </el-select>
            <el-button @click="replay.refreshLogs">过滤</el-button>
          </div>
          <div class="fold-row">
            <el-tag v-for="fold in replay.folded" :key="fold.id" type="info">
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
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { ElMessage } from 'element-plus'
import CanvasView from '@/components/CanvasView.vue'
import { getReplayMap, replayReportUrl } from '@/api/replay'
import { useReplayStore } from '@/stores/replay'
import { useRobotStore } from '@/stores/robot'

const replay = useReplayStore()
const robot = useRobotStore()
const progressValue = ref(0)
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
const progressMax = computed(() => Math.max(0, replay.durationMs))
const currentReplayTime = computed(() => formatDuration(Math.max(0, replay.currentMs - replay.startMs)))
const totalReplayTime = computed(() => formatDuration(replay.durationMs))
const trajectory = computed(() => replay.frames.map((it) => ({ x: it.x, y: it.y })))
const eventTypes = computed(() => Array.from(new Set(replay.events.map((it) => it.category || it.type).filter(Boolean))))
const filteredEvents = computed(() =>
  replay.eventFilter ? replay.events.filter((it) => (it.category || it.type) === replay.eventFilter) : replay.events
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
    .map((event) => nearestFrame(event.timeMs))
    .filter(Boolean)
    .map((frame: any) => ({ x: frame.x, y: frame.y }))
)
const selectedErrorOccurrences = computed(() => {
  if (!replay.selectedErrorCode) return replay.errorOccurrences
  return replay.errorOccurrences.filter((it) => it.code === replay.selectedErrorCode)
})

async function load() {
  try {
    robot.disconnectWs()
    await replay.loadSession()
    robot.map = await getReplayMap()
    robot.connectWs('replay')
    progressValue.value = Math.max(0, replay.currentMs - replay.startMs)
    startProgressTimer()
    ElMessage.success('日志诊断已加载')
  } catch (e: any) {
    ElMessage.error(e && e.message ? e.message : String(e))
  }
}

function jump(timeMs: number) {
  replay.seek(timeMs)
  progressValue.value = Math.max(0, timeMs - replay.startMs)
}

function openReport(kind: 'md' | 'json') {
  window.open(replayReportUrl(kind), '_blank')
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
  let best = replay.frames[0]
  for (const frame of replay.frames) {
    if (Math.abs(frame.timeMs - timeMs) < Math.abs(best.timeMs - timeMs)) best = frame
    if (frame.timeMs > timeMs) break
  }
  return best
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
  await replay.seek(replay.startMs + offset)
  progressValue.value = offset
}

function startProgressTimer() {
  stopProgressTimer()
  progressTimer = window.setInterval(async () => {
    await replay.refreshSession()
    progressValue.value = Math.max(0, replay.currentMs - replay.startMs)
    if (!replay.playing) stopProgressTimer()
  }, 500)
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

function pad(v: number) {
  return String(v).padStart(2, '0')
}

onBeforeUnmount(() => {
  stopProgressTimer()
  robot.disconnectWs()
})
</script>

<style scoped>
.replay-page {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.load-band,
.info-band,
.tabs-card {
  flex: none;
}
.path-input {
  width: 280px;
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
  flex: 1;
  min-height: 0;
}
.main-col,
.map-card,
.side-card {
  height: 100%;
  min-height: 0;
}
.map-card :deep(.el-card__body),
.side-card :deep(.el-card__body) {
  height: calc(100% - 56px);
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
.fold-row {
  flex-wrap: wrap;
  margin-bottom: 8px;
}
.pager {
  margin-top: 8px;
  justify-content: flex-end;
}
</style>
