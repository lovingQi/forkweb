import path from 'path'
import { fileURLToPath } from 'url'
import { chromium, expect, test } from '@playwright/test'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const realLogPath = path.join(__dirname, 'fixtures', 'log-20260720-114052.log')
const requiredE2eBaseUrl = process.env.REPLAY_E2E_BASE_URL
const requiredE2eApiBase = process.env.REPLAY_E2E_API_BASE

if (!requiredE2eBaseUrl || !requiredE2eApiBase) {
  throw new Error('请在隔离环境中设置 REPLAY_E2E_BASE_URL 和 REPLAY_E2E_API_BASE 后再运行真实日志 E2E 测试')
}

test('真实日志端到端分析流程', async () => {
  const browser = await chromium.launch()
  const context = await browser.newContext()
  const page = await context.newPage()
  const unexpectedConsole: string[] = []

  page.on('console', (message: any) => {
    const text = message.text()
    if (message.type() !== 'error') return
    if (text.includes('Failed to load resource: the server responded with a status of 500')) return
    if (text.includes('Failed to load resource: net::ERR_CONNECTION_REFUSED')) return
    if (text.includes('/api/state') || text.includes('/api/map') || text.includes('/api/params') || text.includes('/api/auth/users') || text.includes('/ws/high') || text.includes('/ws/low')) return
    unexpectedConsole.push(text)
  })

  page.on('pageerror', (error: any) => unexpectedConsole.push(error.message))

  try {
    // 读取后端地址
    const configRes = await page.request.get('/config.js')
    const configText = await configRes.text()
    const match = configText.match(/replayApiBase:\s*['"]([^'"]+)['"]/)
    const apiBase = (process.env.REPLAY_E2E_API_BASE || match?.[1] || '').replace(/\/api$/, '')
    expect(apiBase).toBeTruthy()

    // 登录管理员并创建测试现场
    const adminLoginRes = await page.request.post(`${apiBase}/api/auth/login`, {
      data: { username: 'admin', password: 'admin123' }
    })
    expect(adminLoginRes.ok()).toBeTruthy()
    const { token: adminToken } = await adminLoginRes.json() as { token: string }

    const siteName = `真实日志测试现场 ${Date.now()}`
    const siteRes = await page.request.post(`${apiBase}/api/sites`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { name: siteName }
    })
    expect(siteRes.ok()).toBeTruthy()
    const { site } = await siteRes.json() as { site: { id: number } }

    // 创建售后用户
    await page.request.post(`${apiBase}/api/auth/users`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        username: 'aftersales_real_log',
        password: 'aftersales',
        role: 'after_sales',
        displayName: '售后真实日志测试'
      }
    }).catch(() => undefined)

    // 登录售后用户
    await page.goto('/login')
    await page.locator('input[placeholder="请输入用户名"]').fill('aftersales_real_log')
    await page.locator('input[placeholder="请输入密码"]').fill('aftersales')
    await page.getByRole('button', { name: '登录' }).click()
    await page.waitForURL(/\/tickets/)

    // 新建工单并上传真实日志
    await page.goto('/tickets/new')
    await expect(page.locator('.new-header').getByText('新建工单')).toBeVisible()
    await page.locator('input[placeholder="一句话概括问题"]').fill('真实日志端到端测试')
    await page.locator('.el-form-item', { has: page.locator('label', { hasText: '项目现场' }) }).locator('.el-select').click()
    await page.getByRole('listbox').getByText(siteName).click()
    await page.locator('textarea').fill('使用真实叉车日志验证完整分析流程')

    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles(realLogPath)

    await page.getByRole('button', { name: '提交工单' }).click()
    await page.waitForURL(/\/tickets\/\d+/)
    await expect(page.locator('.ticket-title').getByText('真实日志端到端测试')).toBeVisible()

    // 等待分析完成，状态变为待现场排查（真实日志分析可能较慢，给 120 秒）
    await expect(page.locator('.detail-header').getByText('待现场排查')).toBeVisible({ timeout: 120_000 })

    // 验证排查向导可见（至少一条路径）
    await expect(page.locator('.troubleshooting-guide')).toBeVisible()

    // 验证事件流中有分析完成相关事件
    await page.locator('.section-title', { hasText: '事件流' }).scrollIntoViewIfNeeded()
    await expect(page.locator('.el-timeline-item').getByText('analysis_completed').first()).toBeVisible()
  } finally {
    await context.close()
    await browser.close()
    expect(unexpectedConsole).toEqual([])
  }
})
