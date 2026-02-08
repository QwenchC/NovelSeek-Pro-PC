# NovelSeek Pro PC

NovelSeek Pro PC 是一个面向中文长篇创作的桌面端小说工作台，覆盖从大纲设计、章节生成、插图与封面、到 PDF 电子书导出的完整流程。  
技术架构采用 `Tauri + React + TypeScript + Rust + SQLite`，在本地运行并持久化项目数据。

## 版本信息

- 当前版本：`v1.1.1`
- 平台：Windows（当前已验证）
- 形态：桌面客户端（Tauri）

## 主要能力

### 1. 项目与章节管理
- 小说项目创建、编辑、删除
- 章节列表管理（含序章）
- 首页项目卡片封面预览
- 章节编辑页内快速切换章节（标题点击展开章节列表）

### 2. AI 文本生成（DeepSeek）
- AI 生成小说大纲
- 大纲结构化编辑（锁定标题层级，条目可增删改）
- 序章流式生成
- 正文章节流式生成与续写
- 选中文本就地润色

### 3. AI 图像生成（Pollinations）
- 章节推文图（章节摘要 + 封面图）
- 段落插图模式（多段勾选生成、锚点定位、移动与删除）
- 全书封面生成（生成、预览翻页、重命名、删除、设为默认）

### 4. 电子书导出（PDF）
- 章节列表页一键进入导出界面
- 导出开关：小说封面 / 章节封面 / 段落插图
- 常驻导出预览，可删除个别段落插图
- 导出编辑进度持久化（再次进入保留上次选择）
- A4 页面、目录、页码、真实文本排版（非截图）
- 中文字体支持（可从系统字体列表选择）

## 快速开始

## 环境要求

- Node.js `>=18`
- Rust `>=1.75`
- npm

## 安装依赖

```bash
npm install
```

## 开发运行

```bash
npm run tauri:dev
```

## 生产构建

```bash
npm run tauri:build
```

构建产物默认位于：

- `src-tauri/target/release/bundle/msi/`
- `src-tauri/target/release/bundle/nsis/`

## API 配置

在应用“设置”页面配置以下 Key：

- `DeepSeek API Key`：用于大纲、章节、润色、提示词生成
- `Pollinations API Key`：用于封面与插图生图

## 项目结构

```text
NovelSeek-Pro-PC/
├─ src/
│  ├─ components/      # 通用组件
│  ├─ pages/           # 页面（首页/项目页/大纲页/编辑页/导出页）
│  ├─ services/        # 前端 API 封装
│  ├─ store/           # Zustand 状态
│  ├─ types/           # TypeScript 类型
│  └─ utils/           # 工具函数
├─ src-tauri/
│  ├─ src/
│  │  ├─ api/          # DeepSeek / Pollinations 调用层
│  │  ├─ commands/     # Tauri 命令入口
│  │  ├─ db/           # SQLite 初始化与迁移
│  │  ├─ services/     # 业务服务
│  │  └─ models.rs     # Rust 模型
│  └─ tauri.conf.json
├─ package.json
└─ README.md
```

## 常见问题

### PDF 中文不显示怎么办？

优先在导出页面切换其他中文字体后重试。不同系统字体的嵌入兼容性存在差异。

### 为什么导出预览里删过的插图还在？

当前版本已支持导出页面进度持久化。若章节内容结构变化较大，系统会按当前内容重新校准可用插图。

## License

MIT
