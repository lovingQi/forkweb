<template>
  <div class="help-page">
    <aside class="help-toc">
      <div class="toc-title">目录</div>
      <div class="toc-list">
        <a
          v-for="item in toc"
          :key="item.id"
          class="toc-item"
          :class="[`toc-level-${item.level}`, { active: item.id === activeId }]"
          @click="scrollToHeading(item.id)"
        >{{ item.text }}</a>
      </div>
    </aside>

    <div class="help-main">
      <div class="help-toolbar">
        <span class="help-hint">遇到本文未覆盖的问题，请联系系统管理员或研发人员。</span>
        <el-button type="primary" plain size="small" @click="downloadPdf">
          <el-icon><Download /></el-icon>
          <span>下载 PDF 版</span>
        </el-button>
      </div>
      <el-skeleton v-if="loading" :rows="12" animated class="help-skeleton" />
      <el-alert v-else-if="error" type="error" :title="error" :closable="false" />
      <div v-else ref="contentRef" class="markdown-body" @click="onContentClick" v-html="html"></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Download } from '@element-plus/icons-vue'
import MarkdownIt from 'markdown-it'

interface TocItem {
  id: string
  text: string
  level: number
}

const route = useRoute()
const html = ref('')
const loading = ref(true)
const error = ref('')
const toc = ref<TocItem[]>([])
const activeId = ref('')
const contentRef = ref<HTMLElement>()
let observer: IntersectionObserver | null = null

const md = new MarkdownIt({ linkify: true })

// 图片相对路径重写到帮助中心静态目录
const defaultImage = md.renderer.rules.image!
md.renderer.rules.image = (tokens, idx, options, env, self) => {
  const token = tokens[idx]
  const src = token.attrGet('src') || ''
  if (src.startsWith('images/')) token.attrSet('src', `/help/${src}`)
  return defaultImage(tokens, idx, options, env, self)
}

// 外链新标签打开
const defaultLinkOpen =
  md.renderer.rules.link_open || ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options))
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const href = tokens[idx].attrGet('href') || ''
  if (/^https?:\/\//.test(href)) {
    tokens[idx].attrSet('target', '_blank')
    tokens[idx].attrSet('rel', 'noopener')
  }
  return defaultLinkOpen(tokens, idx, options, env, self)
}

// GitHub 风格 slug，与文档内既有锚点（如 #1-系统简介）保持一致
function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
}

function buildAnchorsAndToc() {
  const rootEl = contentRef.value
  if (!rootEl) return
  const used = new Map<string, number>()
  const items: TocItem[] = []
  rootEl.querySelectorAll<HTMLElement>('h1, h2, h3, h4').forEach((el) => {
    let id = slugify(el.textContent || '')
    const count = used.get(id) || 0
    used.set(id, count + 1)
    if (count > 0) id = `${id}-${count}`
    el.id = id
    const level = Number(el.tagName.slice(1))
    if (level === 2 || level === 3) {
      items.push({ id, text: el.textContent || '', level })
    }
  })
  toc.value = items

  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          activeId.value = (entry.target as HTMLElement).id
          break
        }
      }
    },
    { rootMargin: '0px 0px -75% 0px' }
  )
  rootEl.querySelectorAll('h2, h3').forEach((el) => observer!.observe(el))
}

function scrollToHeading(id: string) {
  const el = document.getElementById(id)
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  activeId.value = id
  history.replaceState(null, '', `#${id}`)
}

function onContentClick(event: MouseEvent) {
  const link = (event.target as HTMLElement).closest('a')
  if (!link) return
  const href = link.getAttribute('href') || ''
  if (href.startsWith('#')) {
    event.preventDefault()
    scrollToHeading(decodeURIComponent(href.slice(1)))
  } else if (/\.md($|#)/.test(href)) {
    event.preventDefault()
    ElMessage.info('该文档未包含在帮助中心内，请在代码仓库 docs/ 目录查看。')
  }
}

function downloadPdf() {
  window.open('/help/user-manual.pdf', '_blank')
}

onMounted(async () => {
  try {
    const res = await fetch('/help/user-manual.md')
    if (!res.ok) throw new Error(`加载帮助文档失败（HTTP ${res.status}）`)
    html.value = md.render(await res.text())
    loading.value = false
    await nextTick()
    buildAnchorsAndToc()
    const hash = decodeURIComponent((route.hash || '').replace(/^#/, ''))
    if (hash) scrollToHeading(hash)
  } catch (e) {
    loading.value = false
    error.value = e instanceof Error ? e.message : String(e)
  }
})

onBeforeUnmount(() => {
  observer?.disconnect()
})
</script>

<style scoped>
.help-page {
  display: flex;
  gap: 16px;
  align-items: flex-start;
}
.help-toc {
  position: sticky;
  top: 0;
  width: 230px;
  flex-shrink: 0;
  max-height: calc(100vh - 100px);
  overflow-y: auto;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 14px 0;
}
.toc-title {
  font-size: 14px;
  font-weight: 600;
  color: #1e293b;
  padding: 0 16px 10px;
  border-bottom: 1px solid #e2e8f0;
  margin-bottom: 8px;
}
.toc-item {
  display: block;
  padding: 5px 16px;
  font-size: 13px;
  color: #475569;
  cursor: pointer;
  line-height: 1.5;
  border-left: 2px solid transparent;
}
.toc-item:hover {
  color: #2563eb;
  background: #f8fafc;
}
.toc-item.active {
  color: #2563eb;
  font-weight: 600;
  border-left-color: #2563eb;
  background: #eff6ff;
}
.toc-level-3 {
  padding-left: 32px;
  font-size: 12.5px;
}
.help-main {
  flex: 1;
  min-width: 0;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 24px 32px;
}
.help-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-bottom: 14px;
  border-bottom: 1px solid #e2e8f0;
  margin-bottom: 8px;
}
.help-hint {
  font-size: 13px;
  color: #94a3b8;
}
.help-skeleton {
  padding: 20px 0;
}
</style>

<style>
/* markdown 渲染样式（非 scoped，作用于 v-html 内容） */
.markdown-body {
  font-size: 14px;
  line-height: 1.75;
  color: #24292e;
  word-wrap: break-word;
}
.markdown-body h1 {
  font-size: 24px;
  border-bottom: 2px solid #2c3e50;
  padding-bottom: 8px;
  margin: 18px 0 14px;
}
.markdown-body h2 {
  font-size: 19px;
  border-bottom: 1px solid #e2e8f0;
  padding-bottom: 6px;
  margin: 30px 0 12px;
  scroll-margin-top: 12px;
}
.markdown-body h3 {
  font-size: 16px;
  margin: 24px 0 10px;
  scroll-margin-top: 12px;
}
.markdown-body h4 {
  font-size: 14.5px;
  margin: 18px 0 8px;
}
.markdown-body img {
  max-width: 100%;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  margin: 10px 0;
}
.markdown-body table {
  border-collapse: collapse;
  width: 100%;
  margin: 12px 0;
  font-size: 13px;
}
.markdown-body th,
.markdown-body td {
  border: 1px solid #d0d7de;
  padding: 7px 11px;
  text-align: left;
}
.markdown-body th {
  background: #f8fafc;
  font-weight: 600;
}
.markdown-body code {
  background: #f1f5f9;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 12.5px;
}
.markdown-body pre {
  background: #f6f8fa;
  padding: 14px;
  border-radius: 8px;
  overflow-x: auto;
}
.markdown-body pre code {
  background: none;
  padding: 0;
}
.markdown-body blockquote {
  border-left: 4px solid #cbd5e1;
  margin: 12px 0;
  padding: 4px 16px;
  color: #57606a;
  background: #f8fafc;
}
.markdown-body a {
  color: #2563eb;
  text-decoration: none;
}
.markdown-body a:hover {
  text-decoration: underline;
}
.markdown-body hr {
  border: none;
  border-top: 1px solid #e2e8f0;
  margin: 24px 0;
}
</style>
