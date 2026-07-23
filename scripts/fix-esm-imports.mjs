import fs from 'fs'
import path from 'path'

const dir = process.argv[2]
if (!dir) {
  console.error('Usage: node fix-esm-imports.mjs <directory>')
  process.exit(1)
}

function walk(d) {
  const entries = fs.readdirSync(d, { withFileTypes: true })
  for (const entry of entries) {
    const full = path.join(d, entry.name)
    if (entry.isDirectory()) {
      walk(full)
    } else if (entry.name.endsWith('.js')) {
      fixFile(full)
    }
  }
}

function resolveRelative(fromFile, modPath) {
  const fromDir = path.dirname(fromFile)
  const resolved = path.resolve(fromDir, modPath)
  // If it's a directory with an index.js, use /index.js
  if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
    return modPath + '/index.js'
  }
  return modPath + '.js'
}

function fixFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8')
  const original = content
  // from './xxx' or from '../xxx' → add .js or /index.js
  content = content.replace(
    /(from\s+['"])(\.\.?\/[^'"]+)(['"])/g,
    (match, pre, modPath, quote) => {
      if (modPath.endsWith('.js') || modPath.endsWith('.json')) return match
      const fixed = resolveRelative(filePath, modPath)
      return `${pre}${fixed}${quote}`
    }
  )
  // import('./xxx') dynamic imports
  content = content.replace(
    /(import\s*\(\s*['"])(\.\.?\/[^'"]+)(['"]\s*\))/g,
    (match, pre, modPath, post) => {
      if (modPath.endsWith('.js') || modPath.endsWith('.json')) return match
      const fixed = resolveRelative(filePath, modPath)
      return `${pre}${fixed}${post}`
    }
  )
  if (content !== original) {
    fs.writeFileSync(filePath, content)
    console.log(`Fixed: ${filePath}`)
  }
}

walk(dir)
console.log('ESM import fix complete.')
