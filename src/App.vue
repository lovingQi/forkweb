<template>
  <el-container class="app-root">
    <el-aside width="200px" class="app-aside">
      <div class="logo">叉车单机监控</div>
      <el-menu :default-active="activeMenu" router class="app-menu">
        <el-menu-item index="/">
          <el-icon><Monitor /></el-icon>
          <span>监控总览</span>
        </el-menu-item>
        <el-menu-item index="/laser">
          <el-icon><Aim /></el-icon>
          <span>激光配置</span>
        </el-menu-item>
        <el-menu-item index="/avoid">
          <el-icon><MagicStick /></el-icon>
          <span>避障配置</span>
        </el-menu-item>
        <el-menu-item index="/control">
          <el-icon><Operation /></el-icon>
          <span>控制面板</span>
        </el-menu-item>
        <el-menu-item index="/replay">
          <el-icon><DataAnalysis /></el-icon>
          <span>日志诊断</span>
        </el-menu-item>
      </el-menu>
    </el-aside>

    <el-container>
      <el-header class="app-header">
        <span class="title">{{ currentTitle }}</span>
        <div class="conn">
          <span class="robot-name">{{ store.name || '未知设备' }}</span>
          <el-tag :type="store.connected ? 'success' : 'danger'" size="small" effect="dark">
            {{ store.connected ? '已连接' : '未连接' }}
          </el-tag>
        </div>
      </el-header>
      <el-main class="app-main">
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>

<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useRobotStore } from '@/stores/robot'

const store = useRobotStore()
const route = useRoute()

const activeMenu = computed(() => route.path)
const currentTitle = computed(() => (route.meta.title as string) || '叉车单机监控')

onMounted(() => {
  if (route.path === '/replay') return
  store.loadInitial()
  store.connectWs()
})

watch(
  () => route.path,
  (path, oldPath) => {
    if (path === '/replay') {
      store.disconnectWs()
      return
    }
    if (oldPath === '/replay') {
      store.loadInitial()
      store.connectWs()
    }
  }
)

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
  line-height: 60px;
  text-align: center;
  font-size: 16px;
  font-weight: 600;
  color: #fff;
  background: #111827;
}
.app-menu {
  border-right: none;
  background: #1f2937;
  flex: 1;
}
.app-menu .el-menu-item {
  color: #cbd5e1;
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
  border-bottom: 1px solid #e5e7eb;
}
.app-header .title {
  font-size: 18px;
  font-weight: 600;
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
.app-main {
  background: #f3f4f6;
  padding: 16px;
}
</style>
