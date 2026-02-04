use crate::services::GenerationService;
use crate::api::pollinations::ImageGenerationParams;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct GenerateOutlineInput {
    pub title: String,
    pub genre: String,
    pub description: String,
    pub target_chapters: u32,
    pub deepseek_key: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GenerateChapterInput {
    pub chapter_title: String,
    pub outline_goal: String,
    pub conflict: String,
    pub previous_summary: Option<String>,
    pub character_info: Option<String>,
    pub world_info: Option<String>,
    pub deepseek_key: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GenerateImageInput {
    pub params: ImageGenerationParams,
    pub save_path: String,
    pub pollinations_key: Option<String>,
}

#[tauri::command]
pub async fn generate_outline(input: GenerateOutlineInput) -> Result<String, String> {
    let service = GenerationService::new(Some(input.deepseek_key), None);
    
    service
        .generate_outline(&input.title, &input.genre, &input.description, input.target_chapters)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn generate_chapter(input: GenerateChapterInput) -> Result<String, String> {
    let service = GenerationService::new(Some(input.deepseek_key), None);
    
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
pub async fn test_deepseek_connection(api_key: String) -> Result<bool, String> {
    let service = GenerationService::new(Some(api_key), None);
    service.test_deepseek().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn test_pollinations_connection(api_key: Option<String>) -> Result<bool, String> {
    let service = GenerationService::new(None, api_key);
    service.test_pollinations().await.map_err(|e| e.to_string())
}
