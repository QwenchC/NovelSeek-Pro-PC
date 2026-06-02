use tauri::State;
use sqlx::SqlitePool;
use chrono::Utc;
use uuid::Uuid;
use crate::models::SnapshotMeta;

// Per-project version snapshots (版本历史). The full project state (project + chapters with bodies
// & illustrations + every per-project map slice) is assembled on the frontend and stored here as a
// JSON `content` blob, keyed by target_type='project', target_id=projectId.

#[tauri::command]
pub async fn snapshot_create(
    pool: State<'_, SqlitePool>,
    target_id: String,
    note: Option<String>,
    content: String,
) -> Result<SnapshotMeta, String> {
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    let content_hash = format!("{}", content.len());

    sqlx::query(
        r#"INSERT INTO snapshots (id, target_type, target_id, content, content_hash, note, created_at)
           VALUES (?, 'project', ?, ?, ?, ?, ?)"#,
    )
    .bind(&id)
    .bind(&target_id)
    .bind(&content)
    .bind(&content_hash)
    .bind(&note)
    .bind(&now)
    .execute(pool.inner())
    .await
    .map_err(|e| e.to_string())?;

    Ok(SnapshotMeta { id, target_id, note, created_at: now })
}

#[tauri::command]
pub async fn snapshot_list(
    pool: State<'_, SqlitePool>,
    target_id: String,
) -> Result<Vec<SnapshotMeta>, String> {
    sqlx::query_as::<_, SnapshotMeta>(
        "SELECT id, target_id, note, created_at FROM snapshots \
         WHERE target_id = ? AND target_type = 'project' ORDER BY created_at DESC",
    )
    .bind(&target_id)
    .fetch_all(pool.inner())
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn snapshot_get(pool: State<'_, SqlitePool>, id: String) -> Result<String, String> {
    let content: Option<String> = sqlx::query_scalar("SELECT content FROM snapshots WHERE id = ?")
        .bind(&id)
        .fetch_optional(pool.inner())
        .await
        .map_err(|e| e.to_string())?;
    content.ok_or_else(|| "Snapshot not found".to_string())
}

#[tauri::command]
pub async fn snapshot_rename(
    pool: State<'_, SqlitePool>,
    id: String,
    note: String,
) -> Result<(), String> {
    sqlx::query("UPDATE snapshots SET note = ? WHERE id = ?")
        .bind(&note)
        .bind(&id)
        .execute(pool.inner())
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn snapshot_delete(pool: State<'_, SqlitePool>, id: String) -> Result<(), String> {
    sqlx::query("DELETE FROM snapshots WHERE id = ?")
        .bind(&id)
        .execute(pool.inner())
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}
