# NovelSeek Pro PC

<div align="center">

**专业的 AI 小说创作与出版工具（桌面端 / Tauri）**

[![Tauri](https://img.shields.io/badge/Tauri-1.5-blue)](https://tauri.app)
[![React](https://img.shields.io/badge/React-18-blue)](https://reactjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue)](https://www.typescriptlang.org)
[![Rust](https://img.shields.io/badge/Rust-1.75-orange)](https://www.rust-lang.org)

</div>

## 功能一览

### 📚 结构化小说创作
- 项目 / 章节 / 角色 / 世界观 / 时间线管理
- 章节列表、章节预览与状态追踪
- 大纲保存后同步章节预览信息

### ✨ AI 文本生成与润色（DeepSeek）
- 大纲生成（流式输出）
- 章节生成 / 续写（流式输出）
- 序章生成（流式输出）
- 编辑器内选中文本一键润色

### 🖼 AI 图像生成（Pollinations）
- 章节插图：按段落分组选择，批量生成多图
- 插图锚点位置可调整，随段落变动自动修正
- 章节推文/海报生成
- 全书封面生成与管理（预览 / 重命名 / 删除 / 设为默认）

### 🧩 大纲编辑与格式安全
- 标题锁定不可修改，正文与条目可编辑
- 支持多种 Markdown 条目格式（无序 / 有序 / 加粗名称）
- 新增条目自动继承原格式与编号
- 条目可删除

## 快速开始

### 环境要求
- **Node.js** >= 18
- **Rust** >= 1.75
- **npm / pnpm / yarn**

### 安装依赖

```bash
npm install
```

### 开发模式

```bash
npm run tauri:dev
```

### 生产构建

```bash
npm run tauri:build
```

构建产物位于 `src-tauri/target/release/bundle/`。

## 配置

在应用「设置」页配置：

- **DeepSeek API Key**（文本生成 / 润色必需）
- **Pollinations API Key**（可选，用于图像生成）

## 项目结构

```
NovelSeek-Pro-PC/
├─ src/                  # React 前端
│  ├─ components/        # UI 组件
│  ├─ pages/             # 页面
│  ├─ services/          # API 服务
│  ├─ store/             # 状态管理（Zustand）
│  ├─ types/             # TypeScript 类型
│  └─ utils/             # 工具函数
├─ src-tauri/            # Rust 后端
│  ├─ src/
│  │  ├─ api/            # 外部 API 适配
│  │  ├─ commands/       # Tauri Commands
│  │  ├─ db/             # 数据库
│  │  ├─ services/       # 业务服务
│  │  └─ models.rs       # 数据模型
│  └─ tauri.conf.json
├─ package.json
└─ README.md
```

## 许可

MIT License（详见 `LICENSE`）。

