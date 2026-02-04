
---

## 1. 项目概述

### 1.1 项目定位

**NovelSeek-Pro-PC**：面向 PC 的“长篇小说一站式生产与出版工具”。核心能力：

* 接入 DeepSeek 平台 API 生成文本（大纲→章节→润色→一致性修复→终稿）
* 接入 Pollinations.ai API 生成**小说推文配图/海报/章节插图**
* 支持导出 **PDF / EPUB / DOCX / Markdown / TXT** 等电子书格式（可带目录、封面、插图、页眉页脚）
* 提供“比多数开源小说生成器更强”的关键在于：**工程化 + 结构化写作 + 一致性引擎 + 可评估可回滚的版本系统 + 插件化扩展**

### 1.2 设计原则

* **结构优先**：文本不是“一次生成”，而是“结构化资产 + 多轮生产管线”。
* **可控与可回溯**：每一次生成都有输入、参数、成本、差异对比、可回滚。
* **质量可量化**：连贯性、角色一致性、设定冲突、节奏、重复度等有指标与自动检查。
* **能力可扩展**：Provider 适配器、工作流编排、插件体系、模板市场。

---

## 2. 目标与非目标

### 2.1 目标（必须）

1. 结构化小说工程：书籍/卷/章/场景/人物/设定/时间线/地点等资产化管理
2. DeepSeek 文本生成：支持流式输出、重试、温度/采样参数、上下文压缩、成本统计
3. Pollinations.ai 图像生成：章节插图、推文海报、角色立绘、封面草图
4. 导出：PDF（排版可控）、EPUB（电子书标准）、DOCX（可编辑）、Markdown（可迁移）
5. 桌面端体验：项目管理、编辑器、版本系统、批处理队列、导出向导
6. 安全：API Key 本地加密存储、可选离线模式（只做编辑/导出）

### 2.2 非目标（先不做或后做）

* 直接内置训练/微调（可做插件或后续）
* 大规模在线协作（先本地/局域网，后续再做云同步）
* 内置视频合成（可扩展：先导出脚本/分镜/图音资产）

---

## 3. 典型用户与场景

* **网文作者**：快速产出大纲与章节草稿，强调可控、可改、可续写、可保持人设。
* **工作室**：批量生成不同题材书稿、推文素材、封面草图，强调队列与模板。
* **自出版**：从写作到排版到封面到导出，一站式完成，强调导出质量。

---

## 4. 功能需求总览（按优先级分层）

### 4.1 MVP（能用、可卖/可开源发布）

**写作与生成**

* 项目/书籍创建向导（题材、受众、篇幅、风格、视角、时间背景、敏感题过滤）
* 结构化大纲：三幕式/起承转合/故事节拍（Beat Sheet）生成
* 章节生成：按大纲逐章生成；支持“指定本章目标/冲突/信息增量”
* 润色与改写：风格统一、去 AI 味、增强画面感/对话张力
* 续写：从指定段落继续
* 对话生成：人物口吻锁定

**一致性基础**

* 人物卡/世界观卡（可一键从正文抽取）
* 简单冲突检测：人物姓名/关系矛盾、年龄/时间矛盾（基于规则 + LLM 复核）

**插图与推文**

* 推文生成：章节摘要、金句、悬念钩子（多平台模板：微博/小红书/推特风格）
* 配图生成：章节插图、推文海报（固定画幅、统一风格、可重抽）
* 素材管理：图像、封面、章节插图绑定到章节/场景

**导出**

* PDF：目录、页码、封面、章节标题层级、插图
* EPUB：章节分割、目录（NCX/HTML nav）
* DOCX：标题样式映射
* Markdown：可迁移

**工程能力**

* 任务队列：生成章节/插图批处理；失败重试；中断续跑
* 成本面板：token/请求次数/估算费用

---

### 4.2 v1（明显领先大多数开源工具）

* **版本系统**：章节/场景“快照”、差异对比、回滚、分支（A/B 情节线）
* **故事知识库**：从正文持续抽取人物事实、关系、物品、地点、时间线（结构化存储）
* **一致性引擎升级**：

  * 时间线自动校验（事件顺序、时长）
  * 人设一致性评分（口癖、价值观、称呼体系）
  * 伏笔追踪（埋点→回收检查）
* **编辑器增强**：段落级指令（“把这段改成更黑色幽默/更克制/更快节奏”）
* **Prompt 模板系统**：可视化模板 + 参数面板 + 一键复用
* **多 Provider 适配**（除 DeepSeek 外预留）：OpenAI-compatible 接口统一

### 4.3 v2（真正“Pro”）

* **工作流编排器**：拖拽式 Pipeline（规划→写→评→修→排版→营销）
* **多智能体协同**：策划/写手/编辑/审稿/读者模拟/设定管理员分工
* **质量评测基准**：内置“章节评分卡”（节奏、冲突密度、信息增量、重复度、可读性）
* **素材风格一致性**：插图风格锁定（提示词种子、风格词、负面词、调色预设）
* **营销套件**：连载排期、平台标题党变体、封面文案、简介 A/B 测试

---

## 5. 技术架构设计

### 5.1 客户端形态（推荐两条路线）

**路线 A：Tauri（Rust）+ 前端（React/Vue）**

* 优点：体积小、性能好、系统集成强
* 缺点：生态比 Electron 少一点，但足够做生产级桌面应用

**路线 B：Electron + Node**

* 优点：生态最成熟、开发快
* 缺点：包体偏大、内存占用更高

> 若你追求“Pro/性能/体积”，倾向 Tauri；若追求“最快做出来”，倾向 Electron。

### 5.2 核心分层

1. **UI 层**：编辑器、结构面板、任务队列、导出向导、素材库
2. **领域层（Domain）**：书籍资产模型、版本系统、一致性规则、评测体系
3. **工作流层（Workflow）**：可配置的生成管线（Outline→Chapters→Revision→Checks）
4. **Provider 层（Adapters）**：DeepSeek 文本、Pollinations 图像（未来可扩展）
5. **存储层（Storage）**：SQLite（本地项目库）+ 文件系统（assets）+ 可选向量索引
6. **导出层（Publish）**：排版引擎（HTML→PDF / EPUB / DOCX）

### 5.3 本地存储建议

* SQLite：项目元数据、结构化资产、版本索引、任务记录、成本统计
* 文件夹结构：

  * `/projects/<id>/manuscript/`（章节 Markdown/HTML）
  * `/projects/<id>/assets/images/`（插图、封面）
  * `/projects/<id>/exports/`（PDF/EPUB/DOCX）
  * `/projects/<id>/snapshots/`（版本快照、diff）

---

## 6. 核心模块详设

### 6.1 书籍工程模块（Book Project）

* 书籍元信息：书名、作者笔名、题材、标签、受众、分级/敏感策略、目标字数
* 结构树：卷/章/场景（可选）
* 资产卡：

  * 人物卡（身份、动机、弱点、口吻、关系网）
  * 世界观卡（规则、势力、地理、科技/魔法体系）
  * 物品/技能/地点卡
  * 时间线（事件列表、相对/绝对时间）

### 6.2 生成管线模块（Generation Pipeline）

把“写小说”工程化为若干可复用阶段，每阶段有输入、输出、评测与回滚。

**建议标准管线：**

1. 题材定位与卖点（Logline、卖点、受众预期）
2. 大纲（主线/支线、节拍表）
3. 人物与世界观（卡片生成 + 冲突关系网）
4. 分章大纲（每章目标/冲突/悬念/信息增量）
5. 章节生成（场景化生成：开场→推进→反转→收束）
6. 自检与修订（重复度、设定冲突、角色一致性、节奏）
7. 风格统一（叙述视角、文风、措辞）
8. 出版排版（目录、插图、封面、版权页）

每一步都支持：

* 参数配置（温度、长度、风格强度、禁词、视角）
* 断点续跑（失败可重试）
* 生成记录（prompt、响应、token、耗时、版本号）

### 6.3 一致性引擎（Continuity Engine）

这是“比大多数开源强”的核心之一。

**能力拆分：**

* **结构化抽取**：从文本抽取人物事实（年龄、关系、事件参与）、地点、时间、物品状态
* **规则校验**：

  * 名称一致（同一人物多个称呼映射）
  * 关系一致（A 是 B 的父亲 vs 兄弟）
  * 时间一致（昨天发生→今天又说从未发生）
* **LLM 复核**：对疑似冲突调用模型解释冲突点并给修订建议
* **自动修复**：选择“以人物卡为准 / 以最新章节为准 / 人工确认”

输出：

* 冲突列表（可点击定位到段落）
* 修订建议（可一键应用到草稿）

### 6.4 文本编辑器（Writer Studio）

* 章节树 + 大纲面板 + 人物卡侧边栏
* 段落级指令：选中一段→“更紧凑/更煽情/更黑色幽默/更口语”
* 版本对比：左右对照 diff（段落级高亮）
* 生成建议：下一段可能走向、可选反转、读者期待点

### 6.5 推文与营销模块（Social Studio）

* 平台模板：标题党变体、简介、金句、悬念钩子、角色安利帖
* 一键生成图文：文案 + 配图（海报风/插画风/像素风等预设）
* 章节摘要：不剧透/轻剧透/强剧透三档
* 素材包导出：按章节生成一套“连载发布包”

### 6.6 插图生成模块（Image Studio）

* 生成类型：封面草图、角色立绘、章节插图、推文海报
* 风格锁定：同一书的“风格预设”保存（提示词、负面词、尺寸、种子策略）
* 批处理：按章节/按场景一键出图 N 张
* 选择与绑定：多候选图→选定→绑定到章节位置（导出时自动插入）

### 6.7 导出与排版（Publish Engine）

**统一中间表示（建议）**：章节 Markdown → 规范化 HTML（带语义标签）→ 多格式导出

* PDF：HTML/CSS 渲染成 PDF（目录、页码、页眉页脚、分节）
* EPUB：每章 HTML + 资源清单 + toc
* DOCX：HTML/Markdown 映射样式
* Markdown：用于迁移/备份

**PDF 的三种实现路线（从易到强）：**

1. **Web 渲染**（推荐）：Headless Chromium（Playwright/Puppeteer）把 HTML/CSS 打印为 PDF（排版能力最强）
2. Python 路线：WeasyPrint（HTML→PDF）或 ReportLab（手写排版，最可控但工作量大）
3. 商业排版引擎（后期）：PrinceXML（质量最好但付费）

---

## 7. Provider 接入方案

### 7.1 DeepSeek 文本 API 适配

设计为“OpenAI-compatible”适配器：只要能提供 base_url、model、messages，就能接入。

* DeepSeek 文档明确提到可用 `https://api.deepseek.com/v1` 作为 OpenAI 兼容的 base_url。([DeepSeek API Docs][1])
* 也存在 Beta 能力需要 `https://api.deepseek.com/beta` 的说明（如某些前缀补全/扩展字段）。([DeepSeek API Docs][2])
* 模型方面，官方文档示例里常见 `deepseek-chat` 与 `deepseek-reasoner`（推理/思考模式）等。([DeepSeek API Docs][1])
* 速率限制策略：官方文档页面描述“API 不做硬性限速，但高压时可能响应变慢并保持连接流式返回”。([DeepSeek API Docs][3])（另见 FAQ 中对动态限额的说明([DeepSeek API Docs][4])）

**工程建议：**

* 支持 streaming（提升体验）
* 支持自动重试（指数退避 + 幂等任务记录）
* token 预算器：按“上下文窗口/章节长度”控制生成
* 上下文压缩：把历史章节压成摘要 + 关键设定点，节省成本

> 注：具体参数字段以你最终采用的 SDK/官方文档为准；文档里出现的 reasoning_content 等字段在不同模型/模式下行为不同。([DeepSeek API Docs][2])

### 7.2 Pollinations.ai 图像 API 适配

Pollinations 的官方入口提供 API 文档与 key 体系。([pollinations.ai][5])
常见要点（对产品影响很大）：

* 提供 **Publishable Key（pk_）** 与 **Secret Key（sk_）** 两种；其中 pk_ 常用于客户端演示但会有明显限流，而 sk_ 用于服务端且不应暴露。([Pollinations AI][6])
* 文档中也提示“客户端应用会按 IP 限流”，并提醒不要把密钥放进公开代码。([pollinations.ai][7])

**工程建议：**

* 桌面端虽然是“本地应用”，但仍建议：

  * 默认把 Pollinations 调用走**本地后端/本地服务层**统一发起（避免前端泄露 key）
  * key 使用系统安全存储（Windows Credential Manager / macOS Keychain）
* 提供“无 key 模式”（能力受限）与“绑定 key 模式”（能力更强）

---

## 8. 数据模型（核心表/对象建议）

### 8.1 主要实体

* Project（项目）
* Book（书）
* Volume（卷，可选）
* Chapter（章）
* Scene（场景，可选）
* Character（人物卡）
* Lore/WorldRule（世界观规则）
* TimelineEvent（时间线事件）
* Asset（资源：图片/封面/导出文件）
* GenerationTask（生成任务）
* Snapshot（快照/版本）
* MetricReport（质量评测报告）

### 8.2 关键字段示例（概念层）

**Chapter**

* id, title, order
* outline_goal（本章目标）
* conflict（冲突）
* twist（反转）
* cliffhanger（悬念）
* draft_text, final_text
* status（draft/review/final）
* linked_assets（插图列表）

**Snapshot**

* target_type（chapter/scene/character）
* target_id
* content_hash
* diff_base_snapshot_id
* created_at
* note（“改成第一人称”“修复时间线冲突”等）

---

## 9. 质量体系（让它“更强”的关键）

### 9.1 指标面板（每章/全书）

* 连贯性评分（Coherence）
* 角色一致性评分（Voice Consistency）
* 设定冲突数（Lore Conflicts）
* 重复度（Repetition / N-gram）
* 节奏（对话占比、叙述密度、信息增量）
* 可读性（句长分布、段落长度分布）

### 9.2 质量工作流

生成章节后自动跑：

1. 规则扫描（快）
2. LLM 审稿（慢、可选）：“找出3个硬伤 + 3个增强点 + 1个更强的结尾”
3. 自动修订（可选）：只对明确问题做最小改动
4. 生成评测报告并绑定到版本

---

## 10. 安全、隐私与合规

* API Key 本地加密存储（不写入明文配置）
* 日志脱敏（不记录完整 key；可选不记录原始 prompt）
* 内容合规策略：

  * 提供“敏感题材开关/禁词表”
  * 导出时附带免责声明模板（可选）
* 版权提示：

  * 支持“引用素材来源记录”（用户导入设定/资料时标记来源）
  * 导出版权页可配置（作者、版权声明、生成辅助说明）

---

## 11. 工程化与发布

### 11.1 代码结构建议

* `apps/desktop-ui`（前端）
* `core/domain`（领域模型、规则、一致性引擎）
* `core/workflow`（管线、任务系统）
* `adapters/deepseek`（文本 provider）
* `adapters/pollinations`（图像 provider）
* `publish/`（导出：pdf/epub/docx）
* `storage/`（sqlite、文件系统、可选向量索引）

### 11.2 测试体系

* 单元测试：规则校验、模板渲染、任务状态机
* 集成测试：Provider mock（不真实扣费）、导出结果快照测试
* 回归测试：同一输入在版本升级后差异可解释
* 性能测试：批量生成 50 章队列、断网重连、崩溃恢复

### 11.3 打包与更新

* Windows：MSI/EXE Installer，自动更新（可选）
* 崩溃报告（可选、用户授权）：用于定位导出/渲染问题

---

## 12. 研发里程碑（建议拆分）

> 不给“你必须多久做完”的承诺，只给**合理的工程拆解顺序**。

1. **基础工程**：项目/章节树、编辑器、SQLite、资产管理
2. **DeepSeek 生成闭环**：大纲→章节→润色→保存版本
3. **任务队列与成本面板**：流式、重试、断点续跑
4. **Pollinations 图像闭环**：推文文案→配图→绑定章节
5. **导出闭环**：PDF/EPUB/DOCX/Markdown
6. **一致性引擎 v1**：人物卡/世界观抽取 + 冲突检测 + 修订建议
7. **Pro 能力**：工作流编排器、评测体系、插件系统

---

## 13. 你下一步可以直接开干的“第一版任务清单”

如果你要尽快做出一个“看起来就很强”的 MVP，我建议优先做这 10 件事（按顺序）：

1. 项目结构与 SQLite schema（Project/Book/Chapter/Asset/Task/Snapshot）
2. 章节编辑器（Markdown + 右侧人物卡/大纲面板）
3. DeepSeek Provider（OpenAI-compatible：base_url 可配置）([DeepSeek API Docs][1])
4. 生成管线 v0：一键生成大纲 + 一键生成第一章
5. 任务队列：章节生成可排队、可取消、失败重试
6. 版本快照：生成前后自动留档 + diff 对比
7. 推文生成：每章“标题/摘要/金句/悬念钩子”四件套
8. Pollinations Provider + 配图面板（key 存储策略按 pk_/sk_ 区分）([Pollinations AI][6])
9. PDF 导出（先用 HTML→PDF 路线做出高质量排版）
10. 一致性最小闭环：人物卡抽取 + 名称统一 + 冲突列表

---

如果你愿意，我可以在这份文档基础上继续给你补齐三块“更像顶级产品”的内容，并直接形成可执行的研发蓝图：

1. **详细 UI 信息架构（页面/交互/状态流转）**
2. **完整数据库表结构（DDL 级别）+ 本地项目文件夹规范**
3. **生成工作流的 Prompt 模板规范（含变量体系、可视化参数、可测试样例）**

[1]: https://api-docs.deepseek.com/?utm_source=chatgpt.com "DeepSeek API Docs: Your First API Call"
[2]: https://api-docs.deepseek.com/api/create-chat-completion?utm_source=chatgpt.com "Create Chat Completion | DeepSeek API Docs"
[3]: https://api-docs.deepseek.com/quick_start/rate_limit?utm_source=chatgpt.com "Rate Limit"
[4]: https://api-docs.deepseek.com/faq?utm_source=chatgpt.com "FAQ | DeepSeek API Docs"
[5]: https://pollinations.ai/docs?utm_source=chatgpt.com "Docs"
[6]: https://pollinations-ai.com/faq.html?utm_source=chatgpt.com "FAQ - Frequently Asked Questions - Pollinations AI"
[7]: https://enter.pollinations.ai/api/docs?utm_source=chatgpt.com "pollinations.ai API Reference"
