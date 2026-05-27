use crate::api::{DeepSeekClient, EmbeddingClient};
use crate::models::{EmbeddingConfigInput, TextModelConfigInput};
use crate::services::{EntityService, KnowledgeService, SummaryService};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use tauri::State;

fn build_embedding_client(config: &EmbeddingConfigInput) -> Result<EmbeddingClient, String> {
    config.validate()?;
    Ok(EmbeddingClient::new(
        config.api_key.clone(),
        config.normalized_api_base_url(),
        config.model.clone(),
        config.dimensions,
    ))
}

fn build_chat_client(config: &TextModelConfigInput) -> Result<DeepSeekClient, String> {
    config.validate()?;
    Ok(DeepSeekClient::new(
        config.api_key.clone(),
        Some(config.normalized_api_base_url()),
        Some(config.model.clone()),
    ))
}

// ── index a chapter ────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexChapterInput {
    pub project_id: String,
    pub chapter_id: String,
    pub text: String,
    pub embedding_config: EmbeddingConfigInput,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexResultPayload {
    pub chunks_indexed: usize,
    pub skipped: bool,
}

#[tauri::command]
pub async fn kb_index_chapter(
    pool: State<'_, SqlitePool>,
    input: IndexChapterInput,
) -> Result<IndexResultPayload, String> {
    let client = build_embedding_client(&input.embedding_config)?;
    let result = KnowledgeService::index_source(
        &pool,
        &client,
        &input.project_id,
        "chapter",
        &input.chapter_id,
        &input.text,
        &input.embedding_config.model,
    )
    .await
    .map_err(|e| e.to_string())?;

    Ok(IndexResultPayload {
        chunks_indexed: result.chunks_indexed,
        skipped: result.skipped,
    })
}

// ── retrieve long-range context ────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RetrieveContextInput {
    pub project_id: String,
    pub query: String,
    #[serde(default)]
    pub top_k: Option<usize>,
    #[serde(default)]
    pub exclude_chapter_ids: Vec<String>,
    pub embedding_config: EmbeddingConfigInput,
    #[serde(default)]
    pub include_summaries: bool,
    #[serde(default)]
    pub active_arc_id: Option<String>,
    #[serde(default)]
    pub include_foreshadowing: bool,
    /// v2.3: cap retrieval candidates to the N most recent chapters' chunks.
    /// Defaults to 300 if omitted — generous enough that typical users never notice,
    /// but bounds in-memory cosine cost for very long projects.
    #[serde(default)]
    pub max_recent_chapters: Option<usize>,
}

#[tauri::command]
pub async fn kb_retrieve_context(
    pool: State<'_, SqlitePool>,
    input: RetrieveContextInput,
) -> Result<String, String> {
    let client = build_embedding_client(&input.embedding_config)?;
    let top_k = input.top_k.unwrap_or(5).clamp(1, 20);
    let max_recent = input.max_recent_chapters.or(Some(300));

    KnowledgeService::retrieve(
        &pool,
        &client,
        &input.project_id,
        &input.query,
        top_k,
        &input.exclude_chapter_ids,
        input.include_summaries,
        input.active_arc_id.as_deref(),
        input.include_foreshadowing,
        max_recent,
    )
    .await
    .map_err(|e| e.to_string())
}

// ── forget a source (e.g. when chapter is deleted) ─────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForgetSourceInput {
    pub project_id: String,
    pub source_type: String,
    pub source_id: String,
}

#[tauri::command]
pub async fn kb_forget_source(
    pool: State<'_, SqlitePool>,
    input: ForgetSourceInput,
) -> Result<(), String> {
    KnowledgeService::forget_source(&pool, &input.project_id, &input.source_type, &input.source_id)
        .await
        .map_err(|e| e.to_string())
}

// ── test embedding provider connection ─────────────────────────

#[tauri::command]
pub async fn kb_test_embedding(
    #[allow(non_snake_case)] embeddingConfig: EmbeddingConfigInput,
) -> Result<bool, String> {
    let client = build_embedding_client(&embeddingConfig)?;
    client.test_connection().await.map_err(|e| e.to_string())
}

// ── usage stats for Settings page ──────────────────────────────

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KbStatsPayload {
    pub total_chunks: i64,
    pub total_sources: i64,
    pub embedding_models: Vec<String>,
}

#[tauri::command]
pub async fn kb_get_stats(
    pool: State<'_, SqlitePool>,
    #[allow(non_snake_case)] projectId: String,
) -> Result<KbStatsPayload, String> {
    let (total_chunks,): (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM kb_chunks WHERE project_id = ?")
            .bind(&projectId)
            .fetch_one(&*pool)
            .await
            .map_err(|e| e.to_string())?;

    let (total_sources,): (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM kb_index_state WHERE project_id = ?",
    )
    .bind(&projectId)
    .fetch_one(&*pool)
    .await
    .map_err(|e| e.to_string())?;

    let model_rows: Vec<(String,)> = sqlx::query_as(
        "SELECT DISTINCT embedding_model FROM kb_chunks WHERE project_id = ?",
    )
    .bind(&projectId)
    .fetch_all(&*pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(KbStatsPayload {
        total_chunks,
        total_sources,
        embedding_models: model_rows.into_iter().map(|(m,)| m).collect(),
    })
}

// ╔═══════════════════════════════════════════════════════════════
// ║ v2.0: hierarchical summaries
// ╚═══════════════════════════════════════════════════════════════

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SummaryPayload {
    pub id: String,
    pub scope_type: String,
    pub scope_id: String,
    pub summary_text: String,
    pub is_stale: bool,
    pub word_count: i64,
}

fn to_summary_payload(row: crate::services::summary_service::SummaryRow) -> SummaryPayload {
    SummaryPayload {
        id: row.id,
        scope_type: row.scope_type,
        scope_id: row.scope_id,
        summary_text: row.summary_text,
        is_stale: row.is_stale,
        word_count: row.word_count,
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenChapterSummaryInput {
    pub project_id: String,
    pub chapter_id: String,
    pub chapter_title: String,
    pub chapter_text: String,
    pub text_config: TextModelConfigInput,
    pub embedding_config: EmbeddingConfigInput,
}

#[tauri::command]
pub async fn kb_generate_chapter_summary(
    pool: State<'_, SqlitePool>,
    input: GenChapterSummaryInput,
) -> Result<SummaryPayload, String> {
    let chat = build_chat_client(&input.text_config)?;
    let embed = build_embedding_client(&input.embedding_config)?;
    let row = SummaryService::generate_chapter_summary(
        &pool,
        &chat,
        &embed,
        &input.project_id,
        &input.chapter_id,
        &input.chapter_title,
        &input.chapter_text,
        &input.embedding_config.model,
    )
    .await
    .map_err(|e| e.to_string())?;
    Ok(to_summary_payload(row))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenArcSummaryInput {
    pub project_id: String,
    pub arc_id: String,
    pub arc_title: String,
    #[serde(default)]
    pub arc_description: String,
    pub chapter_ids: Vec<String>,
    pub text_config: TextModelConfigInput,
    pub embedding_config: EmbeddingConfigInput,
}

#[tauri::command]
pub async fn kb_generate_arc_summary(
    pool: State<'_, SqlitePool>,
    input: GenArcSummaryInput,
) -> Result<SummaryPayload, String> {
    let chat = build_chat_client(&input.text_config)?;
    let embed = build_embedding_client(&input.embedding_config)?;
    let row = SummaryService::generate_arc_summary(
        &pool,
        &chat,
        &embed,
        &input.project_id,
        &input.arc_id,
        &input.arc_title,
        &input.arc_description,
        &input.chapter_ids,
        &input.embedding_config.model,
    )
    .await
    .map_err(|e| e.to_string())?;
    Ok(to_summary_payload(row))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenBookSummaryInput {
    pub project_id: String,
    pub book_title: String,
    #[serde(default)]
    pub book_description: String,
    pub text_config: TextModelConfigInput,
    pub embedding_config: EmbeddingConfigInput,
}

#[tauri::command]
pub async fn kb_generate_book_summary(
    pool: State<'_, SqlitePool>,
    input: GenBookSummaryInput,
) -> Result<SummaryPayload, String> {
    let chat = build_chat_client(&input.text_config)?;
    let embed = build_embedding_client(&input.embedding_config)?;
    let row = SummaryService::generate_book_summary(
        &pool,
        &chat,
        &embed,
        &input.project_id,
        &input.book_title,
        &input.book_description,
        &input.embedding_config.model,
    )
    .await
    .map_err(|e| e.to_string())?;
    Ok(to_summary_payload(row))
}

#[tauri::command]
pub async fn kb_list_summaries(
    pool: State<'_, SqlitePool>,
    #[allow(non_snake_case)] projectId: String,
) -> Result<Vec<SummaryPayload>, String> {
    let rows = SummaryService::list_for_project(&pool, &projectId)
        .await
        .map_err(|e| e.to_string())?;
    Ok(rows.into_iter().map(to_summary_payload).collect())
}

#[tauri::command]
pub async fn kb_mark_rollups_stale(
    pool: State<'_, SqlitePool>,
    #[allow(non_snake_case)] projectId: String,
) -> Result<(), String> {
    SummaryService::mark_rollups_stale(&pool, &projectId)
        .await
        .map_err(|e| e.to_string())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForgetSummaryInput {
    pub project_id: String,
    pub scope_type: String,
    pub scope_id: String,
}

#[tauri::command]
pub async fn kb_forget_summary(
    pool: State<'_, SqlitePool>,
    input: ForgetSummaryInput,
) -> Result<(), String> {
    SummaryService::forget_summary(&pool, &input.project_id, &input.scope_type, &input.scope_id)
        .await
        .map_err(|e| e.to_string())
}

// ╔═══════════════════════════════════════════════════════════════
// ║ v2.1: entity extraction
// ╚═══════════════════════════════════════════════════════════════

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EntityPayload {
    pub id: String,
    pub entity_type: String,
    pub canonical_name: String,
    pub aliases: Vec<String>,
    pub summary: String,
    pub status: String,
    pub first_seen_chapter_id: Option<String>,
    pub last_seen_chapter_id: Option<String>,
}

fn to_entity_payload(row: crate::services::entity_service::EntityRow) -> EntityPayload {
    EntityPayload {
        id: row.id,
        entity_type: row.entity_type,
        canonical_name: row.canonical_name,
        aliases: row.aliases,
        summary: row.summary,
        status: row.status,
        first_seen_chapter_id: row.first_seen_chapter_id,
        last_seen_chapter_id: row.last_seen_chapter_id,
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractEntitiesInput {
    pub project_id: String,
    pub chapter_id: String,
    pub chapter_title: String,
    pub chapter_text: String,
    #[serde(default)]
    pub known_character_names: Vec<String>,
    pub text_config: TextModelConfigInput,
    pub embedding_config: EmbeddingConfigInput,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractStatsPayload {
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

#[tauri::command]
pub async fn kb_extract_entities(
    pool: State<'_, SqlitePool>,
    input: ExtractEntitiesInput,
) -> Result<ExtractStatsPayload, String> {
    let chat = build_chat_client(&input.text_config)?;
    let embed = build_embedding_client(&input.embedding_config)?;
    let stats = EntityService::extract_and_upsert(
        &pool,
        &chat,
        &embed,
        &input.project_id,
        &input.chapter_id,
        &input.chapter_title,
        &input.chapter_text,
        &input.known_character_names,
        &input.embedding_config.model,
    )
    .await
    .map_err(|e| e.to_string())?;

    Ok(ExtractStatsPayload {
        characters_added: stats.characters_added,
        characters_updated: stats.characters_updated,
        foreshadowing_added: stats.foreshadowing_added,
        foreshadowing_updated: stats.foreshadowing_updated,
        locations_added: stats.locations_added,
        locations_updated: stats.locations_updated,
        events_added: stats.events_added,
        events_updated: stats.events_updated,
        items_added: stats.items_added,
        items_updated: stats.items_updated,
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListEntitiesInput {
    pub project_id: String,
    #[serde(default)]
    pub entity_type: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
}

#[tauri::command]
pub async fn kb_list_entities(
    pool: State<'_, SqlitePool>,
    input: ListEntitiesInput,
) -> Result<Vec<EntityPayload>, String> {
    let rows = EntityService::list_by_project(
        &pool,
        &input.project_id,
        input.entity_type.as_deref(),
        input.status.as_deref(),
    )
    .await
    .map_err(|e| e.to_string())?;
    Ok(rows.into_iter().map(to_entity_payload).collect())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetEntityStatusInput {
    pub entity_id: String,
    pub status: String,
}

#[tauri::command]
pub async fn kb_set_entity_status(
    pool: State<'_, SqlitePool>,
    input: SetEntityStatusInput,
) -> Result<(), String> {
    EntityService::set_status(&pool, &input.entity_id, &input.status)
        .await
        .map_err(|e| e.to_string())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HandleChapterDeleteInput {
    pub project_id: String,
    pub chapter_id: String,
}

#[tauri::command]
pub async fn kb_handle_chapter_deletion(
    pool: State<'_, SqlitePool>,
    input: HandleChapterDeleteInput,
) -> Result<(), String> {
    EntityService::handle_chapter_deletion(&pool, &input.project_id, &input.chapter_id)
        .await
        .map_err(|e| e.to_string())
}
