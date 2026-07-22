import { createRouter, createWebHistory } from 'vue-router'

const routes = [
  {
    path: '/',
    name: 'dashboard',
    redirect: '/tickets'
  },
  {
    path: '/dashboard',
    name: 'dashboardView',
    component: () => import('@/views/Dashboard.vue'),
    meta: { title: '监控总览', requiresRd: true }
  },
  {
    path: '/laser',
    name: 'laser',
    component: () => import('@/views/LaserConfig.vue'),
    meta: { title: '激光配置', requiresRd: true }
  },
  {
    path: '/avoid',
    name: 'avoid',
    component: () => import('@/views/AvoidConfig.vue'),
    meta: { title: '避障配置', requiresRd: true }
  },
  {
    path: '/control',
    name: 'control',
    component: () => import('@/views/ControlPanel.vue'),
    meta: { title: '控制面板', requiresRd: true }
  },
  {
    path: '/replay',
    name: 'replay',
    component: () => import('@/views/Replay.vue'),
    meta: { title: '日志诊断', requiresRd: true }
  },
  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/Login.vue'),
    meta: { title: '登录', public: true }
  },
  {
    path: '/tickets',
    name: 'tickets',
    component: () => import('@/views/TicketList.vue'),
    meta: { title: '工单管理' }
  },
  {
    path: '/tickets/new',
    name: 'ticketNew',
    component: () => import('@/views/TicketNew.vue'),
    meta: { title: '新建工单' }
  },
  {
    path: '/tickets/:id',
    name: 'ticketDetail',
    component: () => import('@/views/TicketDetail.vue'),
    meta: { title: '工单详情' }
  },
  {
    path: '/users',
    name: 'users',
    component: () => import('@/views/UserManagement.vue'),
    meta: { title: '用户管理', requiresAdmin: true }
  },
  {
    path: '/sites',
    name: 'sites',
    component: () => import('@/views/SiteManage.vue'),
    meta: { title: '现场管理', requiresRd: true }
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

router.beforeEach((to, _from, next) => {
  const token = localStorage.getItem('forkweb_token')
  const cachedUser = JSON.parse(localStorage.getItem('forkweb_user') || 'null')
  if (!to.meta.public && !token) {
    next('/login')
    return
  }
  if (to.meta.requiresAdmin && cachedUser?.role !== 'admin') {
    next('/tickets')
    return
  }
  if (to.meta.requiresRd && !['admin', 'rd'].includes(cachedUser?.role)) {
    next('/tickets')
    return
  }
  if (to.path === '/login' && token) {
    next('/tickets')
    return
  }
  next()
})

export default router
