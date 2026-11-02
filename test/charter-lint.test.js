'use strict';

/**
 * charter-lint 单测（P2-1）
 *
 * 要锁住的不是「函数返回对」，而是三条容易假绿的：
 *   ① 「没做」不能被判成 PASS，也不能被判成 FAIL（三态在退出码层分开）
 *   ② 篡改受保护段必须被定位（否则指纹机制等于装饰）
 *   ③ --seal 没有人名必须拒绝（14.12② 的可执行证据）
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const LINT = require('../scripts/charter-lint.js');
const GATE = require('../scripts/write-gate.js');

const REPO = path.join(__dirname, '..');

function tmpRepo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'charter-lint-'));
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
  }
  return dir;
}

// ── 段提取（14.1 的地基）──────────────────────────────────────

test('extractSegment：按标题锚点精确切段，end 标题不进段内', () => {
  const text = [
    '# 文档',
    '### 14.1 甲',
    '甲的内容',
    '### 14.2 乙',
    '乙的内容',
  ].join('\n');
  const r = LINT.extractSegment(text, { start: '### 14.1 甲', end: '### 14.2 乙' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.body, '### 14.1 甲\n甲的内容');
  assert.ok(!r.body.includes('乙的内容'), 'end 之后的内容不得进入段内');
});

test('extractSegment：锚点失效要说明原因（不能静默切到文末）', () => {
  const r = LINT.extractSegment('# x\na\n', { start: '### 不存在', end: '### 也不存在' });
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /start 锚点未找到/);

  const r2 = LINT.extractSegment('### A\na\n', { start: '### A', end: '### B' });
  assert.strictEqual(r2.ok, false);
  assert.match(r2.reason, /end 锚点未找到/);
});

// ── 三态与退出码 ──────────────────────────────────────────────

test('summarize：有 FAIL → FAIL/exit 1；只有 UNDECIDED → UNDECIDED/exit 2；全绿 → PASS/exit 0', () => {
  const mk = (state) => ({ id: 'x', clause: '14.x', state, title: 't', detail: null, fix: null });

  assert.deepStrictEqual(
    [LINT.summarize([mk('PASS'), mk('FAIL')]).verdict, LINT.summarize([mk('PASS'), mk('FAIL')]).exitCode],
    ['FAIL', 1],
  );
  assert.deepStrictEqual(
    [LINT.summarize([mk('PASS'), mk('UNDECIDED')]).verdict, LINT.summarize([mk('PASS'), mk('UNDECIDED')]).exitCode],
    ['UNDECIDED', 2],
  );
  assert.deepStrictEqual(
    [LINT.summarize([mk('PASS')]).verdict, LINT.summarize([mk('PASS')]).exitCode],
    ['PASS', 0],
  );
});

test('summarize：FAIL 优先于 UNDECIDED（真错不能被"还没做"盖住）', () => {
  const m = (s) => ({ id: 'x', clause: '14.x', state: s, title: 't', detail: null, fix: null });
  const s = LINT.summarize([m('UNDECIDED'), m('FAIL'), m('UNDECIDED')]);
  assert.strictEqual(s.verdict, 'FAIL');
  assert.strictEqual(s.exitCode, 1);
  assert.strictEqual(s.undecided, 2);
});

// ── 14.1 指纹：篡改必须被定位 ────────────────────────────────

test('14.1：段内容被改 → FAIL，并给出期望/实际两组哈希', () => {
  const segStart = '### 14.1 甲';
  const segEnd = '### 14.2 乙';
  const body = `${segStart}\n原始内容\n`;
  const dir = tmpRepo({
    'CHARTER.md': `${body}${segEnd}\n乙的内容\n`,
    'specs/protected-segments.json': {
      segments: [{ id: 's1', path: 'CHARTER.md', class: 'C2', start: segStart, end: segEnd }],
    },
    'specs/anchors.json': { sealed_at: 'x', sealed_by: 'test', files: {}, segments: { s1: 'deadbeef' } },
  });
  LINT.setRoot(dir);
  const r = LINT.check_14_1();
  LINT.setRoot(REPO);

  assert.strictEqual(r.state, 'FAIL');
  assert.match(r.detail, /指纹不符/);
  assert.match(r.detail, /期望 deadbeef/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('14.1：无锚 → UNDECIDED（不是 FAIL，也不是 PASS）', () => {
  const dir = tmpRepo({
    'CHARTER.md': '### A\na\n### B\nb\n',
    'specs/protected-segments.json': {
      segments: [{ id: 's1', path: 'CHARTER.md', class: 'C2', start: '### A', end: '### B' }],
    },
  });
  LINT.setRoot(dir);
  const r = LINT.check_14_1();
  LINT.setRoot(REPO);

  assert.strictEqual(r.state, 'UNDECIDED');
  assert.match(r.detail, /尚无指纹锚/);
  assert.match(r.fix, /--seal --human/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('14.1：清单缺失 → UNDECIDED 且说明缺什么', () => {
  const dir = tmpRepo({ 'CHARTER.md': '# x\n' });
  LINT.setRoot(dir);
  const r = LINT.check_14_1();
  LINT.setRoot(REPO);
  assert.strictEqual(r.state, 'UNDECIDED');
  assert.match(r.fix, /protected-segments/);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ── 14.8 事实红线：七字段 ────────────────────────────────────

test('14.8：缺任一字段 → FAIL，并点名是哪条缺哪个', () => {
  const need = ['source_type', 'mechanism', 'constraint_effect', 'provenance', 'rewrite_cost', 'dissolvable', 'registered_at'];
  const dir = tmpRepo({
    'specs/factual-redlines.json': {
      required_fields: need,
      redlines: [
        { id: 'ok', source_type: 'a', mechanism: 'b', constraint_effect: 'c', provenance: 'd', rewrite_cost: 'e', dissolvable: false, registered_at: 'f' },
        { id: 'bad', source_type: 'a', mechanism: '', constraint_effect: 'c', provenance: 'd', rewrite_cost: 'e', dissolvable: true, registered_at: 'f' },
      ],
    },
  });
  LINT.setRoot(dir);
  const r = LINT.check_14_8();
  LINT.setRoot(REPO);
  assert.strictEqual(r.state, 'FAIL');
  assert.match(r.detail, /bad: 缺 mechanism/);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ── 14.11 C3 回滚：禁止物理删除 ──────────────────────────────

test('14.11：出现 deleted 标记 / 非法状态 / invalid 无指针 → FAIL', () => {
  const dir = tmpRepo({
    'specs/c3-states.json': {
      items: [
        { id: 'a', state: 'deleted' },
        { id: 'b', state: 'invalid' },
        { id: 'c', state: 'active', deleted: true },
      ],
    },
  });
  LINT.setRoot(dir);
  const r = LINT.check_14_11();
  LINT.setRoot(REPO);
  assert.strictEqual(r.state, 'FAIL');
  assert.match(r.detail, /非法状态 deleted/);
  assert.match(r.detail, /supersedes/);
  assert.match(r.detail, /禁止物理删除/);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ── 14.13 节拍：超 2 倍必须告警 ──────────────────────────────

test('14.13：上次成功超过节拍 2 倍 → FAIL；未超 → PASS', () => {
  const old = new Date(Date.now() - 20 * 86400000).toISOString();
  const recent = new Date(Date.now() - 2 * 86400000).toISOString();

  const dirOld = tmpRepo({ 'specs/verification-ledger.json': { cadence_days: 7, last_success_at: old } });
  LINT.setRoot(dirOld);
  const rOld = LINT.check_14_13();
  LINT.setRoot(REPO);
  assert.strictEqual(rOld.state, 'FAIL');
  assert.match(rOld.detail, /× 2/);

  const dirNew = tmpRepo({ 'specs/verification-ledger.json': { cadence_days: 7, last_success_at: recent } });
  LINT.setRoot(dirNew);
  const rNew = LINT.check_14_13();
  LINT.setRoot(REPO);
  assert.strictEqual(rNew.state, 'PASS');

  fs.rmSync(dirOld, { recursive: true, force: true });
  fs.rmSync(dirNew, { recursive: true, force: true });
});

// ── 14.14 版本漂移：不需要锚就能判 FAIL ──────────────────────

test('14.14：文件树写死旧版本 → FAIL（且不被"无锚"盖成 UNDECIDED）', () => {
  const dir = tmpRepo({
    VERSION: '1.3.0',
    'package.json': { version: '1.3.0' },
    'CHARTER.md': '# 宪章\n> 版本：**v1.3.0** · 2026-10-21\n',
    'README.md': '[![Charter Version](https://img.shields.io/badge/Charter-v1.3.0-blue)](CHARTER.md)\n├── CHARTER.md  ← 宪章主文件（v1.1，保持简单易懂）\n',
  });
  LINT.setRoot(dir);
  const r = LINT.check_14_14();
  LINT.setRoot(REPO);
  assert.strictEqual(r.state, 'FAIL');
  assert.match(r.detail, /版本号不一致/);
  assert.match(r.detail, /README 文件树=v1\.1/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('14.14：版本一致但无锚 → UNDECIDED（版本这一项如实说"一致"）', () => {
  const dir = tmpRepo({
    VERSION: '1.3.0',
    'package.json': { version: '1.3.0' },
    'CHARTER.md': '# 宪章\n> 版本：**v1.3.0** · 2026-10-21\n',
    'README.md': '[![Charter Version](https://img.shields.io/badge/Charter-v1.3.0-blue)](CHARTER.md)\n',
  });
  LINT.setRoot(dir);
  const r = LINT.check_14_14();
  LINT.setRoot(REPO);
  assert.strictEqual(r.state, 'UNDECIDED');
  assert.match(r.detail, /版本声明一致（v1\.3\.0）/);
  assert.match(r.detail, /无指纹锚/);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ── 14.12 write-gate：真实探针 ───────────────────────────────

test('write-gate：自动通道永不可写 C1/C2/C3a/C7/C8，但可写 C3b–C6', () => {
  assert.strictEqual(GATE.canWrite({ class: 'C1', actor: 'auto' }), false);
  assert.strictEqual(GATE.canWrite({ class: 'C2', actor: 'auto' }), false);
  assert.strictEqual(GATE.canWrite({ class: 'C3a', actor: 'auto' }), false);
  assert.strictEqual(GATE.canWrite({ class: 'C7', actor: 'auto' }), false);
  assert.strictEqual(GATE.canWrite({ class: 'C8', actor: 'auto' }), false);
  assert.strictEqual(GATE.canWrite({ class: 'C3b', actor: 'auto' }), true);
  assert.strictEqual(GATE.canWrite({ class: 'C4', actor: 'auto' }), true);
});

test('write-gate：人类明示才可改 C1/C2 —— 沉默不算同意', () => {
  assert.strictEqual(GATE.canWrite({ class: 'C1', actor: 'human', humanConfirmed: true }), true);
  assert.strictEqual(GATE.canWrite({ class: 'C1', actor: 'human', humanConfirmed: false }), false);
  assert.strictEqual(GATE.canWrite({ class: 'C1', actor: 'human' }), false);
  assert.strictEqual(GATE.reason({ class: 'C1', actor: 'human' }), 'human_confirmation_required');
});

test('write-gate：不声明级别 = 不允许（不给默认值）', () => {
  assert.strictEqual(GATE.canWrite({ actor: 'auto' }), false);
  assert.strictEqual(GATE.canWrite({ actor: 'human', humanConfirmed: true }), false);
  assert.strictEqual(GATE.reason({}), 'missing_class');
});

// ── --seal 必须有人名 ────────────────────────────────────────

test('--seal 无 --human → 拒绝并 exit 2（14.12② 的可执行证据）', () => {
  const r = spawnSync('node', [path.join(REPO, 'scripts', 'charter-lint.js'), '--seal'], {
    encoding: 'utf8', timeout: 20000,
  });
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /拒绝/);
  assert.match(r.stderr, /接受沉默或默认同意/);
});

// ── 全量跑：本仓当前状态 ────────────────────────────────────

test('全量跑：无 FAIL（UNDECIDED 允许），且每项都声明了「怎么变可判」', () => {
  const r = spawnSync('node', [path.join(REPO, 'scripts', 'charter-lint.js'), '--json'], {
    encoding: 'utf8', timeout: 30000,
  });
  const out = JSON.parse(r.stdout);
  assert.strictEqual(out.fail, 0, `不应有 FAIL：${JSON.stringify(out.results.filter((x) => x.state === 'FAIL'))}`);
  for (const x of out.results) {
    if (x.state !== 'PASS') assert.ok(x.fix, `${x.clause} 未说明怎么变可判`);
  }
  assert.ok(out.results.length >= 13, `应有 13 项判据，实际 ${out.results.length}`);
});

test('每项判据都指向真实的宪章条款（不能自造条款号）', () => {
  const charter = fs.readFileSync(path.join(REPO, 'CHARTER.md'), 'utf8');
  const clauses = [...charter.matchAll(/^### (14\.\d+) /gm)].map((m) => m[1]);
  for (const [id] of LINT.CHECKS) {
    if (id === 'meta') continue;
    const target = id === '14.12' ? '14.12' : id;
    assert.ok(clauses.includes(target), `判据 ${id} 对应的条款 ${target} 不在 CHARTER.md 里`);
  }
});
