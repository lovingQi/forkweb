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
        <el-form-item label="诊断包">
          <el-input v-model="packagePath" class="path-input" placeholder="大包可填本地 zip 路径" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="replay.loading" @click="load()">加载诊断</el-button>
          <el-button :loading="replay.loading" @click="loadAsync()">异步加载</el-button>
          <el-button :loading="replay.loading" @click="load(true)">重新解析</el-button>
          <el-button :disabled="!replay.loaded" @click="openReport('md')">Markdown</el-button>
          <el-button :disabled="!replay.loaded" @click="openReport('json')">JSON</el-button>
          <el-button :disabled="!replay.loaded" @click="openPackageExport">导出诊断包</el-button>
          <el-button :disabled="!replay.loaded" @click="openCaseMetaDialog">人工结论</el-button>
          <el-button @click="openKnowledgeDialog">知识库</el-button>
          <el-button @click="openPackageCompareDialog">诊断包对比</el-button>
          <el-button @click="triggerPackageImport">导入诊断包</el-button>
          <el-button :disabled="!packagePath" @click="importPackagePath">路径导入</el-button>
          <el-button @click="openAliasManager">地图别名</el-button>
          <el-button @click="openCacheDialog">缓存 {{ cacheText }}</el-button>
          <el-button type="warning" plain @click="clearCache">清理缓存</el-button>
          <input ref="packageInput" class="hidden-input" type="file" accept=".zip" @change="onPackageSelected" />
          <input ref="compareLeftInput" class="hidden-input" type="file" accept=".json" @change="onCompareManifestSelected($event, 'left')" />
          <input ref="compareRightInput" class="hidden-input" type="file" accept=".json" @change="onCompareManifestSelected($event, 'right')" />
          <input ref="aliasInput" class="hidden-input" type="file" accept=".json" @change="onAliasFileSelected" />
        </el-form-item>
      </el-form>
      <el-progress
        v-if="replay.sessionJob && replay.sessionJob.status !== 'done'"
        :percentage="replay.sessionJob.progress || 0"
        :status="replay.sessionJob.status === 'error' ? 'exception' : undefined"
        :format="() => `${replay.sessionJob.stage || ''} ${replay.sessionJob.progress || 0}%`"
      />
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
        <span>健康分：{{ scoreText(replay.overview?.healthScore) }}</span>
        <span>日志质量：{{ scoreText(replay.overview?.logQualityScore) }}</span>
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
        <el-tag type="info">解析 {{ replay.overview?.parseStats?.totalMs || 0 }}ms</el-tag>
        <el-tag :type="replay.overview?.parseStats?.cacheHit ? 'success' : 'info'">
          {{ replay.overview?.parseStats?.cacheHit ? '缓存命中' : '直接解析' }}
        </el-tag>
      </div>
      <div v-if="stageTimingEntries.length" class="stage-timing-line">
        <span class="stage-timing-title">各阶段耗时：</span>
        <el-tag v-for="([name, ms]) in stageTimingEntries" :key="name" size="small" type="info" class="stage-tag">
          {{ name }} {{ ms }}ms
        </el-tag>
      </div>
      <div v-if="recommendedFocusTimes.length" class="focus-line">
        <span>建议关注：</span>
        <el-button
          v-for="item in recommendedFocusTimes"
          :key="`${item.timeMs}-${item.title}`"
          size="small"
          link
          @click="jump(item.timeMs)"
        >
          {{ item.timestamp?.slice(11) || '-' }} {{ item.title }}
        </el-button>
      </div>
      <div v-if="(replay.overview?.dataWarnings || []).length" class="warning-line">
        <span v-for="item in replay.overview.dataWarnings" :key="item">{{ item }}</span>
        <el-button v-if="canConfirmMapAlias" size="small" type="warning" plain @click="confirmMapAlias">
          确认使用此地图
        </el-button>
        <el-button size="small" plain @click="openAliasManager">管理地图别名</el-button>
      </div>
    </el-card>

    <el-card v-if="rootCauses.length" shadow="never" class="root-cause-band">
      <template #header>诊断结论</template>
      <el-collapse>
        <el-collapse-item v-for="cause in rootCauses" :key="cause.id" :name="cause.id">
          <template #title>
            <span class="cause-title">{{ cause.title }}</span>
            <el-tag v-if="cause.source === 'knowledge_base'" size="small" type="success">知识库命中</el-tag>
            <el-tag size="small" :type="cause.severity === 'error' ? 'danger' : 'warning'">
              {{ Math.round((cause.confidence || 0) * 100) }}%
            </el-tag>
          </template>
          <div class="cause-body">
            <div>{{ cause.suggestion }}</div>
            <div class="cause-actions">
              <el-button size="small" @click="jumpFirstEvidence(cause)">跳转证据</el-button>
              <el-button size="small" plain @click="copyCauseEvidence(cause)">复制证据包</el-button>
              <el-button size="small" plain @click="openBookmarkDialog(cause)">加书签</el-button>
              <el-button size="small" plain @click="openKnowledgeDraftFromCause(cause)">转为知识</el-button>
              <el-button size="small" type="success" plain @click="sendCauseFeedback(cause.id, 'useful')">有用</el-button>
              <el-button size="small" type="warning" plain @click="sendCauseFeedback(cause.id, 'false_positive')">误报</el-button>
            </div>
            <div class="cause-grid">
              <div>
                <strong>触发规则</strong>
                <p>{{ (cause.triggeredRules || []).join('、') || '-' }}</p>
              </div>
              <div>
                <strong>正向证据</strong>
                <p>{{ (cause.positiveEvidence || []).join('；') || '-' }}</p>
              </div>
              <div>
                <strong>反向证据</strong>
                <p>{{ (cause.negativeEvidence || []).join('；') || '-' }}</p>
              </div>
              <div>
                <strong>置信因素</strong>
                <p>{{ (cause.confidenceFactors || []).join('；') || '-' }}</p>
              </div>
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
                  <el-button size="small" :disabled="!replay.loaded" @click="jumpPrevIssue">上一问题</el-button>
                  <el-button size="small" :disabled="!replay.loaded" @click="jumpNextIssue">下一问题</el-button>
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
                  <el-checkbox v-model="replay.loopEnabled" size="small" @change="replay.updateControlOptions">循环</el-checkbox>
                  <el-checkbox v-model="replay.autoPauseOnIssue" size="small" @change="replay.updateControlOptions">遇问题暂停</el-checkbox>
                  <el-button size="small" :disabled="!replay.loaded" @click="setLoopStart">设起点</el-button>
                  <el-button size="small" :disabled="!replay.loaded" @click="setLoopEnd">设终点</el-button>
                  <el-button size="small" :disabled="!replay.loaded" @click="captureSnapshot">截图</el-button>
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
                  <span v-if="hiddenMarkerCount" class="marker-overflow">+{{ hiddenMarkerCount }}</span>
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
          <div class="side-section">
            <div class="side-section-title">
              <span>人工书签</span>
              <el-button size="small" link :disabled="!replay.loaded" @click="openBookmarkDialog()">添加</el-button>
            </div>
            <el-empty v-if="replay.bookmarks.length === 0" description="暂无书签" :image-size="48" />
            <div v-else class="bookmark-list">
              <div v-for="bookmark in replay.bookmarks.slice(0, 8)" :key="bookmark.id" class="bookmark-item">
                <button class="link-btn" @click="jump(bookmark.timeMs)">{{ bookmark.timestamp?.slice(11) || '-' }} {{ bookmark.title }}</button>
                <el-button size="small" type="danger" link @click="deleteBookmark(bookmark.id)">删除</el-button>
                <div v-if="bookmark.note" class="event-detail">{{ bookmark.note }}</div>
              </div>
            </div>
          </div>
          <div v-if="caseMetaText" class="side-section">
            <div class="side-section-title">
              <span>人工结论</span>
              <el-button size="small" link @click="openCaseMetaDialog">编辑</el-button>
            </div>
            <div class="case-meta-text">{{ caseMetaText }}</div>
          </div>
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
      <el-tabs v-model="activeTab">
        <el-tab-pane label="时间线" name="timeline">
          <div class="filter-row">
            <el-select v-model="replay.eventQuery.category" clearable placeholder="事件类型" class="filter-item">
              <el-option v-for="type in eventTypes" :key="type" :value="type" :label="categoryLabel(type)" />
            </el-select>
            <el-select v-model="replay.eventQuery.level" clearable placeholder="严重度" class="filter-item">
              <el-option value="error" label="错误" />
              <el-option value="warning" label="警告" />
              <el-option value="info" label="信息" />
            </el-select>
            <el-segmented
              v-model="replay.eventQuery.mode"
              size="small"
              :options="eventModeOptions"
              @change="refreshEvents"
            />
            <el-segmented
              v-model="replay.eventQuery.sort"
              size="small"
              :options="eventSortOptions"
              @change="refreshEvents"
            />
            <el-input-number
              v-model="replay.eventQuery.startMs"
              :min="0"
              :controls="false"
              placeholder="开始时间戳"
              class="number-filter"
            />
            <el-input-number
              v-model="replay.eventQuery.endMs"
              :min="0"
              :controls="false"
              placeholder="结束时间戳"
              class="number-filter"
            />
            <el-checkbox v-model="replay.eventQuery.dedupe" size="small" @change="refreshEvents">合并重复</el-checkbox>
            <el-button size="small" @click="refreshEvents">筛选</el-button>
            <el-tag v-if="selectedTaskId" closable @close="clearTaskSelection">任务 {{ selectedTaskId }}</el-tag>
            <el-tag type="info">共 {{ replay.eventTotal }} 条</el-tag>
          </div>
          <el-table :data="filteredEvents" height="320" size="small" @row-click="selectTimelineEvent">
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
            <el-table-column label="类型" width="120">
              <template #default="{ row }">{{ categoryLabel(row.category || row.type) }}</template>
            </el-table-column>
            <el-table-column prop="title" label="标题" width="180" />
            <el-table-column prop="detail" label="详情" show-overflow-tooltip />
            <el-table-column label="操作" width="150">
              <template #default="{ row }">
                <el-button size="small" link @click.stop="openBookmarkDialog(row)">书签</el-button>
                <el-button size="small" link @click.stop="copyEventEvidence(row)">复制证据</el-button>
                <el-button size="small" link @click.stop="openKnowledgeDraftFromEvent(row)">沉淀知识</el-button>
              </template>
            </el-table-column>
          </el-table>
          <el-pagination
            class="pager"
            layout="prev, pager, next, total"
            :total="replay.eventTotal"
            :page-size="replay.eventQuery.limit"
            @current-change="replay.changeEventPage"
          />
        </el-tab-pane>
        <el-tab-pane label="错误码中心" name="errors">
          <div class="filter-row">
            <el-input v-model="replay.errorQuery.code" placeholder="错误码" class="filter-item" />
            <el-input v-model="replay.errorQuery.module" placeholder="模块" class="filter-item" />
            <el-input v-model="replay.errorQuery.level" placeholder="等级" class="filter-item" />
            <el-select v-model="replay.errorQuery.kind" clearable placeholder="类型" class="filter-item">
              <el-option value="real_fault" label="真实故障" />
              <el-option value="config_notice" label="配置提醒" />
              <el-option value="definition" label="定义" />
              <el-option value="unknown" label="未知" />
            </el-select>
            <el-button size="small" @click="refreshErrorCodes">筛选</el-button>
            <el-tag type="info">发生点 {{ replay.errorOccurrenceTotal }}</el-tag>
          </div>
          <el-table :data="replay.errorSummaries" height="160" size="small" @row-click="selectErrorSummary">
            <el-table-column prop="code" label="错误码" width="110" />
            <el-table-column prop="count" label="次数" width="70" />
            <el-table-column prop="realCount" label="真实" width="70" />
            <el-table-column prop="configNoticeCount" label="配置" width="70" />
            <el-table-column prop="level" label="等级" width="70" />
            <el-table-column label="来源" width="90">
              <template #default="{ row }">{{ row.occurrences?.[0]?.definition?.sourceLabel || row.occurrences?.[0]?.definition?.source || '-' }}</template>
            </el-table-column>
            <el-table-column label="置信度" width="80">
              <template #default="{ row }">{{ confidenceText(row.occurrences?.[0]?.definition?.dictionaryConfidence) }}</template>
            </el-table-column>
            <el-table-column label="来源说明" width="180" show-overflow-tooltip>
              <template #default="{ row }">{{ row.occurrences?.[0]?.definition?.confidenceReason || '-' }}</template>
            </el-table-column>
            <el-table-column prop="firstTime" label="首次" width="180" />
            <el-table-column prop="lastTime" label="末次" width="180" />
            <el-table-column label="错误码内容" min-width="180" show-overflow-tooltip>
              <template #default="{ row }">{{ row.occurrences?.[0]?.definition?.content || row.description || '-' }}</template>
            </el-table-column>
            <el-table-column label="屏幕显示" min-width="180" show-overflow-tooltip>
              <template #default="{ row }">{{ row.occurrences?.[0]?.definition?.screenText || '-' }}</template>
            </el-table-column>
            <el-table-column label="故障排除方法" min-width="220" show-overflow-tooltip>
              <template #default="{ row }">{{ row.occurrences?.[0]?.definition?.troubleshooting || '-' }}</template>
            </el-table-column>
          </el-table>
          <el-table :data="selectedErrorOccurrences" height="160" size="small" @row-click="(row:any) => jump(row.timeMs)">
            <el-table-column prop="timestamp" label="时间" width="180" />
            <el-table-column prop="code" label="错误码" width="110" />
            <el-table-column prop="source" label="来源" width="170" />
            <el-table-column prop="kind" label="类型" width="110" />
            <el-table-column prop="taskId" label="任务" width="120" />
            <el-table-column label="说明" min-width="180" show-overflow-tooltip>
              <template #default="{ row }">{{ row.definition?.content || row.definition?.description || '-' }}</template>
            </el-table-column>
            <el-table-column label="处理办法" min-width="220" show-overflow-tooltip>
              <template #default="{ row }">{{ row.definition?.troubleshooting || '-' }}</template>
            </el-table-column>
            <el-table-column label="操作" width="130">
              <template #default="{ row }">
                <el-button size="small" link @click.stop="showErrorLogContext(row)">查看日志上下文</el-button>
                <el-button size="small" link @click.stop="openBookmarkDialog(row)">书签</el-button>
                <el-button size="small" link @click.stop="openKnowledgeDraftFromError(row)">沉淀知识</el-button>
              </template>
            </el-table-column>
          </el-table>
          <el-pagination
            class="pager"
            layout="prev, pager, next, total"
            :total="replay.errorOccurrenceTotal"
            :page-size="replay.errorQuery.occurrenceLimit"
            @current-change="replay.changeErrorOccurrencePage"
          />
        </el-tab-pane>
        <el-tab-pane label="任务视角" name="tasks">
          <el-table :data="replay.tasks" height="320" size="small" @row-click="selectTask">
            <el-table-column prop="id" label="任务" width="160" />
            <el-table-column prop="startTime" label="开始" width="180" />
            <el-table-column prop="endTime" label="结束" width="180" />
            <el-table-column prop="status" label="状态" width="120" />
            <el-table-column prop="lastFinishedTaskId" label="完成任务" width="120" />
            <el-table-column prop="lastFinishedTaskSuccess" label="成功" width="80" />
            <el-table-column prop="routeSummary" label="路线摘要" width="180" show-overflow-tooltip />
            <el-table-column prop="unfinishedPath" label="未完成路径" show-overflow-tooltip />
            <el-table-column prop="failureReasonCandidates" label="失败候选" show-overflow-tooltip />
            <el-table-column prop="errors" label="错误" show-overflow-tooltip />
            <el-table-column label="日志" width="120">
              <template #default="{ row }">
                <el-button size="small" link :disabled="!row.failureLine && !row.startMs" @click.stop="showTaskFailureContext(row)">
                  失败上下文
                </el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>
        <el-tab-pane label="问诊助手" name="assistant">
          <ReplayAssistant @create-knowledge="openKnowledgeDraftFromAssistant" />
        </el-tab-pane>
        <el-tab-pane label="原始日志/过滤" name="logs">
          <div class="filter-row">
            <el-select v-model="replay.logFilter.level" clearable placeholder="级别" class="filter-item">
              <el-option value="E" label="E" />
              <el-option value="W" label="W" />
              <el-option value="I" label="I" />
              <el-option value="D" label="D" />
            </el-select>
            <el-input v-model="replay.logFilter.module" placeholder="模块" class="filter-item" />
            <el-input v-model="replay.logFilter.keyword" placeholder="关键词" class="filter-item" />
            <el-input v-model="replay.logFilter.keywords" placeholder="多关键词逗号分隔" class="filter-item wide-filter" />
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
            <el-input-number
              v-model="replay.logFilter.aroundSeconds"
              :min="0"
              :max="3600"
              :controls="false"
              placeholder="上下文秒"
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
            <el-button :disabled="!replay.logCopyText" @click="copyCurrentEvidencePack">复制证据包</el-button>
            <el-button :disabled="selectedLogRows.length === 0" @click="addSelectedLogEvidence">选中作为证据</el-button>
            <el-button :disabled="replay.selectedEvidenceLines.length === 0" @click="openKnowledgeDraftFromEvidence">沉淀知识</el-button>
            <el-button :disabled="replay.selectedEvidenceLines.length === 0" @click="replay.clearEvidenceLines">清空证据</el-button>
            <el-tag type="info">证据 {{ replay.selectedEvidenceLines.length }}</el-tag>
          </div>
          <div class="fold-row">
            <el-tag v-for="fold in replay.folded" :key="fold.id" type="info" class="fold-tag" @click="openFoldDetail(fold)">
              {{ fold.label }} x{{ fold.count }}
            </el-tag>
            <el-tag v-if="highlightedLogKey" type="warning">已高亮关联日志</el-tag>
            <el-tag v-for="keyword in replay.logKeywordMatches" :key="keyword" type="success">关键词 {{ keyword }}</el-tag>
          </div>
          <el-table
            :data="replay.logs"
            height="260"
            size="small"
            :row-class-name="logRowClassName"
            @selection-change="onLogSelectionChange"
          >
            <el-table-column type="selection" width="42" />
            <el-table-column prop="timestamp" label="时间" width="180" />
            <el-table-column prop="level" label="级别" width="70" />
            <el-table-column prop="module" label="模块" width="130" />
            <el-table-column label="内容" show-overflow-tooltip>
              <template #default="{ row }">
                <span v-html="highlightLogMessage(row.message || row.raw || '')"></span>
              </template>
            </el-table-column>
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
        <div class="dialog-toolbar">
          <el-button size="small" :disabled="!replay.foldedDetail.copyText" @click="copyFoldedDetail">复制当前页</el-button>
        </div>
        <el-table :data="replay.foldedDetail.lines" height="320" size="small">
          <el-table-column prop="timestamp" label="时间" width="180" />
          <el-table-column prop="level" label="级别" width="70" />
          <el-table-column prop="module" label="模块" width="130" />
          <el-table-column prop="message" label="内容" show-overflow-tooltip />
        </el-table>
        <el-pagination
          class="pager"
          layout="prev, pager, next, total"
          :total="replay.foldedDetail.total"
          :page-size="replay.foldedDetail.limit"
          @current-change="replay.changeFoldedDetailPage"
        />
      </div>
    </el-dialog>

    <el-dialog v-model="aliasDialogVisible" title="地图别名管理" width="900px">
      <div class="dialog-toolbar">
        <el-button size="small" @click="openAliasExport">导出别名</el-button>
        <el-button size="small" @click="triggerAliasImport">导入别名</el-button>
        <el-checkbox v-model="aliasImportOverwrite" size="small">覆盖同名别名</el-checkbox>
        <el-tag v-if="replay.mapAliasConflicts.length" type="danger" size="small">
          冲突 {{ replay.mapAliasConflicts.length }}
        </el-tag>
      </div>
      <el-alert
        v-if="replay.mapAliasConflicts.length"
        type="warning"
        :closable="false"
        title="存在同一车辆/地图名指向不同地图文件的别名，请保留现场确认过的关系。"
        class="dialog-alert"
      />
      <el-table :data="replay.mapAliases" height="360" size="small">
        <el-table-column prop="detectedMapName" label="日志地图名" width="150" />
        <el-table-column prop="robotName" label="车辆" width="120" />
        <el-table-column prop="selectedMapFile" label="本地地图文件" show-overflow-tooltip />
        <el-table-column prop="updatedAt" label="更新时间" width="180" />
        <el-table-column label="操作" width="90">
          <template #default="{ row }">
            <el-button size="small" type="danger" link @click="deleteAlias(row.id)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-dialog>

    <el-dialog v-model="bookmarkDialogVisible" title="添加书签" width="520px">
      <el-form label-width="80px">
        <el-form-item label="时间">
          <el-input v-model="bookmarkForm.timestamp" disabled />
        </el-form-item>
        <el-form-item label="标题">
          <el-input v-model="bookmarkForm.title" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="bookmarkForm.note" type="textarea" :rows="4" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="bookmarkDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="saveBookmark">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="caseMetaDialogVisible" title="人工结论" width="720px">
      <el-form label-width="92px">
        <el-form-item label="现场">
          <el-input v-model="caseMetaForm.site" />
        </el-form-item>
        <el-form-item label="车辆">
          <el-input v-model="caseMetaForm.robotName" />
        </el-form-item>
        <el-form-item label="测试人员">
          <el-input v-model="caseMetaForm.operator" />
        </el-form-item>
        <el-form-item label="测试轮次">
          <el-input v-model="caseMetaForm.testRound" />
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="caseMetaForm.status" clearable>
            <el-option value="pending" label="待确认" />
            <el-option value="reproduced" label="已复现" />
            <el-option value="located" label="已定位" />
            <el-option value="fixed" label="已修复" />
            <el-option value="closed" label="已关闭" />
          </el-select>
        </el-form-item>
        <el-form-item label="确认根因">
          <el-input v-model="caseMetaForm.confirmedRootCause" type="textarea" :rows="3" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="caseMetaForm.note" type="textarea" :rows="4" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="caseMetaDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="saveCaseMeta">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="packageExportDialogVisible" title="导出诊断包" width="560px">
      <el-form label-width="112px">
        <el-form-item label="开始时间戳">
          <el-input-number v-model="packageExportForm.startMs" :min="0" :controls="false" />
        </el-form-item>
        <el-form-item label="结束时间戳">
          <el-input-number v-model="packageExportForm.endMs" :min="0" :controls="false" />
        </el-form-item>
        <el-form-item label="包含内容">
          <el-checkbox v-model="packageExportForm.includeMap">地图</el-checkbox>
          <el-checkbox v-model="packageExportForm.includeReports">报告</el-checkbox>
          <el-checkbox v-model="packageExportForm.includeAliases">地图别名</el-checkbox>
          <el-checkbox v-model="packageExportForm.includeFeedback">根因反馈</el-checkbox>
        </el-form-item>
      </el-form>
      <el-alert
        v-if="replay.lastExportedPackage"
        type="success"
        :closable="false"
        :title="`已生成：${replay.lastExportedPackage.file}`"
      />
      <template #footer>
        <el-button @click="downloadDefaultPackage">直接下载完整包</el-button>
        <el-button type="primary" @click="exportPackageWithOptions">生成选项包</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="packageCompareDialogVisible" title="诊断包 Manifest 对比" width="760px">
      <div class="dialog-toolbar">
        <el-button size="small" @click="compareLeftInput?.click()">选择左侧 manifest</el-button>
        <el-button size="small" @click="compareRightInput?.click()">选择右侧 manifest</el-button>
        <el-button size="small" type="primary" :disabled="!compareLeftManifest || !compareRightManifest" @click="compareManifests">开始对比</el-button>
      </div>
      <el-descriptions v-if="replay.packageComparison" :column="2" size="small" border>
        <el-descriptions-item v-for="(value, key) in replay.packageComparison" :key="key" :label="String(key)">
          {{ JSON.stringify(value) }}
        </el-descriptions-item>
      </el-descriptions>
    </el-dialog>

    <el-dialog v-model="knowledgeDraftVisible" title="沉淀诊断知识" width="960px">
      <div class="knowledge-layout">
        <div>
          <div class="context-title">证据日志</div>
          <el-table :data="knowledgeDraft.examples?.[0]?.lines || []" height="360" size="small">
            <el-table-column prop="timestamp" label="时间" width="170" />
            <el-table-column prop="level" label="级别" width="64" />
            <el-table-column prop="module" label="模块" width="120" />
            <el-table-column prop="message" label="内容" show-overflow-tooltip />
          </el-table>
        </div>
        <el-form label-width="86px" class="knowledge-form">
          <el-form-item label="标题">
            <el-input v-model="knowledgeDraft.title" />
          </el-form-item>
          <el-form-item label="严重度">
            <el-select v-model="knowledgeDraft.severity">
              <el-option value="info" label="信息" />
              <el-option value="warning" label="警告" />
              <el-option value="error" label="错误" />
            </el-select>
          </el-form-item>
          <el-form-item label="标签">
            <el-input v-model="knowledgeTagText" placeholder="逗号分隔" />
          </el-form-item>
          <el-form-item label="问题描述">
            <el-input v-model="knowledgeDraft.description" type="textarea" :rows="2" />
          </el-form-item>
          <el-form-item label="确认根因">
            <el-input v-model="knowledgeDraft.rootCause" type="textarea" :rows="2" />
          </el-form-item>
          <el-form-item label="处理办法">
            <el-input v-model="knowledgeDraft.solution" type="textarea" :rows="2" />
          </el-form-item>
          <el-form-item label="必选词">
            <el-input v-model="patternText.requiredKeywords" placeholder="逗号分隔" />
          </el-form-item>
          <el-form-item label="任意词">
            <el-input v-model="patternText.anyKeywords" placeholder="逗号分隔" />
          </el-form-item>
          <el-form-item label="排除词">
            <el-input v-model="patternText.excludedKeywords" placeholder="逗号分隔" />
          </el-form-item>
          <el-form-item label="模块">
            <el-input v-model="patternText.modules" placeholder="逗号分隔" />
          </el-form-item>
          <el-form-item label="等级">
            <el-input v-model="patternText.levels" placeholder="E,W,I,D" />
          </el-form-item>
          <el-form-item label="错误码">
            <el-input v-model="patternText.errorCodes" placeholder="ERRORxxxx,逗号分隔" />
          </el-form-item>
          <el-form-item label="窗口/次数">
            <div class="inline-controls">
              <el-input-number v-model="knowledgeDraft.pattern.windowSeconds" :min="0" :controls="false" placeholder="秒" />
              <el-input-number v-model="knowledgeDraft.pattern.minOccurrences" :min="1" :controls="false" placeholder="次数" />
              <el-input-number v-model="knowledgeDraft.pattern.confidenceBase" :min="0" :max="1" :step="0.05" :controls="false" placeholder="基础置信度" />
            </div>
          </el-form-item>
          <el-form-item label="启用">
            <el-switch v-model="knowledgeDraft.enabled" />
          </el-form-item>
        </el-form>
      </div>
      <el-alert
        v-if="replay.knowledgeTestResult"
        class="dialog-alert"
        :type="replay.knowledgeTestResult.matched ? 'success' : 'warning'"
        :closable="false"
        :title="replay.knowledgeTestResult.matched ? `试跑命中，置信度 ${confidenceText(replay.knowledgeTestResult.match?.confidence)}` : '试跑未命中'"
      />
      <template #footer>
        <el-button @click="autoSuggestKnowledgePattern">自动提取规则</el-button>
        <el-button @click="testKnowledgeDraft">试跑</el-button>
        <el-button @click="knowledgeDraftVisible = false">取消</el-button>
        <el-button type="primary" @click="saveKnowledgeDraft">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="knowledgeDialogVisible" title="诊断知识库" width="980px">
      <div class="dialog-toolbar">
        <el-input v-model="knowledgeQuery.keyword" placeholder="搜索标题/描述" class="filter-item" />
        <el-select v-model="knowledgeQuery.severity" clearable placeholder="严重度" class="filter-item">
          <el-option value="error" label="错误" />
          <el-option value="warning" label="警告" />
          <el-option value="info" label="信息" />
        </el-select>
        <el-button size="small" @click="refreshKnowledgeWithQuery">筛选</el-button>
        <el-button size="small" @click="openBlankKnowledgeDraft">新增</el-button>
        <el-button size="small" @click="openKnowledgeExport">导出</el-button>
        <el-button size="small" @click="triggerKnowledgeImport">导入</el-button>
        <el-checkbox v-model="knowledgeImportOverwrite" size="small">覆盖冲突</el-checkbox>
        <input ref="knowledgeInput" class="hidden-input" type="file" accept=".json" @change="onKnowledgeFileSelected" />
      </div>
      <el-table :data="replay.knowledgeRules" height="420" size="small">
        <el-table-column prop="title" label="标题" min-width="180" show-overflow-tooltip />
        <el-table-column prop="severity" label="严重度" width="80" />
        <el-table-column label="标签" min-width="120" show-overflow-tooltip>
          <template #default="{ row }">{{ (row.tags || []).join(', ') }}</template>
        </el-table-column>
        <el-table-column prop="hitCount" label="命中" width="70" />
        <el-table-column label="启用" width="70">
          <template #default="{ row }">
            <el-switch v-model="row.enabled" @change="(value:any) => toggleKnowledge(row, value)" />
          </template>
        </el-table-column>
        <el-table-column prop="updatedAt" label="更新时间" width="180" />
        <el-table-column label="操作" width="220">
          <template #default="{ row }">
            <el-button size="small" link @click="editKnowledgeRule(row)">编辑</el-button>
            <el-button size="small" link @click="copyKnowledgeRule(row)">复制</el-button>
            <el-button size="small" link @click="testKnowledgeRule(row)">试跑</el-button>
            <el-button size="small" type="danger" link @click="deleteKnowledge(row.id)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-dialog>

    <el-dialog v-model="packageInfoVisible" title="诊断包信息" width="720px">
      <el-descriptions v-if="replay.importedPackage" :column="2" size="small" border>
        <el-descriptions-item label="包 ID">{{ replay.importedPackage.id }}</el-descriptions-item>
        <el-descriptions-item label="车辆">{{ replay.importedPackage.manifest?.robotName || '-' }}</el-descriptions-item>
        <el-descriptions-item label="生成时间">{{ replay.importedPackage.manifest?.createdAt || '-' }}</el-descriptions-item>
        <el-descriptions-item label="日志数量">{{ replay.importedPackage.manifest?.logFiles?.length || 0 }}</el-descriptions-item>
        <el-descriptions-item label="地图文件">{{ replay.importedPackage.mapFile || '-' }}</el-descriptions-item>
        <el-descriptions-item label="包内别名">{{ replay.importedPackage.mapAliases?.length || 0 }}</el-descriptions-item>
      </el-descriptions>
      <el-alert
        v-if="(replay.importedPackage?.aliasConflicts || []).length"
        type="warning"
        :closable="false"
        title="诊断包内地图别名与本地配置存在冲突，请到地图别名管理中确认后再覆盖导入。"
        class="dialog-alert"
      />
      <div class="dialog-toolbar">
        <el-button size="small" @click="openAliasManager">打开地图别名管理</el-button>
      </div>
    </el-dialog>

    <el-dialog v-model="cacheDialogVisible" title="缓存详情" width="720px">
      <el-descriptions v-if="replay.cacheSummary" :column="3" size="small" border>
        <el-descriptions-item label="版本">{{ replay.cacheSummary.version }}</el-descriptions-item>
        <el-descriptions-item label="文件数">{{ replay.cacheSummary.files }}</el-descriptions-item>
        <el-descriptions-item label="大小">{{ formatBytes(replay.cacheSummary.bytes || 0) }}</el-descriptions-item>
      </el-descriptions>
      <el-table :data="replay.cacheSummary?.buckets || []" height="280" size="small" class="dialog-table">
        <el-table-column prop="label" label="类型" width="150" />
        <el-table-column prop="files" label="文件" width="90" />
        <el-table-column label="大小" width="120">
          <template #default="{ row }">{{ formatBytes(row.bytes || 0) }}</template>
        </el-table-column>
        <el-table-column prop="dir" label="目录" show-overflow-tooltip />
        <el-table-column label="操作" width="100">
          <template #default="{ row }">
            <el-button size="small" type="warning" link @click="clearCache(row.key)">清理</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { ElMessage } from 'element-plus'
import CanvasView from '@/components/CanvasView.vue'
import ReplayCharts from '@/components/replay/ReplayCharts.vue'
import ReplayAssistant from '@/components/replay/ReplayAssistant.vue'
import { getReplayMap, replayKnowledgeExportUrl, replayMapAliasesExportUrl, replayPackageUrl, replayReportUrl } from '@/api/replay'
import { useReplayStore } from '@/stores/replay'
import { useRobotStore } from '@/stores/robot'

const replay = useReplayStore()
const robot = useRobotStore()
const progressValue = ref(0)
const activeTab = ref('timeline')
const selectedTaskId = ref('')
const selectedReplayPoint = ref<any>(null)
const selectedFold = ref<any>(null)
const highlightedLogKey = ref('')
const packagePath = ref('')
const foldDialogVisible = ref(false)
const aliasDialogVisible = ref(false)
const packageInfoVisible = ref(false)
const cacheDialogVisible = ref(false)
const bookmarkDialogVisible = ref(false)
const caseMetaDialogVisible = ref(false)
const packageExportDialogVisible = ref(false)
const packageCompareDialogVisible = ref(false)
const knowledgeDialogVisible = ref(false)
const knowledgeDraftVisible = ref(false)
const aliasImportOverwrite = ref(false)
const knowledgeImportOverwrite = ref(false)
const smoothTrajectory = ref(false)
const selectedLogRows = ref<any[]>([])
const packageInput = ref<HTMLInputElement | null>(null)
const aliasInput = ref<HTMLInputElement | null>(null)
const knowledgeInput = ref<HTMLInputElement | null>(null)
const compareLeftInput = ref<HTMLInputElement | null>(null)
const compareRightInput = ref<HTMLInputElement | null>(null)
const bookmarkForm = ref<any>({ timeMs: 0, timestamp: '', title: '', note: '', eventId: '', level: 'info' })
const caseMetaForm = ref<any>({})
const packageExportForm = ref({
  startMs: 0,
  endMs: 0,
  includeMap: true,
  includeReports: true,
  includeAliases: true,
  includeFeedback: true
})
const compareLeftManifest = ref<any>(null)
const compareRightManifest = ref<any>(null)
const knowledgeQuery = ref({ keyword: '', severity: '' })
const knowledgeDraft = ref<any>(emptyKnowledgeDraft())
const knowledgeTagText = ref('')
const patternText = ref({
  requiredKeywords: '',
  anyKeywords: '',
  excludedKeywords: '',
  modules: '',
  levels: '',
  errorCodes: ''
})
let progressTimer = 0

const stageTimingEntries = computed(() => {
  const timings = replay.overview?.parseStats?.stageTimings
  if (!timings || typeof timings !== 'object') return []
  return Object.entries(timings as Record<string, number>)
})

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
const recommendedFocusTimes = computed(() => (replay.overview?.recommendedFocusTimes || []).slice(0, 5))
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
const eventModeOptions = [
  { label: '全部', value: 'all' },
  { label: '真实故障', value: 'real_fault' },
  { label: '配置提醒', value: 'config_notice' },
  { label: '噪声', value: 'noise' }
]
const eventSortOptions = [
  { label: '按时间', value: 'time' },
  { label: '按严重度', value: 'severity' }
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
const progressMarkerResult = computed(() =>
  replay.eventMarkers.length
    ? aggregateServerMarkers(replay.eventMarkers)
    : aggregateMarkers(replay.events
      .filter((event) => event.level === 'error' || event.type === 'task' || ['lost', 'estop', 'loc_score'].includes(event.category))
    )
)
const progressMarkers = computed(() => progressMarkerResult.value.markers)
const hiddenMarkerCount = computed(() => progressMarkerResult.value.hiddenCount)
const filteredEvents = computed(() =>
  replay.events
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
const caseMetaText = computed(() => {
  const meta = replay.caseMeta || {}
  const parts = [
    meta.status ? `状态：${caseStatusLabel(meta.status)}` : '',
    meta.confirmedRootCause ? `根因：${meta.confirmedRootCause}` : '',
    meta.note ? `备注：${meta.note}` : ''
  ].filter(Boolean)
  return parts.join('；')
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

async function loadAsync(forceReload = false) {
  try {
    robot.disconnectWs()
    await replay.loadSessionAsync(forceReload)
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

async function openAliasManager() {
  try {
    await replay.refreshMapAliases()
    aliasDialogVisible.value = true
  } catch (e: any) {
    ElMessage.error(e && e.message ? e.message : String(e))
  }
}

async function deleteAlias(id: string) {
  try {
    await replay.deleteMapAlias(id)
    ElMessage.success('地图别名已删除')
  } catch (e: any) {
    ElMessage.error(e && e.message ? e.message : String(e))
  }
}

function openAliasExport() {
  window.open(replayMapAliasesExportUrl(), '_blank')
}

function triggerAliasImport() {
  aliasInput.value?.click()
}

async function onAliasFileSelected(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  try {
    const text = await file.text()
    const payload = JSON.parse(text)
    const aliases = Array.isArray(payload) ? payload : payload.aliases
    const res = await replay.importMapAliases(Array.isArray(aliases) ? aliases : [], aliasImportOverwrite.value)
    ElMessage.success(`别名导入完成：新增 ${res.imported || 0}，更新 ${res.updated || 0}，跳过 ${res.skipped || 0}`)
  } catch (e: any) {
    ElMessage.error(e && e.message ? e.message : String(e))
  } finally {
    input.value = ''
  }
}

async function refreshCache() {
  try {
    await replay.refreshCacheSummary()
  } catch (e: any) {
    ElMessage.error(e && e.message ? e.message : String(e))
  }
}

async function openCacheDialog() {
  await refreshCache()
  cacheDialogVisible.value = true
}

async function clearCache(bucket?: string) {
  try {
    await replay.clearCache(bucket)
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
  const meta = [
    `结论：${cause.title}`,
    `建议：${cause.suggestion || '-'}`,
    `触发规则：${(cause.triggeredRules || []).join('、') || '-'}`,
    `正向证据：${(cause.positiveEvidence || []).join('；') || '-'}`,
    `反向证据：${(cause.negativeEvidence || []).join('；') || '-'}`,
    `置信因素：${(cause.confidenceFactors || []).join('；') || '-'}`
  ]
  const events = (cause.evidenceEvents || []).slice(0, 3).map((event: any) => `${event.timestamp} ${event.title}: ${event.detail}`)
  const lines = (cause.evidenceLines || []).slice(0, 3).map((line: any) => line.raw)
  return [...meta, ...events, ...lines].join('\n')
}

async function copyCauseEvidence(cause: any) {
  await copyText(causeEvidenceText(cause), '根因证据已复制')
}

function jump(timeMs: number) {
  replay.seek(timeMs)
  syncProgressValue()
}

async function refreshEvents() {
  replay.eventQuery.offset = 0
  await replay.refreshEvents()
}

async function selectTimelineEvent(row: any) {
  jump(row.timeMs)
  activeTab.value = 'logs'
  highlightedLogKey.value = row.line ? logKey(row.line) : ''
  replay.logFilter.aroundTimeMs = row.timeMs
  replay.logFilter.aroundLines = replay.logFilter.aroundLines || 20
  replay.logFilter.offset = 0
  await replay.refreshLogs()
}

async function selectTask(row: any) {
  selectedTaskId.value = row.id
  replay.logFilter.taskId = row.id
  replay.errorQuery.taskId = row.id
  await replay.refreshLogs()
  await replay.refreshErrorCodes()
  jump(row.startMs)
}

async function showTaskFailureContext(row: any) {
  const line = row.failureLine || row.startEvidence
  const timeMs = Number(line?.timeMs || row.startMs)
  if (!Number.isFinite(timeMs)) return
  jump(timeMs)
  activeTab.value = 'logs'
  highlightedLogKey.value = line ? logKey(line) : ''
  replay.logFilter.aroundTimeMs = timeMs
  replay.logFilter.aroundLines = replay.logFilter.aroundLines || 20
  replay.logFilter.offset = 0
  await replay.refreshLogs()
}

async function clearTaskSelection() {
  selectedTaskId.value = ''
  replay.logFilter.taskId = ''
  replay.errorQuery.taskId = ''
  await replay.refreshLogs()
  await replay.refreshErrorCodes()
}

async function refreshErrorCodes() {
  replay.errorQuery.occurrenceOffset = 0
  await replay.refreshErrorCodes()
}

async function showErrorLogContext(row: any) {
  jump(row.timeMs)
  activeTab.value = 'logs'
  highlightedLogKey.value = row.line ? logKey(row.line) : ''
  replay.logFilter.aroundTimeMs = row.timeMs
  replay.logFilter.aroundLines = replay.logFilter.aroundLines || 20
  replay.logFilter.offset = 0
  await replay.refreshLogs()
}

async function loadCurrentTimeLogs() {
  replay.logFilter.aroundTimeMs = replay.currentMs
  replay.logFilter.aroundLines = replay.logFilter.aroundLines || 20
  replay.logFilter.offset = 0
  await replay.refreshLogs()
}

async function importPackagePath() {
  try {
    const res = await replay.importPackageByPath(packagePath.value)
    robot.map = await getReplayMap()
    robot.connectWs('replay')
    syncProgressValue()
    packageInfoVisible.value = true
    ElMessage.success(`诊断包已导入：${res.package?.manifest?.robotName || packagePath.value}`)
  } catch (e: any) {
    ElMessage.error(e && e.message ? e.message : String(e))
  }
}

async function copyLogContext() {
  try {
    await navigator.clipboard.writeText(replay.logCopyText || '')
    ElMessage.success('日志上下文已复制')
  } catch (e: any) {
    ElMessage.error(e && e.message ? e.message : String(e))
  }
}

async function openFoldDetail(fold: any) {
  selectedFold.value = fold
  foldDialogVisible.value = true
  await replay.loadFoldedDetail(fold.id, 0)
}

async function copyFoldedDetail() {
  try {
    await navigator.clipboard.writeText(replay.foldedDetail.copyText || '')
    ElMessage.success('折叠日志已复制')
  } catch (e: any) {
    ElMessage.error(e && e.message ? e.message : String(e))
  }
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
  packageExportForm.value.startMs = replay.startMs
  packageExportForm.value.endMs = replay.endMs
  packageExportDialogVisible.value = true
}

function downloadDefaultPackage() {
  window.open(replayPackageUrl(), '_blank')
}

async function exportPackageWithOptions() {
  try {
    const pkg = await replay.exportPackageWithOptions(packageExportForm.value)
    ElMessage.success(`诊断包已生成：${pkg?.name || pkg?.file || ''}`)
  } catch (e: any) {
    ElMessage.error(e && e.message ? e.message : String(e))
  }
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
    packageInfoVisible.value = true
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
  const markers = Array.from(buckets.entries()).map(([bucket, list]) => {
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
  const sorted = markers.sort((a, b) => a.timeMs - b.timeMs)
  const visible = sorted.slice(0, 200)
  return {
    markers: visible,
    hiddenCount: Math.max(0, sorted.length - visible.length)
  }
}

function aggregateServerMarkers(markers: any[]) {
  const sorted = markers
    .map((marker, index) => ({
      id: `server-marker-${index}-${marker.startMs}`,
      timeMs: marker.startMs,
      level: marker.level || 'info',
      title: `${marker.title || '事件'}\n错误 ${marker.error || 0} / 警告 ${marker.warning || 0} / 任务 ${marker.task || 0}`,
      left: `${markerPercent(marker.startMs)}%`,
      count: (marker.error || 0) + (marker.warning || 0) + (marker.task || 0)
    }))
    .sort((a, b) => a.timeMs - b.timeMs)
  const visible = sorted.slice(0, 200)
  return {
    markers: visible,
    hiddenCount: Math.max(0, sorted.length - visible.length)
  }
}

function logRowClassName({ row }: { row: any }) {
  return highlightedLogKey.value && logKey(row) === highlightedLogKey.value ? 'highlight-log-row' : ''
}

function logKey(line: any) {
  return line ? `${line.file}:${line.line}` : ''
}

function categoryLabel(category: string) {
  const labels: Record<string, string> = {
    system: '系统',
    service_start: '服务启动',
    connect: '连接',
    config: '配置',
    map: '地图',
    task: '任务',
    error_code: '错误码',
    status: '状态',
    lost: '丢失',
    estop: '急停',
    loc_score: '定位分',
    log: '日志'
  }
  return labels[category] || category || '-'
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

function scoreText(value: unknown) {
  const n = Number(value)
  return Number.isFinite(n) ? `${Math.round(n)}` : '-'
}

function caseStatusLabel(status: string) {
  const labels: Record<string, string> = {
    pending: '待确认',
    reproduced: '已复现',
    located: '已定位',
    fixed: '已修复',
    closed: '已关闭'
  }
  return labels[status] || status || '-'
}

function openBookmarkDialog(source?: any) {
  const timeMs = Number(source?.timeMs || source?.evidenceEvents?.[0]?.timeMs || source?.evidenceLines?.[0]?.timeMs || replay.currentMs || replay.startMs)
  const title = source?.title || source?.code || '人工书签'
  bookmarkForm.value = {
    timeMs,
    timestamp: source?.timestamp || new Date(timeMs).toISOString(),
    title,
    note: source?.detail || source?.suggestion || '',
    eventId: source?.id || '',
    level: source?.level || source?.severity || 'info'
  }
  bookmarkDialogVisible.value = true
}

async function saveBookmark() {
  try {
    await replay.addBookmark(bookmarkForm.value)
    bookmarkDialogVisible.value = false
    ElMessage.success('书签已保存')
  } catch (e: any) {
    ElMessage.error(e && e.message ? e.message : String(e))
  }
}

async function deleteBookmark(id: string) {
  try {
    await replay.deleteBookmark(id)
    ElMessage.success('书签已删除')
  } catch (e: any) {
    ElMessage.error(e && e.message ? e.message : String(e))
  }
}

function openCaseMetaDialog() {
  caseMetaForm.value = { ...(replay.caseMeta || {}), robotName: replay.caseMeta?.robotName || replay.overview?.robotName || '' }
  caseMetaDialogVisible.value = true
}

async function saveCaseMeta() {
  try {
    await replay.saveCaseMeta(caseMetaForm.value)
    caseMetaDialogVisible.value = false
    ElMessage.success('人工结论已保存')
  } catch (e: any) {
    ElMessage.error(e && e.message ? e.message : String(e))
  }
}

function jumpPrevIssue() {
  const issues = issueTimes()
  const target = [...issues].reverse().find((time) => time < replay.currentMs - 1)
  if (Number.isFinite(target)) jump(target as number)
}

function jumpNextIssue() {
  const issues = issueTimes()
  const target = issues.find((time) => time > replay.currentMs + 1)
  if (Number.isFinite(target)) jump(target as number)
}

function issueTimes() {
  return replay.events
    .filter((event) => event.level === 'error' || ['lost', 'estop', 'loc_score', 'error_code'].includes(event.category || event.type))
    .map((event) => Number(event.timeMs))
    .filter((time) => Number.isFinite(time))
    .sort((a, b) => a - b)
}

async function setLoopStart() {
  replay.loopStartMs = replay.currentMs
  if (replay.loopEndMs && replay.loopEndMs <= replay.loopStartMs) replay.loopEndMs = replay.endMs
  await replay.updateControlOptions()
  ElMessage.success('循环起点已设置')
}

async function setLoopEnd() {
  replay.loopEndMs = replay.currentMs
  if (replay.loopStartMs && replay.loopStartMs >= replay.loopEndMs) replay.loopStartMs = replay.startMs
  await replay.updateControlOptions()
  ElMessage.success('循环终点已设置')
}

async function captureSnapshot() {
  const pack = [
    `时间：${currentFrame.value?.timestamp || replay.currentMs}`,
    `位置：${currentFrame.value ? `${currentFrame.value.x},${currentFrame.value.y},${currentFrame.value.theta}` : '-'}`,
    `状态：${currentFrame.value?.status || '-'}`,
    `任务：${currentFrame.value?.taskId || '-'}`,
    `错误：${currentFrame.value?.errors || '-'}`
  ].join('\n')
  await copyText(pack, '当前回放快照已复制')
}

async function copyEventEvidence(row: any) {
  await copyText(contextText(row) || `${row.timestamp} ${row.title}\n${row.detail || ''}`, '事件证据已复制')
}

async function copyCurrentEvidencePack() {
  const pack = [
    `当前时间：${currentFrame.value?.timestamp || replay.currentMs}`,
    `任务：${currentFrame.value?.taskId || '-'}`,
    `状态：${currentFrame.value?.status || '-'}`,
    '',
    replay.logCopyText || ''
  ].join('\n')
  await copyText(pack, '证据包已复制')
}

function openPackageCompareDialog() {
  packageCompareDialogVisible.value = true
}

async function onCompareManifestSelected(event: Event, side: 'left' | 'right') {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  try {
    const json = JSON.parse(await file.text())
    if (side === 'left') compareLeftManifest.value = json
    else compareRightManifest.value = json
    ElMessage.success(`${side === 'left' ? '左侧' : '右侧'} manifest 已读取`)
  } catch (e: any) {
    ElMessage.error(e && e.message ? e.message : String(e))
  } finally {
    input.value = ''
  }
}

async function compareManifests() {
  try {
    await replay.comparePackages(compareLeftManifest.value, compareRightManifest.value)
    ElMessage.success('对比完成')
  } catch (e: any) {
    ElMessage.error(e && e.message ? e.message : String(e))
  }
}

function onLogSelectionChange(rows: any[]) {
  selectedLogRows.value = rows || []
}

function addSelectedLogEvidence() {
  replay.addEvidenceLines(selectedLogRows.value)
  ElMessage.success(`已加入证据 ${selectedLogRows.value.length} 行`)
}

async function openKnowledgeDialog() {
  try {
    await replay.refreshKnowledge(knowledgeQuery.value)
    knowledgeDialogVisible.value = true
  } catch (e: any) {
    ElMessage.error(e && e.message ? e.message : String(e))
  }
}

async function refreshKnowledgeWithQuery() {
  await replay.refreshKnowledge(knowledgeQuery.value)
}

function openBlankKnowledgeDraft() {
  openKnowledgeDraft(emptyKnowledgeDraft())
}

function openKnowledgeDraftFromEvidence() {
  openKnowledgeDraft(buildKnowledgeDraft({
    title: '新诊断知识',
    description: '',
    rootCause: '',
    solution: '',
    lines: replay.selectedEvidenceLines
  }))
}

function openKnowledgeDraftFromEvent(row: any) {
  const lines = [...(row.contextBefore || []), row.line, ...(row.contextAfter || [])].filter(Boolean)
  replay.addEvidenceLines(lines)
  openKnowledgeDraft(buildKnowledgeDraft({
    title: row.title || '时间线知识',
    description: row.detail || '',
    rootCause: row.detail || '',
    solution: '',
    lines
  }))
}

function openKnowledgeDraftFromError(row: any) {
  const line = row.line ? [row.line] : []
  replay.addEvidenceLines(line)
  openKnowledgeDraft(buildKnowledgeDraft({
    title: `${row.code || '错误码'} 诊断知识`,
    description: row.definition?.description || row.source || '',
    rootCause: row.definition?.description || '',
    solution: '',
    lines: line,
    seed: {
      pattern: {
        errorCodes: row.code ? [row.code] : [],
        modules: row.line?.module ? [row.line.module] : [],
        levels: row.line?.level ? [row.line.level] : []
      }
    }
  }))
}

function openKnowledgeDraftFromCause(cause: any) {
  const lines = cause.evidenceLines || []
  replay.addEvidenceLines(lines)
  openKnowledgeDraft(buildKnowledgeDraft({
    title: cause.title || '根因知识',
    description: cause.suggestion || '',
    rootCause: cause.title || '',
    solution: cause.suggestion || '',
    severity: cause.severity || 'warning',
    lines
  }))
}

function openKnowledgeDraftFromAssistant(draft: any) {
  replay.addEvidenceLines(draft.examples?.[0]?.lines || [])
  openKnowledgeDraft(buildKnowledgeDraft({
    title: draft.title || 'AI 辅助诊断知识',
    description: draft.description || '',
    rootCause: draft.rootCause || '',
    solution: draft.solution || '',
    severity: draft.severity || 'warning',
    lines: draft.examples?.[0]?.lines || [],
    seed: {
      tags: draft.tags || ['assistant'],
      pattern: draft.pattern || {}
    }
  }))
}

function openKnowledgeDraft(rule: any) {
  knowledgeDraft.value = normalizeKnowledgeDraft(rule)
  knowledgeTagText.value = (knowledgeDraft.value.tags || []).join(',')
  syncPatternTextFromDraft()
  replay.knowledgeTestResult = null
  knowledgeDraftVisible.value = true
}

function editKnowledgeRule(rule: any) {
  openKnowledgeDraft(JSON.parse(JSON.stringify(rule)))
}

function copyKnowledgeRule(rule: any) {
  const copy = JSON.parse(JSON.stringify(rule))
  copy.id = ''
  copy.title = `${copy.title} 副本`
  copy.hitCount = 0
  copy.recentHits = []
  openKnowledgeDraft(copy)
}

async function toggleKnowledge(row: any, enabled: boolean) {
  try {
    await replay.toggleKnowledgeRule(row.id, enabled)
    ElMessage.success(enabled ? '知识规则已启用' : '知识规则已停用')
  } catch (e: any) {
    ElMessage.error(e && e.message ? e.message : String(e))
  }
}

async function deleteKnowledge(id: string) {
  try {
    await replay.deleteKnowledgeRule(id)
    ElMessage.success('知识规则已删除')
  } catch (e: any) {
    ElMessage.error(e && e.message ? e.message : String(e))
  }
}

async function testKnowledgeRule(rule: any) {
  try {
    await replay.testKnowledgeRule(normalizeKnowledgeDraft(rule))
    ElMessage.success(replay.knowledgeTestResult?.matched ? '试跑命中' : '试跑未命中')
  } catch (e: any) {
    ElMessage.error(e && e.message ? e.message : String(e))
  }
}

async function testKnowledgeDraft() {
  await testKnowledgeRule(draftWithPatternText())
}

async function autoSuggestKnowledgePattern() {
  try {
    const suggestion = await replay.suggestKnowledgePattern(knowledgeDraft.value.examples?.[0]?.lines || replay.selectedEvidenceLines)
    knowledgeDraft.value.pattern = {
      ...knowledgeDraft.value.pattern,
      ...suggestion
    }
    syncPatternTextFromDraft()
    ElMessage.success('已提取候选规则')
  } catch (e: any) {
    ElMessage.error(e && e.message ? e.message : String(e))
  }
}

async function saveKnowledgeDraft() {
  try {
    const draft = draftWithPatternText()
    if (draft.id) await replay.updateKnowledgeRule(draft.id, draft)
    else await replay.createKnowledgeRule(draft)
    knowledgeDraftVisible.value = false
    await replay.refreshKnowledge(knowledgeQuery.value)
    ElMessage.success('诊断知识已保存')
  } catch (e: any) {
    ElMessage.error(e && e.message ? e.message : String(e))
  }
}

function openKnowledgeExport() {
  window.open(replayKnowledgeExportUrl(), '_blank')
}

function triggerKnowledgeImport() {
  knowledgeInput.value?.click()
}

async function onKnowledgeFileSelected(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  try {
    const json = JSON.parse(await file.text())
    const res = await replay.importKnowledgeRules(json, knowledgeImportOverwrite.value)
    ElMessage.success(`知识库导入完成：新增 ${res.imported || 0}，更新 ${res.updated || 0}，跳过 ${res.skipped || 0}`)
  } catch (e: any) {
    ElMessage.error(e && e.message ? e.message : String(e))
  } finally {
    input.value = ''
  }
}

function emptyKnowledgeDraft() {
  return buildKnowledgeDraft({ title: '', description: '', rootCause: '', solution: '', lines: [] })
}

function buildKnowledgeDraft(input: { title: string; description: string; rootCause: string; solution: string; severity?: string; lines: any[]; seed?: any }) {
  return normalizeKnowledgeDraft({
    id: input.seed?.id || '',
    title: input.title,
    description: input.description,
    rootCause: input.rootCause,
    solution: input.solution,
    severity: input.severity || 'warning',
    tags: input.seed?.tags || [],
    enabled: true,
    scope: {},
    pattern: {
      requiredKeywords: [],
      anyKeywords: [],
      excludedKeywords: [],
      modules: input.seed?.pattern?.modules || [],
      levels: input.seed?.pattern?.levels || [],
      errorCodes: input.seed?.pattern?.errorCodes || [],
      windowSeconds: 10,
      minOccurrences: 1,
      confidenceBase: 0.62,
      confidenceWeights: []
    },
    examples: [{
      id: `example-${Date.now()}`,
      title: '研发标注证据',
      lines: input.lines || [],
      createdAt: new Date().toISOString()
    }],
    hitCount: 0
  })
}

function normalizeKnowledgeDraft(rule: any) {
  const draft = {
    ...emptyKnowledgeShape(),
    ...rule,
    pattern: {
      ...emptyKnowledgeShape().pattern,
      ...(rule?.pattern || {})
    },
    examples: Array.isArray(rule?.examples) && rule.examples.length ? rule.examples : [{
      id: `example-${Date.now()}`,
      title: '研发标注证据',
      lines: replay.selectedEvidenceLines,
      createdAt: new Date().toISOString()
    }]
  }
  return draft
}

function emptyKnowledgeShape() {
  return {
    id: '',
    title: '',
    description: '',
    rootCause: '',
    solution: '',
    severity: 'warning',
    tags: [] as string[],
    enabled: true,
    scope: {},
    pattern: {
      requiredKeywords: [] as string[],
      anyKeywords: [] as string[],
      excludedKeywords: [] as string[],
      modules: [] as string[],
      levels: [] as string[],
      errorCodes: [] as string[],
      windowSeconds: 10,
      minOccurrences: 1,
      confidenceBase: 0.62,
      confidenceWeights: [] as any[]
    },
    examples: [] as any[],
    hitCount: 0
  }
}

function syncPatternTextFromDraft() {
  const pattern = knowledgeDraft.value.pattern || {}
  patternText.value = {
    requiredKeywords: (pattern.requiredKeywords || []).join(','),
    anyKeywords: (pattern.anyKeywords || []).join(','),
    excludedKeywords: (pattern.excludedKeywords || []).join(','),
    modules: (pattern.modules || []).join(','),
    levels: (pattern.levels || []).join(','),
    errorCodes: (pattern.errorCodes || []).join(',')
  }
}

function draftWithPatternText() {
  const draft = JSON.parse(JSON.stringify(knowledgeDraft.value))
  draft.tags = splitList(knowledgeTagText.value)
  draft.pattern.requiredKeywords = splitList(patternText.value.requiredKeywords)
  draft.pattern.anyKeywords = splitList(patternText.value.anyKeywords)
  draft.pattern.excludedKeywords = splitList(patternText.value.excludedKeywords)
  draft.pattern.modules = splitList(patternText.value.modules)
  draft.pattern.levels = splitList(patternText.value.levels)
  draft.pattern.errorCodes = splitList(patternText.value.errorCodes).map((item) => item.toUpperCase())
  return draft
}

function splitList(text: string) {
  return String(text || '').split(',').map((item) => item.trim()).filter(Boolean)
}

function highlightLogMessage(text: string) {
  const keywords = [
    replay.logFilter.keyword,
    ...String(replay.logFilter.keywords || '').split(',')
  ].map((it) => it.trim()).filter(Boolean)
  let html = escapeHtml(text)
  for (const keyword of keywords) {
    const escaped = escapeRegExp(escapeHtml(keyword))
    html = html.replace(new RegExp(escaped, 'g'), `<mark>${escapeHtml(keyword)}</mark>`)
  }
  return html
}

function escapeHtml(text: string) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function copyText(text: string, successMessage: string) {
  try {
    await navigator.clipboard.writeText(text || '')
    ElMessage.success(successMessage)
  } catch (e: any) {
    ElMessage.error(e && e.message ? e.message : String(e))
  }
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
.tag-line,
.stage-timing-line {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}
.stage-timing-line {
  margin-top: 6px;
}
.stage-timing-title {
  font-size: 12px;
  color: #606266;
}
.stage-tag {
  font-variant-numeric: tabular-nums;
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
.focus-line {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
  color: #374151;
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
.cause-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin-bottom: 8px;
}
.cause-grid p {
  margin: 4px 0 0;
  color: #6b7280;
  line-height: 1.5;
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
.marker-overflow {
  position: absolute;
  right: 0;
  top: 34px;
  color: #92400e;
  font-size: 11px;
  line-height: 1;
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
.side-section {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid #e5e7eb;
}
.side-section-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  color: #374151;
  font-size: 13px;
  font-weight: 600;
}
.bookmark-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.bookmark-item {
  font-size: 12px;
}
.case-meta-text {
  color: #4b5563;
  font-size: 12px;
  line-height: 1.6;
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
.wide-filter {
  width: 210px;
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
:deep(.highlight-log-row) {
  --el-table-tr-bg-color: #fff7ed;
}
:deep(mark) {
  padding: 0 2px;
  border-radius: 2px;
  background: #fef3c7;
  color: #92400e;
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
.dialog-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}
.dialog-alert {
  margin-bottom: 10px;
}
.dialog-table {
  margin-top: 10px;
}
.knowledge-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 360px;
  gap: 14px;
}
.knowledge-form {
  min-width: 0;
}
.inline-controls {
  display: flex;
  align-items: center;
  gap: 8px;
}
.inline-controls :deep(.el-input-number) {
  width: 100px;
}
.pager {
  margin-top: 8px;
  justify-content: flex-end;
}
</style>
