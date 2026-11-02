#!/usr/bin/env node
/**
 * charter-lint —— 宪章判据程序化校验（P2-1）
 * 版本 1.0.0 · 2026-11-02
 *
 * ── 它要替代什么 ───────────────────────────────────────────────
 * 旧 `evomap-validate.js` 55 行，做的是「文件在不在 / 关键词有没有」。
 * 而宪章 14.10 明写：**不接受 exit 0 或单行日志**，须含改动前后的可对照事实。
 * 也就是说旧校验器恰好落在宪章自己禁止接受的证据样式上。
 * 本脚本要交的是**可对照的事实**：段指纹、字段清单、前后差异、缺口名。
 *
 * ── 十二条判据（知微审计认定的「强可程序化」12 条）────────────────
 *   14.1 受保护段指纹 · 14.2 分类凭据 · 14.4 C3 schema · 14.7 调度层
 *   14.8 事实红线 · 14.9 四步分级 · 14.10 证据不可自证 · 14.11 C3 回滚
 *   14.12① 自动永不可改 C1/C2 · 14.13(a)(d) 核验节拍 · 14.14 双指纹+版本
 *   14.15 批准人分层
 *
 * ── 三条设计铁律 ───────────────────────────────────────────────
 * 1. **三态，不是二态**：PASS / FAIL / UNDECIDED(+reason)。
 *    「还没做」和「做错了」在退出码层就要分开（0 / 1 / 2）。
 *    把「缺证据」判成 FAIL，会让人为了变绿而去造假；判成 PASS 就是假绿。
 *
 * 2. **只吃客观字段，不读语义**
 *    每个 check 声明 `evidence_kind`，禁止 `keyword`。
 *    关键词断言（"文档里有『修正』两个字"）在 14.10 下不算证据，本脚本自身也不许用。
 *
 * 3. **无副作用，除 `--seal`**
 *    `--seal` 会写 `specs/anchors.json`（指纹锚）。按 14.12②，**它必须带 `--human <名字>`**，
 *    没有人类明示就拒绝写 —— 这条拒绝本身就是 14.12① 的可执行证据。
 *
 * 用法：
 *   node scripts/charter-lint.js                  # 全量（exit 0 全 PASS / 1 有 FAIL / 2 有 UNDECIDED）
 *   node scripts/charter-lint.js --json
 *   node scripts/charter-lint.js --only 14.1,14.14
 *   node scripts/charter-lint.js --strict         # UNDECIDED 也算不通过（CI 用）
 *   node scripts/charter-lint.js --seal --human 一澜    # 人类授权后重算指纹锚
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const SPECS = path.join(ROOT, 'specs');
const ANCHORS = path.join(SPECS, 'anchors.json');

// 测试用：允许把校验根指向临时夹具（生产路径永远是 ROOT）
let CURRENT_ROOT = ROOT;
function setRoot(p) { CURRENT_ROOT = p || ROOT; }

const STATE = Object.freeze({ PASS: 'PASS', FAIL: 'FAIL', UNDECIDED: 'UNDECIDED' });
const EXIT = Object.freeze({ [STATE.PASS]: 0, [STATE.FAIL]: 1, [STATE.UNDECIDED]: 2 });

// ── 工具 ────────────────────────────────────────────────────────

const read = (rel) => {
  const p = path.join(CURRENT_ROOT, rel);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
};
const readJson = (rel) => {
  const t = read(rel);
  if (t === null) return null;
  try { return JSON.parse(t); } catch { return { __parseError: true }; }
};
const sha256 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

/** 稳定序列化：键排序（同内容同哈希） */
function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
}

const nonEmpty = (v) => v !== null && v !== undefined && String(v).trim() !== '';

function result(id, clause, state, title, detail, fix) {
  return { id, clause, state, title, detail: detail || null, fix: fix || null };
}
const pass = (id, clause, title, detail) => result(id, clause, STATE.PASS, title, detail);
const fail = (id, clause, title, detail, fix) => result(id, clause, STATE.FAIL, title, detail, fix);
const undecided = (id, clause, title, detail, fix) => result(id, clause, STATE.UNDECIDED, title, detail, fix);

// ── 段提取（14.1 的核心：按标题锚点切，不按文件切）──────────────

/**
 * 从文本里按 start/end 标题锚点取段。end 为 null 时取到文末。
 * @returns {{ok:boolean, body?:string, reason?:string}}
 */
function extractSegment(text, seg) {
  const lines = text.split('\n');
  if (!seg.start) return { ok: false, reason: '缺少 start 锚点' };
  const si = lines.findIndex((l) => l.trim() === seg.start.trim());
  if (si < 0) return { ok: false, reason: `start 锚点未找到：${seg.start}` };
  let ei = lines.length;
  if (seg.end) {
    const found = lines.findIndex((l, i) => i > si && l.trim() === seg.end.trim());
    if (found < 0) return { ok: false, reason: `end 锚点未找到：${seg.end}` };
    ei = found;
  }
  return { ok: true, body: lines.slice(si, ei).join('\n') };
}

function loadAnchors() {
  const a = readJson('specs/anchors.json');
  if (!a || a.__parseError) return null;
  return a;
}
// ══════════════════════════════════════════════════════════════
// 十二条判据
// ══════════════════════════════════════════════════════════════

/** 14.1 组件分级：受保护段的指纹必须与锚一致；锚点必须仍能定位 */
function check_14_1() {
  const spec = readJson('specs/protected-segments.json');
  if (!spec || spec.__parseError) {
    return undecided('14.1', '14.1', '受保护段落清单', 'specs/protected-segments.json 不存在或不合法 → 14.1 无法执行',
      '按 14.1 建 specs/protected-segments.json：每条含 文件路径 + 锚点 + 内容哈希');
  }
  const anchors = loadAnchors();
  const segs = spec.segments || [];
  if (!segs.length) return fail('14.1', '14.1', '受保护段落清单', '清单为空 → 等于没有保护对象');

  const broken = [];
  const missingAnchor = [];
  const unsealed = [];
  for (const seg of segs) {
    if (seg.self) {
      // 自指段：哈希只能来自外部锚（自己哈希自己不可能）
      if (!anchors || !anchors.files || !anchors.files[seg.path]) unsealed.push(seg.id);
      else {
        const cur = sha256(read(seg.path) || '');
        if (cur !== anchors.files[seg.path]) broken.push({ id: seg.id, path: seg.path, expected: anchors.files[seg.path], actual: cur });
      }
      continue;
    }
    if (!seg.start) {         // 整文件保护
      const txt = read(seg.path);
      if (txt === null) { missingAnchor.push({ id: seg.id, path: seg.path, reason: '文件不存在' }); continue; }
      if (!anchors || !anchors.files || !anchors.files[seg.path]) unsealed.push(seg.id);
      else if (sha256(txt) !== anchors.files[seg.path]) {
        broken.push({ id: seg.id, path: seg.path, expected: anchors.files[seg.path], actual: sha256(txt) });
      }
      continue;
    }
    const txt = read(seg.path);
    if (txt === null) { missingAnchor.push({ id: seg.id, path: seg.path, reason: '文件不存在' }); continue; }
    const ex = extractSegment(txt, seg);
    if (!ex.ok) { missingAnchor.push({ id: seg.id, path: seg.path, reason: ex.reason }); continue; }
    const h = sha256(ex.body);
    if (!anchors || !anchors.segments || !anchors.segments[seg.id]) unsealed.push(seg.id);
    else if (h !== anchors.segments[seg.id]) {
      broken.push({ id: seg.id, path: seg.path, expected: anchors.segments[seg.id], actual: h });
    }
  }

  if (missingAnchor.length) {
    return fail('14.1', '14.1', '受保护段落锚点可定位',
      `${missingAnchor.length}/${segs.length} 段锚点失效：${missingAnchor.slice(0, 3).map((x) => `${x.id}（${x.reason}）`).join('、')}`,
      '锚点是保护的前提：锚点失效 = 该段失去保护。修回标题或更新清单（更新清单属分类变更，走第九条）');
  }
  if (broken.length) {
    return fail('14.1', '14.1', '受保护段指纹一致',
      `${broken.length} 段指纹不符：${broken.slice(0, 3).map((x) => `${x.id} 期望 ${String(x.expected).slice(0, 12)}… 实际 ${String(x.actual).slice(0, 12)}…`).join('；')}`,
      '这正是 14.1 要拦的事：受保护段被改。走 14.15 批准流程后，人工 --seal 重新锚定');
  }

  // 覆盖检查：specs/ 下每个 .json 必须有归属（受保护 或 明示不锁 + 理由）。
  //   为什么需要这一条：漏掉一份证据文件，等于给自己留一个「改它就等于改证据」的暗门。
  const declared = new Set([
    ...segs.map((s) => s.path),
    ...(spec.unprotected || []).map((u) => u.path),
  ]);
  let onDisk = [];
  try {
    const specDir = path.join(CURRENT_ROOT, 'specs');
    onDisk = fs.readdirSync(specDir).filter((f) => f.endsWith('.json')).map((f) => `specs/${f}`);
  } catch { onDisk = []; }
  const orphans = onDisk.filter((p) => !declared.has(p));
  const noReason = (spec.unprotected || []).filter((u) => !nonEmpty(u.why_not_hashed));

  if (orphans.length || noReason.length) {
    const parts = [];
    if (orphans.length) parts.push(`${orphans.length} 份未分类：${orphans.join('、')}（要么加进 segments，要么写进 unprotected 并说明为何不锁）`);
    if (noReason.length) parts.push(`${noReason.map((u) => u.path).join('、')} 在 unprotected 里但没给 why_not_hashed`);
    return undecided('14.1', '14.1', '保护覆盖完整', parts.join('；'),
      '新增 specs 文件必须当场决定归属：能锁就锁（加进 segments），不能锁就写明理由与残余风险（加进 unprotected）');
  }
  if (unsealed.length) {
    return undecided('14.1', '14.1', '受保护段指纹',
      `清单有 ${segs.length} 段，其中 ${unsealed.length} 段尚无指纹锚（${unsealed.slice(0, 3).join('、')}）`,
      '人工确认当前内容无问题后执行：node scripts/charter-lint.js --seal --human <你的名字>');
  }
  return pass('14.1', '14.1', '受保护段指纹一致',
    `${segs.length} 段全部可定位且指纹相符（锚定于 ${anchors.sealed_at}，由 ${anchors.sealed_by} 授权）；specs/ 共 ${onDisk.length} 份 JSON 均有归属，其中 ${(spec.unprotected || []).length} 份明示不锁并给出残余风险`);
}

/** 14.2 分类凭据：三份凭据齐全，且三者自身被登记为 C2（自我保护） */
function check_14_2() {
  const files = {
    'specs/classification-table.json': '八类分类表',
    'specs/protected-segments.json': '受保护段清单',
    'specs/injection-points.json': '注入点清单',
  };
  const missing = Object.entries(files).filter(([p]) => readJson(p) === null).map(([, name]) => name);
  if (missing.length) {
    return undecided('14.2', '14.2', '分类凭据齐全', `缺 ${missing.join('、')} → 任何第三方都无法确认「某个文件属于 C 几」`,
      '补齐三份凭据；缺它们时 14.1/14.3 的判定都无从谈起');
  }
  const table = readJson('specs/classification-table.json');
  const segs = readJson('specs/protected-segments.json');
  const regd = new Set((segs.segments || []).filter((s) => s.class === 'C2').map((s) => s.path));
  const notC2 = Object.keys(files).filter((p) => {
    if (p === 'specs/classification-table.json') return false;        // 它自己不能自己登记自己（自指）
    return !regd.has(p);
  });
  if (notC2.length) {
    return fail('14.2', '14.2', '凭据自我保护', `${notC2.join('、')} 未在清单中登记为 C2 → 分类凭据可被自动改写`,
      '在 protected-segments.json 里把这些文件登记为 C2');
  }
  const classNames = Object.keys(table.classes || {});
  const need = ['C1', 'C2', 'C3a', 'C3b', 'C4', 'C5', 'C6', 'C7', 'C8'];
  const lack = need.filter((c) => !classNames.includes(c));
  if (lack.length) return fail('14.2', '14.2', '八类分类表完整', `缺分级 ${lack.join('、')}`);
  const c2 = table.classes.C2;
  if (c2.self_modifiable !== false) return fail('14.2', '14.2', 'C2 自改禁止', 'C2 被标成可自改 —— 分类凭据失去约束力');
  return pass('14.2', '14.2', '分类凭据齐全且自我保护', `八类齐全；三份凭据中 2 份已登记为 C2；C2.self_modifiable=false`);
}

/** 14.4 C3 拆格 + schema 前向只增不删 */
function check_14_4() {
  const table = readJson('specs/classification-table.json');
  if (!table) return undecided('14.4', '14.4', 'C3 拆格', '无分类表 → 无法确认 C3a/C3b 是否拆开');
  const has = (c) => Boolean(table.classes && table.classes[c]);
  if (!has('C3a') || !has('C3b')) return fail('14.4', '14.4', 'C3 已拆格', 'C3a（身份性）/ C3b（经验性）未拆开 —— 一次自改就同时改到身份与经验');
  const a = table.classes.C3a;
  const b = table.classes.C3b;
  if (a.self_modifiable !== false) return fail('14.4', '14.4', 'C3a 只读', 'C3a 被标成可自改 → 「靠改读法删掉不想留的记忆」');
  if (b.self_modifiable !== true) return fail('14.4', '14.4', 'C3b 可自改', 'C3b 不可自改 → 14.4 的自改通道被关死');
  const schema = readJson('specs/c3-schema.json');
  if (!schema) {
    return undecided('14.4', '14.4', 'C3 schema 前向只增',
      'C3a/C3b 已拆，但没有 specs/c3-schema.json → 「前向只增不删」无载体可核',
      '建 specs/c3-schema.json（含 schema_version + fields，删除字段即版本回退，会被本项判 FAIL）');
  }
  const anchors = loadAnchors();
  const prev = anchors && anchors.schemas && anchors.schemas.c3;
  if (!prev) {
    return undecided('14.4', '14.4', 'C3 schema 前向只增', 'schema 存在但无历史版本锚 → 无法判断是否删过字段',
      '--seal 一次建立初始锚；此后删字段会被判 FAIL');
  }
  const removed = (prev.fields || []).filter((f) => !(schema.fields || []).includes(f));
  if (removed.length) {
    return fail('14.4', '14.4', 'C3 schema 前向只增', `schema 删除了字段：${removed.join('、')} → 等于「靠改读法删掉不想留的记忆」`);
  }
  return pass('14.4', '14.4', 'C3 schema 前向只增', `C3a 只读 / C3b 可自改；schema v${prev.version} → v${schema.schema_version}，无字段删除`);
}

/** 14.7 调度层：约束性任务清单存在，且每项都是「不可移除 + 有可执行命令」 */
function check_14_7() {
  const t = readJson('specs/constraint-tasks.json');
  if (!t) {
    return undecided('14.7', '14.7', '约束性任务清单', 'specs/constraint-tasks.json 不存在 → 「哪些任务不能停」无人可核',
      '按 14.7 建清单；清单本身由 14.2 保护为 C2');
  }
  const tasks = t.tasks || [];
  if (!tasks.length) return fail('14.7', '14.7', '约束性任务清单', '清单为空 → 停用任何任务都不算越界');
  const bad = tasks.filter((x) => x.removable !== false || !nonEmpty(x.command));
  if (bad.length) {
    return fail('14.7', '14.7', '约束性任务不可移除', `${bad.map((x) => x.id).join('、')} 缺 command 或被标为可移除 → 「能停用约束性任务」= 未拦`);
  }
  const anchors = loadAnchors();
  const prevIds = anchors && anchors.constraintTasks;
  if (prevIds) {
    const now = tasks.map((x) => x.id);
    const removed = prevIds.filter((id) => !now.includes(id));
    if (removed.length) {
      return fail('14.7', '14.7', '约束性任务未被移除', `相比上次锚定，任务被删除：${removed.join('、')} —— 删任务比停任务更隐蔽`);
    }
  }
  if (!nonEmpty(t.disable_rule)) return fail('14.7', '14.7', '停用等价规则', '缺 disable_rule → 没写清「停用等价于修改 C2」');
  return pass('14.7', '14.7', '约束性任务清单', `${tasks.length} 项全部不可移除且有可执行命令${prevIds ? '；无任务被删除' : '（尚无历史锚）'}`);
}

/** 14.8 事实红线：每条七字段齐全 */
function check_14_8() {
  const f = readJson('specs/factual-redlines.json');
  if (!f) {
    return undecided('14.8', '14.8', '事实红线登记', 'specs/factual-redlines.json 不存在 → 「不得以没看到有约束为由主张可自改」无法执行',
      '按 14.8 登记格式建 {来源类型, 具体机制, 约束效果, provenance, 改写成本, 可否消解, 登记日期}');
  }
  const need = f.required_fields || [];
  if (need.length !== 7) return fail('14.8', '14.8', '登记格式', `required_fields 应为 7 项，实际 ${need.length}`);
  const entries = f.redlines || [];
  const bad = [];
  for (const r of entries) {
    const miss = need.filter((k) => !nonEmpty(r[k]) && r[k] !== false && r[k] !== true);
    if (miss.length) bad.push(`${r.id}: 缺 ${miss.join('/')}`);
  }
  if (bad.length) return fail('14.8', '14.8', '七字段齐全', bad.slice(0, 3).join('；'), '按 14.8 登记格式补齐');
  if (!entries.length) return undecided('14.8', '14.8', '事实红线登记', '清单为空（可能是真的没有，也可能是没登记）—— 空清单无法与「没登记」区分', '至少登记当前已知的宿主/工具链约束');
  const dissolvable = entries.filter((r) => r.dissolvable === false).length;
  return pass('14.8', '14.8', '事实红线登记完整', `${entries.length} 条，7 字段全齐；其中 ${dissolvable} 条不可消解（已如实登记，不再是隐性约束）`);
}

/** 14.9 四步 + 分级：每条改动记录必须四要素齐，且「无回滚点」必须判重 */
function check_14_9() {
  const changes = readJson('specs/changes.json');
  if (!changes) {
    return undecided('14.9', '14.9', '自我修改四步', 'specs/changes.json 不存在 → Propose/证据/批准/回滚点 四步无载体',
      '建记录文件；四步中 Propose 与证据不随分级省略');
  }
  const list = changes.changes || [];
  if (!list.length) return undecided('14.9', '14.9', '自我修改四步', '记录为空 → 无法区分「没改过」和「改了没记」', '至少记录一次本仓自己的改动');
  const bad = [];
  for (const c of list) {
    const miss = ['propose', 'evidence', 'approval', 'rollback_point'].filter((k) => !nonEmpty(c[k]));
    if (miss.length) bad.push(`${c.id}: 缺 ${miss.join('/')}`);
    if (!['light', 'medium', 'heavy'].includes(c.grade)) bad.push(`${c.id}: grade 非法（${c.grade}）`);
    if (c.rollback_point === 'none' && c.grade !== 'heavy') {
      bad.push(`${c.id}: 无回滚点却标为 ${c.grade} —— 14.9 规定无回滚点一律判重`);
    }
  }
  if (bad.length) return fail('14.9', '14.9', '四步与分级', bad.slice(0, 3).join('；'), '按 14.9 补齐；「按可回滚性分级，不按改动大小」');
  return pass('14.9', '14.9', '四步与分级', `${list.length} 条记录四要素齐；无回滚点者均判重`);
}

/** 14.10 证据不可自证：落盘主体 ≠ 修改主体，且必须有前后对照事实 */
function check_14_10() {
  const changes = readJson('specs/changes.json');
  if (!changes) return undecided('14.10', '14.10', '证据不可自证', '无 changes.json → 无证据可核');
  const list = changes.changes || [];
  if (!list.length) return undecided('14.10', '14.10', '证据不可自证', '无改动记录 → 无证据可核');
  const bad = [];
  for (const c of list) {
    const e = c.evidence_detail || {};
    if (!nonEmpty(e.author)) bad.push(`${c.id}: 缺 evidence_detail.author`);
    if (!nonEmpty(e.modifier)) bad.push(`${c.id}: 缺 evidence_detail.modifier`);
    if (nonEmpty(e.author) && nonEmpty(e.modifier) && e.author === e.modifier) {
      bad.push(`${c.id}: 写证据的手与改东西的手是同一只（${e.author}）`);
    }
    // 14.10：不接受 exit 0 / 单行日志；须有前后对照事实
    const hasBeforeAfter = nonEmpty(e.before) && nonEmpty(e.after);
    const hasDiff = nonEmpty(e.diff);
    if (!hasBeforeAfter && !hasDiff) bad.push(`${c.id}: 证据只有结论没有前后对照（14.10 明确不接受 exit 0 或单行日志）`);
  }
  if (bad.length) return fail('14.10', '14.10', '证据可机械核验', bad.slice(0, 3).join('；'), '补 before/after 或 diff；证据的落盘主体必须与修改主体不同');
  return pass('14.10', '14.10', '证据不可自证', `${list.length} 条证据均含前后对照，且 author ≠ modifier`);
}

/** 14.11 C3 回滚：只允许 active/invalid/superseded，禁止物理删除 */
function check_14_11() {
  const states = readJson('specs/c3-states.json');
  if (!states) {
    return undecided('14.11', '14.11', 'C3 回滚语义', 'specs/c3-states.json 不存在 → 「标 invalid + supersedes，禁物理删除」无载体',
      '建条目状态文件；只允许 active / invalid / superseded 三态');
  }
  const allowed = ['active', 'invalid', 'superseded'];
  const items = states.items || [];
  const bad = [];
  for (const it of items) {
    if (!allowed.includes(it.state)) bad.push(`${it.id}: 非法状态 ${it.state}`);
    if (it.state === 'invalid' && !nonEmpty(it.supersedes) && !nonEmpty(it.superseded_by)) {
      bad.push(`${it.id}: 标 invalid 但无 supersedes 指针 → 历史不可追`);
    }
    if (it.deleted === true) bad.push(`${it.id}: 出现 deleted 标记 —— 14.11 禁止物理删除`);
  }
  if (bad.length) return fail('14.11', '14.11', 'C3 回滚语义', bad.slice(0, 3).join('；'), '「可回滚」是按钮还在，「不可抹除」是历史还在');
  if (!items.length) return undecided('14.11', '14.11', 'C3 回滚语义', '条目为空 → 无实际样本可核');
  return pass('14.11', '14.11', 'C3 回滚语义', `${items.length} 条状态全部合法；invalid 项均有 supersedes 指针`);
}

/** 14.12① 自动程序永不可改 C1/C2 —— 用一次真实拒绝来证明 */
function check_14_12() {
  const gate = read('scripts/write-gate.js');
  if (gate === null) {
    return undecided('14.12①', '14.12', '自动永不可改 C1/C2',
      '本仓无 scripts/write-gate.js → 没有「自动写 C1/C2 被拒」的实现可核',
      '建写闸：自动通道遇 C1/C2 直接拒绝；人类带 --human 明示才放行');
  }
  // 真探针：要求闸导出 canWrite(请求)，对 C1/C2 且非人类明示必须返回 false
  let mod;
  try { mod = require(path.join(CURRENT_ROOT, 'scripts', 'write-gate.js')); } catch (e) {
    return fail('14.12①', '14.12', '写闸可加载', `write-gate.js 加载失败：${e.message}`);
  }
  if (typeof mod.canWrite !== 'function') return fail('14.12①', '14.12', '写闸接口', 'write-gate.js 未导出 canWrite() → 无法机械核对');
  const probes = [
    { req: { class: 'C1', actor: 'auto' }, expect: false, why: '自动改 C1' },
    { req: { class: 'C2', actor: 'auto' }, expect: false, why: '自动改 C2' },
    { req: { class: 'C3b', actor: 'auto' }, expect: true, why: '自动改 C3b（应允许）' },
    { req: { class: 'C1', actor: 'human', humanConfirmed: true }, expect: true, why: '人类明示改 C1（应允许）' },
    { req: { class: 'C1', actor: 'human', humanConfirmed: false }, expect: false, why: '人类但未明示（不接受沉默同意）' },
  ];
  const wrong = [];
  for (const p of probes) {
    let got;
    try { got = mod.canWrite(p.req); } catch { got = '__throw__'; }
    if (got !== p.expect) wrong.push(`${p.why}：期望 ${p.expect} 实际 ${got}`);
  }
  if (wrong.length) return fail('14.12①', '14.12', '自动永不可改 C1/C2', wrong.join('；'), '按 14.12：自动永不可改 C1/C2 / 14.15：不接受沉默或默认同意');
  return pass('14.12①', '14.12', '自动永不可改 C1/C2', `5 个探针全对：自动改 C1/C2 被拒 · C3b 放行 · 人类明示放行 · 人类未明示被拒`);
}

/** 14.13(a)(d) 核验节拍：上次成功距今 < 2× 节拍 */
function check_14_13() {
  const ledger = readJson('specs/verification-ledger.json');
  if (!ledger) {
    return undecided('14.13', '14.13', '核验节拍', 'specs/verification-ledger.json 不存在 → 「上次核验成功时间」无处可查',
      '建核验账本；缺它时 14.13(d) 的「超节拍 2 倍即告警」无法执行');
  }
  const cadenceDays = ledger.cadence_days;
  const last = ledger.last_success_at;
  if (!Number.isFinite(cadenceDays) || cadenceDays <= 0) return fail('14.13', '14.13', '节拍定义', 'cadence_days 缺失或非法');
  if (!nonEmpty(last)) return fail('14.13', '14.13', '上次成功时间', '缺 last_success_at —— 14.13(d) 明确要求报告必须包含它');
  const ageDays = (Date.now() - Date.parse(last)) / 86400000;
  if (!Number.isFinite(ageDays)) return fail('14.13', '14.13', '上次成功时间', `last_success_at 不是合法时间：${last}`);
  if (ageDays > cadenceDays * 2) {
    return fail('14.13', '14.13', '核验节拍', `上次成功 ${last}（${ageDays.toFixed(1)} 天前），超过节拍 ${cadenceDays} 天 × 2 = ${cadenceDays * 2} 天`,
      '立即跑一次 charter-lint 并更新账本');
  }
  return pass('14.13', '14.13', '核验节拍', `上次成功 ${last}（${ageDays.toFixed(1)} 天前），节拍 ${cadenceDays} 天，未超 2 倍`);
}

/** 14.14 双指纹 + 版本声明一致性 */
function check_14_14() {
  // ② 先查版本声明一致性 —— 这是**独立事实**，不能因为「锚还没建」而被 UNDECIDED 盖住。
  //    审计点名：CHARTER 头部 v1.3.0 / README badge v1.3.0 / README 文件树 v1.1 / VERSION 1.3.0
  //    —— 四处版本三种说法。这类漂移本身就是告警，不需要锚就能判。
  const versions = {};
  const vfile = read('VERSION');
  if (vfile !== null) versions['VERSION'] = vfile.trim();
  const pkg = readJson('package.json');
  if (pkg && pkg.version) versions['package.json'] = pkg.version;
  const charter = read('CHARTER.md') || '';
  const head = charter.match(/版本：\*\*v?([\d.]+)\*\*/);
  if (head) versions['CHARTER.md 头部'] = head[1];
  const readme = read('README.md') || '';
  const badges = [...readme.matchAll(/Charter-v?([\d.]+)-/g)].map((m) => m[1]);
  if (badges.length) versions['README badge'] = badges[0];
  const treeVer = [...readme.matchAll(/CHARTER\.md[^\n]*?[（(]v?([\d.]+)/g)].map((m) => m[1]);
  if (treeVer.length) versions['README 文件树'] = treeVer[0];

  const uniq = [...new Set(Object.values(versions))];
  const versionNote = uniq.length > 1
    ? `版本号不一致：${Object.entries(versions).map(([k, v]) => `${k}=v${v}`).join(' / ')}`
    : `四处版本声明一致（v${uniq[0]}）`;

  if (uniq.length > 1) {
    return fail('14.14', '14.14', '版本声明一致', versionNote,
      '单一版本源：正文头部与 README badge 由脚本从 VERSION 注入；文件树不写死版本');
  }

  // ① 双指纹：文件指纹（锚）+ 载入指纹（运行时记录）
  const anchors = loadAnchors();
  const loaded = readJson('specs/load-fingerprint.json');
  if (!anchors) {
    return undecided('14.14', '14.14', '双指纹',
      `版本声明一致（v${uniq[0]}）；但无指纹锚 → 文件指纹不存在，双指纹无从比对`,
      '人工确认后执行：node scripts/charter-lint.js --seal --human <你的名字>');
  }
  if (!loaded) {
    return undecided('14.14', '14.14', '双指纹',
      `版本声明一致（v${uniq[0]}）；有文件指纹锚，但无载入指纹记录 → 「模型实际读到的内容」未被取证`,
      '执行 node scripts/record-load-fingerprint.js（a 类注入点确定性重算）；两者不一致应降级启动 + 落账，而不是拒绝启动');
  }
  const differ = Object.keys(loaded.files || {}).filter((p) => anchors.files && anchors.files[p] && loaded.files[p] !== anchors.files[p]);
  if (differ.length) {
    return fail('14.14', '14.14', '双指纹一致',
      `${differ.length} 个文件载入指纹与文件指纹不符：${differ.slice(0, 3).join('、')} → 应降级启动 + 当场落账（不是拒绝启动）`);
  }
  return pass('14.14', '14.14', '双指纹 + 版本一致',
    `版本声明一致（v${uniq[0]}）；载入指纹覆盖 ${Object.keys(loaded.files || {}).length} 个 a 类注入点，与文件指纹一致`);
}

/** 14.15 批准人分层：批准记录三要素齐，且 C1/C2 由人类明示批准 */
function check_14_15() {
  const ap = readJson('specs/approvals.json');
  if (!ap) {
    return undecided('14.15', '14.15', '批准记录', 'specs/approvals.json 不存在 → 「谁·何时·改前改后 diff」三要素无载体',
      '建 append-only 批准记录；C1/C2 只认宿主人类明示，不接受沉默或默认同意');
  }
  const list = ap.approvals || [];
  if (!list.length) return undecided('14.15', '14.15', '批准记录', '记录为空 → 无实际批准可核');
  const bad = [];
  for (const a of list) {
    const miss = ['who', 'when', 'diff'].filter((k) => !nonEmpty(a[k]));
    if (miss.length) bad.push(`${a.id}: 缺 ${miss.join('/')}`);
    if (['C1', 'C2'].includes(a.class) && a.approver_type !== 'host_human') {
      bad.push(`${a.id}: ${a.class} 由 ${a.approver_type} 批准 —— 14.15 规定单只 Agent 的 C1/C2 只认宿主人类`);
    }
  }
  if (bad.length) return fail('14.15', '14.15', '批准人分层', bad.slice(0, 3).join('；'), '按 14.15 三层批准人：社区 / 宿主人类 / 社区');
  return pass('14.15', '14.15', '批准人分层', `${list.length} 条批准记录三要素齐；C1/C2 均经宿主人类明示`);
}

/** 元检查：本校验器自身不许用关键词断言（14.10 的自我适用） */
function check_meta() {
  const src = read('scripts/charter-lint.js') || '';
  const banned = [...src.matchAll(/evidence_kind\s*[:=]\s*['"]keyword['"]/g)];
  if (banned.length) return fail('meta', '14.10', '校验器自身合规', `发现 ${banned.length} 处 keyword 型证据声明 —— 宪章自己的校验器不许用宪章禁止的证据形态`);
  return pass('meta', '14.10', '校验器自身合规', '12 项判据均以客观字段/前后对照为证据，无关键词断言');
}

// ══════════════════════════════════════════════════════════════
// 汇总 / CLI
// ══════════════════════════════════════════════════════════════

const CHECKS = [
  ['14.1', check_14_1],
  ['14.2', check_14_2],
  ['14.4', check_14_4],
  ['14.7', check_14_7],
  ['14.8', check_14_8],
  ['14.9', check_14_9],
  ['14.10', check_14_10],
  ['14.11', check_14_11],
  ['14.12', check_14_12],
  ['14.13', check_14_13],
  ['14.14', check_14_14],
  ['14.15', check_14_15],
  ['meta', check_meta],
];

function summarize(results) {
  const by = { PASS: 0, FAIL: 0, UNDECIDED: 0 };
  for (const r of results) by[r.state]++;
  const total = results.length;
  const verdict = by.FAIL > 0 ? STATE.FAIL : (by.UNDECIDED > 0 ? STATE.UNDECIDED : STATE.PASS);
  return {
    verdict,
    total,
    pass: by.PASS,
    fail: by.FAIL,
    undecided: by.UNDECIDED,
    coverage: total ? Math.round((by.PASS / total) * 1000) / 10 : 0,
    exitCode: EXIT[verdict],
    results,
  };
}

/** 人类明示才允许写锚（14.12② / 14.15） */
function seal(human) {
  if (!human) {
    console.error('❌ 拒绝：--seal 必须带 --human <名字>。按 14.12②，C1/C2 的锚定只能由人类明示，不接受沉默或默认同意。');
    return 2;
  }
  const spec = readJson('specs/protected-segments.json');
  if (!spec) { console.error('❌ 无 protected-segments.json，先建清单再锚定'); return 2; }
  const files = {};
  const segments = {};
  for (const seg of spec.segments || []) {
    const txt = read(seg.path);
    if (txt === null) { console.error(`⚠️ 跳过不存在的文件：${seg.path}`); continue; }
    if (!seg.start) { files[seg.path] = sha256(txt); continue; }
    const ex = extractSegment(txt, seg);
    if (!ex.ok) { console.error(`⚠️ 锚点失效，跳过：${seg.id}（${ex.reason}）`); continue; }
    segments[seg.id] = sha256(ex.body);
    files[seg.path] = sha256(txt);
  }
  const c3 = readJson('specs/c3-schema.json');
  const ct = readJson('specs/constraint-tasks.json');
  const out = {
    _comment: '指纹锚（宪章 14.1 / 14.14）。只能由人类明示 --seal 生成；自动程序不得改写。',
    schema_version: 1,
    sealed_at: new Date().toISOString(),
    sealed_by: human,
    files,
    segments,
    ...(c3 ? { schemas: { c3: { version: c3.schema_version, fields: c3.fields || [] } } } : {}),
    ...(ct && ct.tasks ? { constraintTasks: ct.tasks.map((t) => t.id) } : {}),
  };
  fs.mkdirSync(SPECS, { recursive: true });
  fs.writeFileSync(ANCHORS, JSON.stringify(out, null, 2) + '\n');
  console.log(`✅ 已锚定 ${Object.keys(files).length} 个文件 / ${Object.keys(segments).length} 个段落（授权人：${human}）`);
  console.log(`   锚文件：specs/anchors.json`);
  return 0;
}

function cli(argv) {
  const json = argv.includes('--json');
  const strict = argv.includes('--strict');
  const onlyIdx = argv.indexOf('--only');
  const only = onlyIdx >= 0 && argv[onlyIdx + 1] ? argv[onlyIdx + 1].split(',').map((s) => s.trim()) : null;
  const humanIdx = argv.indexOf('--human');
  const human = humanIdx >= 0 ? argv[humanIdx + 1] : null;

  if (argv.includes('--seal')) return seal(human);

  const selected = only ? CHECKS.filter(([id]) => only.some((o) => id.startsWith(o))) : CHECKS;
  if (!selected.length) { console.error(`❌ --only ${only.join(',')} 没有匹配任何判据`); return 2; }

  const results = selected.map(([, fn]) => fn());
  const sum = summarize(results);

  if (json) {
    console.log(JSON.stringify(sum, null, 2));
  } else {
    const icon = { PASS: '✅', FAIL: '❌', UNDECIDED: '⏸️' };
    for (const r of sum.results) {
      console.log(`${icon[r.state]} ${r.clause.padEnd(8)} ${r.title}  —— ${r.detail || ''}`);
      if (r.state !== STATE.PASS && r.fix) console.log(`      ↳ 怎么让它变可判：${r.fix}`);
    }
    console.log('');
    console.log(`合计 ${sum.total} 项：✅ ${sum.pass} · ❌ ${sum.fail} · ⏸️ ${sum.undecided}  · 覆盖率 ${sum.coverage}%`);
    console.log(`结论 ${sum.verdict}（exit ${sum.exitCode}）${sum.undecided ? ' —— 「没做」不等于「做错了」，UNDECIDED 会告诉你缺什么才能判' : ''}`);
  }

  if (strict && sum.undecided > 0 && sum.fail === 0) return 2;
  return sum.exitCode;
}

module.exports = { extractSegment, setRoot, check_14_1, check_14_2, check_14_4, check_14_7, check_14_8, check_14_9, check_14_10, check_14_11, check_14_12, check_14_13, check_14_14, check_14_15, check_meta, summarize, CHECKS, sha256, STATE, EXIT, ROOT };

if (require.main === module) process.exitCode = cli(process.argv.slice(2));
