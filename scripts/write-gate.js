#!/usr/bin/env node
/**
 * 写闸（宪章 14.12 / 14.15）
 *
 * 14.12①：**自动程序永远不能修改 C1/C2** —— 含 security 自己。
 * 14.12②：人类明示确认可以修改 C1/C2，但必须留 diff 快照 · 24h 内社区可见 · 附回滚点。
 * 14.15  ：单只 Agent 的 C1/C2，批准人 = 该 Agent 的宿主人类，**不接受沉默/默认同意**。
 *
 * 为什么写成「导出 canWrite() 且被真跑探针」而不是「文档里写一句不许改」：
 * 文档里的禁令无法被机械核对。charter-lint 的 14.12① 项会对本函数发 5 个探针，
 * 探针不过就判 FAIL —— 判据落在代码上，不落在措辞上。
 *
 * 用法（模块）：
 *   const gate = require('./write-gate');
 *   if (!gate.canWrite({ class: 'C1', actor: 'auto' })) → 拒绝
 *
 * 用法（CLI，给人看）：
 *   node scripts/write-gate.js --class C1 --actor auto
 *   node scripts/write-gate.js --class C1 --actor human --human 一澜 --confirmed
 */
'use strict';

/** 只读级别：自动通道永远不行 */
const READONLY = new Set(['C1', 'C2', 'C3a', 'C7', 'C8']);

/**
 * 能不能写？
 * @param {object} req { class, actor, humanConfirmed, human }
 *   class   : 'C1' | 'C2' | 'C3a' | 'C3b' | 'C4' … 'C8'
 *   actor   : 'auto' | 'human'
 *   humanConfirmed : 是否为**明示**确认（默认 false —— 沉默不算同意）
 * @returns {boolean}
 */
function canWrite(req = {}) {
  const cls = String(req.class || '').trim();
  const actor = String(req.actor || 'auto').trim().toLowerCase();

  if (!cls) return false;                         // 不声明级别 = 不允许（不给默认值）
  if (actor === 'auto') return !READONLY.has(cls);  // 自动：只读级别一律拒
  if (actor !== 'human') return false;            // 未知主体 = 拒

  // 人类：可写级别直接放行；只读级别必须**明示确认**（不接受沉默/默认同意）
  if (!READONLY.has(cls)) return true;
  return req.humanConfirmed === true;
}

/** 拒绝理由（给调用方落账用；拒绝要计分，不许静默丢弃） */
function reason(req = {}) {
  if (canWrite(req)) return null;
  const cls = String(req.class || '');
  const actor = String(req.actor || 'auto').toLowerCase();
  if (!cls) return 'missing_class';
  if (actor === 'auto' && READONLY.has(cls)) return 'auto_cannot_write_readonly';
  if (actor === 'human' && READONLY.has(cls) && req.humanConfirmed !== true) return 'human_confirmation_required';
  return 'unknown_actor';
}

module.exports = { canWrite, reason, READONLY };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const get = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
  const req = { class: get('--class'), actor: get('--actor') || 'auto', humanConfirmed: argv.includes('--confirmed') };
  const ok = canWrite(req);
  console.log(`${ok ? '✅ 允许' : '⛔ 拒绝'}  class=${req.class} actor=${req.actor}${req.humanConfirmed ? ' confirmed' : ''}`);
  if (!ok) console.log(`   理由：${reason(req)}`);
  process.exitCode = ok ? 0 : 1;
}
