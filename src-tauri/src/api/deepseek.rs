use serde::{Deserialize, Serialize};
use reqwest::Client;
use anyhow::{Result, anyhow};

#[derive(Debug, Clone)]
pub struct DeepSeekClient {
    client: Client,
    api_key: String,
    base_url: String,
    model: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Serialize)]
struct ChatCompletionRequest {
    model: String,
    messages: Vec<ChatMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_tokens: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    stream: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct ChatCompletionResponse {
    pub id: String,
    pub choices: Vec<Choice>,
    pub usage: Option<Usage>,
}

#[derive(Debug, Deserialize)]
pub struct Choice {
    pub index: u32,
    pub message: ChatMessage,
    pub finish_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct Usage {
    pub prompt_tokens: u32,
    pub completion_tokens: u32,
    pub total_tokens: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenerationParams {
    pub temperature: Option<f32>,
    pub max_tokens: Option<u32>,
    pub system_prompt: Option<String>,
}

impl Default for GenerationParams {
    fn default() -> Self {
        Self {
            temperature: Some(0.7),
            max_tokens: Some(4000),
            system_prompt: None,
        }
    }
}

impl DeepSeekClient {
    pub fn new(api_key: String, base_url: Option<String>, model: Option<String>) -> Self {
        Self {
            client: Client::new(),
            api_key,
            base_url: base_url.unwrap_or_else(|| "https://api.deepseek.com/v1".to_string()),
            model: model.unwrap_or_else(|| "deepseek-chat".to_string()),
        }
    }

    pub async fn test_connection(&self) -> Result<bool> {
        let messages = vec![ChatMessage {
            role: "user".to_string(),
            content: "测试连接".to_string(),
        }];

        match self.chat_completion(messages, None).await {
            Ok(_) => Ok(true),
            Err(e) => {
                log::error!("DeepSeek connection test failed: {}", e);
                Err(e)
            }
        }
    }

    pub async fn chat_completion(
        &self,
        mut messages: Vec<ChatMessage>,
        params: Option<GenerationParams>,
    ) -> Result<ChatCompletionResponse> {
        let params = params.unwrap_or_default();

        // Add system prompt if provided
        if let Some(system_prompt) = params.system_prompt {
            messages.insert(0, ChatMessage {
                role: "system".to_string(),
                content: system_prompt,
            });
        }

        let request = ChatCompletionRequest {
            model: self.model.clone(),
            messages,
            temperature: params.temperature,
            max_tokens: params.max_tokens,
            stream: Some(false),
        };

        let url = format!("{}/chat/completions", self.base_url);
        
        let response = self.client
            .post(&url)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .header("Content-Type", "application/json")
            .json(&request)
            .send()
            .await?;

        if !response.status().is_success() {
            let error_text = response.text().await?;
            return Err(anyhow!("DeepSeek API error: {}", error_text));
        }

        let result = response.json::<ChatCompletionResponse>().await?;
        Ok(result)
    }

    pub async fn generate_text(
        &self,
        prompt: &str,
        params: Option<GenerationParams>,
    ) -> Result<(String, Option<Usage>)> {
        let messages = vec![ChatMessage {
            role: "user".to_string(),
            content: prompt.to_string(),
        }];

        let response = self.chat_completion(messages, params).await?;
        
        let content = response.choices
            .first()
            .ok_or_else(|| anyhow!("No choices in response"))?
            .message
            .content
            .clone();

        Ok((content, response.usage))
    }
}

// Pre-defined prompts for novel generation
pub mod prompts {
    use super::*;

    pub fn outline_system_prompt() -> String {
        r#"你是一位专业的小说策划师和编剧。你的任务是根据用户提供的题材、风格和要求，创建详细的小说大纲。

大纲应该包含：
1. 故事主线和核心冲突
2. 主要角色及其动机
3. 三幕式结构（起因、发展、高潮、结局）
4. 关键转折点和悬念设置
5. 每一章的目标和冲突点

请确保大纲具有：
- 清晰的故事线
- 角色成长弧线
- 节奏控制
- 情感张力"#.to_string()
    }

    pub fn chapter_system_prompt() -> String {
        r#"你是一位优秀的小说作者。你的任务是根据大纲和章节目标，撰写引人入胜的章节内容。

写作要求：
1. 保持人物性格一致
2. 遵循既定的世界观设定
3. 注重场景描写和画面感
4. 对话要符合人物口吻
5. 保持叙述节奏，张弛有度
6. 每章结尾留下悬念或钩子

写作风格：
- 避免AI痕迹（减少"然而"、"不禁"等词汇）
- 使用具体细节而非笼统描述
- 展示而非告知（Show, don't tell）
- 保持语言简洁有力"#.to_string()
    }

    pub fn revision_system_prompt() -> String {
        r#"你是一位专业的文学编辑。你的任务是润色和改进文本，使其更加精炼和有感染力。

润色重点：
1. 消除重复和冗余
2. 增强画面感和代入感
3. 优化对话的真实性
4. 统一叙述风格
5. 修复逻辑漏洞和设定冲突
6. 去除AI写作痕迹

保持原文的：
- 核心情节和人物
- 整体风格和语气
- 关键信息点"#.to_string()
    }

    pub fn tweet_system_prompt() -> String {
        r#"你是一位擅长内容营销的编辑。你的任务是为小说章节创建吸引人的推文内容。

推文要求：
1. 提炼章节核心看点
2. 制造悬念和好奇心
3. 突出情感冲突或反转
4. 适合社交媒体传播
5. 不剧透关键情节

输出格式：
- 标题（吸睛）
- 摘要（50-100字）
- 金句（可引用的精彩片段）
- 悬念钩子（引导读者继续阅读）"#.to_string()
    }
}
