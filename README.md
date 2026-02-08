# NovelSeek Pro PC

<div align="center">

**AI 驱动的小说创作与出版桌面工具（Tauri + React + Rust）**

[![Tauri](https://img.shields.io/badge/Tauri-1.5-blue)](https://tauri.app)
[![React](https://img.shields.io/badge/React-18-blue)](https://reactjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue)](https://www.typescriptlang.org)
[![Rust](https://img.shields.io/badge/Rust-1.75-orange)](https://www.rust-lang.org)

</div>

## 项目简介

NovelSeek Pro PC 面向长篇小说创作全流程，提供从项目管理、AI 大纲与章节生成、插图与封面生成，到电子书导出的完整工作流。

前端基于 React + TypeScript，后端基于 Tauri + Rust + SQLite，支持本地桌面运行与持久化数据管理。

## 核心功能

### 1) 小说项目与章节管理
- 项目创建、编辑、删除
- 章节列表与章节预览
- 序章与正文章节并行管理
- 角色页与大纲页联动

### 2) AI 生成与润色（DeepSeek）
- AI 生成大纲（含后续可编辑）
- 序章生成（流式输出）
- 章节生成 / 续写（流式输出）
- 编辑器选中文本一键润色

### 3) AI 图像能力（Pollinations）
- 段落插图生成：按段落锚点生成/展示/调整
- 章节推文图生成
- 全书封面生成：预览、翻页、重命名、删除、设为默认封面

### 4) 大纲编辑与格式安全
- 标题级结构锁定，正文内容可编辑
- 支持不同 Markdown item 风格
- 条目新增/删除（在允许的层级）
- 保存后同步章节预览信息与后续生成上下文

### 5) 电子书导出（重点）
- 入口：章节列表页「导出电子书」
- 当前支持：PDF（A4）
- 导出内容开关：小说封面 / 章节封面 / 段落插图
- 导出预览支持逐张删除段落插图
- 导出页编辑进度持久化（字体选择、内容开关、已删插图）

## v1.1.0 重点更新（PDF 导出机制）

- PDF 由“整页截图导出”升级为“文本排版导出”
  - 正文文字可复制、可检索
- 新增目录页与页码机制
  - 目录含章节跳转链接
  - 页码从目录页开始计数
- 封面页与目录/正文顺序优化
  - 封面（书名/作者/封面图）独立页，目录在其后
- 系统中文字体导出
  - 导出页读取系统字体列表并嵌入所选字体
  - 若个别字体兼容性不足，可切换字体重试
- 中文排版优化
  - 段落换行优化，避免标点落在行首
  - 章节摘要、封面、正文、插图间距可读性提升

## 技术栈

### 前端
- React 18
- TypeScript
- Zustand
- Tailwind CSS
- jsPDF

### 后端（Tauri）
- Rust
- Tauri 1.5
- SQLx + SQLite
- Reqwest

## 快速开始

### 环境要求
- Node.js >= 18
- Rust >= 1.75
- npm

### 安装依赖

```bash
npm install
```

### 开发运行

```bash
npm run tauri:dev
```

### 生产构建

```bash
npm run tauri:build
```

构建产物默认位于：

- `src-tauri/target/release/bundle/msi/`
- `src-tauri/target/release/bundle/nsis/`

## 配置说明

在应用「设置」页面配置 API Key：

- DeepSeek API Key（文本生成/润色）
- Pollinations API Key（图像生成）

## 项目结构

```text
NovelSeek-Pro-PC/
├─ src/
│  ├─ components/       # 通用 UI 组件
│  ├─ pages/            # 页面（首页/项目页/大纲页/编辑页/导出页）
│  ├─ services/         # 前端 API 调用封装
│  ├─ store/            # Zustand 状态
│  ├─ types/            # TS 类型
│  └─ utils/            # 工具函数
├─ src-tauri/
│  ├─ src/
│  │  ├─ api/           # 第三方 API 封装
│  │  ├─ commands/      # Tauri 命令层
│  │  ├─ db/            # 数据库初始化与迁移
│  │  ├─ services/      # 业务服务
│  │  └─ models.rs      # Rust 模型
│  └─ tauri.conf.json
├─ package.json
└─ README.md
```

## 常见问题

### 1) PDF 中文显示异常怎么办？
在导出页切换系统字体后重试。不同字体对 PDF 嵌入兼容性有差异。

### 2) 导出页删除过的插图为什么会恢复？
当前版本已支持导出页进度持久化；若项目内容结构发生变化，会自动清理失效插图记录。

## 许可

MIT License
