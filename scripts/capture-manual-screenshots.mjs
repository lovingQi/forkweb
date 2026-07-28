// 为 docs/user-manual.md 自动生成演示数据并截图。
// 前置条件：
//   1. 隔离后端已启动（建议 FORKWEB_CACHE_DIR/FORKWEB_CONFIG_DIR 指向临时目录），默认 http://127.0.0.1:18090
//   2. 前端 Vite 已启动，默认 http://127.0.0.1:5273，public/config.js 指向上述后端
// 用法：node scripts/capture-manual-screenshots.mjs
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import { chromium, request } from '@playwright/test'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BASE = process.env.SHOT_BASE_URL || 'http://127.0.0.1:5273'
const API = process.env.SHOT_API_BASE || 'http://127.0.0.1:18090'
const OUT_DIR = path.join(root, 'docs/images')
const SAMPLE_LOG = path.join(root, 'tests/e2e/fixtures/sample-log/log-20260715-084920.log')
const SAMPLE_LOG_DIR = path.dirname(SAMPLE_LOG)
const VIEWPORT = { width: 1440, height: 900 }

const USERS = {
  admin: { username: 'admin', password: 'admin123' },
  afterSales: { username: 'zhangsan', password: 'demo1234', role: 'after_sales', displayName: '售后-张三' },
  rd: { username: 'lisi', password: 'demo1234', role: 'rd', displayName: '研发-李四' }
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true })
  const api = await request.newContext({ baseURL: API })

  // ── 造演示数据 ──────────────────────────────────────
  const adminToken = await login(api, USERS.admin)
  await ensureUser(api, adminToken, USERS.afterSales)
  await ensureUser(api, adminToken, USERS.rd)
  const siteId = await ensureSite(api, adminToken, '华东演示仓库')
  const modelId = await ensureVehicleModel(api, adminToken, '平衡重叉车', 'FK-15')
  await api.put(`/api/sites/${siteId}`, {
    headers: auth(adminToken),
    data: { name: '华东演示仓库', vehicleModelIds: [modelId] }
  })
  await ensureKnowledgeRule(api, adminToken)

  const afterSalesToken = await login(api, USERS.afterSales)
  const ticketId = await ensureDemoTicket(api, afterSalesToken, siteId, modelId)
  console.log(`演示工单 #${ticketId} 就绪`)

  // ── 截图 ────────────────────────────────────────────
  const browser = await chromium.launch()
  const context = await browser.newContext({ viewport: VIEWPORT, baseURL: BASE })
  const page = await context.newPage()

  // 01 登录页
  await page.goto('/login')
  await page.locator('input[placeholder="请输入用户名"]').fill('zhangsan')
  await page.locator('input[placeholder="请输入密码"]').fill('demo1234')
  await shot(page, '01-login.png')

  // 售后视角
  await loginUi(page, USERS.afterSales)

  // 02 工单列表
  await page.goto('/tickets')
  await page.locator('.el-table__row').first().waitFor()
  await shot(page, '02-ticket-list.png')

  // 03 新建工单（填写后截图，不提交）
  await page.goto('/tickets/new')
  await page.locator('input[placeholder="一句话概括问题"]').fill('2 号车避障频繁误触发')
  await page.locator('.el-form-item', { has: page.locator('label', { hasText: '项目现场' }) }).locator('.el-select').click()
  await page.getByRole('listbox').getByText('华东演示仓库').click()
  await page.locator('.el-form-item', { has: page.locator('label', { hasText: '车型' }) }).locator('.el-select').click()
  await page.getByRole('listbox').getByText('FK-15').click()
  await page.locator('textarea').first().fill('今天上午 10 点起，2 号车在 A 区通道多次无障碍物急停，重启后仍复现。')
  await page.locator('input[type="file"]').setInputFiles(SAMPLE_LOG)
  await page.locator('.upload-file-status.success').waitFor({ timeout: 60_000 })
  await shot(page, '03-ticket-new.png')

  // 04 工单详情（含排查向导）
  const detailUrl = `/tickets/${ticketId}`
  await page.goto(detailUrl)
  await page.locator('.ticket-title').waitFor()
  await page.locator('.troubleshooting-guide .path-title').first().waitFor({ timeout: 15_000 })
  await shot(page, '04-ticket-detail.png', { fullPage: true })

  // 05 排查向导区域
  await page.locator('.troubleshooting-guide').scrollIntoViewIfNeeded()
  await page.waitForTimeout(300)
  await shot(page, '05-troubleshooting-guide.png')

  // 开始排查，进入现场排查中
  const startBtn = page.getByRole('button', { name: '开始排查' })
  if (await startBtn.isVisible().catch(() => false)) {
    await startBtn.click()
    await page.locator('.detail-header').getByText('现场排查中').waitFor()
  }

  // 06 安全确认弹窗（现场操作步骤选“已通过”触发）
  await expandGuide(page)
  const fieldStep = page.locator('.step-row', { has: page.getByText('现场操作') }).first()
  await fieldStep.scrollIntoViewIfNeeded()
  await fieldStep.locator('.el-radio-button__inner', { hasText: '已通过' }).click()
  await page.getByRole('dialog', { name: '安全确认' }).waitFor()
  await page.waitForTimeout(500)
  await shot(page, '06-safety-confirm.png')
  await page.getByRole('dialog', { name: '安全确认' }).getByRole('button', { name: '已确认安全' }).click()

  // 07 不适用原因弹窗
  await expandGuide(page)
  const firstStep = page.locator('.step-row').first()
  await firstStep.scrollIntoViewIfNeeded()
  await firstStep.locator('.el-radio-button__inner', { hasText: '不适用' }).click()
  const reasonDialog = page.getByRole('dialog', { name: '选择不适用原因' })
  await reasonDialog.waitFor()
  await reasonDialog.locator('.el-select').click()
  await page.getByRole('listbox').getByText('工具不可用').click()
  await page.waitForTimeout(500)
  await shot(page, '07-na-reason.png')
  await reasonDialog.getByRole('button', { name: '提交' }).click()

  // 08 评论与事件流
  await page.locator('.comment-section textarea').fill('现场已检查参数目录，确认缺少激光参数文件，准备补齐后重启。')
  await page.locator('.comment-section').getByRole('button', { name: '发表评论' }).click()
  await page.locator('.event-comment').first().waitFor()
  await page.locator('.section-title', { hasText: '事件流' }).scrollIntoViewIfNeeded()
  await page.waitForTimeout(300)
  await shot(page, '08-events.png')

  // 09 升级研发弹窗
  await page.getByRole('button', { name: '需要研发介入' }).click()
  const escalateDialog = page.getByRole('dialog', { name: '升级研发' })
  await escalateDialog.waitFor()
  await escalateDialog.locator('.el-select').click()
  await page.getByRole('listbox').getByText('按向导排查仍未解决').click()
  await page.waitForTimeout(500)
  await shot(page, '09-escalate.png')
  await escalateDialog.getByRole('button', { name: '提交' }).click()
  await page.locator('.detail-header').getByText('待研发介入').waitFor()

  // 研发视角
  await loginUi(page, USERS.rd)

  // 10 待研发介入详情（认领入口）
  await page.goto(detailUrl)
  await page.getByRole('button', { name: '认领工单' }).waitFor()
  await page.getByRole('button', { name: '认领工单' }).scrollIntoViewIfNeeded()
  await page.waitForTimeout(300)
  await shot(page, '10-rd-claim.png')
  await page.getByRole('button', { name: '认领工单' }).click()
  await page.locator('.detail-header').getByText('研发处理中').waitFor()

  // 11 填写解决方案弹窗
  await page.getByRole('button', { name: '标记已解决' }).click()
  const resolveDialog = page.getByRole('dialog', { name: '填写解决方案' })
  await resolveDialog.waitFor()
  await resolveDialog.locator('textarea').fill('已补齐缺失的激光参数文件，重启定位程序后定位恢复正常，观察 2 小时无复现。')
  await page.waitForTimeout(500)
  await shot(page, '11-resolve-dialog.png')
  await resolveDialog.getByRole('button', { name: '提交' }).click()
  await page.locator('.detail-header').getByText('已解决').waitFor()

  // 12 修改问题类型弹窗（截图后取消，不改动数据）
  await page.locator('.issue-type-cell').getByRole('button', { name: '修改' }).click()
  const issueDialog = page.getByRole('dialog', { name: '修改问题类型' })
  await issueDialog.waitFor()
  await page.waitForTimeout(500)
  await shot(page, '12-issue-type.png')
  await page.keyboard.press('Escape')

  // 13 日志诊断回放 /replay
  await page.goto('/replay')
  const logDirInput = page.locator('.el-form-item', { has: page.locator('label', { hasText: '日志目录' }) }).locator('input')
  await logDirInput.fill(SAMPLE_LOG_DIR)
  await page.getByRole('button', { name: '加载诊断' }).click()
  await page.getByRole('button', { name: 'Markdown' }).and(page.locator(':not([disabled])')).waitFor({ timeout: 120_000 })
  await page.waitForTimeout(1000)
  await shot(page, '13-replay.png')

  // 14 知识库管理弹窗
  await page.getByRole('button', { name: '知识库', exact: true }).click()
  await page.locator('.el-dialog').first().waitFor()
  await page.waitForTimeout(500)
  await shot(page, '14-knowledge.png')
  await page.keyboard.press('Escape')

  // 15 现场管理 / 16 车型管理 / 17 数据统计
  await page.goto('/sites')
  await page.locator('.el-table__row').first().waitFor()
  await shot(page, '15-sites.png')
  await page.goto('/vehicles')
  await page.locator('.el-table__row').first().waitFor()
  await shot(page, '16-vehicles.png')
  await page.goto('/stats')
  await page.locator('.stats-section').first().waitFor()
  await shot(page, '17-stats.png', { fullPage: true })

  // 管理员视角：18 用户管理
  await loginUi(page, USERS.admin)
  await page.goto('/users')
  await page.locator('.el-table__row').first().waitFor()
  await shot(page, '18-users.png')

  await browser.close()
  await api.dispose()
  console.log(`截图完成，输出目录：${OUT_DIR}`)
}

// ── 数据准备工具函数 ────────────────────────────────────

async function login(api, { username, password }) {
  const res = await api.post('/api/auth/login', { data: { username, password } })
  if (!res.ok()) throw new Error(`登录 ${username} 失败: ${await res.text()}`)
  return (await res.json()).token
}

async function ensureUser(api, adminToken, { username, password, role, displayName }) {
  const res = await api.post('/api/auth/users', {
    headers: auth(adminToken),
    data: { username, password, role, displayName }
  })
  if (!res.ok()) {
    const text = await res.text()
    if (!text.includes('已存在')) throw new Error(`创建用户 ${username} 失败: ${text}`)
  }
}

async function ensureSite(api, adminToken, name) {
  const listRes = await api.get('/api/sites', { headers: auth(adminToken) })
  const existing = ((await listRes.json()).sites || []).find((s) => s.name === name)
  if (existing) return existing.id
  const res = await api.post('/api/sites', { headers: auth(adminToken), data: { name } })
  if (!res.ok()) throw new Error(`创建现场失败: ${await res.text()}`)
  return (await res.json()).site.id
}

async function ensureVehicleModel(api, adminToken, categoryName, modelName) {
  const catList = await api.get('/api/vehicles/categories', { headers: auth(adminToken) })
  let category = ((await catList.json()).categories || []).find((c) => c.name === categoryName)
  if (!category) {
    const res = await api.post('/api/vehicles/categories', { headers: auth(adminToken), data: { name: categoryName } })
    if (!res.ok()) throw new Error(`创建车型类别失败: ${await res.text()}`)
    category = (await res.json()).category
  }
  const modelList = await api.get(`/api/vehicles/models?categoryId=${category.id}`, { headers: auth(adminToken) })
  const existing = ((await modelList.json()).models || []).find((m) => m.name === modelName)
  if (existing) return existing.id
  const res = await api.post('/api/vehicles/models', {
    headers: auth(adminToken),
    data: { categoryId: category.id, name: modelName }
  })
  if (!res.ok()) throw new Error(`创建车型失败: ${await res.text()}`)
  return (await res.json()).model.id
}

async function ensureKnowledgeRule(api, adminToken) {
  const title = '参数文件缺失排查'
  const listRes = await api.get('/api/replay/knowledge', { headers: auth(adminToken) })
  if (((await listRes.json()).rules || []).some((r) => r.title === title)) return
  const res = await api.post('/api/replay/knowledge', {
    headers: auth(adminToken),
    data: {
      title,
      description: '启动或运行过程中提示参数文件不存在，常伴随激光配置加载失败、定位异常。',
      rootCause: '车端参数目录缺少必需的参数文件（如激光安装参数）',
      solution: '对照标准参数清单补齐缺失文件后重启定位程序',
      severity: 'warning',
      publicationStatus: 'verified',
      enabled: true,
      pattern: {
        requiredKeywords: ['does not exist'],
        anyKeywords: ['Params', 'laser'],
        modules: ['JParams', 'mg_main'],
        windowSeconds: 10,
        minOccurrences: 1,
        confidenceBase: 0.7,
        confidenceWeights: []
      },
      guideSteps: [
        { stepNo: 1, title: '检查参数目录中激光参数文件是否存在', stepType: 'readonly_check', isCritical: true },
        { stepNo: 2, title: '补齐缺失的参数文件并重启定位程序', stepType: 'field_operation', isCritical: true },
        { stepNo: 3, title: '确认激光配置加载正常、定位分恢复', stepType: 'readonly_check', isCritical: false }
      ],
      tags: ['参数', '激光']
    }
  })
  if (!res.ok()) throw new Error(`创建知识规则失败: ${await res.text()}`)
}

async function ensureDemoTicket(api, afterSalesToken, siteId, vehicleModelId) {
  const logBuffer = await fs.readFile(SAMPLE_LOG)
  const uploadRes = await api.post('/api/tickets/upload-files', {
    headers: auth(afterSalesToken),
    multipart: {
      files: { name: path.basename(SAMPLE_LOG), mimeType: 'text/plain', buffer: logBuffer }
    }
  })
  if (!uploadRes.ok()) throw new Error(`预上传日志失败: ${await uploadRes.text()}`)
  const tempFileId = (await uploadRes.json()).files[0].tempFileId

  const createRes = await api.post('/api/tickets', {
    headers: auth(afterSalesToken),
    data: {
      title: '3 号车定位丢失',
      description: '3 号车在 B 区巷道内行驶时定位分骤降后丢失，车辆急停，重启后短暂恢复又复现。',
      siteId,
      vehicleModelId,
      tempFileIds: tempFileId,
      aiEnabled: 'false'
    }
  })
  if (!createRes.ok()) throw new Error(`创建工单失败: ${await createRes.text()}`)
  const ticketId = (await createRes.json()).ticket.id

  // 等待分析完成并出现排查向导
  for (let i = 0; i < 60; i++) {
    await sleep(2000)
    const res = await api.get(`/api/tickets/${ticketId}`, { headers: auth(afterSalesToken) })
    const body = await res.json()
    if (body.ticket?.status === 'pending_field_troubleshooting') return ticketId
  }
  throw new Error(`工单 #${ticketId} 分析未在预期时间内完成`)
}

// ── 截图工具函数 ────────────────────────────────────────

async function loginUi(page, { username, password }) {
  await page.goto('/')
  await page.evaluate(() => {
    localStorage.removeItem('forkweb_token')
    localStorage.removeItem('forkweb_user')
  })
  await page.goto('/login')
  await page.locator('input[placeholder="请输入用户名"]').fill(username)
  await page.locator('input[placeholder="请输入密码"]').fill(password)
  await page.getByRole('button', { name: '登录' }).click()
  await page.waitForURL(/\/tickets/)
}

async function expandGuide(page) {
  const firstStep = page.locator('.step-row').first()
  if (await firstStep.isVisible().catch(() => false)) return
  await page.locator('.el-collapse-item__header').first().click()
  await firstStep.waitFor()
}

async function shot(page, name, options = {}) {
  await page.screenshot({ path: path.join(OUT_DIR, name), ...options })
  console.log(`✔ ${name}`)
}

function auth(token) {
  return { Authorization: `Bearer ${token}` }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
