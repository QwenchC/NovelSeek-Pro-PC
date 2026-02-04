use reqwest::Client;
use anyhow::Result;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone)]
pub struct PollinationsClient {
    client: Client,
    api_key: Option<String>,
    base_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageGenerationParams {
    pub prompt: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub seed: Option<i64>,
    pub model: Option<String>,
    pub nologo: Option<bool>,
    pub enhance: Option<bool>,
}

impl Default for ImageGenerationParams {
    fn default() -> Self {
        Self {
            prompt: String::new(),
            width: Some(1024),
            height: Some(1024),
            seed: None,
            model: Some("flux".to_string()),
            nologo: Some(true),
            enhance: Some(false),
        }
    }
}

impl PollinationsClient {
    pub fn new(api_key: Option<String>, base_url: Option<String>) -> Self {
        Self {
            client: Client::new(),
            api_key,
            base_url: base_url.unwrap_or_else(|| "https://image.pollinations.ai".to_string()),
        }
    }

    pub async fn test_connection(&self) -> Result<bool> {
        let test_params = ImageGenerationParams {
            prompt: "test".to_string(),
            width: Some(512),
            height: Some(512),
            ..Default::default()
        };

        match self.generate_image_url(&test_params) {
            Ok(_) => Ok(true),
            Err(e) => {
                log::error!("Pollinations connection test failed: {}", e);
                Err(e)
            }
        }
    }

    /// Generate image URL (Pollinations uses URL-based API)
    pub fn generate_image_url(&self, params: &ImageGenerationParams) -> Result<String> {
        let mut url = format!("{}/prompt/{}", self.base_url, urlencoding::encode(&params.prompt));
        
        let mut query_params = Vec::new();
        
        if let Some(width) = params.width {
            query_params.push(format!("width={}", width));
        }
        if let Some(height) = params.height {
            query_params.push(format!("height={}", height));
        }
        if let Some(seed) = params.seed {
            query_params.push(format!("seed={}", seed));
        }
        if let Some(ref model) = params.model {
            query_params.push(format!("model={}", model));
        }
        if let Some(nologo) = params.nologo {
            if nologo {
                query_params.push("nologo=true".to_string());
            }
        }
        if let Some(enhance) = params.enhance {
            if enhance {
                query_params.push("enhance=true".to_string());
            }
        }

        if !query_params.is_empty() {
            url.push('?');
            url.push_str(&query_params.join("&"));
        }

        Ok(url)
    }

    /// Download image and save to file
    pub async fn generate_and_download(&self, params: &ImageGenerationParams, save_path: &str) -> Result<String> {
        let url = self.generate_image_url(params)?;
        
        let mut request = self.client.get(&url);
        
        // Add API key if available
        if let Some(ref api_key) = self.api_key {
            request = request.header("Authorization", format!("Bearer {}", api_key));
        }

        let response = request.send().await?;
        
        if !response.status().is_success() {
            let error_text = response.text().await?;
            return Err(anyhow::anyhow!("Pollinations API error: {}", error_text));
        }

        let bytes = response.bytes().await?;
        std::fs::write(save_path, bytes)?;

        Ok(save_path.to_string())
    }
}

/// Pre-defined prompts for novel-related images
pub mod prompts {
    pub fn cover_prompt_template(title: &str, genre: &str, mood: &str) -> String {
        format!(
            "Book cover design for '{}', {} genre, {} mood, professional illustration, high quality, detailed, cinematic lighting, trending on artstation",
            title, genre, mood
        )
    }

    pub fn character_portrait_template(name: &str, description: &str, style: &str) -> String {
        format!(
            "Character portrait of {}, {}, {} art style, detailed face, professional digital art, high quality",
            name, description, style
        )
    }

    pub fn scene_illustration_template(scene_description: &str, mood: &str, style: &str) -> String {
        format!(
            "{}, {} atmosphere, {} art style, detailed illustration, cinematic composition, professional quality",
            scene_description, mood, style
        )
    }

    pub fn social_media_poster_template(hook: &str, visual_elements: &str) -> String {
        format!(
            "Social media poster: '{}', {}, eye-catching design, modern layout, high contrast, professional graphics",
            hook, visual_elements
        )
    }
}
