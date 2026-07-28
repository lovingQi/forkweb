// 将使用说明（docs/user-manual.md + 截图 + PDF）同步到 public/help/，
// 供前端帮助中心（/help 页面）在构建产物中直接访问。挂在 npm run build 之前执行。
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SOURCES = {
  manual: path.join(root, 'docs/user-manual.md'),
  images: path.join(root, 'docs/images'),
  pdf: path.join(root, 'docs/user-manual.pdf')
}
const HELP_DIR = path.join(root, 'public/help')

await fs.rm(HELP_DIR, { recursive: true, force: true })
await fs.mkdir(path.join(HELP_DIR, 'images'), { recursive: true })

await fs.copyFile(SOURCES.manual, path.join(HELP_DIR, 'user-manual.md'))

const images = (await fs.readdir(SOURCES.images)).filter((f) => f.endsWith('.png'))
for (const img of images) {
  await fs.copyFile(path.join(SOURCES.images, img), path.join(HELP_DIR, 'images', img))
}

let pdfCopied = false
try {
  await fs.copyFile(SOURCES.pdf, path.join(HELP_DIR, 'user-manual.pdf'))
  pdfCopied = true
} catch {
  console.warn('警告: docs/user-manual.pdf 不存在，帮助中心将没有 PDF 下载。')
}

console.log(`帮助文档已同步: 1 个 md、${images.length} 张图片${pdfCopied ? '、1 个 PDF' : ''} -> public/help/`)
