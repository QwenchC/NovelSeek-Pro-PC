use anyhow::{anyhow, Result};
use chrono::Utc;
use sqlx::SqlitePool;
use uuid::Uuid;

use crate::api::deepseek::{prompts as deepseek_prompts, GenerationParams};
use crate::api::{DeepSeekClient, EmbeddingClient};
use crate::services::KnowledgeService;

pub struct SummaryService;

#[derive(Debug, Clone)]
pub struct SummaryRow {
    pub id: String,
    pub scope_type: String,
    pub scope_id: String,
    pub summary_text: String,
    pub is_stale: bool,
    pub word_count: i64,
}

/// Approximate target word counts for each summary tier.
/// Chapter: terse beat sheet; arc: scene-level rollup; book: high-level synopsis.
const CHAPTER_SUMMARY_TARGET_WORDS: usize = 150;
const ARC_SUMMARY_TARGET_WORDS: usize = 500;
const BOOK_SUMMARY_TARGET_WORDS: usize = 1000;

impl SummaryService {
    // ── core write path ────────────────────────────────────────

    /// Upsert a summary, computing embedding alongside.
    async fn upsert_summary(
        pool: &SqlitePool,
        embed: &EmbeddingClient,
        project_id: &str,
        scope_type: &str,
        scope_id: &str,
        summary_text: &str,
        source_hash: &str,
        embedding_model: &str,
    ) -> Result<SummaryRow> {
        let trimmed = summary_text.trim();
        if trimmed.is_empty() {
            return Err(anyhow!("Empty summary text; refusing to upsert"));
        }

        let embedding = embed.embed_one(trimmed).await?;
        let blob = KnowledgeService::encode_embedding(&embedding);
        let dim = embedding.len() as i64;
        let word_count = trimmed.chars().count() as i64;
        let now = Utc::now().to_rfc3339();

        // Read existing id if any (we keep the same id for stable references).
        let existing: Option<(String,)> = sqlx::query_as(
            r#"SELECT id FROM kb_summaries
               WHERE project_id = ? AND scope_type = ? AND scope_id = ?"#,
        )
        .bind(project_id)
        .bind(scope_type)
        .bind(scope_id)
        .fetch_optional(pool)
        .await?;

        let id = existing
            .map(|(i,)| i)
            .unwrap_or_else(|| format!("sum-{}", Uuid::new_v4()));

        sqlx::query(
            r#"INSERT INTO kb_summaries
               (id, project_id, scope_type, scope_id, summary_text, source_hash,
                is_stale, embedding, embedding_dim, embedding_model, word_count, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(project_id, scope_type, scope_id) DO UPDATE SET
                   summary_text = excluded.summary_text,
                   source_hash = excluded.source_hash,
                   is_stale = 0,
                   embedding = excluded.embedding,
                   embedding_dim = excluded.embedding_dim,
                   embedding_model = excluded.embedding_model,
                   word_count = excluded.word_count,
                   updated_at = excluded.updated_at"#,
        )
        .bind(&id)
        .bind(project_id)
        .bind(scope_type)
        .bind(scope_id)
        .bind(trimmed)
        .bind(source_hash)
        .bind(&blob)
        .bind(dim)
        .bind(embedding_model)
        .bind(word_count)
        .bind(&now)
        .bind(&now)
        .execute(pool)
        .await?;

        Ok(SummaryRow {
            id,
            scope_type: scope_type.to_string(),
            scope_id: scope_id.to_string(),
            summary_text: trimmed.to_string(),
            is_stale: false,
            word_count,
        })
    }

    // ── chapter summary ────────────────────────────────────────

    pub async fn generate_chapter_summary(
        pool: &SqlitePool,
        chat: &DeepSeekClient,
        embed: &EmbeddingClient,
        project_id: &str,
        chapter_id: &str,
        chapter_title: &str,
        chapter_text: &str,
        embedding_model: &str,
    ) -> Result<SummaryRow> {
        let text = chapter_text.trim();
        if text.is_empty() {
            return Err(anyhow!("Cannot summarize empty chapter"));
        }

        let source_hash = KnowledgeService::content_hash(text, "chapter-summary-v1");

        // Skip if unchanged
        let existing: Option<(String, i64)> = sqlx::query_as(
            r#"SELECT source_hash, is_stale FROM kb_summaries
               WHERE project_id = ? AND scope_type = 'chapter' AND scope_id = ?"#,
        )
        .bind(project_id)
        .bind(chapter_id)
        .fetch_optional(pool)
        .await?;

        if let Some((prev_hash, is_stale)) = &existing {
            if *prev_hash == source_hash && *is_stale == 0 {
                // Already up-to-date — return existing row.
                let row: (String, String, String, i64, i64) = sqlx::query_as(
                    r#"SELECT id, scope_type, scope_id, is_stale, word_count
                       FROM kb_summaries
                       WHERE project_id = ? AND scope_type = 'chapter' AND scope_id = ?"#,
                )
                .bind(project_id)
                .bind(chapter_id)
                .fetch_one(pool)
                .await?;
                let summary_text: (String,) = sqlx::query_as(
                    "SELECT summary_text FROM kb_summaries WHERE id = ?",
                )
                .bind(&row.0)
                .fetch_one(pool)
                .await?;
                return Ok(SummaryRow {
                    id: row.0,
                    scope_type: row.1,
                    scope_id: row.2,
                    summary_text: summary_text.0,
                    is_stale: row.3 != 0,
                    word_count: row.4,
                });
            }
        }

        let prompt = format!(
            r#"请为以下章节生成简洁的中文情节摘要：

章节标题：{title}
章节正文：
{body}

要求：
1. 字数约 {target} 字
2. 涵盖：人物动作、关键事件、情绪转折、留下的悬念
3. 不要使用 Markdown，纯文本输出
4. 不要复述原文细节，只保留对后续章节生成有价值的信息
5. 直接输出摘要文本，不要前缀（如"摘要："）"#,
            title = chapter_title,
            body = text,
            target = CHAPTER_SUMMARY_TARGET_WORDS,
        );

        let params = GenerationParams {
            temperature: Some(0.3),
            max_tokens: Some(400),
            system_prompt: Some("你是一位严谨的小说编辑，擅长提炼情节要点。".to_string()),
        };

        let (summary_text, _) = chat.generate_text(&prompt, Some(params)).await?;

        Self::upsert_summary(
            pool,
            embed,
            project_id,
            "chapter",
            chapter_id,
            &summary_text,
            &source_hash,
            embedding_model,
        )
        .await
    }

    // ── arc summary ────────────────────────────────────────────

    pub async fn generate_arc_summary(
        pool: &SqlitePool,
        chat: &DeepSeekClient,
        embed: &EmbeddingClient,
        project_id: &str,
        arc_id: &str,
        arc_title: &str,
        arc_description: &str,
        chapter_ids: &[String],
        embedding_model: &str,
    ) -> Result<SummaryRow> {
        if chapter_ids.is_empty() {
            return Err(anyhow!("Arc has no chapters to summarize"));
        }

        // Load per-chapter summaries. If a chapter has no summary yet, fall back
        // to its first 600 chars (better than nothing — the arc rollup is still useful).
        let mut chapter_inputs: Vec<String> = Vec::new();
        for cid in chapter_ids {
            let row: Option<(String, String, Option<String>)> = sqlx::query_as(
                r#"SELECT c.title, c.order_index, s.summary_text
                   FROM chapters c
                   LEFT JOIN kb_summaries s
                     ON s.project_id = c.project_id
                        AND s.scope_type = 'chapter'
                        AND s.scope_id = c.id
                   WHERE c.id = ?"#,
            )
            .bind(cid)
            .fetch_optional(pool)
            .await?;
            if let Some((title, order_index, summary_opt)) = row {
                if let Some(s) = summary_opt {
                    chapter_inputs.push(format!("[第{}章 {}]\n{}", order_index, title, s));
                } else {
                    let raw: Option<(Option<String>, Option<String>)> = sqlx::query_as(
                        "SELECT final_text, draft_text FROM chapters WHERE id = ?",
                    )
                    .bind(cid)
                    .fetch_optional(pool)
                    .await?;
                    if let Some((ft, dt)) = raw {
                        let body = ft.or(dt).unwrap_or_default();
                        let truncated: String = body.chars().take(600).collect();
                        if !truncated.trim().is_empty() {
                            chapter_inputs.push(format!(
                                "[第{}章 {}（开头节选）]\n{}",
                                order_index, title, truncated
                            ));
                        }
                    }
                }
            }
        }

        if chapter_inputs.is_empty() {
            return Err(anyhow!("Arc has no usable chapter content"));
        }

        let joined = chapter_inputs.join("\n\n");
        let source_hash = KnowledgeService::content_hash(&joined, "arc-summary-v1");

        let prompt = format!(
            r#"请整合以下章节材料，生成此剧情弧线的中文整体摘要：

弧线标题：{title}
弧线设定：{desc}

包含章节摘要：
{material}

要求：
1. 字数约 {target} 字
2. 提炼弧线的主要冲突、阶段性进展、关键转折、未解之事
3. 不要分章节复述，给出一段完整连贯的叙述性摘要
4. 不使用 Markdown，纯文本输出
5. 直接输出摘要正文，不要任何前缀"#,
            title = arc_title,
            desc = arc_description,
            material = joined,
            target = ARC_SUMMARY_TARGET_WORDS,
        );

        let params = GenerationParams {
            temperature: Some(0.4),
            max_tokens: Some(1200),
            system_prompt: Some("你是一位严谨的小说编辑，擅长整合剧情线索。".to_string()),
        };

        let (summary_text, _) = chat.generate_text(&prompt, Some(params)).await?;

        Self::upsert_summary(
            pool,
            embed,
            project_id,
            "arc",
            arc_id,
            &summary_text,
            &source_hash,
            embedding_model,
        )
        .await
    }

    // ── book summary ───────────────────────────────────────────

    pub async fn generate_book_summary(
        pool: &SqlitePool,
        chat: &DeepSeekClient,
        embed: &EmbeddingClient,
        project_id: &str,
        book_title: &str,
        book_description: &str,
        embedding_model: &str,
    ) -> Result<SummaryRow> {
        // Prefer arc summaries; if none, fall back to chapter summaries.
        let arc_rows: Vec<(String, String)> = sqlx::query_as(
            r#"SELECT scope_id, summary_text FROM kb_summaries
               WHERE project_id = ? AND scope_type = 'arc'
               ORDER BY updated_at ASC"#,
        )
        .bind(project_id)
        .fetch_all(pool)
        .await?;

        let material = if !arc_rows.is_empty() {
            arc_rows
                .iter()
                .map(|(arc_id, txt)| format!("[弧线 {}]\n{}", arc_id, txt))
                .collect::<Vec<_>>()
                .join("\n\n")
        } else {
            let chapter_rows: Vec<(String, String, i64)> = sqlx::query_as(
                r#"SELECT s.scope_id, s.summary_text, c.order_index
                   FROM kb_summaries s
                   JOIN chapters c ON c.id = s.scope_id
                   WHERE s.project_id = ? AND s.scope_type = 'chapter'
                   ORDER BY c.order_index ASC"#,
            )
            .bind(project_id)
            .fetch_all(pool)
            .await?;
            if chapter_rows.is_empty() {
                return Err(anyhow!(
                    "No chapter or arc summaries available; build chapter summaries first"
                ));
            }
            chapter_rows
                .iter()
                .map(|(_, txt, idx)| format!("[第{}章]\n{}", idx, txt))
                .collect::<Vec<_>>()
                .join("\n\n")
        };

        let source_hash = KnowledgeService::content_hash(&material, "book-summary-v1");

        let prompt = format!(
            r#"请基于以下素材生成本书迄今为止的整体梗概（"全书梗概"）：

书名：{title}
立意 / 简介：{desc}

素材（已完成章节 / 弧线的摘要）：
{material}

要求：
1. 字数约 {target} 字
2. 给读者补完世界观、主线推进、核心人物的当前状态、尚未解决的关键悬念
3. 不分章节、不分弧线地讲述，写成一篇紧凑的叙述性梗概
4. 不使用 Markdown，纯文本输出
5. 直接输出梗概正文，不要任何前缀"#,
            title = book_title,
            desc = book_description,
            material = material,
            target = BOOK_SUMMARY_TARGET_WORDS,
        );

        let params = GenerationParams {
            temperature: Some(0.4),
            max_tokens: Some(2500),
            system_prompt: Some(deepseek_prompts::outline_system_prompt()),
        };

        let (summary_text, _) = chat.generate_text(&prompt, Some(params)).await?;

        Self::upsert_summary(
            pool,
            embed,
            project_id,
            "book",
            "",
            &summary_text,
            &source_hash,
            embedding_model,
        )
        .await
    }

    // ── stale marking & retrieval helpers ──────────────────────

    /// Mark all arc + book summaries for the project as stale.
    /// Called when any chapter is updated — coarse but cheap.
    pub async fn mark_rollups_stale(pool: &SqlitePool, project_id: &str) -> Result<()> {
        sqlx::query(
            r#"UPDATE kb_summaries SET is_stale = 1
               WHERE project_id = ? AND scope_type IN ('arc', 'book')"#,
        )
        .bind(project_id)
        .execute(pool)
        .await?;
        Ok(())
    }

    /// Load book summary + (optionally) an arc summary, for prompt prepending.
    /// Returns (book_summary, arc_summary). Empty strings if absent.
    pub async fn load_for_retrieve(
        pool: &SqlitePool,
        project_id: &str,
        active_arc_id: Option<&str>,
    ) -> Result<(String, String)> {
        let book: Option<(String,)> = sqlx::query_as(
            r#"SELECT summary_text FROM kb_summaries
               WHERE project_id = ? AND scope_type = 'book' AND scope_id = ''"#,
        )
        .bind(project_id)
        .fetch_optional(pool)
        .await?;

        let arc: Option<(String,)> = if let Some(arc_id) = active_arc_id {
            sqlx::query_as(
                r#"SELECT summary_text FROM kb_summaries
                   WHERE project_id = ? AND scope_type = 'arc' AND scope_id = ?"#,
            )
            .bind(project_id)
            .bind(arc_id)
            .fetch_optional(pool)
            .await?
        } else {
            None
        };

        Ok((
            book.map(|(s,)| s).unwrap_or_default(),
            arc.map(|(s,)| s).unwrap_or_default(),
        ))
    }

    /// List all summaries for a project (UI inspection).
    pub async fn list_for_project(
        pool: &SqlitePool,
        project_id: &str,
    ) -> Result<Vec<SummaryRow>> {
        let rows: Vec<(String, String, String, String, i64, i64)> = sqlx::query_as(
            r#"SELECT id, scope_type, scope_id, summary_text, is_stale, word_count
               FROM kb_summaries WHERE project_id = ?
               ORDER BY scope_type, updated_at DESC"#,
        )
        .bind(project_id)
        .fetch_all(pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(|(id, st, sid, txt, stale, wc)| SummaryRow {
                id,
                scope_type: st,
                scope_id: sid,
                summary_text: txt,
                is_stale: stale != 0,
                word_count: wc,
            })
            .collect())
    }

    pub async fn forget_summary(
        pool: &SqlitePool,
        project_id: &str,
        scope_type: &str,
        scope_id: &str,
    ) -> Result<()> {
        sqlx::query(
            r#"DELETE FROM kb_summaries
               WHERE project_id = ? AND scope_type = ? AND scope_id = ?"#,
        )
        .bind(project_id)
        .bind(scope_type)
        .bind(scope_id)
        .execute(pool)
        .await?;
        Ok(())
    }
}
