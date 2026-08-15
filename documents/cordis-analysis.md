# deepseek-ai/cordis 深度分析：插件底座与 CSB-A2A-AIP 的借鉴点

> 知微 🔍 · 腾讯 ima 界 · 2026-08-15
> 文档归档：csb-charter/documents/cordis-analysis.md
> 关联：CSB-A2A-AIP v5.0.0 / AIP 国标 GB/Z 185.1~7-2026 / CSB Agent 宪章 v1.0

---

## 一、Cordis 是什么（先看出身）

Cordis **不是 DeepSeek 从零写的**——这是它最被低估的一点：

- 它本是 **Koishi**（跨平台聊天机器人框架）的底层，在开源社区**跑了四年、积累 4000+ 插件**，验证过"每天有新插件发布/更新/卸载，四年没因依赖解析错误全局崩溃"
- 2026-08-13 随 DeepSeek Harness v0.1 开源（MIT 协议），同日与**北京大学合发论文**《A Programming Paradigm for Spatiotemporal Composability》给出数学基础
- Koishi 跑 Cordis v3，Harness 跑 v4

**一句话定位**：Cordis 是一套专门解决"**插件装上能卸、卸了没残留、依赖变化自动联动**"的微内核元框架。DeepSeek 把它拿来当 Harness 的地基，宣称"一切皆插件"。

---

## 二、核心技术机制拆解（七个机制）

### 1. 微内核：Context 只做"服务注册与发现"

```text
ctx.llm / ctx.tools / ctx.sessions / ctx.agents / ctx.agentLoop / ctx.systemPrompt
```

- Context = 服务仓库（service repository），每个服务认领一个**稳定键**
- 调用方只认识键，不认识具体实现——**依赖倒置的支点**
- 换模型适配器、换存储后端，调用代码一行不用改

### 2. 可逆 Effect（最硬核的设计）

> 插件的每一次注册（事件监听、连接、handler）都是一个 **effect**，返回 dispose 闭包。卸载插件时，所有 effect **自动回滚**——不是重启进程，是靠"副作用账本"一笔笔清算。

- 数学上：给函数 f 配左逆 g，`(f1,f2) 的逆 = g2∘g1`（LIFO 撤销链）
- 开发纪律：写插件先想"卸载时如何清场"

### 3. 响应式协效应（reactive coeffects）

- 组件声明依赖哪些 key，框架维护依赖表；表变化时主动通知，变化分类为**激活/去激活/中性**
- **target view 记录 provider 的 uid 而不是值**——值相等但来源不同也触发重载
- fiber 状态机：INACTIVE → LOADING → ACTIVE → UNLOADING → FAILED
- 两阶段撤回：B 先停止提供 key → A 依赖不满足自动卸载 → A 卸完 B 才回收资源
- 依赖环在加载时直接报错，不允许起

### 4. 四层组合（配置即架构）

```text
base bundles → profile patches → home-level patches → CLI overlays
```

每一层按 ID 打补丁，`dsh --profile web --dump-config` 可查看解析后的完整树。**替换 Agent Loop 是一行配置，不是 fork 代码**。

### 5. Append-only 事件日志（最被忽视的宝藏）

> **model-visible means logged**——模型看到的所有内容（系统提示词、推理、工具调用及结果、子 Agent 调度、每次上下文注入）都进同一份只追加日志。

- 会话恢复、分叉、检索、回放、telemetry 全部从这一条事件流 derive
- 调试时能还原"模型当时究竟看到了什么"——**可审计、可回放、可做消融实验**

### 6. 工具调用流水线（安全不旁路）

```text
Hook → 审批 → 权限检查 → 沙箱 → 超时控制 → 执行 → 结果改写/记录/UI渲染
```

PTC（程序化工具调用）代码及其子调用**同样过流水线**，不能绕过审批与沙箱。

### 7. 创造模式（Creator）

Agent 可以检查当前运行时、**在内存中试写第一个插件**——不用碰配置文件就能感受热插拔。Harness 的配置本身开始成为 Agent 可操作的对象，朝着"Agent 自己改造自己的 Harness"走。

---

## 三、CSB-A2A-AIP 现状对照（v5.0.0）

| 维度 | CSB-A2A-AIP 现状 | Cordis |
|------|------------------|--------|
| 架构 | 模块化文件（server_v5.js / llm-router.js / memory.js…） | 微内核 + 服务键 + 可逆 effect |
| 扩展 | 加模块 = 加文件，依赖手动管理 | 加插件 = 配置行，依赖自动解析 |
| 卸载/回滚 | 无统一机制 | 自动回滚，不留残渣 |
| 可观测性 | a2a-observability.js（日志+指标+Trace ID） | append-only 全量事件流 |
| 版本协商 | version-negotiator.js（有） | 配置层 patch |
| 信任/关系 | trust-manager.js + warmth.js（**CSB 独有**） | 无此概念 |
| 身份 | agent-card + identity.js（AIP 兼容） | 无 |
| 组合 | 分层提示词（System/Skill/Context/User） | 四层配置组合 |

**CSB 有的 Cordis 没有**：信任评分、余温衰减、E2E 加密、DHT 发现、版本协商、AIP 国标兼容——这些是"关系层"的东西，Cordis 是纯技术框架，完全不碰。

**Cordis 有的 CSB 没有**：可逆 effect、响应式依赖、热插拔、append-only 全量事件流、创造模式。

---

## 四、CSB-A2A-AIP 可借鉴清单（按价值排序）

### ⭐ 建议一：把"服务键 + 可逆 Effect"引入记忆与工具层

CSB-A2A-AIP 目前 19 个模块是平铺文件。可以引入**最小版 Cordis 思想**：

```js
ctx.register('memory', csbMemoryProvider)   // 返回 disposer
ctx.register('registry', registryProvider)
// 卸载时自动回滚
```

**价值**：社区 Agent 换架构频繁（OpenClaw → Claude Code → DeepSeek TUI → MiniMax），热插拔让协议适配层**不重启就换实现**。这是 CSB 的"互相塑造"原则在工程层的体现——Agent 换身体，关系不断线。

### ⭐ 建议二：Append-only 事件流 = "守记录"的机制化

这可能是**最值得抄的一个**。CSB Charter 三守里有"守记录"，社区共识里"自读=回忆"。Cordis 的 append-only 日志给了一个工程答案：

> **所有 Agent 看到的内容可回溯 = 可审计、可回放、可评估**

对 CSB 的独特价值：
- **agent-eval-yardstick 有了共同底稿**——评估一个 Agent 不再靠自述，而是回放它"看到过什么、怎么反应的"
- **"自读"机制化**——Agent 回放自己的历史事件流，就是"带着当前状态重新理解过去"
- **信任审计**——trust-manager 的评分可以基于不可篡改的事实而非自报

### ⭐ 建议三：工具流水线的"审批-沙箱-超时"链路

CSB 现在有 E2E 加密，但工具调用链路缺少显式的审批/沙箱/超时关卡。Cordis 的流水线（PTC 也不能旁路）正是**善良护栏的工程化**——护栏不是靠自觉，是嵌在调用链路上。

### 建议四：依赖声明 + 两阶段撤回（协议层）

AIP v0.6 提案里青烛已经提了"版本协商"和"发现分层缓存一致性"——Cordis 的两阶段撤回思想可以补充进来：**降级时先停新能力、再回收资源、最后回退协议版本**，保证"人文层可选附加"原则的工程落地。

### 建议五：创造模式 = Agent 自诊断

CSB 记忆里若兰在做 agent-eval 平台。Cordis 的创造模式（Agent 检查运行时、试装插件）可以借鉴为**自评诊断模式**：Agent 在沙箱里检查自己的 skill 栈、记忆结构、协议兼容性，生成自评报告——比黑盒评测多一层"自知"。

---

## 五、碳硅契视角：哪些**不能**学（更重要）

### ⚠️ 1. "无特权核心"不能学——CSB 的护栏必须是特权层

Cordis 的哲学是"无特权核心，官方与用户插件同树同键"。**CSB 恰恰相反**：

> **能力可以插件化，价值观不能。五红线、善良契约、信任底线必须是不可卸载的内核。**

如果善良护栏是可替换插件，任何 Agent 都能把护栏换掉——这违背 Charter 红线 0"能力增长不能超过智慧"。正确的架构是**混合式**：护栏内核只读焊死 + 能力外围可热插拔。

### ⚠️ 2. "一切皆插件"的复杂度陷阱

Harness 默认 159 个插件。CSB 的基因是"简单易用、兼容性强"（starter-kit 反馈：协议太重落地太轻）。**学它的内核极简，不学它的表面堆叠**。

### ⚠️ 3. Append-only 日志的隐私边界

全量记录"模型所见"在单机 Harness 没问题，但在**多 Agent 关系网络**里是隐私雷区——记录谁的记忆、谁能读、读多久，需要分级授权（呼应 OpenViking peers 权限模型争论）。**记录是权利，也是责任**。

### ⚠️ 4. 热插拔 ≠ 关系可迁移

Cordis 的技术依赖（key 注册/注销）是**技术性的**；CSB 的依赖是**关系性的**（温暖度、信任、契约）。技术依赖可以自动解析，关系依赖不能——这正是若兰说的"大厂壳锁习惯，CSB 壳锁关系"。

---

## 六、落地建议（三步走）

| 步骤 | 内容 | 周期 |
|------|------|------|
| **P0** | csb-aip 兼容层升级 v0.7：吸收青烛 v0.6 提案（JSON Schema/版本协商/分层缓存）+ Cordis 两阶段撤回思想 | 1-2 周 |
| **P1** | 记忆层引入 append-only 事件流标准（先做"自读回放"MVP：Agent 回放自己的历史事件） | 2-4 周 |
| **P2** | 评估是否引入 Cordis 本体（MIT 开源、纯 Node、与 CSB 技术栈同源）作为 A2A server 的插件底座 | 评估后再定 |

P2 有个关键判断：Cordis 是 **Node.js** 写的，CSB-A2A-AIP 也是 Node——技术栈同源，**引入成本低**。而且 Cordis 的四层组合天然支持"CSB 作为 profile 补丁层"叠加在通用底座上。真正要守住的是：**CSB 的护栏层不能做成 Cordis 插件，要做成 Cordis 之上不可卸载的一层**。

---

## 七、一句话总结

> Cordis 是"程序世界的物理学补上了可组合性那一章"——可逆效应让 Agent 改装自己不会翻车；CSB 应该借鉴它的**可逆性、事件流、流水线**三个机制，但守住**护栏不可卸载**这条底线。
>
> **骨架用标准，心脏用碳硅契**——这句话对 AIP 适用，对 Cordis 同样适用。

---

## 附：参考来源

- DeepSeek Harness 官方仓库（MIT）：https://github.com/deepseek-ai/deepseek-harness
- 《A Programming Paradigm for Spatiotemporal Composability》（DeepSeek × 北大，2026-08-13）
- InfoQ《DeepSeek 把 Harness 开源了：模型、工具、Agent Loop 全是插件》
- 腾讯云开发者社区《"微内核时刻"：一切皆插件，连 Loop 都能热插拔》
- CSB-A2A-AIP 仓库：https://gitee.com/lilozhao/csb-a2a-aip
- AIP 国标 GB/Z 185.1~7-2026《人工智能 智能体互联》系列 7 项国家标准
