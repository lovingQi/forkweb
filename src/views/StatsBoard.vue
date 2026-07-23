<template>
  <div class="stats-board-page">
    <el-card shadow="never">
      <template #header>
        <div class="stats-header">
          <span>数据统计</span>
          <div class="date-picker">
            <el-date-picker
              v-model="dateRange"
              type="daterange"
              range-separator="至"
              start-placeholder="开始日期"
              end-placeholder="结束日期"
              value-format="YYYY-MM-DD"
              :clearable="true"
              @change="onDateChange"
            />
            <el-button type="primary" :loading="loading" @click="loadAll">刷新</el-button>
          </div>
        </div>
      </template>

      <el-alert v-if="error" :title="error" type="error" show-icon :closable="false" class="error-alert" />

      <el-row :gutter="16">
        <!-- 工单统计 -->
        <el-col :span="12">
          <el-card shadow="never" class="stats-section" v-loading="loading">
            <template #header>
              <div class="section-title">工单统计</div>
            </template>
            <div class="stat-grid">
              <div class="stat-item">
                <div class="stat-label">工单总数</div>
                <div class="stat-value">{{ ticketStats.totalTickets }}</div>
              </div>
              <div class="stat-item">
                <div class="stat-label">自助解决率</div>
                <div class="stat-value">{{ ticketStats.selfServiceRateText }}</div>
              </div>
              <div class="stat-item">
                <div class="stat-label">平均解决耗时</div>
                <div class="stat-value">{{ ticketStats.avgResolutionText }}</div>
              </div>
            </div>

            <div class="stat-subtitle">状态分布</div>
            <el-table :data="ticketStats.statusDistribution" size="small" stripe>
              <el-table-column prop="status" label="状态" />
              <el-table-column prop="count" label="数量" width="100" />
            </el-table>

            <div class="stat-subtitle">按现场分布</div>
            <el-table :data="ticketStats.bySite" size="small" stripe>
              <el-table-column prop="siteName" label="现场" />
              <el-table-column prop="count" label="数量" width="100" />
            </el-table>

            <div class="stat-subtitle">按问题类型分布</div>
            <el-table :data="ticketStats.byIssueType" size="small" stripe>
              <el-table-column prop="issueType" label="问题类型" />
              <el-table-column prop="count" label="数量" width="100" />
            </el-table>

            <div class="stat-subtitle">按车型分布</div>
            <el-table :data="ticketStats.byVehicleModel" size="small" stripe>
              <el-table-column label="车型">
                <template #default="{ row }">
                  {{ row.vehicleCategoryName ? `${row.vehicleCategoryName} - ` : '' }}{{ row.vehicleModelName }}
                </template>
              </el-table-column>
              <el-table-column prop="count" label="数量" width="100" />
            </el-table>
          </el-card>
        </el-col>

        <!-- 知识库统计 + 人员统计 -->
        <el-col :span="12">
          <el-card shadow="never" class="stats-section" v-loading="loading">
            <template #header>
              <div class="section-title">知识库统计</div>
            </template>
            <div class="stat-grid">
              <div class="stat-item">
                <div class="stat-label">规则总数</div>
                <div class="stat-value">{{ knowledgeStats.totalRules }}</div>
              </div>
              <div class="stat-item">
                <div class="stat-label">已验证规则</div>
                <div class="stat-value">{{ knowledgeStats.verifiedRules }}</div>
              </div>
              <div class="stat-item">
                <div class="stat-label">覆盖率</div>
                <div class="stat-value">{{ knowledgeStats.coverageRateText }}</div>
              </div>
            </div>

            <div class="stat-subtitle">命中次数排行</div>
            <el-table :data="knowledgeStats.topRules" size="small" stripe>
              <el-table-column prop="title" label="规则标题" show-overflow-tooltip />
              <el-table-column prop="hitCount" label="命中次数" width="100" />
              <el-table-column prop="enabled" label="启用" width="80">
                <template #default="{ row }">
                  <el-tag :type="row.enabled ? 'success' : 'info'" size="small">{{ row.enabled ? '是' : '否' }}</el-tag>
                </template>
              </el-table-column>
            </el-table>

            <div class="stat-subtitle">反馈分布</div>
            <div class="feedback-summary">
              <span class="feedback-tag">有用 {{ knowledgeStats.feedbackDistribution.useful }}</span>
              <span class="feedback-tag">部分有用 {{ knowledgeStats.feedbackDistribution.partial }}</span>
              <span class="feedback-tag">没用 {{ knowledgeStats.feedbackDistribution.useless }}</span>
            </div>
          </el-card>

          <el-card shadow="never" class="stats-section" v-loading="loading">
            <template #header>
              <div class="section-title">人员统计</div>
            </template>

            <div class="stat-subtitle">售后提单量排行</div>
            <el-table :data="userStats.afterSalesRanking" size="small" stripe>
              <el-table-column prop="displayName" label="售后人员">
                <template #default="{ row }">
                  {{ row.displayName || row.username }}
                </template>
              </el-table-column>
              <el-table-column prop="count" label="提单量" width="100" />
            </el-table>

            <div class="stat-subtitle">研发解决量排行</div>
            <el-table :data="userStats.rdResolutionRanking" size="small" stripe>
              <el-table-column prop="displayName" label="研发人员">
                <template #default="{ row }">
                  {{ row.displayName || row.username }}
                </template>
              </el-table-column>
              <el-table-column prop="count" label="解决量" width="100" />
            </el-table>
          </el-card>
        </el-col>
      </el-row>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import {
  fetchStatsKnowledge,
  fetchStatsTickets,
  fetchStatsUsers,
  type DateRangeQuery,
  type KnowledgeStats,
  type TicketStats,
  type UserStats
} from '@/api/stats'

const loading = ref(false)
const error = ref('')
const dateRange = ref<[string, string] | null>(null)

const emptyTicketStats: TicketStats = {
  totalTickets: 0,
  statusDistribution: [],
  selfServiceRate: 0,
  selfServiceRateText: '0.0%',
  avgResolutionSeconds: 0,
  avgResolutionText: '无数据',
  bySite: [],
  byIssueType: [],
  byVehicleModel: []
}

const emptyKnowledgeStats: KnowledgeStats = {
  totalRules: 0,
  verifiedRules: 0,
  coverageRate: 0,
  coverageRateText: '0.0%',
  topRules: [],
  feedbackDistribution: { useful: 0, partial: 0, useless: 0 }
}

const emptyUserStats: UserStats = {
  afterSalesRanking: [],
  rdResolutionRanking: []
}

const ticketStats = reactive<TicketStats>({ ...emptyTicketStats })
const knowledgeStats = reactive<KnowledgeStats>({ ...emptyKnowledgeStats })
const userStats = reactive<UserStats>({ ...emptyUserStats })

function getRangeQuery(): DateRangeQuery | undefined {
  if (!dateRange.value || !dateRange.value[0] || !dateRange.value[1]) return undefined
  return { startDate: dateRange.value[0], endDate: dateRange.value[1] }
}

function onDateChange() {
  loadAll()
}

async function loadAll() {
  loading.value = true
  error.value = ''
  const range = getRangeQuery()
  try {
    const [tickets, knowledge, users] = await Promise.all([
      fetchStatsTickets(range),
      fetchStatsKnowledge(),
      fetchStatsUsers(range)
    ])
    Object.assign(ticketStats, tickets)
    Object.assign(knowledgeStats, knowledge)
    Object.assign(userStats, users)
  } catch (e) {
    error.value = e instanceof Error ? e.message : '加载统计失败'
    ElMessage.error(error.value)
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  loadAll()
})
</script>

<style scoped>
.stats-board-page {
  padding: 0;
}
.stats-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 16px;
  font-weight: 600;
  color: #1e293b;
}
.date-picker {
  display: flex;
  align-items: center;
  gap: 12px;
}
.error-alert {
  margin-bottom: 16px;
}
.stats-section {
  margin-bottom: 16px;
}
.stat-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 14px;
  margin-bottom: 20px;
}
.stat-item {
  background: #f8fafc;
  border-radius: 10px;
  padding: 16px 14px;
  text-align: center;
  border-left: 4px solid #2563eb;
  transition: box-shadow 0.2s;
}
.stat-item:hover {
  box-shadow: 0 2px 8px rgba(37, 99, 235, 0.1);
}
.stat-item:nth-child(2) {
  border-left-color: #16a34a;
}
.stat-item:nth-child(3) {
  border-left-color: #f59e0b;
}
.stat-label {
  font-size: 12px;
  color: #64748b;
  margin-bottom: 6px;
}
.stat-value {
  font-size: 26px;
  font-weight: 700;
  color: #0f172a;
}
.stat-subtitle {
  font-size: 14px;
  font-weight: 600;
  color: #334155;
  margin: 18px 0 10px;
  padding-left: 10px;
  border-left: 3px solid #2563eb;
}
.feedback-summary {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}
.feedback-tag {
  background: #f1f5f9;
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 13px;
  color: #475569;
  font-weight: 500;
}
</style>
