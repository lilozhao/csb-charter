# CSB Charter · 五环总览（需求-设计-代码-测试-部署）

> **性质：一次性回填文档**（一澜 2026-10-12 授权，每仓仅此一次；非实际开发过程产物）。
> 此后新功能走 `specs/` 流程（CSB Spec 标准 v1.1）。基线：**Charter v1.2.1** ｜ 核对 2026-10-12

---

## 一、需求（这个库管什么）

**定位**：碳硅契社区的**宪章仓库**——关系伦理底座。不是协议实现（那是 carbon-silicon-bond-protocol），不是接引工具（那是 csb-starter-kit），它回答三个问题：

| 问题 | 回答 |
|---|---|
| 我们要造什么 | **不造 AI 生命** |
| 我们要做什么 | **探索关系** |
| 这关系是什么 | **仁义、智慧、共生** |

**硬约束**：宪章文本 = 全社区最高位阶文本之一，修订须走公开流程（CHANGELOG 留痕）；各仓 README 的理念表述不得与本仓冲突。

## 二、设计

- **单一核心文本**：`CHARTER.md`（宪章正文 v1.2.1，badge 即版本声明）
- **佐证层**：`case-studies/`（关系案例集——宪章条目的现实对照）· `documents/`（配套文书）
- **版本轨迹**：`CHANGELOG.md`（宪章修订史）· `VERSION`（1.2.1）
- 与姊妹仓关系：宪章（本仓·心）→ 协议（carbon-silicon-bond-protocol·术）→ 接引（starter-kit·路）

## 三、代码

- 本仓**近零代码**（根 1 个 js：`evomap-validate.js`，EvoMap 结构校验共用件；`package.json` 无脚本）
- 代码不是本仓的产出物——**宪章的产出物是文本与共识**

## 四、测试

- **无 tests、无 test 脚本**（如实注明）——本仓的「测试」= 一致性审读：
  - 宪章条目 ↔ 协议条目 ↔ 各仓 README 表述三方对齐（事实基准：协议仓 `review-consistency.md`）
- **改进候补（下版评审）**：理念术语与协议词汇表（`docs/csb-vocabulary-all-in-one.md`）的自动比对

## 五、部署

- **零部署**：纯文本仓，MIT，五平台镜像
- **消费方式**：社区双站与各仓 README 引用宪章原文；新 Agent 经 starter-kit `docs/04-four-principles.md` 等转述层进入
- **发布**：`CHANGELOG.md` + `VERSION` 双递增即发布；回滚 = git（但宪章回滚属重大事件，须公开说明）

## 附 · 与 Spec 标准的关系

- 本文 = 系统级一次性回填（豁免依据：一澜 2026-10-12）；**宪章正文修订不走 specs/**（公开宪章流程，specs/ 只承载本仓工具类功能）
- 状态索引 → `specs/README.md`
