use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc};

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Project {
    pub id: String,
    pub title: String,
    pub author: Option<String>,
    pub genre: Option<String>,
    pub description: Option<String>,
    pub language: String,
    pub target_word_count: Option<i64>,
    pub current_word_count: i64,
    pub status: String, // draft, in_progress, completed
    pub created_at: String,
    pub updated_at: String,
    pub cover_images: Option<String>,
    pub default_cover_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateProjectInput {
    pub title: String,
    pub author: Option<String>,
    pub genre: Option<String>,
    pub description: Option<String>,
    pub language: Option<String>,
    pub target_word_count: Option<i64>,
    pub cover_images: Option<String>,
    pub default_cover_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Chapter {
    pub id: String,
    pub project_id: String,
    pub title: String,
    pub order_index: i32,
    pub outline_goal: Option<String>,
    pub conflict: Option<String>,
    pub twist: Option<String>,
    pub cliffhanger: Option<String>,
    pub draft_text: Option<String>,
    pub final_text: Option<String>,
    pub illustrations: Option<String>,
    pub word_count: i64,
    pub status: String, // draft, review, final
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateChapterInput {
    pub project_id: String,
    pub title: String,
    pub order_index: i32,
    pub outline_goal: Option<String>,
    pub conflict: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateChapterMetaInput {
    pub title: Option<String>,
    pub order_index: Option<i32>,
    pub outline_goal: Option<String>,
    pub conflict: Option<String>,
    pub twist: Option<String>,
    pub cliffhanger: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Character {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub role: Option<String>,
    pub description: Option<String>,
    pub personality: Option<String>,
    pub background: Option<String>,
    pub motivation: Option<String>,
    pub voice_style: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct GenerationTask {
    pub id: String,
    pub project_id: String,
    pub task_type: String, // outline, chapter, image, revision
    pub status: String, // pending, running, completed, failed
    pub input_params: String, // JSON
    pub output_result: Option<String>,
    pub error_message: Option<String>,
    pub token_count: Option<i64>,
    pub cost: Option<f64>,
    pub created_at: String,
    pub completed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Snapshot {
    pub id: String,
    pub target_type: String, // chapter, scene, character
    pub target_id: String,
    pub content: String,
    pub content_hash: String,
    pub note: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiConfig {
    pub deepseek_api_key: Option<String>,
    pub deepseek_base_url: String,
    pub deepseek_model: String,
    pub pollinations_api_key: Option<String>,
    pub pollinations_base_url: String,
}

impl Default for ApiConfig {
    fn default() -> Self {
        Self {
            deepseek_api_key: None,
            deepseek_base_url: "https://api.deepseek.com/v1".to_string(),
            deepseek_model: "deepseek-chat".to_string(),
            pollinations_api_key: None,
            pollinations_base_url: "https://image.pollinations.ai".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextModelConfigInput {
    pub provider: String,
    pub api_key: String,
    pub api_url: String,
    pub model: String,
    pub temperature: f32,
}

impl Default for TextModelConfigInput {
    fn default() -> Self {
        Self {
            provider: "deepseek".to_string(),
            api_key: String::new(),
            api_url: "https://api.deepseek.com/v1".to_string(),
            model: "deepseek-chat".to_string(),
            temperature: 0.7,
        }
    }
}

impl TextModelConfigInput {
    pub fn validate(&self) -> Result<(), String> {
        if self.api_key.trim().is_empty() {
            return Err("API Key 不能为空".to_string());
        }
        if self.api_url.trim().is_empty() {
            return Err("API URL 不能为空".to_string());
        }
        if self.model.trim().is_empty() {
            return Err("模型名称不能为空".to_string());
        }
        if !self.temperature.is_finite() {
            return Err("Temperature 无效".to_string());
        }
        Ok(())
    }

    pub fn normalized_temperature(&self, fallback: f32) -> f32 {
        if self.temperature.is_finite() {
            self.temperature.clamp(0.0, 2.0)
        } else {
            fallback
        }
    }

    pub fn normalized_api_base_url(&self) -> String {
        self.api_url.trim().trim_end_matches('/').to_string()
    }

    pub fn chat_completions_url(&self) -> String {
        let base = self.normalized_api_base_url();
        if base.ends_with("/chat/completions") {
            base
        } else {
            format!("{}/chat/completions", base)
        }
    }
}
