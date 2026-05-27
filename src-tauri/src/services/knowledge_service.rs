use anyhow::{anyhow, Result};
use chrono::Utc;
use sqlx::SqlitePool;
use std::collections::HashSet;
use uuid::Uuid;

use crate::api::EmbeddingClient;
use crate::services::{EntityService, SummaryService};

pub struct KnowledgeService;

pub struct IndexResult {
    pub chunks_indexed: usize,
    pub skipped: bool,
}

/// Target chunk size in characters. Tuned for Chinese novel prose:
/// ~450 chars ≈ 1 short scene beat, fits comfortably in any embedding context window,
/// and yields ~6-8 chunks per 3000-char chapter (good retrieval granularity).
const TARGET_CHUNK_CHARS: usize = 450;
const MAX_CHUNK_CHARS: usize = 900;
const MIN_TAIL_CHARS: usize = 80;

impl KnowledgeService {
    // ── chunking ────────────────────────────────────────────────

    pub fn chunk_text(text: &str) -> Vec<String> {
        let text = text.trim();
        if text.is_empty() {
            return Vec::new();
        }

        // Split by paragraphs first. Prefer double newlines; fall back to single newlines
        // (some inputs are flat one-paragraph-per-line).
        let paragraphs: Vec<String> = if text.contains("\n\n") {
            text.split("\n\n")
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect()
        } else {
            text.split('\n')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect()
        };

        let mut chunks: Vec<String> = Vec::new();
        let mut buf = String::new();
        let mut buf_chars = 0usize;

        for para in paragraphs {
            let para_chars = para.chars().count();

            if para_chars > MAX_CHUNK_CHARS {
                // Flush whatever we've accumulated, then sentence-split this paragraph.
                if !buf.is_empty() {
                    chunks.push(std::mem::take(&mut buf));
                    buf_chars = 0;
                }
                chunks.extend(Self::split_long_paragraph(&para));
                continue;
            }

            if !buf.is_empty() && buf_chars + para_chars > TARGET_CHUNK_CHARS {
                chunks.push(std::mem::take(&mut buf));
                buf_chars = 0;
            }
            if !buf.is_empty() {
                buf.push_str("\n\n");
                buf_chars += 2;
            }
            buf.push_str(&para);
            buf_chars += para_chars;
        }
        if !buf.is_empty() {
            chunks.push(buf);
        }

        // Merge a tiny tail chunk into the previous one.
        if chunks.len() >= 2 {
            let tail_chars = chunks.last().unwrap().chars().count();
            if tail_chars < MIN_TAIL_CHARS {
                let tail = chunks.pop().unwrap();
                if let Some(prev) = chunks.last_mut() {
                    prev.push_str("\n\n");
                    prev.push_str(&tail);
                }
            }
        }

        chunks
    }

    fn split_long_paragraph(text: &str) -> Vec<String> {
        let mut chunks: Vec<String> = Vec::new();
        let mut buf = String::new();
        let mut buf_chars = 0usize;

        let chars: Vec<char> = text.chars().collect();
        for (i, &c) in chars.iter().enumerate() {
            buf.push(c);
            buf_chars += 1;
            let is_terminal = matches!(c, '。' | '！' | '？' | '!' | '?' | '.' | '；' | ';');
            let next_is_closing_quote = chars
                .get(i + 1)
                .map(|&n| matches!(n, '」' | '”' | '\'' | '"' | '』'))
                .unwrap_or(false);

            if buf_chars >= TARGET_CHUNK_CHARS && is_terminal && !next_is_closing_quote {
                chunks.push(std::mem::take(&mut buf));
                buf_chars = 0;
            } else if buf_chars >= MAX_CHUNK_CHARS {
                // Hard cut to avoid runaway long sentences (e.g., dialogue blocks).
                chunks.push(std::mem::take(&mut buf));
                buf_chars = 0;
            }
        }
        if !buf.trim().is_empty() {
            chunks.push(buf);
        }
        chunks
    }

    // ── hashing (FNV-1a 64-bit, plenty for change detection) ────

    pub fn content_hash(text: &str, model: &str) -> String {
        const FNV_OFFSET: u64 = 0xcbf29ce484222325;
        const FNV_PRIME: u64 = 0x100000001b3;
        let mut h: u64 = FNV_OFFSET;
        for b in model.as_bytes() {
            h ^= *b as u64;
            h = h.wrapping_mul(FNV_PRIME);
        }
        h ^= b':' as u64;
        h = h.wrapping_mul(FNV_PRIME);
        for b in text.as_bytes() {
            h ^= *b as u64;
            h = h.wrapping_mul(FNV_PRIME);
        }
        // Also fold in length to defend against length-extension-style collisions on identical prefixes.
        let len_bytes = (text.len() as u64).to_le_bytes();
        for b in len_bytes.iter() {
            h ^= *b as u64;
            h = h.wrapping_mul(FNV_PRIME);
        }
        format!("{:016x}", h)
    }

    // ── BLOB codec ──────────────────────────────────────────────

    pub fn encode_embedding(v: &[f32]) -> Vec<u8> {
        let mut out = Vec::with_capacity(v.len() * 4);
        for x in v {
            out.extend_from_slice(&x.to_le_bytes());
        }
        out
    }

    pub fn decode_embedding(bytes: &[u8]) -> Vec<f32> {
        let n = bytes.len() / 4;
        let mut out = Vec::with_capacity(n);
        for i in 0..n {
            let s = i * 4;
            let arr = [bytes[s], bytes[s + 1], bytes[s + 2], bytes[s + 3]];
            out.push(f32::from_le_bytes(arr));
        }
        out
    }

    // ── cosine similarity ──────────────────────────────────────

    pub fn cosine(a: &[f32], b: &[f32]) -> f32 {
        if a.len() != b.len() || a.is_empty() {
            return 0.0;
        }
        let mut dot = 0.0f32;
        let mut na = 0.0f32;
        let mut nb = 0.0f32;
        for (x, y) in a.iter().zip(b.iter()) {
            dot += x * y;
            na += x * x;
            nb += y * y;
        }
        if na <= 0.0 || nb <= 0.0 {
            return 0.0;
        }
        dot / (na.sqrt() * nb.sqrt())
    }

    // ── indexing ────────────────────────────────────────────────

    pub async fn index_source(
        pool: &SqlitePool,
        embed: &EmbeddingClient,
        project_id: &str,
        source_type: &str,
        source_id: &str,
        text: &str,
        embedding_model: &str,
    ) -> Result<IndexResult> {
        let text = text.trim();
        if text.is_empty() {
            return Ok(IndexResult { chunks_indexed: 0, skipped: false });
        }

        let hash = Self::content_hash(text, embedding_model);

        // Skip if unchanged
        let existing: Option<(String, String)> = sqlx::query_as(
            r#"SELECT content_hash, embedding_model FROM kb_index_state
               WHERE project_id = ? AND source_type = ? AND source_id = ?"#,
        )
        .bind(project_id)
        .bind(source_type)
        .bind(source_id)
        .fetch_optional(pool)
        .await?;

        if let Some((prev_hash, prev_model)) = existing {
            if prev_hash == hash && prev_model == embedding_model {
                return Ok(IndexResult { chunks_indexed: 0, skipped: true });
            }
        }

        let chunks = Self::chunk_text(text);
        if chunks.is_empty() {
            return Ok(IndexResult { chunks_indexed: 0, skipped: false });
        }

        let vectors = embed.embed_batch(&chunks).await?;
        if vectors.len() != chunks.len() {
            return Err(anyhow!(
                "Embed returned {} vectors for {} chunks",
                vectors.len(),
                chunks.len()
            ));
        }
        let dim = vectors.first().map(|v| v.len()).unwrap_or(0);
        if dim == 0 {
            return Err(anyhow!("Embedding returned a zero-dim vector"));
        }

        let now = Utc::now().to_rfc3339();

        let mut tx = pool.begin().await?;

        // Replace any prior chunks for this source.
        sqlx::query(
            "DELETE FROM kb_chunks WHERE project_id = ? AND source_type = ? AND source_id = ?",
        )
        .bind(project_id)
        .bind(source_type)
        .bind(source_id)
        .execute(&mut *tx)
        .await?;

        for (i, (chunk, vec)) in chunks.iter().zip(vectors.iter()).enumerate() {
            let id = format!("kb-{}", Uuid::new_v4());
            let blob = Self::encode_embedding(vec);
            // Rough token estimate (Chinese ≈ 1.5 token/char). Used only for telemetry.
            let token_estimate = (chunk.chars().count() as f32 * 1.5) as i64;

            sqlx::query(
                r#"INSERT INTO kb_chunks
                   (id, project_id, source_type, source_id, chunk_index, text, embedding,
                    embedding_dim, embedding_model, token_count, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"#,
            )
            .bind(id)
            .bind(project_id)
            .bind(source_type)
            .bind(source_id)
            .bind(i as i64)
            .bind(chunk)
            .bind(&blob)
            .bind(vec.len() as i64)
            .bind(embedding_model)
            .bind(token_estimate)
            .bind(&now)
            .execute(&mut *tx)
            .await?;
        }

        sqlx::query(
            r#"INSERT INTO kb_index_state
               (project_id, source_type, source_id, content_hash, embedding_model, indexed_at)
               VALUES (?, ?, ?, ?, ?, ?)
               ON CONFLICT(project_id, source_type, source_id) DO UPDATE SET
                   content_hash = excluded.content_hash,
                   embedding_model = excluded.embedding_model,
                   indexed_at = excluded.indexed_at"#,
        )
        .bind(project_id)
        .bind(source_type)
        .bind(source_id)
        .bind(&hash)
        .bind(embedding_model)
        .bind(&now)
        .execute(&mut *tx)
        .await?;

        tx.commit().await?;

        Ok(IndexResult { chunks_indexed: chunks.len(), skipped: false })
    }

    // ── retrieval ───────────────────────────────────────────────

    /// Retrieve top-K relevant chunks and format them as a prompt-ready string.
    /// `exclude_source_ids` is for skipping sources already covered by the legacy
    /// "last N chapters" context — pass the chapter IDs the prompt already includes.
    ///
    /// If `include_summaries` is true and v2 summaries exist, the book + active arc
    /// summaries are prepended. If `include_foreshadowing` is true, the open
    /// foreshadowing list (v2) is prepended too. These additions are independent —
    /// any subset can be enabled.
    pub async fn retrieve(
        pool: &SqlitePool,
        embed: &EmbeddingClient,
        project_id: &str,
        query: &str,
        top_k: usize,
        exclude_source_ids: &[String],
        include_summaries: bool,
        active_arc_id_for_summary: Option<&str>,
        include_foreshadowing: bool,
        max_recent_chapters: Option<usize>,
    ) -> Result<String> {
        let query = query.trim();
        let mut sections: Vec<String> = Vec::new();

        // ── v2 layer: book + arc summaries ──────────────────────
        if include_summaries {
            if let Ok((book, arc)) =
                SummaryService::load_for_retrieve(pool, project_id, active_arc_id_for_summary).await
            {
                if !book.is_empty() {
                    sections.push(format!("【全书梗概】\n{}", book.trim()));
                }
                if !arc.is_empty() {
                    sections.push(format!("【当前弧线进度】\n{}", arc.trim()));
                }
            }
        }

        // ── v2 layer: open foreshadowing ────────────────────────
        if include_foreshadowing {
            if let Ok(block) = EntityService::load_open_foreshadowing(pool, project_id, 12).await {
                if !block.is_empty() {
                    sections.push(block);
                }
            }
        }

        // ── v1 layer: semantic chunk retrieval ──────────────────
        if !query.is_empty() && top_k > 0 {
            let q_vec = embed.embed_one(query).await?;

            // v2.3 optimization: when project chunk count grows large, only consider
            // chunks belonging to the N most recent chapters. This caps the in-memory
            // cosine scan without needing a vector index.
            let rows: Vec<(String, String, i64, String, Vec<u8>)> = match max_recent_chapters {
                Some(n) if n > 0 => sqlx::query_as(
                    r#"SELECT k.source_type, k.source_id, k.chunk_index, k.text, k.embedding
                       FROM kb_chunks k
                       WHERE k.project_id = ?
                         AND (
                           k.source_type != 'chapter'
                           OR k.source_id IN (
                             SELECT id FROM chapters
                             WHERE project_id = ?
                             ORDER BY order_index DESC
                             LIMIT ?
                           )
                         )"#,
                )
                .bind(project_id)
                .bind(project_id)
                .bind(n as i64)
                .fetch_all(pool)
                .await?,
                _ => sqlx::query_as(
                    r#"SELECT source_type, source_id, chunk_index, text, embedding
                       FROM kb_chunks WHERE project_id = ?"#,
                )
                .bind(project_id)
                .fetch_all(pool)
                .await?,
            };

            if !rows.is_empty() {
                let exclude: HashSet<&str> =
                    exclude_source_ids.iter().map(|s| s.as_str()).collect();

                let mut scored: Vec<(f32, String, String, i64, String)> =
                    Vec::with_capacity(rows.len());
                for (source_type, source_id, chunk_index, text, blob) in rows {
                    if exclude.contains(source_id.as_str()) {
                        continue;
                    }
                    let v = Self::decode_embedding(&blob);
                    if v.len() != q_vec.len() {
                        continue;
                    }
                    let score = Self::cosine(&q_vec, &v);
                    scored.push((score, source_type, source_id, chunk_index, text));
                }

                scored
                    .sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
                let top: Vec<_> = scored.into_iter().take(top_k).collect();

                if !top.is_empty() {
                    let mut chunk_block = String::new();
                    for (i, (score, source_type, source_id, _chunk_index, text)) in
                        top.iter().enumerate()
                    {
                        let label = Self::lookup_source_label(pool, source_type, source_id)
                            .await
                            .unwrap_or_else(|_| source_id.clone());
                        chunk_block.push_str(&format!(
                            "【相关片段 {} | 来自{} | 相关度 {:.2}】\n{}\n\n",
                            i + 1,
                            label,
                            score,
                            text.trim()
                        ));
                    }
                    sections.push(chunk_block.trim_end().to_string());
                }
            }
        }

        Ok(sections.join("\n\n"))
    }

    async fn lookup_source_label(
        pool: &SqlitePool,
        source_type: &str,
        source_id: &str,
    ) -> Result<String> {
        match source_type {
            "chapter" => {
                let row: Option<(String, i32)> = sqlx::query_as(
                    "SELECT title, order_index FROM chapters WHERE id = ?",
                )
                .bind(source_id)
                .fetch_optional(pool)
                .await?;
                Ok(row
                    .map(|(title, idx)| format!("第{}章「{}」", idx, title))
                    .unwrap_or_else(|| source_id.to_string()))
            }
            _ => Ok(source_id.to_string()),
        }
    }

    /// Delete all KB entries for a source. Call this when a chapter is deleted
    /// so stale embeddings don't pollute retrieval.
    pub async fn forget_source(
        pool: &SqlitePool,
        project_id: &str,
        source_type: &str,
        source_id: &str,
    ) -> Result<()> {
        let mut tx = pool.begin().await?;
        sqlx::query(
            "DELETE FROM kb_chunks WHERE project_id = ? AND source_type = ? AND source_id = ?",
        )
        .bind(project_id)
        .bind(source_type)
        .bind(source_id)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "DELETE FROM kb_index_state WHERE project_id = ? AND source_type = ? AND source_id = ?",
        )
        .bind(project_id)
        .bind(source_type)
        .bind(source_id)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chunk_short_text_single_chunk() {
        let chunks = KnowledgeService::chunk_text("短短一段。");
        assert_eq!(chunks.len(), 1);
    }

    #[test]
    fn chunk_paragraphs_grouped() {
        let txt = "段落一。".repeat(20) + "\n\n" + &"段落二。".repeat(20);
        let chunks = KnowledgeService::chunk_text(&txt);
        assert!(chunks.len() >= 1);
        for c in &chunks {
            assert!(c.chars().count() <= MAX_CHUNK_CHARS + 50);
        }
    }

    #[test]
    fn blob_roundtrip() {
        let v = vec![0.1f32, -0.2, 3.14, -0.0, 1e-6];
        let bytes = KnowledgeService::encode_embedding(&v);
        let back = KnowledgeService::decode_embedding(&bytes);
        assert_eq!(v.len(), back.len());
        for (a, b) in v.iter().zip(back.iter()) {
            assert!((a - b).abs() < 1e-9);
        }
    }

    #[test]
    fn cosine_identity() {
        let v = vec![1.0f32, 2.0, 3.0];
        assert!((KnowledgeService::cosine(&v, &v) - 1.0).abs() < 1e-5);
    }

    #[test]
    fn cosine_orthogonal() {
        let a = vec![1.0f32, 0.0];
        let b = vec![0.0f32, 1.0];
        assert!(KnowledgeService::cosine(&a, &b).abs() < 1e-5);
    }

    #[test]
    fn hash_changes_with_content() {
        let h1 = KnowledgeService::content_hash("hello", "model-a");
        let h2 = KnowledgeService::content_hash("hello!", "model-a");
        let h3 = KnowledgeService::content_hash("hello", "model-b");
        assert_ne!(h1, h2);
        assert_ne!(h1, h3);
    }
}
