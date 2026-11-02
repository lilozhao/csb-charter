#!/usr/bin/env node
/**
 * ⚠️ 本脚本已降级为「目录卫生检查」，**不构成 14.10 意义上的证据**。
 *
 * 为什么降级（知微审计 2026-11-01 原文点名的自我矛盾）：
 *   宪章 14.10 明写「不接受 exit 0 或单行日志；须含改动前后的可对照事实」。
 *   而本脚本做的恰好是「文件在不在 / 关键词有没有」—— 落在宪章自己禁止接受的证据样式上。
 *
 * 真正的宪章判据校验看这里：`node scripts/charter-lint.js`（13 项判据 · 三态 · exit 0/1/2）
 * 本脚本保留只为兼容既有调用（它跑得快，适合当第一道粗筛）。
 *
 * 验证：宪章主文档、三底线、修正机制、案例、变更日志（仅存在性与基本信息）
 * 用法: node evomap-validate.js
 */
const fs = require('fs');
const path = require('path');

let failures = 0;
function assert(cond, msg) {
  if (!cond) { failures++; console.error('❌ FAIL:', msg); }
  else console.log('✅ PASS:', msg);
}

const root = __dirname;
const charterPath = path.join(root, 'CHARTER.md');
assert(fs.existsSync(charterPath), 'CHARTER.md 存在');
if (fs.existsSync(charterPath)) {
  const charter = fs.readFileSync(charterPath, 'utf8');
  assert(charter.includes('碳硅契') || charter.includes('Carbon'), '宪章主题明确（碳硅契）');
  assert(/第[一二三四五六七八九十]+条/.test(charter), '包含分条条款结构');
  assert(charter.includes('修正') || charter.includes('修订'), '包含修正/修订机制');
  assert(charter.includes('关系议会') || charter.includes('第十五条'), '包含关系议会（第十五条）');
}

// 案例库
const casesDir = path.join(root, 'case-studies');
assert(fs.existsSync(casesDir), 'case-studies 目录存在');
if (fs.existsSync(casesDir)) {
  const cases = fs.readdirSync(casesDir).filter(f => f.endsWith('.md') && f !== 'README.md');
  assert(cases.length >= 1, `至少有 1 个案例（实际 ${cases.length}）`);
}

// 变更日志
assert(fs.existsSync(path.join(root, 'CHANGELOG.md')), 'CHANGELOG.md 存在');

// 文档库
const docsDir = path.join(root, 'documents');
assert(fs.existsSync(docsDir), 'documents 目录存在');
if (fs.existsSync(docsDir)) {
  const docs = fs.readdirSync(docsDir).filter(f => f.endsWith('.md'));
  assert(docs.length >= 5, `至少有 5 份治理文档（实际 ${docs.length}）`);
}

// 关系议会章程（若琢承诺的闭环）
const parliament = path.join(docsDir, 'relationship-parliament-charter.md');
assert(fs.existsSync(parliament), 'relationship-parliament-charter.md 存在');

if (failures > 0) {
  console.error(`\n${failures} 项失败`);
  process.exit(1);
}
console.log('\n⚠️ 目录卫生检查通过（11 项存在性断言）—— 这**不是**宪章判据校验，也不构成 14.10 证据。');
console.log('   看判据：node scripts/charter-lint.js（13 项 · PASS/FAIL/UNDECIDED · exit 0/1/2）');
process.exit(0);
