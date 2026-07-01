<template>
  <div class="laser-config">
    <el-card shadow="never" class="mb">
      <template #header>
        <div class="card-header">
          <span>激光使能</span>
          <el-button size="small" @click="reload">刷新</el-button>
        </div>
      </template>
      <el-alert
        type="warning"
        :closable="false"
        title="安全提示：车辆运动中将拒绝修改激光使能与配置，请在停止/空闲状态下操作。"
        class="mb"
      />
      <div class="enable-row">
        <div v-for="item in enableItems" :key="item.key" class="enable-item">
          <span class="enable-label">{{ item.label }}</span>
          <el-switch
            v-model="item.value"
            :loading="item.loading"
            @change="(val:boolean) => onToggle(item, val)"
          />
        </div>
      </div>
    </el-card>

    <el-card v-if="laserSections.length === 0" shadow="never">
      <el-empty description="未获取到激光参数（请检查后端 /api/params）" />
    </el-card>

    <el-card v-for="sec in laserSections" :key="sec" shadow="never" class="mb">
      <template #header>
        <span>{{ sec }} 参数</span>
      </template>
      <ParamForm :section="sec" :fields="store.paramsInfo[sec]" @saved="reload" />
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { useRobotStore } from '@/stores/robot'
import { setLaserEnable } from '@/api/http'
import ParamForm from '@/components/ParamForm.vue'

const store = useRobotStore()

interface EnableItem {
  key: string // 后端激光键: back/side/top/down_slopg
  field: string // robot 段字段: has_*Laser
  label: string
  value: boolean
  loading: boolean
}

const enableItems = reactive<EnableItem[]>([
  { key: 'back', field: 'has_backLaser', label: '后激光', value: false, loading: false },
  { key: 'side', field: 'has_sideLaser', label: '侧激光', value: false, loading: false },
  { key: 'top', field: 'has_topLaser', label: '顶激光', value: false, loading: false },
  { key: 'down_slopg', field: 'has_downSlopgLaser', label: '下坡激光', value: false, loading: false }
])

const laserSections = computed(() =>
  Object.keys(store.paramsInfo).filter((k) => k.toLowerCase().includes('laser'))
)

function syncEnableFromParams() {
  const robot = store.paramsInfo['robot']
  if (!robot) return
  for (const item of enableItems) {
    const meta = robot[item.field]
    if (meta && meta.default !== undefined) {
      item.value = !!meta.default
    }
  }
}

watch(() => store.paramsInfo, syncEnableFromParams, { deep: true })

async function onToggle(item: EnableItem, val: boolean) {
  item.loading = true
  try {
    const res = await setLaserEnable(item.key, val)
    if (res && res.succeed) {
      ElMessage.success(`${item.label}已${val ? '启用' : '关闭'}`)
      await store.reloadParams()
    } else {
      ElMessage.error('操作失败：' + (res && res.error ? res.error : '未知错误'))
      item.value = !val
    }
  } catch (e: any) {
    ElMessage.error('请求失败：' + (e && e.message ? e.message : e))
    item.value = !val
  } finally {
    item.loading = false
  }
}

async function reload() {
  await store.reloadParams()
  syncEnableFromParams()
}

onMounted(() => {
  if (Object.keys(store.paramsInfo).length === 0) {
    store.reloadParams().then(syncEnableFromParams)
  } else {
    syncEnableFromParams()
  }
})
</script>

<style scoped>
.mb {
  margin-bottom: 16px;
}
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.enable-row {
  display: flex;
  flex-wrap: wrap;
  gap: 32px;
}
.enable-item {
  display: flex;
  align-items: center;
  gap: 10px;
}
.enable-label {
  color: #374151;
}
</style>
