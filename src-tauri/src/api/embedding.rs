use anyhow::{anyhow, Result};
use reqwest::Client;
use serde::{Deserialize, Serialize};

/// OpenAI-compatible embedding client.
///
/// Tested against DashScope (Bailian) `/compatible-mode/v1/embeddings`.
/// Also works with SiliconFlow, Zhipu GLM, OpenAI proper — any provider that
/// implements the `POST /embeddings` shape with `{ model, input, [dimensions] }`.
#[derive(Debug, Clone)]
pub struct EmbeddingClient {
    client: Client,
    api_key: String,
    base_url: String,
    model: String,
    dimensions: Option<u32>,
    batch_size: usize,
}

#[derive(Debug, Serialize)]
struct EmbeddingRequest<'a> {
    model: &'a str,
    input: &'a [String],
    #[serde(skip_serializing_if = "Option::is_none")]
    dimensions: Option<u32>,
    encoding_format: &'static str,
}

#[derive(Debug, Deserialize)]
struct EmbeddingResponse {
    data: Vec<EmbeddingData>,
    #[serde(default)]
    usage: Option<EmbeddingUsage>,
}

#[derive(Debug, Deserialize)]
struct EmbeddingData {
    index: usize,
    embedding: Vec<f32>,
}

#[derive(Debug, Deserialize)]
struct EmbeddingUsage {
    #[serde(default)]
    prompt_tokens: u32,
    #[serde(default)]
    total_tokens: u32,
}

impl EmbeddingClient {
    pub fn new(
        api_key: String,
        base_url: String,
        model: String,
        dimensions: Option<u32>,
    ) -> Self {
        Self {
            client: Client::new(),
            api_key,
            base_url,
            model,
            dimensions,
            // DashScope text-embedding-v3 accepts up to 6 inputs / request; v4 = 10.
            // SiliconFlow / OpenAI accept far more. 6 is the safe lowest-common-denominator.
            batch_size: 6,
        }
    }

    fn embeddings_url(&self) -> String {
        let base = self.base_url.trim().trim_end_matches('/');
        if base.ends_with("/embeddings") {
            base.to_string()
        } else {
            format!("{}/embeddings", base)
        }
    }

    pub async fn test_connection(&self) -> Result<bool> {
        let v = self
            .embed_batch_single(&["connection test".to_string()])
            .await?;
        Ok(v.first().map(|e| !e.is_empty()).unwrap_or(false))
    }

    /// Embed an arbitrary number of texts. Auto-chunks into `batch_size` requests.
    pub async fn embed_batch(&self, texts: &[String]) -> Result<Vec<Vec<f32>>> {
        if texts.is_empty() {
            return Ok(Vec::new());
        }
        let mut out = Vec::with_capacity(texts.len());
        for chunk in texts.chunks(self.batch_size) {
            let part = self.embed_batch_single(chunk).await?;
            out.extend(part);
        }
        Ok(out)
    }

    /// Embed a single text. Convenience wrapper around `embed_batch`.
    pub async fn embed_one(&self, text: &str) -> Result<Vec<f32>> {
        let v = self.embed_batch(&[text.to_string()]).await?;
        v.into_iter()
            .next()
            .ok_or_else(|| anyhow!("Embedding response was empty"))
    }

    async fn embed_batch_single(&self, texts: &[String]) -> Result<Vec<Vec<f32>>> {
        let req = EmbeddingRequest {
            model: &self.model,
            input: texts,
            dimensions: self.dimensions,
            encoding_format: "float",
        };

        let url = self.embeddings_url();
        let resp = self
            .client
            .post(&url)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .header("Content-Type", "application/json")
            .json(&req)
            .send()
            .await
            .map_err(|e| anyhow!("Embedding request failed: {}", e))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(anyhow!("Embedding API error {}: {}", status, body));
        }

        let parsed: EmbeddingResponse = resp
            .json()
            .await
            .map_err(|e| anyhow!("Failed to parse embedding response: {}", e))?;

        let mut data = parsed.data;
        // Some providers don't guarantee order; sort by index to be safe.
        data.sort_by_key(|d| d.index);

        if data.len() != texts.len() {
            return Err(anyhow!(
                "Embedding response count mismatch: expected {}, got {}",
                texts.len(),
                data.len()
            ));
        }

        if let Some(usage) = parsed.usage {
            log::debug!(
                "Embedding usage: prompt={} total={}",
                usage.prompt_tokens,
                usage.total_tokens
            );
        }

        Ok(data.into_iter().map(|d| d.embedding).collect())
    }
}
