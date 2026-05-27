use anyhow::{anyhow, Result};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use uuid::Uuid;

use crate::api::deepseek::GenerationParams;
use crate::api::{DeepSeekClient, EmbeddingClient};
use crate::services::KnowledgeService;

pub struct EntityService;

#[derive(Debug, Clone, Serialize)]
pub struct EntityRow {
    pub id: String,
    pub entity_type: String,
    pub canonical_name: String,
    pub aliases: Vec<String>,
    pub summary: String,
    pub status: String,
    pub first_seen_chapter_id: Option<String>,
    pub last_seen_chapter_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ExtractedCharacter {
    name: String,
    #[serde(default)]
    role_hint: Option<String>,
    #[serde(default)]
    key_action: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ExtractedNamed {
    name: String,
    #[serde(default)]
    summary: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
struct ExtractionResult {
    #[serde(default)]
    characters_present: Vec<ExtractedCharacter>,
    #[serde(default)]
    new_foreshadowing: Vec<ExtractedNamed>,
    #[serde(default)]
    locations: Vec<ExtractedNamed>,
    #[serde(default)]
    significant_events: Vec<ExtractedNamed>,
    #[serde(default)]
    items: Vec<ExtractedNamed>,
}

/// Similarity threshold for merging an extracted entity into an existing one.
/// 0.85 is empirical — high enough to avoid spurious merges, low enough to
/// catch obvious aliases ("银色怀表" ≈ "祖母的挂件").
const ENTITY_DEDUPE_THRESHOLD: f32 = 0.85;

#[derive(Debug, Serialize)]
pub struct ExtractStats {
    pub characters_added: usize,
    pub characters_updated: usize,
    pub foreshadowing_added: usize,
    pub foreshadowing_updated: usize,
    pub locations_added: usize,
    pub locations_updated: usize,
    pub events_added: usize,
    pub events_updated: usize,
    pub items_added: usize,
    pub items_updated: usize,
}

impl ExtractStats {
    fn new() -> Self {
        Self {
            characters_added: 0,
            characters_updated: 0,
            foreshadowing_added: 0,
            foreshadowing_updated: 0,
            locations_added: 0,
            locations_updated: 0,
            events_added: 0,
            events_updated: 0,
            items_added: 0,
            items_updated: 0,
        }
    }
}

impl EntityService {
    // ── extraction ─────────────────────────────────────────────

    pub async fn extract_and_upsert(
        pool: &SqlitePool,
        chat: &DeepSeekClient,
        embed: &EmbeddingClient,
        project_id: &str,
        chapter_id: &str,
        chapter_title: &str,
        chapter_text: &str,
        known_character_names: &[String],
        embedding_model: &str,
    ) -> Result<ExtractStats> {
        let text = chapter_text.trim();
        if text.is_empty() {
            return Err(anyhow!("Cannot extract from empty chapter"));
        }

        let known_block = if known_character_names.is_empty() {
            "（暂无已知角色）".to_string()
        } else {
            known_character_names
                .iter()
                .enumerate()
                .map(|(i, n)| format!("{}. {}", i + 1, n))
                .collect::<Vec<_>>()
                .join("\n")
        };

        let prompt = format!(
            r#"你是小说编辑助手。请从下面的章节正文中抽取结构化信息，**只输出 JSON**。

已知角色列表（如果章节里出现这些角色，请直接用列表里的名字，不要换名）：
{known}

章节标题：{title}
章节正文：
{body}

请严格输出以下 JSON 结构（不要包裹在 ```json``` 里，不要任何前后文字）：
{{
  "characters_present": [
    {{ "name": "角色名", "role_hint": "可选的身份提示", "key_action": "本章最重要动作" }}
  ],
  "new_foreshadowing": [
    {{ "name": "伏笔名（短）", "summary": "一句话描述这个伏笔，10-30 字" }}
  ],
  "locations": [
    {{ "name": "地点名", "summary": "可选，描述这个地点的特征" }}
  ],
  "significant_events": [
    {{ "name": "事件名", "summary": "一句话描述事件意义" }}
  ],
  "items": [
    {{ "name": "重要物品名", "summary": "可选，物品来历或意义" }}
  ]
}}

规则：
- 每个数组都是必填字段，但内容可以为空数组 []
- 只抽取"对后续剧情有意义"的实体，不要罗列所有提到的东西
- characters_present 只抽取实际在本章出场的角色（被提到名字但未出场不算）
- new_foreshadowing 只抽取"看似无意但可能在后续回收"的细节
- significant_events 是改变剧情走向的事件，不是日常对话
"#,
            known = known_block,
            title = chapter_title,
            body = text,
        );

        let params = GenerationParams {
            temperature: Some(0.2),
            max_tokens: Some(1500),
            system_prompt: Some("You extract structured story entities. Output JSON only.".to_string()),
        };

        let (raw_output, _) = chat.generate_text(&prompt, Some(params)).await?;

        // Strip code fences if any
        let cleaned = raw_output
            .trim()
            .trim_start_matches("```json")
            .trim_start_matches("```")
            .trim_end_matches("```")
            .trim();

        let extracted: ExtractionResult = serde_json::from_str(cleaned)
            .map_err(|e| anyhow!("Failed to parse entity JSON: {}. Raw: {}", e, cleaned))?;

        let mut stats = ExtractStats::new();

        // Process each entity type
        for c in &extracted.characters_present {
            let summary = c
                .key_action
                .clone()
                .or(c.role_hint.clone())
                .unwrap_or_default();
            let was_new = Self::upsert_entity(
                pool,
                embed,
                project_id,
                chapter_id,
                "character_ref",
                &c.name,
                &summary,
                embedding_model,
            )
            .await?;
            if was_new {
                stats.characters_added += 1;
            } else {
                stats.characters_updated += 1;
            }
        }

        for f in &extracted.new_foreshadowing {
            let was_new = Self::upsert_entity(
                pool,
                embed,
                project_id,
                chapter_id,
                "foreshadowing",
                &f.name,
                f.summary.as_deref().unwrap_or(""),
                embedding_model,
            )
            .await?;
            if was_new {
                stats.foreshadowing_added += 1;
            } else {
                stats.foreshadowing_updated += 1;
            }
        }

        for l in &extracted.locations {
            let was_new = Self::upsert_entity(
                pool,
                embed,
                project_id,
                chapter_id,
                "location",
                &l.name,
                l.summary.as_deref().unwrap_or(""),
                embedding_model,
            )
            .await?;
            if was_new {
                stats.locations_added += 1;
            } else {
                stats.locations_updated += 1;
            }
        }

        for ev in &extracted.significant_events {
            let was_new = Self::upsert_entity(
                pool,
                embed,
                project_id,
                chapter_id,
                "event",
                &ev.name,
                ev.summary.as_deref().unwrap_or(""),
                embedding_model,
            )
            .await?;
            if was_new {
                stats.events_added += 1;
            } else {
                stats.events_updated += 1;
            }
        }

        for it in &extracted.items {
            let was_new = Self::upsert_entity(
                pool,
                embed,
                project_id,
                chapter_id,
                "item",
                &it.name,
                it.summary.as_deref().unwrap_or(""),
                embedding_model,
            )
            .await?;
            if was_new {
                stats.items_added += 1;
            } else {
                stats.items_updated += 1;
            }
        }

        Ok(stats)
    }

    /// Upsert a single entity with similarity-based dedup. Returns true if newly created.
    async fn upsert_entity(
        pool: &SqlitePool,
        embed: &EmbeddingClient,
        project_id: &str,
        chapter_id: &str,
        entity_type: &str,
        name: &str,
        summary: &str,
        embedding_model: &str,
    ) -> Result<bool> {
        let name = name.trim();
        if name.is_empty() {
            return Ok(false);
        }

        let embed_text = if summary.is_empty() {
            name.to_string()
        } else {
            format!("{name}: {summary}")
        };
        let new_vec = embed.embed_one(&embed_text).await?;

        // Look for matches by exact name first (fast path)
        let exact: Option<(String, Option<String>)> = sqlx::query_as(
            r#"SELECT id, aliases FROM kb_entities
               WHERE project_id = ? AND entity_type = ? AND canonical_name = ?"#,
        )
        .bind(project_id)
        .bind(entity_type)
        .bind(name)
        .fetch_optional(pool)
        .await?;

        if let Some((id, aliases_json)) = exact {
            Self::touch_existing(pool, &id, chapter_id, summary, aliases_json.as_deref(), None)
                .await?;
            return Ok(false);
        }

        // Cosine-based fuzzy dedup
        let candidates: Vec<(String, String, Option<String>, Option<Vec<u8>>)> = sqlx::query_as(
            r#"SELECT id, canonical_name, aliases, embedding FROM kb_entities
               WHERE project_id = ? AND entity_type = ?"#,
        )
        .bind(project_id)
        .bind(entity_type)
        .fetch_all(pool)
        .await?;

        let mut best: Option<(String, String, Option<String>, f32)> = None;
        for (id, cname, aliases, blob_opt) in candidates {
            if let Some(blob) = blob_opt {
                let v = KnowledgeService::decode_embedding(&blob);
                if v.len() != new_vec.len() {
                    continue;
                }
                let score = KnowledgeService::cosine(&new_vec, &v);
                if score >= ENTITY_DEDUPE_THRESHOLD {
                    let better = match &best {
                        Some(b) => score > b.3,
                        None => true,
                    };
                    if better {
                        best = Some((id, cname, aliases, score));
                    }
                }
            }
        }

        if let Some((id, _cname, aliases_json, _score)) = best {
            // Merge as alias
            Self::touch_existing(
                pool,
                &id,
                chapter_id,
                summary,
                aliases_json.as_deref(),
                Some(name),
            )
            .await?;
            return Ok(false);
        }

        // No match — create new entity
        let new_id = format!("ent-{}", Uuid::new_v4());
        let now = Utc::now().to_rfc3339();
        let blob = KnowledgeService::encode_embedding(&new_vec);

        sqlx::query(
            r#"INSERT INTO kb_entities
               (id, project_id, entity_type, canonical_name, aliases, summary,
                status, first_seen_chapter_id, last_seen_chapter_id,
                embedding, embedding_dim, embedding_model, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"#,
        )
        .bind(&new_id)
        .bind(project_id)
        .bind(entity_type)
        .bind(name)
        .bind(serde_json::json!([]).to_string())
        .bind(summary)
        .bind("open")
        .bind(chapter_id)
        .bind(chapter_id)
        .bind(&blob)
        .bind(new_vec.len() as i64)
        .bind(embedding_model)
        .bind(&now)
        .bind(&now)
        .execute(pool)
        .await?;

        Self::record_appearance(pool, &new_id, project_id, chapter_id, summary).await?;
        Ok(true)
    }

    async fn touch_existing(
        pool: &SqlitePool,
        id: &str,
        chapter_id: &str,
        summary_appendix: &str,
        existing_aliases_json: Option<&str>,
        new_alias: Option<&str>,
    ) -> Result<()> {
        let mut aliases: Vec<String> = existing_aliases_json
            .and_then(|s| serde_json::from_str(s).ok())
            .unwrap_or_default();

        if let Some(alias) = new_alias {
            if !aliases.iter().any(|a| a == alias) {
                aliases.push(alias.to_string());
            }
        }

        let aliases_json = serde_json::json!(aliases).to_string();
        let now = Utc::now().to_rfc3339();

        sqlx::query(
            r#"UPDATE kb_entities
               SET aliases = ?, last_seen_chapter_id = ?, updated_at = ?
               WHERE id = ?"#,
        )
        .bind(aliases_json)
        .bind(chapter_id)
        .bind(&now)
        .bind(id)
        .execute(pool)
        .await?;

        Self::record_appearance(pool, id, "", chapter_id, summary_appendix).await?;
        Ok(())
    }

    async fn record_appearance(
        pool: &SqlitePool,
        entity_id: &str,
        project_id_hint: &str,
        chapter_id: &str,
        excerpt: &str,
    ) -> Result<()> {
        // De-dup: don't record the same (entity, chapter) twice
        let existing: Option<(String,)> = sqlx::query_as(
            "SELECT id FROM kb_entity_appearances WHERE entity_id = ? AND chapter_id = ?",
        )
        .bind(entity_id)
        .bind(chapter_id)
        .fetch_optional(pool)
        .await?;
        if existing.is_some() {
            return Ok(());
        }

        // Resolve project_id if caller didn't pass one
        let pid: String = if project_id_hint.is_empty() {
            let row: Option<(String,)> =
                sqlx::query_as("SELECT project_id FROM kb_entities WHERE id = ?")
                    .bind(entity_id)
                    .fetch_optional(pool)
                    .await?;
            row.map(|(p,)| p).unwrap_or_default()
        } else {
            project_id_hint.to_string()
        };

        let id = format!("app-{}", Uuid::new_v4());
        let now = Utc::now().to_rfc3339();
        sqlx::query(
            r#"INSERT INTO kb_entity_appearances
               (id, entity_id, project_id, chapter_id, excerpt, created_at)
               VALUES (?, ?, ?, ?, ?, ?)"#,
        )
        .bind(id)
        .bind(entity_id)
        .bind(pid)
        .bind(chapter_id)
        .bind(excerpt)
        .bind(now)
        .execute(pool)
        .await?;
        Ok(())
    }

    // ── retrieval / listing ────────────────────────────────────

    pub async fn list_by_project(
        pool: &SqlitePool,
        project_id: &str,
        entity_type_filter: Option<&str>,
        status_filter: Option<&str>,
    ) -> Result<Vec<EntityRow>> {
        let mut sql = String::from(
            "SELECT id, entity_type, canonical_name, aliases, summary, status,
                    first_seen_chapter_id, last_seen_chapter_id
             FROM kb_entities WHERE project_id = ?",
        );
        if entity_type_filter.is_some() {
            sql.push_str(" AND entity_type = ?");
        }
        if status_filter.is_some() {
            sql.push_str(" AND status = ?");
        }
        sql.push_str(" ORDER BY updated_at DESC");

        let mut q = sqlx::query_as::<_, (String, String, String, Option<String>, Option<String>, String, Option<String>, Option<String>)>(&sql)
            .bind(project_id);
        if let Some(t) = entity_type_filter {
            q = q.bind(t);
        }
        if let Some(s) = status_filter {
            q = q.bind(s);
        }

        let rows = q.fetch_all(pool).await?;
        Ok(rows
            .into_iter()
            .map(|(id, et, name, aliases, summary, status, first_id, last_id)| {
                let aliases: Vec<String> = aliases
                    .as_deref()
                    .and_then(|s| serde_json::from_str(s).ok())
                    .unwrap_or_default();
                EntityRow {
                    id,
                    entity_type: et,
                    canonical_name: name,
                    aliases,
                    summary: summary.unwrap_or_default(),
                    status,
                    first_seen_chapter_id: first_id,
                    last_seen_chapter_id: last_id,
                }
            })
            .collect())
    }

    /// Build a "未回收伏笔" block for the prompt.
    pub async fn load_open_foreshadowing(
        pool: &SqlitePool,
        project_id: &str,
        max_items: usize,
    ) -> Result<String> {
        let rows: Vec<(String, Option<String>, Option<String>, i64)> = sqlx::query_as(
            r#"SELECT e.canonical_name, e.summary, e.first_seen_chapter_id, COALESCE(c.order_index, 0)
               FROM kb_entities e
               LEFT JOIN chapters c ON c.id = e.first_seen_chapter_id
               WHERE e.project_id = ?
                 AND e.entity_type = 'foreshadowing'
                 AND e.status = 'open'
               ORDER BY c.order_index ASC
               LIMIT ?"#,
        )
        .bind(project_id)
        .bind(max_items as i64)
        .fetch_all(pool)
        .await?;

        if rows.is_empty() {
            return Ok(String::new());
        }

        let mut out = String::from("【未回收伏笔】\n");
        for (name, summary, _chap_id, order) in rows {
            let chap_label = if order > 0 {
                format!("第{}章", order)
            } else {
                "?".to_string()
            };
            let desc = summary.unwrap_or_default();
            if desc.is_empty() {
                out.push_str(&format!("- {}（{}）\n", name, chap_label));
            } else {
                out.push_str(&format!("- {}（{}）：{}\n", name, chap_label, desc));
            }
        }
        Ok(out.trim_end().to_string())
    }

    pub async fn set_status(
        pool: &SqlitePool,
        entity_id: &str,
        status: &str,
    ) -> Result<()> {
        let now = Utc::now().to_rfc3339();
        sqlx::query("UPDATE kb_entities SET status = ?, updated_at = ? WHERE id = ?")
            .bind(status)
            .bind(now)
            .bind(entity_id)
            .execute(pool)
            .await?;
        Ok(())
    }

    /// Cleanup when a chapter is deleted. Appearances cascade; entities that lose
    /// their last appearance are archived (not deleted, since they may be referenced).
    pub async fn handle_chapter_deletion(
        pool: &SqlitePool,
        project_id: &str,
        chapter_id: &str,
    ) -> Result<()> {
        // Appearances will cascade via FK. Recompute first/last_seen for affected entities.
        let affected: Vec<(String,)> = sqlx::query_as(
            r#"SELECT DISTINCT entity_id FROM kb_entity_appearances
               WHERE project_id = ? AND chapter_id = ?"#,
        )
        .bind(project_id)
        .bind(chapter_id)
        .fetch_all(pool)
        .await?;

        sqlx::query("DELETE FROM kb_entity_appearances WHERE chapter_id = ?")
            .bind(chapter_id)
            .execute(pool)
            .await?;

        for (entity_id,) in affected {
            let remaining: Option<(Option<String>, Option<String>)> = sqlx::query_as(
                r#"SELECT MIN(chapter_id), MAX(chapter_id) FROM kb_entity_appearances
                   WHERE entity_id = ?"#,
            )
            .bind(&entity_id)
            .fetch_optional(pool)
            .await?;
            match remaining {
                Some((Some(first), Some(last))) => {
                    sqlx::query(
                        "UPDATE kb_entities SET first_seen_chapter_id = ?, last_seen_chapter_id = ? WHERE id = ?",
                    )
                    .bind(first)
                    .bind(last)
                    .bind(&entity_id)
                    .execute(pool)
                    .await?;
                }
                _ => {
                    sqlx::query("UPDATE kb_entities SET status = 'archived' WHERE id = ?")
                        .bind(&entity_id)
                        .execute(pool)
                        .await?;
                }
            }
        }
        Ok(())
    }
}
