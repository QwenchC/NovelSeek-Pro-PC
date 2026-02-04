# API 使用示例

## DeepSeek API

### 基础配置

```typescript
// 在设置页面配置
const config = {
  api_key: "sk-your-key-here",
  base_url: "https://api.deepseek.com/v1",
  model: "deepseek-chat"
};
```

### 生成小说大纲

```typescript
const outline = await aiApi.generateOutline({
  title: "星际穿越者",
  genre: "科幻",
  description: "一个关于人类首次跨越银河系的冒险故事",
  target_chapters: 30,
  deepseek_key: config.api_key
});

console.log(outline);
// 输出示例：
// 1. 故事梗概
// 2. 核心冲突：人类vs外星文明
// 3. 主要角色...
```

### 生成章节内容

```typescript
const chapter = await aiApi.generateChapter({
  chapter_title: "第一章 - 启程",
  outline_goal: "介绍主角林凯，建立未来世界观",
  conflict: "林凯面临是否加入星际探索计划的抉择",
  previous_summary: "无（第一章）",
  character_info: `
    林凯：28岁，星际飞行学院优秀毕业生
    性格：谨慎、富有责任感
    动机：寻找失踪的父亲
  `,
  world_info: `
    2150年，人类已掌握亚光速飞行技术
    地球联邦政府启动"银河探索计划"
    未知外星信号引发全球关注
  `,
  deepseek_key: config.api_key
});

// 章节内容会自动生成3000-5000字
```

### 文本润色

```typescript
const revised = await GenerationService.generate_revision(
  original_text,
  "修订目标：\n1. 增强画面感\n2. 减少AI痕迹\n3. 对话更自然"
);
```

## Pollinations API

### 生成章节插图

```typescript
const image = await aiApi.generateImage({
  params: {
    prompt: "未来城市夜景，高楼林立，飞行汽车穿梭，赛博朋克风格，高质量数字艺术",
    width: 1024,
    height: 768,
    model: "flux",
    nologo: true,
    enhance: true
  },
  save_path: "E:/projects/NovelSeek-Pro-PC/assets/chapter1_scene1.png",
  pollinations_key: undefined // 可选
});

console.log(image); // 返回保存路径
```

### 生成角色立绘

```typescript
const characterPortrait = await aiApi.generateImage({
  params: {
    prompt: "林凯，28岁男性，短发，深邃眼神，穿着星际联邦制服，专业角色设计，高清",
    width: 768,
    height: 1024,
    seed: 42, // 固定种子保证风格一致
    model: "flux"
  },
  save_path: "./assets/characters/linkai.png"
});
```

### 生成推文海报

```typescript
const poster = await aiApi.generateImage({
  params: {
    prompt: "小说封面设计：《星际穿越者》，宇宙星空背景，飞船剪影，科幻感强，现代海报设计",
    width: 1080,
    height: 1920, // 竖版海报
    model: "flux",
    nologo: true,
    enhance: true
  },
  save_path: "./marketing/twitter_poster.png"
});
```

## 完整工作流示例

### 从零开始创建小说

```typescript
// 1. 创建项目
const project = await projectApi.create({
  title: "星际穿越者",
  author: "AI小说家",
  genre: "科幻",
  description: "2150年，人类的星际探索之旅",
  target_word_count: 100000
});

// 2. 生成大纲
const outline = await aiApi.generateOutline({
  title: project.title,
  genre: project.genre,
  description: project.description,
  target_chapters: 30,
  deepseek_key: "sk-..."
});

// 3. 解析大纲，创建章节
const chapters = parseOutline(outline); // 自定义解析函数
for (let i = 0; i < chapters.length; i++) {
  await chapterApi.create({
    project_id: project.id,
    title: chapters[i].title,
    order_index: i + 1,
    outline_goal: chapters[i].goal,
    conflict: chapters[i].conflict
  });
}

// 4. 批量生成章节内容
const allChapters = await chapterApi.getByProject(project.id);
for (const chapter of allChapters) {
  const content = await aiApi.generateChapter({
    chapter_title: chapter.title,
    outline_goal: chapter.outline_goal,
    conflict: chapter.conflict,
    deepseek_key: "sk-..."
  });
  
  await chapterApi.update(chapter.id, content, undefined);
  
  // 为每章生成插图
  const image = await aiApi.generateImage({
    params: {
      prompt: `${chapter.title}场景插图，${chapter.outline_goal}，电影级别画质`,
      width: 1024,
      height: 768
    },
    save_path: `./assets/chapter_${chapter.order_index}.png`
  });
}
```

## 高级用法

### 自定义提示词

```rust
// 后端 Rust 代码
let custom_prompt = format!(
  r#"你是{author}风格的作家。

写作要求：
- 文风：{style}
- 节奏：{pace}
- 视角：{pov}

章节任务：
{task}

请撰写章节内容。"#,
  author = "东野圭吾",
  style = "简洁、悬疑",
  pace = "快节奏",
  pov = "第三人称",
  task = chapter_goal
);
```

### 批处理与错误重试

```typescript
async function batchGenerate(chapters: Chapter[]) {
  const results = [];
  for (const chapter of chapters) {
    let retries = 3;
    while (retries > 0) {
      try {
        const content = await aiApi.generateChapter({
          chapter_title: chapter.title,
          outline_goal: chapter.outline_goal,
          conflict: chapter.conflict,
          deepseek_key: "sk-..."
        });
        results.push({ chapter, content, success: true });
        break;
      } catch (error) {
        retries--;
        if (retries === 0) {
          results.push({ chapter, error, success: false });
        }
        await sleep(2000); // 等待2秒后重试
      }
    }
  }
  return results;
}
```

### Token 成本统计

```typescript
interface GenerationStats {
  total_tokens: number;
  total_cost: number;
  chapters_generated: number;
}

const stats: GenerationStats = {
  total_tokens: 0,
  total_cost: 0,
  chapters_generated: 0
};

// DeepSeek 定价示例（实际价格请查官网）
const PRICE_PER_1K_TOKENS = 0.002; // $0.002 / 1K tokens

// 每次生成后更新
stats.total_tokens += response.usage.total_tokens;
stats.total_cost += (response.usage.total_tokens / 1000) * PRICE_PER_1K_TOKENS;
stats.chapters_generated++;
```

## 提示词模板库

### 不同题材的系统提示词

```typescript
const genrePrompts = {
  fantasy: `你是一位擅长玄幻小说的作家。
    写作风格：宏大的世界观、复杂的修炼体系、激烈的战斗描写
    注重：升级节奏、势力关系、宝物设定`,
  
  romance: `你是一位擅长言情小说的作家。
    写作风格：细腻的情感描写、真实的人物关系、贴近生活的场景
    注重：情感张力、互动细节、内心独白`,
  
  scifi: `你是一位擅长科幻小说的作家。
    写作风格：硬核科技设定、逻辑严谨、富有想象力
    注重：科技原理、世界构建、哲学思考`,
};
```

---

更多示例请查看项目文档和源代码！
