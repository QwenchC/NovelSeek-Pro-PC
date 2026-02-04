use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc};

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Project {
    pub id: String,
    pub title: String,
    pub author: Option<String>,
    pub genre: Option<String>,
    pub description: Option<String>,
    pub target_word_count: Option<i64>,
    pub current_word_count: i64,
    pub status: String, // draft, in_progress, completed
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateProjectInput {
    pub title: String,
    pub author: Option<String>,
    pub genre: Option<String>,
    pub description: Option<String>,
    pub target_word_count: Option<i64>,
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
