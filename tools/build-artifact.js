#!/usr/bin/env node
/**
 * demo/index.html の <!--BUNDLE--> に src/ のバンドルを差し込み、
 * 単一ファイルの体験版ページを書き出す。
 */
const fs = require('node:fs')
const path = require('node:path')
const { build } = require('./build-demo')

const TEMPLATE = path.join(__dirname, '..', 'demo', 'index.html')
const MARKER = '<!--BUNDLE-->'

function buildPage() {
  const template = fs.readFileSync(TEMPLATE, 'utf8')
  if (!template.includes(MARKER)) {
    throw new Error(`${MARKER} が demo/index.html に見つかりません`)
  }
  // </script> がバンドル内の文字列に含まれるとタグが閉じてしまうため保護する。
  const bundle = build().replace(/<\/script>/g, '<\\/script>')
  return template.replace(MARKER, `<script>\n${bundle}\n</script>`)
}

if (require.main === module) {
  const output = process.argv[2] || path.join(__dirname, '..', 'dist', 'demo.html')
  fs.mkdirSync(path.dirname(output), { recursive: true })
  fs.writeFileSync(output, buildPage())
  const size = (fs.statSync(output).size / 1024).toFixed(1)
  console.log(`wrote ${output} (${size} KB)`)
}

module.exports = { buildPage }
