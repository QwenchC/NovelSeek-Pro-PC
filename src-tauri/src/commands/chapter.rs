use tauri::State;
use sqlx::SqlitePool;
use serde::Serialize;
use crate::models::{Chapter, CreateChapterInput, UpdateChapterMetaInput};
use crate::services::ChapterService;

#[derive(Serialize)]
pub struct ChapterCount {
    pub project_id: String,
    pub count: i64,
}

/// Lightweight per-project chapter counts (one grouped query, no row bodies).
/// Used by the project list cards to show 章节数 without fetching full chapters.
#[tauri::command]
pub async fn get_chapter_counts(
    pool: State<'_, SqlitePool>,
) -> Result<Vec<ChapterCount>, String> {
    let rows: Vec<(String, i64)> = sqlx::query_as(
        "SELECT project_id, COUNT(*) FROM chapters GROUP BY project_id",
    )
    .fetch_all(pool.inner())
    .await
    .map_err(|e| e.to_string())?;

    Ok(rows
        .into_iter()
        .map(|(project_id, count)| ChapterCount { project_id, count })
        .collect())
}

#[tauri::command]
pub async fn create_chapter(
    pool: State<'_, SqlitePool>,
    input: CreateChapterInput,
) -> Result<Chapter, String> {
    ChapterService::create(&pool, input)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_chapters(
    pool: State<'_, SqlitePool>,
    project_id: String,
) -> Result<Vec<Chapter>, String> {
    ChapterService::get_by_project(&pool, &project_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_chapter(
    pool: State<'_, SqlitePool>,
    id: String,
    draft_text: Option<String>,
    final_text: Option<String>,
    illustrations: Option<String>,
) -> Result<(), String> {
    ChapterService::update_text(&pool, &id, draft_text, final_text, illustrations)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_chapter_meta(
    pool: State<'_, SqlitePool>,
    id: String,
    input: UpdateChapterMetaInput,
) -> Result<Chapter, String> {
    ChapterService::update_meta(&pool, &id, input)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_chapter(pool: State<'_, SqlitePool>, id: String) -> Result<(), String> {
    ChapterService::delete(&pool, &id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn recalculate_project_word_count(
    pool: State<'_, SqlitePool>,
    project_id: String,
) -> Result<i64, String> {
    ChapterService::update_project_word_count_only(&pool, &project_id)
        .await
        .map_err(|e| e.to_string())?;
    
    // 返回新的总字数
    let total: i64 = sqlx::query_scalar(
        "SELECT COALESCE(current_word_count, 0) FROM projects WHERE id = ?"
    )
    .bind(&project_id)
    .fetch_one(pool.inner())
    .await
    .map_err(|e| e.to_string())?;
    
    Ok(total)
}
