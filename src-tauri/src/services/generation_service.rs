use anyhow::Result;
use crate::api::{DeepSeekClient, PollinationsClient};
use crate::api::deepseek::{GenerationParams, prompts as deepseek_prompts};
use crate::api::pollinations::ImageGenerationParams;

pub struct GenerationService {
    deepseek: Option<DeepSeekClient>,
    pollinations: Option<PollinationsClient>,
    text_temperature: Option<f32>,
}

impl GenerationService {
    pub fn new(
        deepseek_key: Option<String>,
        pollinations_key: Option<String>,
    ) -> Self {
        Self::new_with_text_config(deepseek_key, None, None, None, pollinations_key)
    }

    pub fn new_with_text_config(
        deepseek_key: Option<String>,
        deepseek_base_url: Option<String>,
        deepseek_model: Option<String>,
        text_temperature: Option<f32>,
        pollinations_key: Option<String>,
    ) -> Self {
        let deepseek = deepseek_key.map(|key| {
            DeepSeekClient::new(key, deepseek_base_url.clone(), deepseek_model.clone())
        });
        let pollinations = Some(PollinationsClient::new(pollinations_key, None));

        Self {
            deepseek,
            pollinations,
            text_temperature: text_temperature.map(|v| v.clamp(0.0, 2.0)),
        }
    }

    fn effective_temperature(&self, default: f32) -> f32 {
        self.text_temperature.unwrap_or(default).clamp(0.0, 2.0)
    }

    pub async fn test_deepseek(&self) -> Result<bool> {
        if let Some(ref client) = self.deepseek {
            client.test_connection().await
        } else {
            Err(anyhow::anyhow!("DeepSeek client not configured"))
        }
    }

    pub async fn test_pollinations(&self) -> Result<bool> {
        if let Some(ref client) = self.pollinations {
            client.test_connection().await
        } else {
            Err(anyhow::anyhow!("Pollinations client not configured"))
        }
    }

    pub async fn generate_outline(
        &self,
        title: &str,
        genre: &str,
        description: &str,
        target_chapters: u32,
    ) -> Result<String> {
        let client = self.deepseek.as_ref()
            .ok_or_else(|| anyhow::anyhow!("DeepSeek not configured"))?;

        let prompt = format!(
            r#"请为以下小说创建详细大纲：

书名：{}
题材：{}
简介：{}
目标章节数：{}

请生成包含以下内容的大纲：
1. 故事梗概（200字左右）
2. 核心冲突
3. 主要角色（3-5个，含简介和动机）
4. 三幕结构规划
5. 每章大纲（包含章节标题、目标、冲突点、信息增量）

请以结构化的方式输出，便于后续处理。"#,
            title, genre, description, target_chapters
        );

        let params = GenerationParams {
            temperature: Some(self.effective_temperature(0.8)),
            max_tokens: Some(4000),
            system_prompt: Some(deepseek_prompts::outline_system_prompt()),
        };

        let (content, usage) = client.generate_text(&prompt, Some(params)).await?;
        
        if let Some(usage) = usage {
            log::info!("Outline generation used {} tokens", usage.total_tokens);
        }

        Ok(content)
    }

    pub async fn generate_chapter(
        &self,
        chapter_title: &str,
        outline_goal: &str,
        conflict: &str,
        previous_summary: Option<&str>,
        character_info: Option<&str>,
        world_info: Option<&str>,
    ) -> Result<String> {
        let client = self.deepseek.as_ref()
            .ok_or_else(|| anyhow::anyhow!("DeepSeek not configured"))?;

        let mut prompt = format!(
            r#"请撰写以下章节：

章节标题：{}
本章目标：{}
核心冲突：{}
"#,
            chapter_title, outline_goal, conflict
        );

        if let Some(summary) = previous_summary {
            prompt.push_str(&format!("\n前情提要：\n{}\n", summary));
        }

        if let Some(chars) = character_info {
            prompt.push_str(&format!("\n人物信息：\n{}\n", chars));
        }

        if let Some(world) = world_info {
            prompt.push_str(&format!("\n世界观：\n{}\n", world));
        }

        prompt.push_str("\n请撰写完整章节内容（3000-5000字），注意：\n");
        prompt.push_str("1. 保持人物性格一致\n");
        prompt.push_str("2. 场景描写要有画面感\n");
        prompt.push_str("3. 对话要自然生动\n");
        prompt.push_str("4. 章节结尾留悬念\n");

        let params = GenerationParams {
            temperature: Some(self.effective_temperature(0.7)),
            max_tokens: Some(6000),
            system_prompt: Some(deepseek_prompts::chapter_system_prompt()),
        };

        let (content, usage) = client.generate_text(&prompt, Some(params)).await?;
        
        if let Some(usage) = usage {
            log::info!("Chapter generation used {} tokens", usage.total_tokens);
        }

        Ok(content)
    }

    pub async fn generate_prologue(
        &self,
        title: &str,
        genre: &str,
        outline: &str,
    ) -> Result<String> {
        let client = self.deepseek.as_ref()
            .ok_or_else(|| anyhow::anyhow!("DeepSeek not configured"))?;

        let prompt = format!(
            r#"请根据以下小说大纲生成一篇序章（引子），要求：
1. 与整体故事风格一致，能快速建立世界观与氛围
2. 为后续主线埋下伏笔或引出核心冲突
3. 输出中文小说正文，不使用任何 Markdown
4. 字数约 800-1500 字

书名：{}
题材：{}

小说大纲：
{}"#,
            title, genre, outline
        );

        let params = GenerationParams {
            temperature: Some(self.effective_temperature(0.7)),
            max_tokens: Some(2000),
            system_prompt: Some(deepseek_prompts::chapter_system_prompt()),
        };

        let (content, _) = client.generate_text(&prompt, Some(params)).await?;
        Ok(content)
    }

    pub async fn generate_revision(&self, original_text: &str, revision_goals: &str) -> Result<String> {
        let client = self.deepseek.as_ref()
            .ok_or_else(|| anyhow::anyhow!("DeepSeek not configured"))?;

        let prompt = format!(
            r#"请润色以下文本：

修订目标：
{}

原文：
{}

请输出改进后的版本。"#,
            revision_goals, original_text
        );

        let params = GenerationParams {
            temperature: Some(self.effective_temperature(0.5)),
            max_tokens: Some(6000),
            system_prompt: Some(deepseek_prompts::revision_system_prompt()),
        };

        let (content, _) = client.generate_text(&prompt, Some(params)).await?;
        Ok(content)
    }

    pub async fn generate_tweet(&self, chapter_content: &str) -> Result<String> {
        let client = self.deepseek.as_ref()
            .ok_or_else(|| anyhow::anyhow!("DeepSeek not configured"))?;

        let prompt = format!(
            r#"请为以下章节创建推文内容：

章节内容：
{}

请输出：
1. 标题（吸引眼球）
2. 摘要（50-100字）
3. 金句（可引用的片段）
4. 悬念钩子（引导读者继续）"#,
            chapter_content
        );

        let params = GenerationParams {
            temperature: Some(self.effective_temperature(0.8)),
            max_tokens: Some(1000),
            system_prompt: Some(deepseek_prompts::tweet_system_prompt()),
        };

        let (content, _) = client.generate_text(&prompt, Some(params)).await?;
        Ok(content)
    }

    pub async fn generate_image(&self, params: ImageGenerationParams, save_path: &str) -> Result<String> {
        let client = self.pollinations.as_ref()
            .ok_or_else(|| anyhow::anyhow!("Pollinations not configured"))?;

        client.generate_and_download(&params, save_path).await
    }

    pub fn generate_image_url(&self, params: &ImageGenerationParams) -> Result<String> {
        let client = self.pollinations.as_ref()
            .ok_or_else(|| anyhow::anyhow!("Pollinations not configured"))?;

        client.generate_image_url(params)
    }
}
