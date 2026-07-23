import path from 'path'
import fs from 'fs/promises'
import { fileURLToPath } from 'url'
import { chromium, expect, test } from '@playwright/test'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const sampleLogPath = path.join(__dirname, 'fixtures', 'sample-log', 'log-20260715-084920.log')
const requiredE2eBaseUrl = process.env.REPLAY_E2E_BASE_URL
const requiredE2eApiBase = process.env.REPLAY_E2E_API_BASE

if (!requiredE2eBaseUrl || !requiredE2eApiBase) {
  throw new Error('请在隔离环境中设置 REPLAY_E2E_BASE_URL 和 REPLAY_E2E_API_BASE 后再运行工单 E2E 测试')
}

test.describe.serial('工单主流程', () => {
  let browser: any
  let context: any
  let page: any
  let siteName: string = ''
  let afterSalesToken: string = ''
  let adminToken: string = ''
  let apiBase: string = ''
  let ticketDetailUrl: string = ''
  const unexpectedConsole: string[] = []

  test.beforeAll(async () => {
    browser = await chromium.launch()
    context = await browser.newContext()
    page = await context.newPage()

    page.on('console', (message: any) => {
      if (message.type() !== 'error') return
      const text = message.text()
      // 开发环境下 vite 代理到未启动的 8080 服务会产生 500，这里过滤掉
      if (text.includes('Failed to load resource: the server responded with a status of 500')) return
      if (text.includes('Failed to load resource: net::ERR_CONNECTION_REFUSED')) return
      if (text.includes('/api/state') || text.includes('/api/map') || text.includes('/api/params') || text.includes('/api/auth/users') || text.includes('/ws/high') || text.includes('/ws/low')) return
      unexpectedConsole.push(text)
    })

    page.on('pageerror', (error: any) => unexpectedConsole.push(error.message))

    // 从运行时配置读取后端地址
    const configRes = await page.request.get('/config.js')
    if (!configRes.ok()) {
      console.error('读取 config.js 失败', configRes.status(), await configRes.text())
    }
    const configText = await configRes.text()
    const match = configText.match(/replayApiBase:\s*['"]([^'"]+)['"]/)
    apiBase = (process.env.REPLAY_E2E_API_BASE || match?.[1] || '').replace(/\/api$/, '')
    if (!apiBase) {
      throw new Error('无法确定后端 API 地址')
    }

    // 登录管理员
    const adminLoginRes = await page.request.post(`${apiBase}/api/auth/login`, {
      data: { username: 'admin', password: 'admin123' }
    })
    expect(adminLoginRes.ok()).toBeTruthy()
    const adminLogin = await adminLoginRes.json() as { token: string }
    adminToken = adminLogin.token

    // 创建售后用户
    const createUserRes = await page.request.post(`${apiBase}/api/auth/users`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        username: 'aftersales',
        password: 'aftersales',
        role: 'after_sales',
        displayName: '售后测试'
      }
    })
    if (!createUserRes.ok()) {
      const error = await createUserRes.text()
      // 用户可能已存在
      if (!error.includes('已存在')) {
        console.error('创建售后用户失败', createUserRes.status(), error)
        expect(createUserRes.ok()).toBeTruthy()
      }
    }

    // 登录售后用户
    const afterSalesLoginRes = await page.request.post(`${apiBase}/api/auth/login`, {
      data: { username: 'aftersales', password: 'aftersales' }
    })
    expect(afterSalesLoginRes.ok()).toBeTruthy()
    const afterSalesLogin = await afterSalesLoginRes.json() as { token: string }
    afterSalesToken = afterSalesLogin.token

    // 创建测试现场
    siteName = `E2E 测试现场 ${Date.now()}`
    const res = await page.request.post(`${apiBase}/api/sites`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { name: siteName }
    })
    expect(res.ok()).toBeTruthy()

    // 创建一条已验证的通用排查知识规则，确保样例日志能命中
    const ruleRes = await page.request.post(`${apiBase}/api/replay/knowledge`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        title: 'E2E 参数缺失排查',
        description: '参数文件缺失类问题排查',
        rootCause: '参数文件缺失',
        solution: '补齐参数文件',
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
          { stepNo: 1, title: '检查参数文件', stepType: 'readonly_check', isCritical: true },
          { stepNo: 2, title: '补齐缺失参数', stepType: 'field_operation', isCritical: false }
        ],
        tags: ['E2E']
      }
    })
    if (!ruleRes.ok()) {
      const err = await ruleRes.text()
      if (!err.includes('已存在')) {
        expect(ruleRes.ok()).toBeTruthy()
      }
    }
  })

  test.afterAll(async () => {
    await context?.close()
    await browser?.close()
    expect(unexpectedConsole).toEqual([])
  })

  async function loginAs(role: 'admin' | 'after_sales') {
    await page.goto('/')
    await page.evaluate(() => {
      localStorage.removeItem('forkweb_token')
      localStorage.removeItem('forkweb_user')
    })
    await page.goto('/login')
    if (role === 'admin') {
      await page.locator('input[placeholder="请输入用户名"]').fill('admin')
      await page.locator('input[placeholder="请输入密码"]').fill('admin123')
    } else {
      await page.locator('input[placeholder="请输入用户名"]').fill('aftersales')
      await page.locator('input[placeholder="请输入密码"]').fill('aftersales')
    }
    await page.getByRole('button', { name: '登录' }).click()
    await page.waitForURL(/\/tickets/)
  }

  test('登录后默认进入工单列表', async () => {
    await loginAs('after_sales')
    await page.goto('/')
    await page.waitForURL(/\/tickets/)
    await expect(page.getByText('工单列表')).toBeVisible()
  })

  test('新建工单并等待进入待现场排查', async () => {
    await page.goto('/tickets/new')
    await expect(page.locator('.new-header').getByText('新建工单')).toBeVisible()

    await page.locator('input[placeholder="一句话概括问题"]').fill('状态流测试工单')
    await page.locator('.el-form-item', { has: page.locator('label', { hasText: '项目现场' }) }).locator('.el-select').click()
    await page.getByRole('listbox').getByText(siteName).click()
    await page.locator('textarea').fill('状态流测试工单描述')

    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles(sampleLogPath)

    await page.getByRole('button', { name: '提交工单' }).click()
    await page.waitForURL(/\/tickets\/\d+/)
    ticketDetailUrl = page.url()
    await expect(page.locator('.ticket-title').getByText('状态流测试工单')).toBeVisible()

    // 等待后台分析完成，状态变为待现场排查（页面每 3 秒轮询）
    await expect(page.locator('.detail-header').getByText('待现场排查')).toBeVisible({ timeout: 60_000 })

    // 验证自动分析后问题类型非 unknown
    await expect(page.locator('.issue-type-cell').getByText('未知')).not.toBeVisible()
  })

  test('现场升级研发后状态变为待研发介入', async () => {
    await page.getByRole('button', { name: '需要研发介入' }).click()
    const dialog = page.getByRole('dialog', { name: '升级研发' })
    await expect(dialog).toBeVisible()
    await dialog.locator('.el-select').click()
    await page.getByRole('listbox').getByText('按向导排查仍未解决').click()
    await dialog.getByRole('button', { name: '提交' }).click()
    await expect(page.locator('.detail-header').getByText('待研发介入')).toBeVisible()
  })

  test('研发认领后状态变为研发处理中', async () => {
    await loginAs('admin')
    await page.goto(ticketDetailUrl)
    await expect(page.locator('.detail-header').getByText('待研发介入')).toBeVisible()
    await page.getByRole('button', { name: '认领工单' }).click()
    await expect(page.locator('.detail-header').getByText('研发处理中')).toBeVisible()
  })

  test('研发标记已解决后状态变为已解决', async () => {
    await page.getByRole('button', { name: '标记已解决' }).click()
    const dialog = page.getByRole('dialog', { name: '填写解决方案' })
    await expect(dialog).toBeVisible()
    await dialog.locator('textarea').fill('已更换激光模块')
    await dialog.getByRole('button', { name: '提交' }).click()
    await expect(page.locator('.detail-header').getByText('已解决')).toBeVisible()
  })

  test('触发重新分析后分析版本数增加', async () => {
    // 使用上一工单，当前状态为已解决
    await page.goto(ticketDetailUrl)
    await expect(page.locator('.detail-header').getByText('已解决')).toBeVisible()

    // 通过 API 触发重新分析
    const ticketIdMatch = ticketDetailUrl.match(/\/tickets\/(\d+)/)
    expect(ticketIdMatch).toBeTruthy()
    const ticketId = ticketIdMatch![1]
    const analyzeRes = await page.request.post(`${apiBase}/api/tickets/${ticketId}/analyze`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    })
    expect(analyzeRes.ok()).toBeTruthy()

    // 轮询等待分析完成
    let status = ''
    for (let i = 0; i < 30; i++) {
      await page.waitForTimeout(2000)
      const res = await page.request.get(`${apiBase}/api/tickets/${ticketId}`, {
        headers: { Authorization: `Bearer ${adminToken}` }
      })
      const body = await res.json() as { ticket: { status: string } }
      status = body.ticket.status
      if (status === 'pending_field_troubleshooting') break
    }
    expect(status).toBe('pending_field_troubleshooting')

    // 刷新页面以加载新版本列表
    await page.goto(ticketDetailUrl)
    const versionSelect = page.locator('.version-bar .el-select')
    await expect(versionSelect).toBeVisible()
    await versionSelect.click()
    await expect(page.getByRole('listbox').locator('.el-select-dropdown__item')).toHaveCount(2)
  })

  test('切换分析版本后内容变化', async () => {
    await page.goto(ticketDetailUrl)
    const versionSelect = page.locator('.version-bar .el-select')
    await expect(versionSelect).toBeVisible()
    await versionSelect.click()

    // 选择第二个版本
    const options = page.getByRole('listbox').locator('.el-select-dropdown__item')
    await expect(options).toHaveCount(2)
    await options.nth(1).click()

    // 验证当前分析版本区域显示第二个版本
    await expect(page.locator('.version-info').getByText('版本 1')).toBeVisible()
  })

  test('分析版本差异对比可见', async () => {
    await page.goto(ticketDetailUrl)
    await page.getByRole('button', { name: '对比差异' }).click()
    const dialog = page.getByRole('dialog', { name: '分析版本差异对比' })
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('.analysis-version-diff')).toBeVisible()
  })

  test('手动修正问题类型后列表筛选生效', async () => {
    await loginAs('admin')
    await page.goto(ticketDetailUrl)

    // 打开问题类型修改对话框并选择“激光”
    await page.locator('.issue-type-cell').getByRole('button', { name: '修改' }).click()
    const dialog = page.getByRole('dialog', { name: '修改问题类型' })
    await expect(dialog).toBeVisible()
    await dialog.locator('.el-select').click()
    await page.getByRole('listbox').getByText('激光').click()
    await dialog.getByRole('button', { name: '提交' }).click()
    await expect(dialog).not.toBeVisible()
    await expect(page.locator('.issue-type-cell').getByText('激光')).toBeVisible()

    // 返回列表并筛选“激光”
    await page.goto('/tickets')
    await page.locator('.filter-row .el-select', { hasText: '问题类型' }).click()
    await page.getByRole('listbox').getByText('激光').click()
    await expect(page.locator('.el-table__row').first().getByText('状态流测试工单')).toBeVisible()
    await expect(page.locator('.el-table__row').first().getByText('激光')).toBeVisible()
  })

  test('分析完成后展示 Top 3 排查路径', async () => {
    await loginAs('after_sales')
    await page.goto(ticketDetailUrl)
    await expect(page.locator('.ticket-title').getByText('状态流测试工单')).toBeVisible()

    // 排查向导区域应展示命中的已验证路径
    await expect(page.locator('.troubleshooting-guide .path-title').first()).toBeVisible({ timeout: 10_000 })
    await page.locator('.troubleshooting-guide .path-title').first().click()
    await expect(page.locator('.troubleshooting-guide .path-title').first()).toHaveText('E2E 参数缺失排查')
    await expect(page.locator('.step-title').getByText('检查参数文件').first()).toBeVisible()
  })

  test('知识规则新增字段保存与按产品化状态筛选', async () => {
    const ruleTitle = `E2E 测试规则 ${Date.now()}`
    const createRes = await page.request.post(`${apiBase}/api/replay/knowledge`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        title: ruleTitle,
        description: '测试描述',
        rootCause: '测试根因',
        solution: '测试方案',
        severity: 'warning',
        publicationStatus: 'verified',
        guideSteps: [{ stepNo: 1, title: '检查激光数据', stepType: 'readonly_check', isCritical: true }],
        feedbackStats: { useful: 2, partial: 1, useless: 0 }
      }
    })
    expect(createRes.ok()).toBeTruthy()
    const createBody = await createRes.json() as { rule: { id: string } }
    const ruleId = createBody.rule.id

    // 验证详情包含新增字段
    const detailRes = await page.request.get(`${apiBase}/api/replay/knowledge`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    })
    expect(detailRes.ok()).toBeTruthy()
    const detailBody = await detailRes.json() as { rules: any[] }
    const rule = detailBody.rules.find((r) => r.id === ruleId)
    expect(rule).toBeTruthy()
    expect(rule.publicationStatus).toBe('verified')
    expect(rule.guideSteps).toHaveLength(1)
    expect(rule.guideSteps[0].title).toBe('检查激光数据')
    expect(rule.feedbackStats).toEqual({ useful: 2, partial: 1, useless: 0 })

    // 按产品化状态筛选
    const filterRes = await page.request.get(`${apiBase}/api/replay/knowledge?publicationStatus=draft`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    })
    expect(filterRes.ok()).toBeTruthy()
    const filterBody = await filterRes.json() as { rules: any[] }
    expect(filterBody.rules.some((r) => r.id === ruleId)).toBe(false)
  })

  test('步骤状态切换、不适用原因、安全确认与事件记录', async () => {
    await loginAs('after_sales')
    await page.goto(ticketDetailUrl)
    await expect(page.locator('.ticket-title').getByText('状态流测试工单')).toBeVisible()

    // 点击开始排查
    await page.getByRole('button', { name: '开始排查' }).click()
    await expect(page.locator('.detail-header').getByText('现场排查中')).toBeVisible()


    // 展开排查路径折叠面板
    await page.locator('.el-collapse-item__header').first().click()
    await page.waitForTimeout(500)
    // 找到第一个步骤的“未通过”单选
    const stepRow = page.locator('.step-row').first()
    await stepRow.locator('.el-radio-button__inner', { hasText: '未通过' }).click()

    // 找到第一个现场操作步骤并选择已通过，触发安全确认
    const fieldStep = page.locator('.step-row', { has: page.getByText('现场操作') }).first()
    await fieldStep.locator('.el-radio-button__inner', { hasText: '已通过' }).click()
    const safetyDialog = page.getByRole('dialog', { name: '安全确认' })
    await expect(safetyDialog).toBeVisible()
    await safetyDialog.getByRole('button', { name: '已确认安全' }).click()

    // 找到一个步骤选择不适用，触发原因选择
    await stepRow.locator('.el-radio-button__inner', { hasText: '不适用' }).click()
    const reasonDialog = page.getByRole('dialog', { name: '选择不适用原因' })
    await expect(reasonDialog).toBeVisible()
    await reasonDialog.locator('.el-select').click()
    await page.getByRole('listbox').getByText('工具不可用').click()
    await reasonDialog.getByRole('button', { name: '提交' }).click()

    // 滚动到事件流区域
    await page.locator('.section-title', { hasText: '事件流' }).scrollIntoViewIfNeeded()
    await page.waitForTimeout(500)

    // 验证事件流中记录了步骤状态变化
    await expect(page.locator('.el-timeline-item').getByText('step_status_changed').first()).toBeVisible()
  })

  test('超大文件在提交前被拒绝', async () => {
    await loginAs('after_sales')
    await page.goto('/tickets/new')
    await page.locator('input[placeholder="一句话概括问题"]').fill('超大文件测试工单')
    await page.locator('.el-form-item', { has: page.locator('label', { hasText: '项目现场' }) }).locator('.el-select').click()
    await page.getByRole('listbox').getByText(siteName).click()
    await page.locator('textarea').fill('验证 200MB 上传限制')

    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles({ name: 'small.log', mimeType: 'text/plain', buffer: Buffer.from('test log') })
    await fileInput.evaluate((input) => {
      const file = input.files?.[0]
      if (!file) throw new Error('未找到测试上传文件')
      Object.defineProperty(file, 'size', { value: 201 * 1024 * 1024 })
    })

    await page.getByRole('button', { name: '提交工单' }).click()
    await expect(page.getByText('所有上传文件总大小不能超过 200MB')).toBeVisible()
  })

  test('分析失败后状态回退为待分析并记录事件', async () => {
    const ticketIdMatch = ticketDetailUrl.match(/\/tickets\/(\d+)/)
    expect(ticketIdMatch).toBeTruthy()
    const ticketId = ticketIdMatch![1]

    const ticketRes = await page.request.get(`${apiBase}/api/tickets/${ticketId}`, {
      headers: { Authorization: `Bearer ${afterSalesToken}` }
    })
    expect(ticketRes.ok()).toBeTruthy()
    const ticketBody = await ticketRes.json() as { ticket: { logDir: string } }
    await fs.rm(ticketBody.ticket.logDir, { recursive: true, force: true })

    const analyzeRes = await page.request.post(`${apiBase}/api/tickets/${ticketId}/analyze`, {
      headers: { Authorization: `Bearer ${afterSalesToken}` }
    })
    expect(analyzeRes.ok()).toBeTruthy()

    let body: { ticket: { status: string }, events: Array<{ action: string }> } | undefined
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(500)
      const detailRes = await page.request.get(`${apiBase}/api/tickets/${ticketId}`, {
        headers: { Authorization: `Bearer ${afterSalesToken}` }
      })
      body = await detailRes.json() as { ticket: { status: string }, events: Array<{ action: string }> }
      if (body.ticket.status === 'pending_analysis') break
    }

    expect(body?.ticket.status).toBe('pending_analysis')
    expect(body?.events.some((event) => event.action === 'analysis_failed')).toBeTruthy()
  })
})
