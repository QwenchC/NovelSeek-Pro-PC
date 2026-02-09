use crate::api::pollinations::ImageGenerationParams;
use crate::models::TextModelConfigInput;
use crate::services::GenerationService;
use reqwest::Client;
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

#[derive(Debug, Serialize, Deserialize)]
pub struct GenerateCharacterAppearanceInput {
    pub name: String,
    pub role: Option<String>,
    pub personality: Option<String>,
    pub background: Option<String>,
    pub motivation: Option<String>,
    pub style: Option<String>,
    pub text_config: TextModelConfigInput,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CharacterAppearanceResult {
    pub appearance: String,
    pub image_prompt: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GenerateCharacterPortraitPromptInput {
    pub name: String,
    pub appearance: Option<String>,
    pub role: Option<String>,
    pub personality: Option<String>,
    pub background: Option<String>,
    pub motivation: Option<String>,
    pub style: Option<String>,
    pub text_config: TextModelConfigInput,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CharacterPortraitPromptResult {
    pub image_prompt: String,
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
pub async fn generate_character_appearance(
    input: GenerateCharacterAppearanceInput,
) -> Result<CharacterAppearanceResult, String> {
    input.text_config.validate()?;
    let client = Client::new();
    let api_url = input.text_config.chat_completions_url();
    let temperature = input.text_config.normalized_temperature(0.7);
    let style = input.style.unwrap_or_default();

    let prompt = format!(
        r#"你是一位专业的小说人物设定师和 AI 生图提示词工程师。

请基于以下角色信息完成两项任务：
1) 生成中文“形象”描述（40~120字，具体，可用于小说人设）
2) 生成英文“一寸证件照风格”图像提示词（image_prompt）

角色名称：{}
身份：{}
性格：{}
背景：{}
动机：{}
用户偏好风格（可能是中文，请先理解再转成英文风格词）：{}

输出要求：
- 严格输出 JSON
- 不要输出任何额外解释
- JSON 结构如下：
{{"appearance":"中文形象文本","image_prompt":"English prompt"}}
"#,
        input.name.trim(),
        input.role.unwrap_or_default().trim(),
        input.personality.unwrap_or_default().trim(),
        input.background.unwrap_or_default().trim(),
        input.motivation.unwrap_or_default().trim(),
        style.trim()
    );

    let request_body = serde_json::json!({
        "model": input.text_config.model,
        "messages": [
            {
                "role": "system",
                "content": "You are a character designer and image prompt engineer. Return JSON only."
            },
            {
                "role": "user",
                "content": prompt
            }
        ],
        "temperature": temperature,
        "max_tokens": 500
    });

    let response = client
        .post(&api_url)
        .header("Authorization", format!("Bearer {}", input.text_config.api_key))
        .header("Content-Type", "application/json")
        .json(&request_body)
        .send()
        .await
        .map_err(|e| format!("请求失败: {}", e))?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("API 错误: {}", error_text));
    }

    let response_json: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("解析响应失败: {}", e))?;

    let content = response_json["choices"][0]["message"]["content"]
        .as_str()
        .ok_or("无法获取 AI 响应内容")?;

    let cleaned_content = content
        .trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();

    let result: serde_json::Value = serde_json::from_str(cleaned_content)
        .map_err(|e| format!("解析 AI 返回 JSON 失败: {}。原始内容: {}", e, cleaned_content))?;

    let appearance = result["appearance"].as_str().unwrap_or("").trim().to_string();
    let image_prompt = result["image_prompt"]
        .as_str()
        .unwrap_or("studio portrait, one-inch ID photo, clean background, realistic, high detail")
        .trim()
        .to_string();

    if appearance.is_empty() {
        return Err("AI 未返回有效的人物形象文本".to_string());
    }

    Ok(CharacterAppearanceResult {
        appearance,
        image_prompt,
    })
}

#[tauri::command]
pub async fn generate_character_portrait_prompt(
    input: GenerateCharacterPortraitPromptInput,
) -> Result<CharacterPortraitPromptResult, String> {
    input.text_config.validate()?;
    let client = Client::new();
    let api_url = input.text_config.chat_completions_url();
    let temperature = input.text_config.normalized_temperature(0.6);
    let style = input.style.unwrap_or_default();

    let prompt = format!(
        r#"你是专业的 AI 人像提示词工程师。请基于以下信息，生成一条用于人物“一寸证件照”风格的英文提示词。

角色名称：{}
形象描述：{}
身份：{}
性格：{}
背景：{}
动机：{}
用户偏好风格（可能是中文，请先转换为英文风格词后再融合）：{}

要求：
- 输出必须是英文提示词（image_prompt）
- 适合人像特写、一寸照构图、清晰面部细节
- 不要输出解释
- 严格输出 JSON：{{"image_prompt":"English prompt"}}
"#,
        input.name.trim(),
        input.appearance.unwrap_or_default().trim(),
        input.role.unwrap_or_default().trim(),
        input.personality.unwrap_or_default().trim(),
        input.background.unwrap_or_default().trim(),
        input.motivation.unwrap_or_default().trim(),
        style.trim()
    );

    let request_body = serde_json::json!({
        "model": input.text_config.model,
        "messages": [
            {
                "role": "system",
                "content": "You are a professional portrait prompt engineer. Return JSON only."
            },
            {
                "role": "user",
                "content": prompt
            }
        ],
        "temperature": temperature,
        "max_tokens": 300
    });

    let response = client
        .post(&api_url)
        .header("Authorization", format!("Bearer {}", input.text_config.api_key))
        .header("Content-Type", "application/json")
        .json(&request_body)
        .send()
        .await
        .map_err(|e| format!("请求失败: {}", e))?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("API 错误: {}", error_text));
    }

    let response_json: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("解析响应失败: {}", e))?;

    let content = response_json["choices"][0]["message"]["content"]
        .as_str()
        .ok_or("无法获取 AI 响应内容")?;

    let cleaned_content = content
        .trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();

    let result: serde_json::Value = serde_json::from_str(cleaned_content)
        .map_err(|e| format!("解析 AI 返回 JSON 失败: {}。原始内容: {}", e, cleaned_content))?;

    let image_prompt = result["image_prompt"]
        .as_str()
        .unwrap_or("studio portrait, one-inch ID photo, clean background, realistic, high detail")
        .trim()
        .to_string();

    if image_prompt.is_empty() {
        return Err("AI 未返回有效的人像提示词".to_string());
    }

    Ok(CharacterPortraitPromptResult { image_prompt })
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
