# NovelSeek Pro PC

[![Built with Pollinations](https://img.shields.io/badge/Built%20with-Pollinations-8a2be2?style=for-the-badge&logo=data:image/svg+xml,%3Csvg%20xmlns%3D%22http://www.w3.org/2000/svg%22%20viewBox%3D%220%200%20124%20124%22%3E%3Ccircle%20cx%3D%2262%22%20cy%3D%2262%22%20r%3D%2262%22%20fill%3D%22%23ffffff%22/%3E%3C/svg%3E&logoColor=white&labelColor=6a0dad)](https://pollinations.ai)

[English README](README.md)

NovelSeek Pro PC 是一款面向长篇小说创作的桌面工具，覆盖从大纲规划、章节生成到插图封面与电子书导出的完整流程。  
项目基于 `Tauri + React + TypeScript + Rust + SQLite`，支持本地运行与数据持久化。

## Pollinations Attribution

- 官方网站：<https://pollinations.ai>

[![pollinations.ai Logo Text White](docs/assets/pollinations-logo-text-on-dark.svg)](https://pollinations.ai)

## 版本信息

- 当前版本：`v1.3.0`
- 主要平台：Windows

## 功能概览

### 1. 创作流程
- 小说项目创建、编辑、删除
- 章节列表与序章管理
- 章节编辑器流式生成、续写、润色
- 章节生成页可直接展开章节列表并快速切换
- 大纲生成与结构化编辑

### 2. AI 能力
- 文本模型平台：`DeepSeek / OpenAI / OpenRouter / Gemini(OpenAI兼容) / 自定义`
- 文本模型配置支持：`API Key / API URL / Model / Temperature`
- 支持为每个模型平台独立保存配置，并新增自定义平台到可选列表
- 文本生成能力：大纲、章节、序章、润色、图片提示词
- Pollinations：章节推文图、段落插图、全书封面、角色一寸照
- 插图支持锚点定位、预览、移动、删除
- 章节推文（章节封面）生成前支持画风选择（含手动输入）

### 3. 角色管理
- 角色基础字段：名称、身份、性格、背景、动机
- 支持基于角色信息生成“形象”文本，并同步写回大纲角色部分
- 支持生成人物一寸照（可单独“重生一寸照”，不改动形象文本）

### 4. 电子书导出
- 导出入口：章节列表页「导出电子书」
- 支持格式：
  - `PDF`（A4，支持封面 / 章节封面 / 段落插图）
  - `TXT`（纯文本）
  - `EPUB`（纯文本）
  - `MOBI`（纯文本）
- 导出预览支持删除个别段落插图
- 导出设置与编辑进度持久化

### 5. 界面与交互
- 侧栏增强：导航区 + 项目快捷入口 + 主题切换
- 支持暗色/亮色模式一键切换
- 设置页 API 密钥输入支持显示/隐藏
- 设置页提供密钥获取链接（主流文本模型平台 / Pollinations）
- 支持中英文界面切换

## 快速开始

### 环境要求

- Node.js `>=18`
- Rust `>=1.75`
- npm

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

安装包默认输出目录：

- `src-tauri/target/release/bundle/msi/`
- `src-tauri/target/release/bundle/nsis/`

## API 配置

在应用「设置」页面配置：

- 文本模型平台配置（可多套保存并切换）：
  - `API Key`
  - `API URL`
  - `Model`
  - `Temperature`
- `Pollinations API Key`（图像生成相关，可选）

## 项目结构

```text
NovelSeek-Pro-PC/
├─ src/
│  ├─ components/      # 通用 UI 组件
│  ├─ pages/           # 页面：首页/项目/大纲/编辑/导出/设置
│  ├─ services/        # 前端 API 封装
│  ├─ store/           # Zustand 全局状态
│  ├─ types/           # TypeScript 类型定义
│  └─ utils/           # 工具函数
├─ src-tauri/
│  ├─ src/
│  │  ├─ api/          # DeepSeek / Pollinations 调用层
│  │  ├─ commands/     # Tauri 命令入口
│  │  ├─ db/           # SQLite 初始化与迁移
│  │  ├─ services/     # 后端业务服务
│  │  └─ models.rs     # Rust 模型
│  └─ tauri.conf.json
├─ package.json
├─ README.md
└─ README.zh-CN.md
```

## 说明

- 非 PDF 导出格式当前为纯文本导出，不包含图片资源。
- PDF 中文字体来自系统字体列表，若显示异常可切换字体重试。

## License

MIT
