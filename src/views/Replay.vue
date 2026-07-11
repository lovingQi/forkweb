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

    <el-row :gutter="12" class="main-row">
      <el-col :span="15" class="main-col">
        <el-card shadow="never" class="map-card">
          <template #header>
            <div class="card-head">
              <span>地图回放</span>
              <div class="play-tools">
                <el-button size="small" :disabled="!replay.loaded" @click="replay.play">播放</el-button>
                <el-button size="small" :disabled="!replay.loaded" @click="replay.pause">暂停</el-button>
                <el-select v-model="replay.speed" size="small" class="speed-select" @change="replay.setSpeed">
                  <el-option :value="0.5" label="0.5x" />
                  <el-option :value="1" label="1x" />
                  <el-option :value="2" label="2x" />
                  <el-option :value="5" label="5x" />
                </el-select>
              </div>
            </div>
          </template>
          <CanvasView :show-map="true" />
        </el-card>
      </el-col>
      <el-col :span="9" class="main-col">
        <el-card shadow="never" class="side-card">
          <template #header>Top 问题</template>
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
          <el-table :data="replay.events" height="320" size="small" @row-click="(row:any) => jump(row.timeMs)">
            <el-table-column prop="timestamp" label="时间" width="180" />
            <el-table-column prop="level" label="级别" width="80" />
            <el-table-column prop="type" label="类型" width="120" />
            <el-table-column prop="title" label="标题" width="180" />
            <el-table-column prop="detail" label="详情" show-overflow-tooltip />
          </el-table>
        </el-tab-pane>
        <el-tab-pane label="错误码中心">
          <el-table :data="replay.errorOccurrences" height="320" size="small" @row-click="(row:any) => jump(row.timeMs)">
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
        </el-tab-pane>
      </el-tabs>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount } from 'vue'
import { ElMessage } from 'element-plus'
import CanvasView from '@/components/CanvasView.vue'
import { replayReportUrl } from '@/api/replay'
import { useReplayStore } from '@/stores/replay'
import { useRobotStore } from '@/stores/robot'

const replay = useReplayStore()
const robot = useRobotStore()

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

async function load() {
  try {
    robot.disconnectWs()
    await replay.loadSession()
    await robot.reloadMap()
    robot.connectWs('replay')
    ElMessage.success('日志诊断已加载')
  } catch (e: any) {
    ElMessage.error(e && e.message ? e.message : String(e))
  }
}

function jump(timeMs: number) {
  replay.seek(timeMs)
}

function openReport(kind: 'md' | 'json') {
  window.open(replayReportUrl(kind), '_blank')
}

onBeforeUnmount(() => {
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
.tabs-card {
  flex: none;
}
.path-input {
  width: 280px;
}
.overview-row {
  flex: none;
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
.card-head,
.play-tools,
.filter-row,
.fold-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.card-head {
  justify-content: space-between;
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
</style>
