use anyhow::{anyhow, Result};
use base64::{engine::general_purpose, Engine as _};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::{Duration, Instant};

/// ComfyUI HTTP client.
/// Submits a hardcoded z-image-turbo workflow with variable
/// positive/negative prompts and image dimensions.
#[derive(Debug, Clone)]
pub struct ComfyUIClient {
    client: Client,
    base_url: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct PromptResponse {
    prompt_id: String,
}

#[derive(Debug, Deserialize)]
struct HistoryOutput {
    images: Vec<HistoryImage>,
}

#[derive(Debug, Deserialize)]
struct HistoryImage {
    filename: String,
    subfolder: String,
    #[serde(rename = "type")]
    image_type: String,
}

impl ComfyUIClient {
    pub fn new(base_url: Option<String>) -> Self {
        let client = Client::builder()
            .timeout(Duration::from_secs(300))
            .connect_timeout(Duration::from_secs(10))
            .build()
            .unwrap_or_else(|_| Client::builder()
                .timeout(Duration::from_secs(300))
                .build()
                .unwrap_or_default());
        Self {
            client,
            base_url: base_url
                .unwrap_or_else(|| "http://localhost:8188".to_string())
                .trim_end_matches('/')
                .to_string(),
        }
    }

    /// Quick health check — ComfyUI exposes GET /system_stats
    pub async fn test_connection(&self) -> Result<bool> {
        let url = format!("{}/system_stats", self.base_url);
        match self.client.get(&url).send().await {
            Ok(resp) => Ok(resp.status().is_success()),
            Err(e) => Err(anyhow!("ComfyUI connection test failed: {}", e)),
        }
    }

    /// Build the ComfyUI API-format prompt for the z-image-turbo workflow.
    /// LoRA node (48) is skipped; UNETLoader connects directly to ModelSamplingAuraFlow.
    fn build_prompt(
        &self,
        positive: &str,
        negative: &str,
        width: u32,
        height: u32,
    ) -> Value {
        let seed: u64 = rand_seed();
        json!({
            // Step 1 – Load models
            "46": {
                "class_type": "UNETLoader",
                "inputs": {
                    "unet_name": "z_image_turbo_bf16.safetensors",
                    "weight_dtype": "default"
                }
            },
            "39": {
                "class_type": "CLIPLoader",
                "inputs": {
                    "clip_name": "qwen_3_4b.safetensors",
                    "type": "lumina2",
                    "device": "default"
                }
            },
            "40": {
                "class_type": "VAELoader",
                "inputs": {
                    "vae_name": "ae.safetensors"
                }
            },
            // Step 2 – Sampling config (shift for AuraFlow-style scheduling)
            "47": {
                "class_type": "ModelSamplingAuraFlow",
                "inputs": {
                    "model": ["46", 0],
                    "shift": 3.0
                }
            },
            // Step 3 – Prompts
            "45": {
                "class_type": "CLIPTextEncode",
                "inputs": {
                    "clip": ["39", 0],
                    "text": positive
                }
            },
            "61": {
                "class_type": "CLIPTextEncode",
                "inputs": {
                    "clip": ["39", 0],
                    "text": negative
                }
            },
            // Step 4 – Latent canvas
            "41": {
                "class_type": "EmptySD3LatentImage",
                "inputs": {
                    "width": width,
                    "height": height,
                    "batch_size": 1
                }
            },
            // KSampler
            "44": {
                "class_type": "KSampler",
                "inputs": {
                    "model": ["47", 0],
                    "positive": ["45", 0],
                    "negative": ["61", 0],
                    "latent_image": ["41", 0],
                    "seed": seed,
                    "steps": 6,
                    "cfg": 1.0,
                    "sampler_name": "dpmpp_2m_sde_gpu",
                    "scheduler": "simple",
                    "denoise": 1.0
                }
            },
            // Decode + Save
            "43": {
                "class_type": "VAEDecode",
                "inputs": {
                    "samples": ["44", 0],
                    "vae": ["40", 0]
                }
            },
            "9": {
                "class_type": "SaveImage",
                "inputs": {
                    "images": ["43", 0],
                    "filename_prefix": "novelseek"
                }
            }
        })
    }

    /// Submit the prompt and return the prompt_id.
    async fn submit_prompt(
        &self,
        positive: &str,
        negative: &str,
        width: u32,
        height: u32,
    ) -> Result<String> {
        let prompt = self.build_prompt(positive, negative, width, height);
        let body = json!({ "prompt": prompt });

        let url = format!("{}/prompt", self.base_url);
        let resp = self
            .client
            .post(&url)
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| anyhow!("ComfyUI /prompt request failed: {}", e))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            // Try to extract a friendly error from ComfyUI's node validation JSON
            if let Ok(json_err) = serde_json::from_str::<Value>(&text) {
                let main_msg = json_err
                    .get("error")
                    .and_then(|e| e.get("message"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let node_detail = json_err
                    .get("node_errors")
                    .and_then(|ne| ne.as_object())
                    .and_then(|obj| obj.values().next())
                    .and_then(|node| node.get("errors"))
                    .and_then(|errs| errs.as_array())
                    .and_then(|arr| arr.first())
                    .and_then(|e| e.get("details"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                if !main_msg.is_empty() {
                    let msg = if node_detail.is_empty() {
                        main_msg.to_string()
                    } else {
                        format!("{} ({})", main_msg, node_detail)
                    };
                    return Err(anyhow!("ComfyUI 节点验证失败: {}", msg));
                }
            }
            return Err(anyhow!("ComfyUI /prompt 错误 ({}): {}", status, text));
        }

        let data: PromptResponse = resp
            .json()
            .await
            .map_err(|e| anyhow!("Failed to parse ComfyUI prompt response: {}", e))?;

        Ok(data.prompt_id)
    }

    /// Poll GET /history/{prompt_id} until the job finishes or times out.
    /// Returns the list of output images.
    async fn poll_until_done(&self, prompt_id: &str) -> Result<Vec<HistoryImage>> {
        let url = format!("{}/history/{}", self.base_url, prompt_id);
        let timeout = Duration::from_secs(300);
        let interval = Duration::from_millis(1500);
        let start = Instant::now();

        loop {
            if start.elapsed() > timeout {
                return Err(anyhow!("ComfyUI job timed out after 5 minutes"));
            }

            let resp = self
                .client
                .get(&url)
                .send()
                .await
                .map_err(|e| anyhow!("ComfyUI /history poll failed: {}", e))?;

            let history: Value = resp
                .json()
                .await
                .map_err(|e| anyhow!("Failed to parse history response: {}", e))?;

            if let Some(entry) = history.get(prompt_id) {
                let status_node = entry.get("status");
                let status_complete = status_node
                    .and_then(|s| s.get("completed"))
                    .and_then(|c| c.as_bool())
                    .unwrap_or(false);

                if status_complete {
                    // Check whether ComfyUI reported an execution error
                    let status_str = status_node
                        .and_then(|s| s.get("status_str"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("success");

                    if status_str == "error" {
                        // Extract the execution_error message from messages array
                        let error_msg = status_node
                            .and_then(|s| s.get("messages"))
                            .and_then(|msgs| msgs.as_array())
                            .and_then(|msgs| {
                                msgs.iter().find_map(|msg| {
                                    let arr = msg.as_array()?;
                                    if arr.first()?.as_str()? == "execution_error" {
                                        let details = arr.get(1)?;
                                        let node_type = details
                                            .get("node_type")
                                            .and_then(|v| v.as_str())
                                            .unwrap_or("unknown");
                                        let exc = details
                                            .get("exception_message")
                                            .and_then(|v| v.as_str())
                                            .unwrap_or("unknown error");
                                        Some(format!("节点 {} 执行失败: {}", node_type, exc))
                                    } else {
                                        None
                                    }
                                })
                            })
                            .unwrap_or_else(|| "ComfyUI 任务执行失败".to_string());
                        return Err(anyhow!("{}", error_msg));
                    }

                    // Extract SaveImage node (9) outputs
                    let images = entry
                        .pointer("/outputs/9/images")
                        .and_then(|v| v.as_array())
                        .map(|arr| {
                            arr.iter()
                                .filter_map(|img| {
                                    let filename =
                                        img.get("filename")?.as_str()?.to_string();
                                    let subfolder =
                                        img.get("subfolder")?.as_str()?.to_string();
                                    let image_type =
                                        img.get("type")?.as_str()?.to_string();
                                    Some(HistoryImage {
                                        filename,
                                        subfolder,
                                        image_type,
                                    })
                                })
                                .collect::<Vec<_>>()
                        })
                        .unwrap_or_default();

                    if images.is_empty() {
                        return Err(anyhow!("ComfyUI 任务完成但无输出图片，请检查 SaveImage 节点（id=9）"));
                    }
                    return Ok(images);
                }
            }

            tokio::time::sleep(interval).await;
        }
    }

    /// Download image bytes from ComfyUI /view endpoint.
    /// Retries up to 3 times to handle stale keep-alive connections (Windows error 10053).
    async fn download_image(&self, img: &HistoryImage) -> Result<Vec<u8>> {
        let url = format!(
            "{}/view?filename={}&subfolder={}&type={}",
            self.base_url,
            urlencoding::encode(&img.filename),
            urlencoding::encode(&img.subfolder),
            urlencoding::encode(&img.image_type),
        );

        let max_retries: u32 = 3;
        let mut last_err = String::new();

        for attempt in 0..max_retries {
            if attempt > 0 {
                tokio::time::sleep(Duration::from_millis(800 * u64::from(attempt))).await;
            }

            let send_result = self.client.get(&url).send().await;
            let resp = match send_result {
                Err(e) => {
                    last_err = e.to_string();
                    continue;
                }
                Ok(r) => r,
            };

            if !resp.status().is_success() {
                return Err(anyhow!("ComfyUI /view error ({})", resp.status()));
            }

            match resp.bytes().await {
                Err(e) => {
                    last_err = e.to_string();
                    continue;
                }
                Ok(bytes) => return Ok(bytes.to_vec()),
            }
        }

        Err(anyhow!("ComfyUI /view request failed after {} retries: {}", max_retries, last_err))
    }

    /// Generate an image and return it as a `data:image/png;base64,...` string.
    pub async fn generate_image_base64(
        &self,
        positive: &str,
        negative: &str,
        width: u32,
        height: u32,
    ) -> Result<String> {
        let prompt_id = self.submit_prompt(positive, negative, width, height).await?;
        let images = self.poll_until_done(&prompt_id).await?;
        let first = images
            .into_iter()
            .next()
            .ok_or_else(|| anyhow!("No output image"))?;
        let bytes = self.download_image(&first).await?;
        let b64 = general_purpose::STANDARD.encode(&bytes);
        // Detect format from magic bytes
        let mime = if bytes.starts_with(b"\x89PNG") {
            "image/png"
        } else if bytes.starts_with(b"\xff\xd8") {
            "image/jpeg"
        } else {
            "image/png"
        };
        Ok(format!("data:{};base64,{}", mime, b64))
    }
}

/// Simple non-crypto random seed using current time.
fn rand_seed() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.subsec_nanos() as u64 ^ d.as_secs().wrapping_mul(6364136223846793005))
        .unwrap_or(12345678)
}
