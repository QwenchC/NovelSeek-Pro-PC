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
- **目标**：本章要完成的剧情目标
- **冲突**：本章的核心冲突或挑战
- **结尾钩子**：吸引读者继续阅读的悬念

### 第2章：章节标题
...

（以此类推，直到第{}章）

请确保：
1. 章节数量严格等于{}章
2. 每章都有明确的剧情推进
3. 章节之间逻辑连贯
4. 角色格式便于系统解析
"#, input.target_chapters, input.target_chapters, input.target_chapters, input.target_chapters));

    let system_prompt = format!(r#"你是一位专业的小说策划师和编剧。你的任务是根据用户提供的题材、风格和要求，创建详细的小说大纲。

【核心要求】
1. 章节数量必须严格等于用户指定的{}章，不能多也不能少
2. 使用标准Markdown格式输出
3. 角色信息必须按照指定格式，便于系统解析

【内容要求】
- 故事主线清晰，核心冲突明确
- 每个主要角色都有完整的设定（身份、性格、背景、动机）
- 三幕结构合理分配剧情节奏
- 每章都有明确目标、冲突和悬念钩子
- 章节之间逻辑连贯，剧情层层递进

【格式要求】
- 使用 ## 作为一级标题
- 使用 ### 作为二级标题（角色名、章节标题）
- 使用 - **字段**：内容 格式列出详细信息
- 确保格式统一，便于程序解析"#, input.target_chapters);

    let request_body = serde_json::json!({
        "model": "deepseek-chat",
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": prompt}
        ],
        "temperature": 0.8,
        "max_tokens": 4000,
        "stream": true
    });

    let response = client
        .post("https://api.deepseek.com/v1/chat/completions")
        .header("Authorization", format!("Bearer {}", input.deepseek_key))
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
        // 检查是否被取消
        if CANCEL_FLAG.load(Ordering::SeqCst) {
            return Err("生成已被用户中断".to_string());
        }

        let chunk = chunk_result.map_err(|e| format!("读取流失败: {}", e))?;
        let chunk_str = String::from_utf8_lossy(&chunk);

        // 处理SSE格式的数据
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
                            // 发送流式事件到前端
                            let _ = window.emit("outline-stream", content.clone());
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
5. 不要使用markdown格式，直接输出小说正文

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
2. 保持人物性格一致
3. 场景描写要有画面感
4. 对话要自然生动
5. 如果有前一章内容，请自然衔接，不要突兀
6. 不要使用markdown格式，直接输出小说正文

请直接开始撰写章节内容："#, word_target));
    }

    let system_prompt = r#"你是一位优秀的小说作者。你的任务是根据大纲和章节目标，撰写引人入胜的章节内容。

核心原则：
1. 保持叙事连贯性 - 如果提供了前一章内容，必须自然衔接
2. 保持人物性格一致
3. 注重场景描写和画面感
4. 对话要符合人物口吻
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
