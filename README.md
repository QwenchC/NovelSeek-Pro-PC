# NovelSeek Pro PC

NovelSeek Pro PC 是一款面向长篇小说创作的桌面应用，覆盖从大纲、章节写作、插图封面生成到电子书导出的完整流程。  
技术栈为 `Tauri + React + TypeScript + Rust + SQLite`，数据本地持久化。

## 版本

- 当前版本：`v1.2.0`
- 运行平台：Windows（当前版本已验证）

## 核心功能

### 1. 项目与章节管理
- 小说项目创建、编辑、删除
- 章节列表管理（含序章）
- 章节生成页内快速切换章节（点击标题展开章节列表）

### 2. AI 文本创作（DeepSeek）
- AI 生成小说大纲
- 大纲结构化编辑（锁定标题结构，支持条目增删改）
- 序章与章节流式生成 / 续写
- 选中文本就地润色

### 3. AI 图像生成（Pollinations）
- 章节推文图（摘要 + 章节封面）
- 段落插图模式（多段勾选生成、锚点定位、移动、删除）
- 全书封面生成（预览翻页、重命名、删除、设为默认）

### 4. 电子书导出
- 导出入口：章节列表页「导出电子书」
- 支持格式：
  - `PDF`（A4，支持封面 / 章节封面 / 段落插图）
  - `TXT`（纯文本）
  - `EPUB`（纯文本）
  - `MOBI`（纯文本）
- 导出预览支持删除个别段落插图
- 导出编辑进度持久化（再次进入保留上次设置）

## 快速开始

### 环境要求

- Node.js `>=18`
- Rust `>=1.75`
- npm

### 安装依赖

```bash
npm install
```

### 开发运行

```bash
npm run tauri:dev
```

### 构建安装包

```bash
npm run tauri:build
```

默认输出目录：

- `src-tauri/target/release/bundle/msi/`
- `src-tauri/target/release/bundle/nsis/`

## API 配置

在应用「设置」页面配置：

- `DeepSeek API Key`：用于文本生成、润色、提示词生成
- `Pollinations API Key`：用于封面与插图生成

## 项目结构

```text
NovelSeek-Pro-PC/
├─ src/
│  ├─ components/      # 通用组件
│  ├─ pages/           # 页面：首页/项目/大纲/编辑/导出
│  ├─ services/        # 前端 API 封装
│  ├─ store/           # Zustand 状态
│  ├─ types/           # TypeScript 类型
│  └─ utils/           # 工具函数
├─ src-tauri/
│  ├─ src/
│  │  ├─ api/          # DeepSeek / Pollinations 调用
│  │  ├─ commands/     # Tauri 命令入口
│  │  ├─ db/           # SQLite 初始化与迁移
│  │  ├─ services/     # 业务服务
│  │  └─ models.rs     # Rust 模型
│  └─ tauri.conf.json
├─ package.json
└─ README.md
```

## 常见说明

- 非 PDF 格式当前按纯文本导出，不包含图片资源。
- PDF 字体由系统字体列表读取；若中文显示异常，请切换字体后重试。

## License

MIT
