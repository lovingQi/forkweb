import { createRouter, createWebHistory } from 'vue-router'

const routes = [
  {
    path: '/',
    name: 'dashboard',
    component: () => import('@/views/Dashboard.vue'),
    meta: { title: '监控总览' }
  },
  {
    path: '/laser',
    name: 'laser',
    component: () => import('@/views/LaserConfig.vue'),
    meta: { title: '激光配置' }
  },
  {
    path: '/avoid',
    name: 'avoid',
    component: () => import('@/views/AvoidConfig.vue'),
    meta: { title: '避障配置' }
  },
  {
    path: '/control',
    name: 'control',
    component: () => import('@/views/ControlPanel.vue'),
    meta: { title: '控制面板' }
  },
  {
    path: '/replay',
    name: 'replay',
    component: () => import('@/views/Replay.vue'),
    meta: { title: '日志诊断' }
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

export default router
