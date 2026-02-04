# NovelSeek Pro PC

<div align="center">

**专业的AI小说生成与出版工具**

[![Tauri](https://img.shields.io/badge/Tauri-1.5-blue)](https://tauri.app)
[![React](https://img.shields.io/badge/React-18-blue)](https://reactjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue)](https://www.typescriptlang.org)
[![Rust](https://img.shields.io/badge/Rust-1.75-orange)](https://www.rust-lang.org)

</div>

## ✨ 核心特性

### 🎯 结构化小说工程
- 项目、章节、人物、世界观的资产化管理
- 完整的版本控制与回滚系统
- 时间线管理与一致性检查

### 🤖 AI 文本生成
- **DeepSeek API** 集成 - OpenAI兼容接口
- 大纲生成、章节生成、文本润色
- 流式输出、智能重试、成本统计
- 可自定义的提示词模板系统

### 🎨 AI 图像生成
- **Pollinations.ai** 集成
- 章节插图、推文海报、角色立绘、封面设计
- 风格锁定与批量生成
- 素材管理与章节绑定

### 📚 多格式导出
- **PDF** - 专业排版（目录、页码、插图）
- **EPUB** - 电子书标准格式
- **DOCX** - 可编辑文档
- **Markdown** - 便于迁移

### 🔧 工程化能力
- 任务队列系统（批处理、失败重试、断点续跑）
- 一致性引擎（人物、设定、时间线冲突检测）
- 质量评测（连贯性、重复度、节奏分析）

## 🚀 快速开始

### 环境要求

- **Node.js** >= 18
- **Rust** >= 1.75
- **pnpm** / npm / yarn

### 安装依赖

```bash
# 安装前端依赖
npm install

# Tauri会自动安装Rust依赖
```

### 开发模式

```bash
# 启动开发服务器
npm run tauri:dev
```

这将同时启动：
- Vite 开发服务器（前端热重载）
- Tauri 应用程序（自动刷新）

### 生产构建

```bash
# 构建应用程序
npm run tauri:build
```

构建产物位于 `src-tauri/target/release/bundle/`

## 📁 项目结构

```
NovelSeek-Pro-PC/
├── src/                      # React 前端
│   ├── components/          # UI组件
│   ├── pages/              # 页面
│   ├── services/           # API服务
│   ├── store/              # 状态管理（Zustand）
│   ├── types/              # TypeScript类型
│   └── utils/              # 工具函数
│
├── src-tauri/               # Rust 后端
│   ├── src/
│   │   ├── api/            # API适配器
│   │   │   ├── deepseek.rs       # DeepSeek文本生成
│   │   │   └── pollinations.rs  # Pollinations图像生成
│   │   ├── db/             # 数据库
│   │   │   ├── mod.rs           # 数据库初始化
│   │   │   └── schema.rs        # SQLite Schema
│   │   ├── services/       # 业务逻辑
│   │   ├── commands/       # Tauri Commands
│   │   ├── models.rs       # 数据模型
│   │   └── main.rs         # 入口文件
│   ├── Cargo.toml          # Rust依赖
│   └── tauri.conf.json     # Tauri配置
│
├── package.json
├── tsconfig.json
├── vite.config.ts
├── tailwind.config.js
└── README.md
```

## 🔑 API 配置

### DeepSeek API

1. 访问 [DeepSeek开放平台](https://platform.deepseek.com)
2. 注册账号并获取 API Key
3. 在应用的"设置"页面配置：
   - API Key: `sk-...`
   - Base URL: `https://api.deepseek.com/v1` (默认)
   - Model: `deepseek-chat` (推荐)

### Pollinations.ai API

1. 访问 [Pollinations.ai](https://pollinations.ai)
2. 可选：获取 API Key（不提供也能使用，但有限流）
3. 在应用的"设置"页面配置 API Key

## 🎨 功能演示

### 1. 创建项目

```typescript
// 创建新的小说项目
await projectApi.create({
  title: "我的科幻小说",
  author: "作者笔名",
  genre: "科幻",
  description: "一个关于...",
  target_word_count: 100000
});
```

### 2. AI 生成大纲

```typescript
// 使用DeepSeek生成小说大纲
const outline = await aiApi.generateOutline({
  title: "星际穿越者",
  genre: "科幻",
  description: "人类首次跨越银河系的故事",
  target_chapters: 30,
  deepseek_key: "sk-..."
});
```

### 3. 生成章节

```typescript
// AI生成章节内容
const chapterContent = await aiApi.generateChapter({
  chapter_title: "第一章 - 启程",
  outline_goal: "介绍主角并建立世界观",
  conflict: "主角面临选择",
  deepseek_key: "sk-..."
});
```

### 4. 生成配图

```typescript
// 为章节生成插图
const imagePath = await aiApi.generateImage({
  params: {
    prompt: "未来城市，赛博朋克风格，高质量插画",
    width: 1024,
    height: 1024,
    model: "flux"
  },
  save_path: "/path/to/save/image.png"
});
```

## 🛠️ 技术栈

### 前端
- **React 18** - UI框架
- **TypeScript** - 类型安全
- **Vite** - 构建工具
- **TailwindCSS** - 样式框架
- **Zustand** - 状态管理
- **React Router** - 路由
- **Lucide React** - 图标库

### 后端
- **Tauri 1.5** - 桌面应用框架
- **Rust** - 系统编程语言
- **SQLx** - 数据库（SQLite）
- **Reqwest** - HTTP客户端
- **Tokio** - 异步运行时
- **Serde** - 序列化/反序列化

## 📊 数据库结构

核心表：
- `projects` - 项目管理
- `chapters` - 章节内容
- `characters` - 人物卡
- `lore` - 世界观设定
- `timeline_events` - 时间线事件
- `generation_tasks` - 生成任务
- `snapshots` - 版本快照
- `assets` - 资源文件

## 🔐 安全性

- API Key 使用系统安全存储（Windows Credential Manager / macOS Keychain）
- 数据库本地加密
- 日志脱敏处理
- 不在明文配置文件中存储敏感信息

## 🚧 开发路线图

### MVP (已完成)
- ✅ 项目与章节管理
- ✅ DeepSeek API 集成
- ✅ Pollinations API 集成
- ✅ 基础编辑器
- ✅ 数据库Schema
- ✅ 任务队列基础

### v1.0 (进行中)
- ⏳ Monaco Editor 集成
- ⏳ 版本系统（快照、diff、回滚）
- ⏳ 一致性引擎
- ⏳ PDF/EPUB/DOCX 导出
- ⏳ 推文生成与营销

### v2.0 (规划中)
- 📋 工作流编排器
- 📋 多智能体协同
- 📋 质量评测系统
- 📋 插件体系

## 🤝 贡献指南

欢迎贡献代码、报告问题或提出建议！

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启 Pull Request

## 📄 许可证

本项目采用 MIT 许可证 - 详见 [LICENSE](LICENSE) 文件

## 🙏 致谢

- [Tauri](https://tauri.app) - 优秀的桌面应用框架
- [DeepSeek](https://www.deepseek.com) - 强大的AI文本生成
- [Pollinations.ai](https://pollinations.ai) - 免费的AI图像生成

---

**NovelSeek Pro** - 让AI辅助你的小说创作之旅 ✨
