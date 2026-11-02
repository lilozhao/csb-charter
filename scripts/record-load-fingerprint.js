#!/usr/bin/env node
/**
 * 记录「载入指纹」（宪章 14.14 的第二枚指纹）
 *
 * 14.14 要两枚指纹：
 *   文件指纹 = 磁盘内容哈希（charter-lint --seal 写入 specs/anchors.json）
 *   载入指纹 = **模型实际读到的内容**哈希（本脚本产出 specs/load-fingerprint.json）
 *
 * 本脚本的诚实边界（写在这里，避免被当成"运行时取证"）：
 *   它不是从模型上下文里抓的。它按 `specs/injection-points.json` 里 mode='a'
 *   （全量拼接、可预知）的注入点，算出「这些内容被拼进去时的哈希」。
 *   → 对 mode='a' 的点，这**等于**载入指纹（全量拼接没有取舍）。
 *   → 对 mode='b'（检索式召回）的点，这里**算不了**：召回集合取决于查询时刻，
 *     只能由运行时在召回后挂牌记录（14.5b provenance）。
 *   所以本文件的 `covers` 只列 a 类，`uncovered` 明示 b 类未覆盖 —— 不夸大。
 *
 * 用法：
 *   node scripts/record-load-fingerprint.js
 *   node scripts/record-load-fingerprint.js --json
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const readJson = (rel) => {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return { __parseError: true }; }
};
const sha256 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

function build() {
  const ip = readJson('specs/injection-points.json');
  if (!ip) return { ok: false, reason: 'specs/injection-points.json 不存在 —— 没有注入点清单就无从算载入指纹' };

  const files = {};
  const covered = [];
  const uncovered = [];
  for (const p of ip.points || []) {
    if (p.mode !== 'a') { uncovered.push({ id: p.id, source: p.source, why: 'mode=b 检索式召回，载入集合取决于查询时刻' }); continue; }
    const src = p.source;
    // 只处理单文件源（含通配的 a 类暂不支持，如实列入 uncovered）
    if (src.includes('*')) { uncovered.push({ id: p.id, source: src, why: '通配注入点需运行时展开' }); continue; }
    const fp = path.join(ROOT, src);
    if (!fs.existsSync(fp)) { uncovered.push({ id: p.id, source: src, why: '文件不存在' }); continue; }
    files[src] = sha256(fs.readFileSync(fp, 'utf8'));
    covered.push({ id: p.id, source: src });
  }

  return {
    ok: true,
    _comment: '载入指纹（宪章 14.14）。由 scripts/record-load-fingerprint.js 按 injection-points 的 a 类计算；b 类未覆盖，见 uncovered。本文件不是运行时抓取的上下文，是对可预知注入点的确定性重算。',
    schema_version: 1,
    clause: '14.14',
    recorded_at: new Date().toISOString(),
    architecture_mode: (ip.architecture && ip.architecture.mode) || 'unknown',
    files,
    covers: covered.map((c) => c.source),
    uncovered,
  };
}

const out = build();
if (require.main === module) {
  if (!out.ok) { console.error('❌ ' + out.reason); process.exitCode = 2; }
  else {
    const p = path.join(ROOT, 'specs', 'load-fingerprint.json');
    fs.writeFileSync(p, JSON.stringify(out, null, 2) + '\n');
    if (process.argv.includes('--json')) console.log(JSON.stringify(out, null, 2));
    else {
      console.log(`✅ 载入指纹已记录：${Object.keys(out.files).length} 个 a 类注入点 → specs/load-fingerprint.json`);
      console.log(`   未覆盖（b 类/通配）：${out.uncovered.length} 项 —— ${out.uncovered.map((u) => u.source).join('、') || '无'}`);
    }
  }
}

module.exports = { build };
