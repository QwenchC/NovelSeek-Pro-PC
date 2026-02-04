# NovelSeek Pro - 开发指南

## 本地开发环境配置

### 1. 安装 Rust

```bash
# Windows
# 访问 https://www.rust-lang.org/tools/install 下载安装器

# macOS/Linux
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

### 2. 安装 Node.js (推荐 v18+)

访问 https://nodejs.org 下载安装

### 3. 克隆项目

```bash
git clone <your-repo-url>
cd NovelSeek-Pro-PC
```

### 4. 安装依赖

```bash
npm install
```

## 开发工作流

### 启动开发服务器

```bash
npm run tauri:dev
```

这会同时启动：
- Vite 开发服务器 (端口 1420)
- Tauri 桌面应用

前端代码热重载会自动生效。后端 Rust 代码修改后需要重启。

### 调试技巧

#### 前端调试
- 在 Tauri 窗口中按 `F12` 打开开发者工具
- 使用 `console.log` 查看日志
- React DevTools 可在浏览器扩展中使用

#### 后端调试
- 查看终端输出的 Rust 日志
- 使用 `log::info!()`, `log::error!()` 等宏
- 环境变量 `RUST_LOG=debug` 可启用详细日志

```bash
RUST_LOG=debug npm run tauri:dev
```

## 代码规范

### TypeScript/React

```typescript
// 使用函数组件和 Hooks
export function MyComponent() {
  const [state, setState] = useState();
  return <div>...</div>;
}

// 类型优先
interface Props {
  title: string;
  count: number;
}

// 使用 Path Alias
import { Button } from '@components/Button';
import type { Project } from '@types/index';
```

### Rust

```rust
// 使用异步函数
pub async fn my_function() -> Result<String> {
    // ...
}

// 错误处理
use anyhow::Result;

// 命名规范：snake_case
pub struct MyService {
    client: Client,
}
```

## 添加新功能

### 1. 添加新的 API 端点

#### 后端 (Rust)

```rust
// src-tauri/src/commands/my_feature.rs
#[tauri::command]
pub async fn my_command(
    pool: State<'_, SqlitePool>,
    input: MyInput,
) -> Result<MyOutput, String> {
    // 实现逻辑
    Ok(result)
}

// 在 main.rs 中注册
.invoke_handler(tauri::generate_handler![
    // ... 其他命令
    commands::my_feature::my_command,
])
```

#### 前端 (TypeScript)

```typescript
// src/services/api.ts
export const myApi = {
  myCommand: (input: MyInput) => invoke<MyOutput>('my_command', { input }),
};

// 使用
const result = await myApi.myCommand({ ... });
```

### 2. 添加新的数据表

```rust
// src-tauri/src/db/schema.rs
pub async fn run_migrations(pool: &SqlitePool) -> Result<()> {
    // 添加新表
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS my_table (
            id TEXT PRIMARY KEY,
            data TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
        "#
    )
    .execute(pool)
    .await?;
    
    // ...
}
```

### 3. 添加新页面

```typescript
// src/pages/MyPage.tsx
export function MyPage() {
  return (
    <div>
      <h1>My New Page</h1>
    </div>
  );
}

// src/App.tsx 中添加路由
<Route path="/my-page" element={<MyPage />} />
```

## 构建与发布

### 开发构建

```bash
npm run build
npm run tauri:build
```

### 生产构建

```bash
# 会在 src-tauri/target/release/bundle/ 生成安装包
npm run tauri:build
```

生成文件：
- Windows: `.msi`, `.exe`
- macOS: `.dmg`, `.app`
- Linux: `.deb`, `.AppImage`

## 常见问题

### Q: Tauri 编译失败

A: 确保安装了所有系统依赖：

**Windows:**
- Microsoft Visual Studio C++ Build Tools
- WebView2 (通常已预装在 Windows 10/11)

**macOS:**
```bash
xcode-select --install
```

**Linux (Ubuntu/Debian):**
```bash
sudo apt update
sudo apt install libwebkit2gtk-4.0-dev \
    build-essential \
    curl \
    wget \
    file \
    libssl-dev \
    libgtk-3-dev \
    libayatana-appindicator3-dev \
    librsvg2-dev
```

### Q: SQLite 数据库位置

开发环境：
- Windows: `%APPDATA%\com.novelseek.pro\novelseek.db`
- macOS: `~/Library/Application Support/com.novelseek.pro/novelseek.db`
- Linux: `~/.local/share/com.novelseek.pro/novelseek.db`

### Q: API Key 存储位置

内存中临时存储（重启后需要重新输入）。
未来版本将使用系统密钥环（Keychain/Credential Manager）。

## 性能优化

### 前端
- 使用 `React.memo()` 避免不必要的重渲染
- 大列表使用虚拟滚动
- 图片懒加载

### 后端
- 数据库查询添加索引
- 使用连接池
- 批量操作而非逐个处理

## 测试

```bash
# 前端测试 (TODO)
npm run test

# Rust 测试
cd src-tauri
cargo test
```

## 贡献代码前检查清单

- [ ] 代码符合项目规范
- [ ] 添加了必要的注释
- [ ] 测试通过
- [ ] 更新了相关文档
- [ ] 提交信息清晰明确

---

有问题？查看项目 Issues 或提交新 Issue！
