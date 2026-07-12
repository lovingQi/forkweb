import { expect, test } from '@playwright/test'

const replayApiBase = process.env.REPLAY_E2E_API_BASE || 'http://127.0.0.1:18082/api'
const expectedLogDir = process.env.REPLAY_E2E_LOG_DIR || '/home/xbl/Desktop'
const expectedMapDir = process.env.REPLAY_E2E_MAP_DIR || '/home/xbl/Desktop/jarvis-fork/params/map'

test.describe('日志回放诊断工具', () => {
  test('完成真实浏览器点击链路', async ({ page, request }) => {
    const unexpectedConsole: string[] = []
    page.on('console', (message) => {
      if (message.type() !== 'error') return
      const text = message.text()
      if (text.includes('/api/state') || text.includes('/api/map') || text.includes('/api/params')) return
      if (text.includes('Failed to load resource: the server responded with a status of 500')) return
      if (text.includes('/ws/high') || text.includes('/ws/low')) return
      unexpectedConsole.push(text)
    })
    page.on('pageerror', (error) => unexpectedConsole.push(error.message))

    const status = await request.get(`${replayApiBase}/replay/assistant/status`)
    expect(status.ok(), '回放诊断后端必须先运行').toBeTruthy()

    await page.goto('/replay')
    await expect(page.getByRole('button', { name: '加载诊断' })).toBeVisible()

    await expect(page.locator('label').filter({ hasText: '日志目录' })).toBeVisible()
    await expect(page.locator('label').filter({ hasText: '地图目录' })).toBeVisible()
    await expect(page.getByRole('button', { name: '知识库' })).toBeVisible()
    await expect(page.getByRole('button', { name: '导出诊断包' })).toBeDisabled()

    await fillInputByLabel(page, '日志目录', expectedLogDir)
    await fillInputByLabel(page, '地图目录', expectedMapDir)
    await page.getByRole('button', { name: '加载诊断' }).click()

    await expect(page.getByText('地图回放')).toBeVisible({ timeout: 120_000 })
    await expect(page.getByText(/回放帧可用|回放帧缺失/)).toBeVisible()
    await expect(page.getByText('诊断结论')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('button', { name: '导出诊断包' })).toBeEnabled()
    await expect(page.locator('.progress-slider')).toBeVisible()
    await expect(page.locator('canvas')).toBeVisible()

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
    await expect(page.getByRole('button', { name: '筛选' }).first()).toBeVisible()

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

    await page.getByRole('button', { name: '知识库' }).click()
    const knowledgeDialog = page.getByRole('dialog', { name: '诊断知识库' })
    await expect(knowledgeDialog).toBeVisible()
    await expect(knowledgeDialog.getByPlaceholder('搜索标题/描述')).toBeVisible()
    await expect(knowledgeDialog.getByRole('button', { name: '新增' })).toBeVisible()
    await expect(knowledgeDialog.getByRole('button', { name: '导出' })).toBeVisible()
    await expect(knowledgeDialog.getByRole('button', { name: '导入' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(knowledgeDialog).toBeHidden()

    expect(unexpectedConsole).toEqual([])
  })
})

async function fillInputByLabel(page: any, label: string, value: string) {
  const input = page.locator('.el-form-item', { has: page.locator('label', { hasText: label }) }).locator('input').first()
  await input.fill(value)
  await expect(input).toHaveValue(value)
}
