<template>
  <el-container class="app-root">
    <el-aside v-if="route.path !== '/login'" width="200px" class="app-aside">
      <div class="logo"><img src="/favicon.png" alt="" class="logo-icon" /><span>Junion</span></div>
      <el-menu :default-active="activeMenu" router class="app-menu">
        <!-- 工单管理：所有角色可见 -->
        <el-menu-item index="/tickets">
          <el-icon><Document /></el-icon>
          <span>工单管理</span>
        </el-menu-item>

        <!-- 研发/管理员高级工具 -->
        <template v-if="auth.isRd">
          <el-menu-item index="/replay">
            <el-icon><DataAnalysis /></el-icon>
            <span>日志诊断</span>
          </el-menu-item>
          <el-menu-item index="/sites">
            <el-icon><OfficeBuilding /></el-icon>
            <span>现场管理</span>
          </el-menu-item>
          <el-menu-item index="/vehicles">
            <el-icon><Van /></el-icon>
            <span>车型管理</span>
          </el-menu-item>
          <el-menu-item index="/stats">
            <el-icon><TrendCharts /></el-icon>
            <span>数据统计</span>
          </el-menu-item>
        </template>

        <!-- 管理员专属 -->
        <el-menu-item v-if="auth.isAdmin" index="/users">
          <el-icon><User /></el-icon>
          <span>用户管理</span>
        </el-menu-item>
      </el-menu>
    </el-aside>

    <el-container>
      <el-header v-if="route.path !== '/login'" class="app-header">
        <span class="title">{{ currentTitle }}</span>
        <div class="conn">
          <template v-if="auth.isLoggedIn">
            <span class="user-name">{{ auth.user?.displayName || auth.user?.username }}</span>
            <el-tag size="small" :type="roleTagType" effect="plain">{{ roleLabel }}</el-tag>
            <el-button size="small" @click="onLogout">退出</el-button>
          </template>
          <template v-else>
            <span class="robot-name">{{ store.name || '未知设备' }}</span>
            <el-tag :type="store.connected ? 'success' : 'danger'" size="small" effect="dark">
              {{ store.connected ? '已连接' : '未连接' }}
            </el-tag>
          </template>
        </div>
      </el-header>
      <el-main :class="route.path === '/login' ? 'login-main' : 'app-main'">
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>

<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useRobotStore } from '@/stores/robot'
import { useAuthStore } from '@/stores/auth'

const store = useRobotStore()
const auth = useAuthStore()
const route = useRoute()
const router = useRouter()

const activeMenu = computed(() => route.path)
const currentTitle = computed(() => (route.meta.title as string) || 'Junion')

const roleLabel = computed(() => {
  const role = auth.user?.role
  if (role === 'admin') return '管理员'
  if (role === 'rd') return '研发'
  if (role === 'after_sales') return '售后'
  return ''
})

const roleTagType = computed(() => {
  const role = auth.user?.role
  if (role === 'admin') return 'danger'
  if (role === 'rd') return 'warning'
  return 'info'
})

onMounted(async () => {
  await auth.restoreSession()
  if (route.path === '/replay' || route.path === '/login') return
  store.loadInitial()
  store.connectWs()
})

watch(
  () => route.path,
  (path, oldPath) => {
    if (path === '/replay' || path === '/login') {
      store.disconnectWs()
      return
    }
    if (oldPath === '/replay' || oldPath === '/login') {
      store.loadInitial()
      store.connectWs()
    }
  }
)

async function onLogout() {
  await auth.logout()
  router.push('/login')
}

onBeforeUnmount(() => {
  store.disconnectWs()
})
</script>

<style>
html,
body,
#app {
  height: 100%;
  margin: 0;
  font-family: -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
}
.app-root {
  height: 100%;
}
.app-aside {
  background: #1f2937;
  color: #fff;
  display: flex;
  flex-direction: column;
}
.logo {
  height: 60px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-size: 16px;
  font-weight: 600;
  color: #fff;
  background: #111827;
}
.logo-icon {
  width: 28px;
  height: 28px;
  border-radius: 6px;
}
.app-menu {
  border-right: none;
  background: #1f2937;
  flex: 1;
}
.app-menu .el-menu-item {
  color: #cbd5e1;
}
.app-menu .el-menu-item:hover {
  background: rgba(255, 255, 255, 0.06);
}
.app-menu .el-menu-item.is-active {
  color: #fff;
  background: #2563eb;
}
.app-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #fff;
  border-bottom: none;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
}
.app-header .title {
  font-size: 17px;
  font-weight: 600;
  color: #1e293b;
}
.app-header .conn {
  display: flex;
  align-items: center;
  gap: 10px;
}
.app-header .robot-name {
  color: #6b7280;
  font-size: 14px;
}
.app-header .user-name {
  color: #374151;
  font-size: 14px;
  font-weight: 500;
}
.app-main {
  background: #f1f5f9;
  padding: 20px;
}
.login-main {
  padding: 0;
}

/* ===== 全局美化 ===== */
.el-card {
  border-radius: 10px !important;
  border: 1px solid #e2e8f0 !important;
}
.el-card__header {
  border-bottom: 1px solid #e2e8f0 !important;
  padding: 14px 20px !important;
}
.el-table th.el-table__cell {
  background: #f8fafc !important;
  color: #475569 !important;
  font-weight: 600 !important;
  font-size: 13px !important;
}
.el-table td.el-table__cell {
  padding: 10px 0 !important;
}
.section-title {
  font-size: 15px;
  font-weight: 600;
  color: #1e293b;
  margin: 20px 0 12px;
  padding-left: 10px;
  border-left: 3px solid #2563eb;
}
.section-title:first-child {
  margin-top: 0;
}
</style>
