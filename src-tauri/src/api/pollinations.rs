use reqwest::Client;
use anyhow::Result;
use serde::{Deserialize, Serialize};
use base64::{Engine as _, engine::general_purpose};

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
            seed: Some(-1),  // 随机种子
            model: Some("zimage".to_string()),  // 使用zimage作为默认模型
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
            base_url: base_url.unwrap_or_else(|| "https://gen.pollinations.ai".to_string()),
        }
    }

    pub async fn test_connection(&self) -> Result<bool> {
        // 简单测试：生成一个小图片URL
        let test_url = format!("{}/image/test?width=64&height=64&model=zimage", self.base_url);
        
        let mut request = self.client.head(&test_url);
        if let Some(ref api_key) = self.api_key {
            request = request.header("Authorization", format!("Bearer {}", api_key));
        }
        
        match request.send().await {
            Ok(resp) => Ok(resp.status().is_success() || resp.status().as_u16() == 302),
            Err(e) => {
                log::error!("Pollinations connection test failed: {}", e);
                Err(e.into())
            }
        }
    }

    /// 生成图片URL（新版API格式：/image/{prompt}?params）
    pub fn generate_image_url(&self, params: &ImageGenerationParams) -> Result<String> {
        // URL encode the prompt
        let encoded_prompt = urlencoding::encode(&params.prompt);
        let mut url = format!("{}/image/{}", self.base_url, encoded_prompt);
        
        let mut query_params = Vec::new();
        
        if let Some(ref model) = params.model {
            query_params.push(format!("model={}", model));
        }
        if let Some(width) = params.width {
            query_params.push(format!("width={}", width));
        }
        if let Some(height) = params.height {
            query_params.push(format!("height={}", height));
        }
        if let Some(seed) = params.seed {
            query_params.push(format!("seed={}", seed));
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

    /// 生成图片并返回base64编码（用于前端直接显示）
    pub async fn generate_image_base64(&self, params: &ImageGenerationParams) -> Result<String> {
        let url = self.generate_image_url(params)?;
        
        let mut request = self.client.get(&url)
            .header("Accept", "*/*");
        
        // 添加API key（如果有）
        if let Some(ref api_key) = self.api_key {
            request = request.header("Authorization", format!("Bearer {}", api_key));
        }

        let response = request.send().await?;
        
        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await.unwrap_or_default();
            return Err(anyhow::anyhow!("Pollinations API error ({}): {}", status, error_text));
        }

        let bytes = response.bytes().await?;
        let base64_str = general_purpose::STANDARD.encode(&bytes);
        
        Ok(format!("data:image/png;base64,{}", base64_str))
    }

    /// 下载图片并保存到文件
    pub async fn generate_and_download(&self, params: &ImageGenerationParams, save_path: &str) -> Result<String> {
        let url = self.generate_image_url(params)?;
        
        let mut request = self.client.get(&url)
            .header("Accept", "*/*");
        
        // 添加API key（如果有）
        if let Some(ref api_key) = self.api_key {
            request = request.header("Authorization", format!("Bearer {}", api_key));
        }

        let response = request.send().await?;
        
        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await.unwrap_or_default();
            return Err(anyhow::anyhow!("Pollinations API error ({}): {}", status, error_text));
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
