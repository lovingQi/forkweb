import path from 'path'
import { fileURLToPath } from 'url'
import { chromium, expect, test } from '@playwright/test'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const replayApiBase = process.env.REPLAY_E2E_API_BASE || 'http://127.0.0.1:18082/api'
const expectedLogDir = process.env.REPLAY_E2E_LOG_DIR || path.join(__dirname, 'fixtures', 'sample-log')
const expectedMapDir = process.env.REPLAY_E2E_MAP_DIR || '/home/xbl/Desktop/jarvis-fork/params/map'

test.describe.serial('日志回放诊断工具', () => {
  let browser: any
  let context: any
  let page: any
  const unexpectedConsole: string[] = []

  test.beforeAll(async () => {
    browser = await chromium.launch()
    context = await browser.newContext()
    page = await context.newPage()

    page.on('console', (message: any) => {
      if (message.type() !== 'error') return
      const text = message.text()
      if (text.includes('/api/state') || text.includes('/api/map') || text.includes('/api/params')) return
      if (text.includes('Failed to load resource: the server responded with a status of 500')) return
      if (text.includes('/ws/high') || text.includes('/ws/low')) return
      unexpectedConsole.push(text)
    })
    page.on('pageerror', (error: any) => unexpectedConsole.push(error.message))

    await page.goto('/login')
    await page.locator('input[placeholder="请输入用户名"]').fill('admin')
    await page.locator('input[placeholder="请输入密码"]').fill('admin123')
    await page.getByRole('button', { name: '登录' }).click()
    await page.waitForURL(/\/tickets/)

    await page.goto('/replay')
    await expect(page.getByRole('button', { name: '加载诊断' })).toBeVisible()

    await expect(page.locator('label').filter({ hasText: '日志目录' })).toBeVisible()
    await expect(page.locator('label').filter({ hasText: '地图目录' })).toBeVisible()

    const logInput = page.locator('.el-form-item', { has: page.locator('label', { hasText: '日志目录' }) }).locator('input').first()
    await logInput.fill(expectedLogDir)
    await expect(logInput).toHaveValue(expectedLogDir)

    const mapInput = page.locator('.el-form-item', { has: page.locator('label', { hasText: '地图目录' }) }).locator('input').first()
    await mapInput.fill(expectedMapDir)
    await expect(mapInput).toHaveValue(expectedMapDir)

    await page.getByRole('button', { name: '加载诊断' }).click()
    await expect(page.getByText('地图回放')).toBeVisible({ timeout: 120_000 })
    await expect(page.getByText(/回放帧可用|回放帧缺失/)).toBeVisible()
    await expect(page.getByText('诊断结论')).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('.progress-slider')).toBeVisible()
    await expect(page.locator('canvas')).toBeVisible()
  })

  test.afterAll(async () => {
    await context?.close()
    await browser?.close()
    expect(unexpectedConsole).toEqual([])
  })

  test('完成真实浏览器点击链路', async () => {
    await expect(page.getByRole('button', { name: '导出诊断包' })).toBeEnabled()

    await page.getByRole('button', { name: '播放' }).click()
    await page.waitForTimeout(600)
    await page.getByRole('button', { name: '暂停' }).click()

    const slider = page.locator('.progress-slider .el-slider__runway').first()
    const sliderBox = await slider.boundingBox()
    expect(sliderBox, '播放进度条必须可点击').toBeTruthy()
    if (sliderBox) {
      await page.mouse.click(sliderBox.x + sliderBox.width * 0.35, sliderBox.y + sliderBox.height / 2)
    }

    await page.getByRole('tab', { name: '时间线' }).click()
    await expect(page.getByText(/共 \d+ 条/)).toBeVisible()
    const timelinePanel = page.locator('.el-tab-pane:visible').filter({ has: page.getByText(/共 \d+ 条/) })
    await expect(timelinePanel.getByRole('button', { name: '筛选' })).toBeVisible()

    await page.getByRole('tab', { name: '错误码中心' }).click()
    const errorPanel = page.locator('.el-tab-pane:visible').filter({ has: page.getByPlaceholder('错误码') })
    await expect(errorPanel.getByText(/发生点 \d+/)).toBeVisible()
    await expect(errorPanel.getByPlaceholder('错误码')).toBeVisible()

    await page.getByRole('tab', { name: '任务视角' }).click()
    await expect(page.getByText('任务').first()).toBeVisible()

    await page.getByRole('tab', { name: '原始日志/过滤' }).click()
    const logsPanel = page.locator('.el-tab-pane:visible').filter({ has: page.getByText(/证据 \d+/) })
    await expect(logsPanel.getByRole('button', { name: '过滤' })).toBeVisible()
    await logsPanel.getByRole('button', { name: '过滤' }).click()
    await expect(logsPanel.getByText(/证据 \d+/)).toBeVisible()

    await page.getByRole('tab', { name: '问诊助手' }).click()
    await expect(page.getByRole('button', { name: '配置模型' })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByPlaceholder('输入你想问的日志问题')).toBeVisible()
    await page.getByRole('button', { name: '配置模型' }).click()
    const configDialog = page.getByRole('dialog', { name: '配置问诊模型' })
    await expect(configDialog).toBeVisible()
    await expect(configDialog.getByLabel('Provider')).toBeVisible()
    await expect(configDialog.getByLabel('API Key')).toBeVisible()
    await expect(configDialog.getByLabel('Base URL')).toBeVisible()
    await expect(configDialog.getByLabel('Model')).toBeVisible()
    await configDialog.getByRole('button', { name: '取消' }).click()
    await expect(configDialog).toBeHidden()

    const toolbar = page.locator('.load-band')
    await toolbar.getByRole('button', { name: '知识库', exact: true }).click()
    const knowledgeDialog = page.getByRole('dialog', { name: '诊断知识库' })
    await expect(knowledgeDialog).toBeVisible()
    await expect(knowledgeDialog.getByPlaceholder('搜索标题/描述')).toBeVisible()
    await expect(knowledgeDialog.getByRole('button', { name: '新增' })).toBeVisible()
    await expect(knowledgeDialog.getByRole('button', { name: '导出' })).toBeVisible()
    await expect(knowledgeDialog.getByRole('button', { name: '导入' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(knowledgeDialog).toBeHidden()
  })

  test('时间线筛选与事件跳转', async () => {
    await page.getByRole('tab', { name: '时间线' }).click()
    await expect(page.getByText(/共 \d+ 条/)).toBeVisible()

    await page.locator('.el-select').filter({ has: page.getByText('严重度') }).first().click()
    await page.getByRole('listbox').getByText('错误', { exact: true }).click()
    await page.getByRole('button', { name: '筛选' }).click()

    const table = page.locator('.el-tab-pane:visible').locator('.el-table__body-wrapper .el-table__body')
    await expect(table.locator('.el-table__row').first()).toBeVisible({ timeout: 15_000 })
    const firstRow = table.locator('.el-table__row').first()
    await expect(firstRow.locator('td').nth(2)).toHaveText('error')

    const timeBefore = await page.locator('.play-head .time-text').first().textContent()
    await firstRow.click()
    await page.waitForTimeout(400)
    const timeAfter = await page.locator('.play-head .time-text').first().textContent()
    expect(timeAfter).not.toEqual(timeBefore)
  })

  test('错误码中心聚合与发生点跳转', async () => {
    await page.getByRole('tab', { name: '错误码中心' }).click()
    const errorPanel = page.locator('.el-tab-pane:visible').filter({ has: page.getByPlaceholder('错误码') })
    await expect(errorPanel.getByText(/发生点 \d+/)).toBeVisible()

    const summaryTable = errorPanel.locator('.el-table__body-wrapper .el-table__body').first()
    await expect(summaryTable.locator('.el-table__row').first()).toBeVisible({ timeout: 15_000 })

    await summaryTable.locator('.el-table__row').first().click()
    const occurrenceTable = errorPanel.locator('.el-table__body-wrapper .el-table__body').nth(1)
    await expect(occurrenceTable.locator('.el-table__row').first()).toBeVisible({ timeout: 15_000 })
    const occurrenceRow = occurrenceTable.locator('.el-table__row').first()

    const timeBefore = await page.locator('.play-head .time-text').first().textContent()
    await occurrenceRow.click()
    await page.waitForTimeout(400)
    const timeAfter = await page.locator('.play-head .time-text').first().textContent()
    expect(timeAfter).not.toEqual(timeBefore)
  })

  test('原始日志多关键词过滤与高亮', async () => {
    await page.getByRole('tab', { name: '原始日志/过滤' }).click()
    const logsPanel = page.locator('.el-tab-pane:visible').filter({ has: page.getByText(/证据 \d+/) })
    await expect(logsPanel.getByRole('button', { name: '过滤' })).toBeVisible()

    const keywordInput = logsPanel.locator('input[placeholder="关键词"]').first()
    await keywordInput.scrollIntoViewIfNeeded()
    await keywordInput.fill('mLaser', { force: true })
    await logsPanel.getByRole('button', { name: '过滤' }).click()

    const table = logsPanel.locator('.el-table__body-wrapper .el-table__body')
    await expect(table.locator('.el-table__row').first()).toBeVisible({ timeout: 15_000 })
    await expect(logsPanel.getByText('已高亮关联日志')).toBeVisible()
    await expect(table.locator('mark').first()).toHaveText('mLaser')

    await logsPanel.getByRole('button', { name: '当前时间上下文' }).click()
    await expect(table.locator('.el-table__row').first()).toBeVisible({ timeout: 15_000 })
  })

  test('问诊助手离线提问与相似案例', async () => {
    await page.getByRole('tab', { name: '问诊助手' }).click()
    await expect(page.getByRole('button', { name: '配置模型' })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByPlaceholder('输入你想问的日志问题')).toBeVisible()

    const questionInput = page.getByPlaceholder('输入你想问的日志问题')
    await questionInput.fill('这次问题最可能是什么？')
    await page.getByRole('button', { name: '提问' }).click()

    const assistantPanel = page.locator('.assistant-panel')
    await expect(assistantPanel.getByText(/AI 辅助建议/)).toBeVisible({ timeout: 60_000 })

    const similarTable = page.locator('.assistant-section').filter({ has: page.getByText('相似历史问题') }).locator('.el-table__body-wrapper .el-table__body')
    await expect(similarTable.locator('.el-table__row').first()).toBeVisible({ timeout: 15_000 })
  })

  test('诊断包导出完整包', async () => {
    await page.getByRole('button', { name: '导出诊断包' }).click()
    const exportDialog = page.getByRole('dialog', { name: '导出诊断包' })
    await expect(exportDialog).toBeVisible()

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      exportDialog.getByRole('button', { name: '直接下载完整包' }).click()
    ])

    const fileName = download.suggestedFilename()
    expect(fileName).toMatch(/\.zip$/)

    await page.keyboard.press('Escape')
    await expect(exportDialog).toBeHidden()
  })

  test('地图别名管理弹窗', async () => {
    const toolbar = page.locator('.load-band')
    await toolbar.getByRole('button', { name: '地图别名', exact: true }).click()

    const aliasDialog = page.getByRole('dialog', { name: '地图别名管理' })
    await expect(aliasDialog).toBeVisible()
    await expect(aliasDialog.getByText('日志地图名')).toBeVisible()

    await aliasDialog.getByRole('button', { name: 'Close this dialog' }).click()
    await expect(aliasDialog).toBeHidden()
  })
})
