use tauri::{AppHandle, Manager, Window};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::Mutex;
use reqwest::Client;
use futures_util::StreamExt;

// 全局取消标志
lazy_static::lazy_static! {
    static ref CANCEL_FLAG: Arc<AtomicBool> = Arc::new(AtomicBool::new(false));
    static ref GENERATION_LOCK: Arc<Mutex<()>> = Arc::new(Mutex::new(()));
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GenerateOutlineStreamInput {
    pub title: String,
    pub genre: String,
    pub description: String,
    pub target_chapters: u32,
    pub deepseek_key: String,
    pub requirements: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct StreamChoice {
    delta: StreamDelta,
    finish_reason: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct StreamDelta {
    content: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct StreamResponse {
    choices: Vec<StreamChoice>,
}

#[tauri::command]
pub async fn generate_outline_stream(
    window: Window,
    input: GenerateOutlineStreamInput,
) -> Result<String, String> {
    // 获取生成锁，确保同时只有一个生成任务
    let _lock = GENERATION_LOCK.lock().await;
    
    // 重置取消标志
    CANCEL_FLAG.store(false, Ordering::SeqCst);

    let client = Client::new();
    let target_chapters = input.target_chapters;
    
    let initial_prompt = build_outline_prompt(&input);
    let system_prompt = build_outline_system_prompt(target_chapters);

    // 第一次生成
    let mut full_content = stream_generate(
        &client, 
        &window, 
        &input.deepseek_key, 
        &system_prompt, 
        &initial_prompt,
        "outline-stream",
        8000  // 增加 token 限制
    ).await?;

    // 检测是否需要续写（最多续写5次）
    let max_continuations = 5;
    for i in 0..max_continuations {
        if CANCEL_FLAG.load(Ordering::SeqCst) {
            return Err("生成已被用户中断".to_string());
        }

        // 检查是否已生成所有章节
        let last_chapter_found = find_last_chapter_number(&full_content);
        
        if last_chapter_found >= target_chapters {
            // 已完成所有章节
            break;
        }

        // 通知前端正在续写
        let _ = window.emit("outline-stream", format!("\n\n【系统：检测到大纲未完成（已生成到第{}章，目标{}章），正在自动续写...】\n\n", last_chapter_found, target_chapters));

        // 构建续写提示
        let continue_prompt = format!(
            r#"请继续完成大纲的章节部分。

【已生成内容的结尾】
{}

【续写要求】
1. 从第{}章继续生成，直到第{}章
2. 保持与前面相同的格式
3. 每章格式：
### 第X章：章节标题
- **时间**：本章发生的时间点
- **目标**：本章要完成的剧情目标
- **冲突**：本章的核心冲突或挑战
- **结尾钩子**：吸引读者继续阅读的悬念

请直接从第{}章开始续写，不要重复已有内容："#,
            get_last_n_chars(&full_content, 1500),
            last_chapter_found + 1,
            target_chapters,
            last_chapter_found + 1
        );

        let continue_system = format!(
            r#"你正在续写一份小说大纲。前面的内容已经生成了第1章到第{}章，现在需要继续生成剩余的章节（第{}章到第{}章）。

请保持格式一致，直接续写章节内容，不要添加任何开头说明。"#,
            last_chapter_found,
            last_chapter_found + 1,
            target_chapters
        );

        // 续写生成
        let continuation = stream_generate(
            &client,
            &window,
            &input.deepseek_key,
            &continue_system,
            &continue_prompt,
            "outline-stream",
            6000
        ).await?;

        full_content.push_str(&continuation);
    }

    Ok(full_content)
}

// 构建大纲生成的初始提示词
fn build_outline_prompt(input: &GenerateOutlineStreamInput) -> String {
    let mut prompt = format!(
        r#"请为以下小说创建详细大纲：

书名：{}
题材：{}
简介：{}
目标章节数：{}（必须严格按照这个数量生成章节大纲）

"#,
        input.title, input.genre, input.description, input.target_chapters
    );

    if let Some(ref req) = input.requirements {
        prompt.push_str(&format!("特殊要求：{}\n\n", req));
    }

    prompt.push_str(&format!(r#"【重要】请严格按照以下格式生成大纲，章节数必须恰好为{}章：

## 故事梗概
（200字左右的故事概述）

## 核心冲突
（主要矛盾和冲突描述）

## 世界观设定
（详细描述故事发生的世界背景、规则、势力分布、社会结构等，确保后续章节保持一致）

### 基础设定
- **时代背景**：故事发生的时代/纪元
- **地理环境**：主要地点、城市、国家等
- **社会结构**：权力体系、阶级划分、组织势力等
- **特殊规则**：如有魔法/科技/超能力等特殊元素的规则

### 重要势力
（列出3-5个重要势力/组织及其特点）

## 时间线事件
（按时间顺序列出影响剧情的重要历史事件和关键节点，便于各章节保持时间一致性）

### 历史事件（故事开始前）
1. 【时间点】事件描述及影响
2. ...

### 剧情时间线（故事进行中）
1. 【第X章时间点】关键事件
2. ...

## 主要角色

### 1. 角色名称
- **身份**：角色的身份定位
- **性格**：性格特点描述
- **背景**：背景故事简述
- **动机**：角色的目标和动机

### 2. 角色名称
（同上格式，3-5个主要角色）

## 三幕结构

### 第一幕：起始（约占全书20%）
（介绍主要人物、世界观，引出核心冲突）

### 第二幕：发展与高潮（约占全书60%）
（冲突升级、角色成长、多次转折）

### 第三幕：结局（约占全书20%）
（高潮对决、冲突解决、结局交代）

## 章节大纲

【必须生成恰好{}章，每章格式如下】

### 第1章：章节标题
- **时间**：本章发生的时间点
- **目标**：本章要完成的剧情目标
- **冲突**：本章的核心冲突或挑战
- **结尾钩子**：吸引读者继续阅读的悬念

### 第2章：章节标题
...

（以此类推，直到第{}章）

请确保：
1. 章节数量严格等于{}章
2. 每章都有明确的剧情推进
3. 章节之间逻辑连贯，时间线一致
4. 世界观设定详细完整，便于后续章节参考
5. 角色和势力格式便于系统解析
"#, input.target_chapters, input.target_chapters, input.target_chapters, input.target_chapters));

    prompt
}

// 构建大纲生成的系统提示词
fn build_outline_system_prompt(target_chapters: u32) -> String {
    format!(r#"你是一位专业的小说策划师和编剧。你的任务是根据用户提供的题材、风格和要求，创建详细的小说大纲。

【核心要求】
1. 章节数量必须严格等于用户指定的{}章，不能多也不能少
2. 使用标准Markdown格式输出
3. 角色、世界观、时间线信息必须按照指定格式，便于系统解析

【内容要求】
- 故事主线清晰，核心冲突明确
- 世界观设定完整详细（时代背景、地理环境、社会结构、特殊规则、重要势力）
- 时间线事件清晰（历史事件和剧情时间线），确保各章节时间一致
- 每个主要角色都有完整的设定（身份、性格、背景、动机）
- 三幕结构合理分配剧情节奏
- 每章都有明确的时间点、目标、冲突和悬念钩子
- 章节之间逻辑连贯，剧情层层递进

【格式要求】
- 使用 ## 作为一级标题（故事梗概、世界观设定、时间线事件、主要角色、章节大纲等）
- 使用 ### 作为二级标题（角色名、章节标题、势力名等）
- 使用 - **字段**：内容 格式列出详细信息
- 确保格式统一，便于程序解析"#, target_chapters)
}

// 查找已生成的最后一章编号
fn find_last_chapter_number(content: &str) -> u32 {
    use regex::Regex;
    
    // 匹配 "第X章" 或 "### 第X章"
    let re = Regex::new(r"第(\d+)章").unwrap();
    let mut max_chapter = 0u32;
    
    for cap in re.captures_iter(content) {
        if let Some(num_str) = cap.get(1) {
            if let Ok(num) = num_str.as_str().parse::<u32>() {
                if num > max_chapter {
                    max_chapter = num;
                }
            }
        }
    }
    
    max_chapter
}

// 获取字符串最后N个字符
fn get_last_n_chars(s: &str, n: usize) -> &str {
    let len = s.len();
    if len <= n {
        s
    } else {
        // 找到合适的 UTF-8 边界
        let mut start = len - n;
        while start > 0 && !s.is_char_boundary(start) {
            start -= 1;
        }
        &s[start..]
    }
}

// 通用流式生成函数
async fn stream_generate(
    client: &Client,
    window: &Window,
    api_key: &str,
    system_prompt: &str,
    user_prompt: &str,
    event_name: &str,
    max_tokens: u32,
) -> Result<String, String> {
    let request_body = serde_json::json!({
        "model": "deepseek-chat",
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        "temperature": 0.8,
        "max_tokens": max_tokens,
        "stream": true
    });

    let response = client
        .post("https://api.deepseek.com/v1/chat/completions")
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&request_body)
        .send()
        .await
        .map_err(|e| format!("请求失败: {}", e))?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("API错误: {}", error_text));
    }

    let mut full_content = String::new();
    let mut stream = response.bytes_stream();

    while let Some(chunk_result) = stream.next().await {
        if CANCEL_FLAG.load(Ordering::SeqCst) {
            return Err("生成已被用户中断".to_string());
        }

        let chunk = chunk_result.map_err(|e| format!("读取流失败: {}", e))?;
        let chunk_str = String::from_utf8_lossy(&chunk);

        for line in chunk_str.lines() {
            if line.starts_with("data: ") {
                let data = &line[6..];
                if data == "[DONE]" {
                    continue;
                }

                if let Ok(stream_response) = serde_json::from_str::<StreamResponse>(data) {
                    if let Some(choice) = stream_response.choices.first() {
                        if let Some(content) = &choice.delta.content {
                            full_content.push_str(content);
                            let _ = window.emit(event_name, content.clone());
                        }
                    }
                }
            }
        }
    }

    Ok(full_content)
}

#[tauri::command]
pub fn cancel_generation() -> Result<(), String> {
    CANCEL_FLAG.store(true, Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
pub async fn generate_chapter_stream(
    window: Window,
    #[allow(non_snake_case)] chapterTitle: String,
    #[allow(non_snake_case)] outlineGoal: String,
    conflict: String,
    #[allow(non_snake_case)] previousSummary: Option<String>,
    #[allow(non_snake_case)] currentContent: Option<String>,
    #[allow(non_snake_case)] charactersInfo: Option<String>,
    #[allow(non_snake_case)] worldSetting: Option<String>,
    #[allow(non_snake_case)] timeline: Option<String>,
    #[allow(non_snake_case)] targetWords: Option<u32>,
    #[allow(non_snake_case)] isContinuation: Option<bool>,
    #[allow(non_snake_case)] deepseekKey: String,
) -> Result<String, String> {
    let _lock = GENERATION_LOCK.lock().await;
    CANCEL_FLAG.store(false, Ordering::SeqCst);

    let client = Client::new();
    let is_continue = isContinuation.unwrap_or(false);
    let word_target = targetWords.unwrap_or(2500);
    
    let mut prompt = String::new();
    
    // 添加世界观设定（确保各章节世界观一致）
    if let Some(ref world) = worldSetting {
        prompt.push_str(&format!(
            r#"【重要：世界观设定 - 必须严格遵守】
以下是本小说的世界观设定，生成内容时必须保持一致，不得与设定冲突：

{}

"#, world));
    }
    
    // 添加时间线事件（确保各章节时间线一致）
    if let Some(ref tl) = timeline {
        prompt.push_str(&format!(
            r#"【重要：时间线事件 - 必须严格遵守】
以下是本小说的时间线，生成内容时必须保持时间顺序一致，不得与已发生的事件冲突：

{}

"#, tl));
    }
    
    // 如果有角色信息，添加角色设定
    if let Some(ref chars) = charactersInfo {
        prompt.push_str(&format!(
            r#"【重要：角色设定 - 必须严格遵守】
以下是本小说的角色设定，生成内容时必须保持角色身份、性格、背景完全一致，不得擅自更改：

{}

"#, chars));
    }
    
    if is_continue {
        // 续写模式
        prompt.push_str(&format!(
            r#"请续写以下小说章节内容。

章节标题：{}
本章目标：{}

【已有内容结尾】
{}

请注意：
1. 自然衔接上文，不要重复已有内容
2. 继续推进剧情发展
3. 本次续写约{}字
4. 保持文风和节奏一致
5. 【重要】必须严格遵守上述世界观设定、时间线和角色设定，不得与之冲突
6. 不要使用markdown格式，直接输出小说正文

请直接续写内容，不要添加任何说明或标记："#,
            chapterTitle, 
            outlineGoal,
            currentContent.as_deref().unwrap_or("（无）"),
            word_target
        ));
    } else {
        // 新章节生成模式
        prompt.push_str(&format!(
            r#"请撰写以下章节：

章节标题：{}
本章目标：{}
核心冲突：{}
"#,
            chapterTitle, outlineGoal, conflict
        ));

        // 添加前一章的上下文，确保连贯性
        if let Some(ref summary) = previousSummary {
            prompt.push_str(&format!(r#"
【前一章结尾内容】（请自然衔接，不要重复）
{}

"#, summary));
        }

        prompt.push_str(&format!(r#"
写作要求：
1. 本次生成约{}字
2. 【重要】必须严格遵守世界观设定、时间线和角色设定，不得与之冲突
3. 场景描写要有画面感
4. 对话要自然生动，符合角色性格
5. 如果有前一章内容，请自然衔接，不要突兀
6. 不要使用markdown格式，直接输出小说正文

请直接开始撰写章节内容："#, word_target));
    }

    let system_prompt = r#"你是一位优秀的小说作者。你的任务是根据大纲和章节目标，撰写引人入胜的章节内容。

【最重要的规则 - 必须严格遵守】
1. 世界观一致性：如果用户提供了世界观设定（时代背景、地理环境、社会结构、特殊规则、势力分布），你必须严格遵守，不得创造与设定矛盾的内容。
2. 时间线一致性：如果用户提供了时间线事件，你必须保持时间顺序一致，不得与已发生的历史事件冲突。
3. 角色一致性：如果用户提供了角色设定，你必须严格遵守每个角色的身份、性格、背景和动机，不得擅自更改。

核心原则：
1. 严格按照提供的世界观、时间线、角色设定创作，保持全书一致
2. 叙事连贯性 - 如果提供了前一章内容，必须自然衔接
3. 注重场景描写和画面感
4. 对话要符合人物口吻和性格设定
5. 保持叙述节奏，张弛有度

写作风格：
- 避免AI痕迹（减少"然而"、"不禁"、"心中暗想"等词汇）
- 使用具体细节而非笼统描述
- 展示而非告知（Show, don't tell）
- 保持语言简洁有力
- 不要使用任何markdown格式，输出纯小说正文"#;

    let request_body = serde_json::json!({
        "model": "deepseek-chat",
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": prompt}
        ],
        "temperature": 0.7,
        "max_tokens": 4000,  // 控制在4000 tokens以内，避免中断
        "stream": true
    });

    let response = client
        .post("https://api.deepseek.com/v1/chat/completions")
        .header("Authorization", format!("Bearer {}", deepseekKey))
        .header("Content-Type", "application/json")
        .json(&request_body)
        .send()
        .await
        .map_err(|e| format!("请求失败: {}", e))?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("API错误: {}", error_text));
    }

    let mut full_content = String::new();
    let mut stream = response.bytes_stream();

    while let Some(chunk_result) = stream.next().await {
        if CANCEL_FLAG.load(Ordering::SeqCst) {
            return Err("生成已被用户中断".to_string());
        }

        let chunk = chunk_result.map_err(|e| format!("读取流失败: {}", e))?;
        let chunk_str = String::from_utf8_lossy(&chunk);

        for line in chunk_str.lines() {
            if line.starts_with("data: ") {
                let data = &line[6..];
                if data == "[DONE]" {
                    continue;
                }

                if let Ok(stream_response) = serde_json::from_str::<StreamResponse>(data) {
                    if let Some(choice) = stream_response.choices.first() {
                        if let Some(content) = &choice.delta.content {
                            full_content.push_str(content);
                            let _ = window.emit("chapter-stream", content.clone());
                        }
                    }
                }
            }
        }
    }

    Ok(full_content)
}

/// 生成章节推文（封面图片提示词 + 摘要）
#[derive(Debug, Serialize, Deserialize)]
pub struct ChapterPromoResult {
    pub image_prompt: String,
    pub summary: String,
    pub image_base64: Option<String>,
}

/// 将选中的段落内容转换为专业英文插图提示词
#[tauri::command]
pub async fn generate_illustration_prompt(
    #[allow(non_snake_case)] text: String,
    #[allow(non_snake_case)] style: Option<String>,
    #[allow(non_snake_case)] deepseekKey: String,
) -> Result<String, String> {
    let client = Client::new();
    let clipped_text = if text.chars().count() > 3000 {
        text.chars().take(3000).collect::<String>() + "..."
    } else {
        text
    };
    let style_text = style.unwrap_or_default();
    let style_section = if style_text.trim().is_empty() {
        String::new()
    } else {
        format!(
            r#"
用户指定的图片风格（可能包含中文，请先翻译为英文再使用）：
{}"#,
            style_text
        )
    };

    let prompt = format!(
        r#"你是专业的AI绘图提示词工程师。请根据下面的小说段落，生成**一条高质量、专业、英文**的插图提示词（image prompt），用于书籍插图或章节配图。

要求：
- 必须是英文
- 包含场景、人物、氛围、构图、光线、风格等关键信息
- 语言精炼、专业，适合图像模型
- 不要输出任何解释

{}

段落内容：
{}

请严格按JSON格式输出：
{{"image_prompt": "your English prompt here"}}"#,
        style_section,
        clipped_text
    );

    let request_body = serde_json::json!({
        "model": "deepseek-chat",
        "messages": [
            {
                "role": "system",
                "content": "You are a professional image prompt engineer. Return only JSON with an English image_prompt."
            },
            {
                "role": "user",
                "content": prompt
            }
        ],
        "max_tokens": 400,
        "temperature": 0.6
    });

    let response = client
        .post("https://api.deepseek.com/v1/chat/completions")
        .header("Authorization", format!("Bearer {}", deepseekKey))
        .header("Content-Type", "application/json")
        .json(&request_body)
        .send()
        .await
        .map_err(|e| format!("请求失败: {}", e))?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("API错误: {}", error_text));
    }

    let response_json: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("解析响应失败: {}", e))?;

    let content = response_json["choices"][0]["message"]["content"]
        .as_str()
        .ok_or("无法获取AI响应内容")?;

    // 清理可能的markdown包裹
    let cleaned_content = content
        .trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();

    let result: serde_json::Value = serde_json::from_str(cleaned_content)
        .map_err(|e| format!("解析AI返回的JSON失败: {}。原始内容: {}", e, cleaned_content))?;

    let image_prompt = result["image_prompt"]
        .as_str()
        .unwrap_or("A cinematic book illustration, dramatic lighting, highly detailed")
        .to_string();

    Ok(image_prompt)
}

/// 生成章节摘要和图片提示词（使用DeepSeek）
#[tauri::command]
pub async fn generate_chapter_promo(
    #[allow(non_snake_case)] chapterTitle: String,
    #[allow(non_snake_case)] chapterContent: String,
    #[allow(non_snake_case)] deepseekKey: String,
) -> Result<ChapterPromoResult, String> {
    let client = Client::new();
    
    // 构建提示词：让AI生成摘要和英文图片提示词
    let prompt = format!(
        r#"你是一位专业的小说营销专家。请根据以下章节内容，完成两项任务：

## 章节标题
{}

## 章节内容
{}

---

请完成以下任务：

### 任务1：生成摘要
为这一章生成一段精炼的中文摘要，用于社交媒体推广。要求：
- 字数不超过100字
- 抓住本章最吸引人的看点
- 语言生动有悬念感

### 任务2：生成图片提示词
根据章节内容，生成一段英文图片提示词(image prompt)，用于AI生图。要求：
- 必须是英文
- 描述本章最具代表性的场景或氛围
- 包含画面风格描述（如 cinematic, dramatic lighting, anime style 等）
- 适合作为章节封面使用

请严格按照以下JSON格式返回，不要添加任何其他内容：
{{"summary": "中文摘要内容", "image_prompt": "English image prompt here"}}"#,
        chapterTitle, 
        // 只取前3000字避免超出token限制
        if chapterContent.chars().count() > 3000 {
            chapterContent.chars().take(3000).collect::<String>() + "..."
        } else {
            chapterContent.clone()
        }
    );

    let request_body = serde_json::json!({
        "model": "deepseek-chat",
        "messages": [
            {
                "role": "system",
                "content": "你是一位专业的小说营销专家，擅长提炼故事亮点和创作吸引人的推广文案。请严格按JSON格式返回结果。"
            },
            {
                "role": "user",
                "content": prompt
            }
        ],
        "max_tokens": 500,
        "temperature": 0.7
    });

    let response = client
        .post("https://api.deepseek.com/v1/chat/completions")
        .header("Authorization", format!("Bearer {}", deepseekKey))
        .header("Content-Type", "application/json")
        .json(&request_body)
        .send()
        .await
        .map_err(|e| format!("请求失败: {}", e))?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("API错误: {}", error_text));
    }

    let response_json: serde_json::Value = response.json().await
        .map_err(|e| format!("解析响应失败: {}", e))?;

    let content = response_json["choices"][0]["message"]["content"]
        .as_str()
        .ok_or("无法获取AI响应内容")?;

    // 清理AI返回的内容：去除可能的markdown代码块标记
    let cleaned_content = content
        .trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();

    // 解析JSON响应
    let result: serde_json::Value = serde_json::from_str(cleaned_content)
        .map_err(|e| format!("解析AI返回的JSON失败: {}。原始内容: {}", e, cleaned_content))?;

    let summary = result["summary"]
        .as_str()
        .unwrap_or("摘要生成失败")
        .to_string();
    
    let image_prompt = result["image_prompt"]
        .as_str()
        .unwrap_or("A dramatic scene from a novel, cinematic lighting, high quality illustration")
        .to_string();

    Ok(ChapterPromoResult {
        image_prompt,
        summary,
        image_base64: None,
    })
}

/// 使用Pollinations生成图片
#[tauri::command]
pub async fn generate_promo_image(
    prompt: String,
    width: Option<u32>,
    height: Option<u32>,
    model: Option<String>,
    #[allow(non_snake_case)] pollinationsKey: Option<String>,
) -> Result<String, String> {
    use crate::api::pollinations::{PollinationsClient, ImageGenerationParams};
    
    let client = PollinationsClient::new(pollinationsKey, None);
    
    let params = ImageGenerationParams {
        prompt,
        width: Some(width.unwrap_or(1200)),  // 默认3:1比例
        height: Some(height.unwrap_or(400)),
        seed: Some(-1),
        model: Some(model.unwrap_or_else(|| "zimage".to_string())),
        nologo: Some(true),
        enhance: Some(false),
    };

    client.generate_image_base64(&params).await
        .map_err(|e| format!("图片生成失败: {}", e))
}
