use crate::api::pollinations::ImageGenerationParams;
use crate::models::TextModelConfigInput;
use crate::services::GenerationService;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct GenerateOutlineInput {
    pub title: String,
    pub genre: String,
    pub description: String,
    pub target_chapters: u32,
    pub text_config: TextModelConfigInput,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GenerateChapterInput {
    pub chapter_title: String,
    pub outline_goal: String,
    pub conflict: String,
    pub previous_summary: Option<String>,
    pub character_info: Option<String>,
    pub world_info: Option<String>,
    pub text_config: TextModelConfigInput,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GenerateImageInput {
    pub params: ImageGenerationParams,
    pub save_path: String,
    pub pollinations_key: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GeneratePrologueInput {
    pub title: String,
    pub genre: String,
    pub outline: String,
    pub text_config: TextModelConfigInput,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GenerateRevisionInput {
    pub text: String,
    pub goals: Option<String>,
    pub text_config: TextModelConfigInput,
}

fn build_text_service(config: &TextModelConfigInput) -> Result<GenerationService, String> {
    config.validate()?;

    Ok(GenerationService::new_with_text_config(
        Some(config.api_key.clone()),
        Some(config.normalized_api_base_url()),
        Some(config.model.clone()),
        Some(config.normalized_temperature(0.7)),
        None,
    ))
}

#[tauri::command]
pub async fn generate_outline(input: GenerateOutlineInput) -> Result<String, String> {
    let service = build_text_service(&input.text_config)?;

    service
        .generate_outline(
            &input.title,
            &input.genre,
            &input.description,
            input.target_chapters,
        )
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn generate_chapter(input: GenerateChapterInput) -> Result<String, String> {
    let service = build_text_service(&input.text_config)?;

    service
        .generate_chapter(
            &input.chapter_title,
            &input.outline_goal,
            &input.conflict,
            input.previous_summary.as_deref(),
            input.character_info.as_deref(),
            input.world_info.as_deref(),
        )
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn generate_image(input: GenerateImageInput) -> Result<String, String> {
    let service = GenerationService::new(None, input.pollinations_key);

    service
        .generate_image(input.params, &input.save_path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn generate_prologue(input: GeneratePrologueInput) -> Result<String, String> {
    let service = build_text_service(&input.text_config)?;

    service
        .generate_prologue(&input.title, &input.genre, &input.outline)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn generate_revision(input: GenerateRevisionInput) -> Result<String, String> {
    let service = build_text_service(&input.text_config)?;
    let goals = input
        .goals
        .unwrap_or_else(|| "润色并保持原意，使表达更自然流畅".to_string());

    service
        .generate_revision(&input.text, &goals)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn test_deepseek_connection(api_key: String) -> Result<bool, String> {
    let service = GenerationService::new(Some(api_key), None);
    service.test_deepseek().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn test_text_connection(text_config: TextModelConfigInput) -> Result<bool, String> {
    let service = build_text_service(&text_config)?;
    service.test_deepseek().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn test_pollinations_connection(api_key: Option<String>) -> Result<bool, String> {
    let service = GenerationService::new(None, api_key);
    service.test_pollinations().await.map_err(|e| e.to_string())
}
