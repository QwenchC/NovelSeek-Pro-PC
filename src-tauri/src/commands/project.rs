use tauri::State;
use sqlx::SqlitePool;
use crate::models::{Project, CreateProjectInput};
use crate::services::ProjectService;

#[tauri::command]
pub async fn create_project(
    pool: State<'_, SqlitePool>,
    input: CreateProjectInput,
) -> Result<Project, String> {
    ProjectService::create(&pool, input)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_projects(pool: State<'_, SqlitePool>) -> Result<Vec<Project>, String> {
    ProjectService::get_all(&pool)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_project(pool: State<'_, SqlitePool>, id: String) -> Result<Option<Project>, String> {
    ProjectService::get_by_id(&pool, &id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_project(
    pool: State<'_, SqlitePool>,
    id: String,
    input: CreateProjectInput,
) -> Result<Project, String> {
    ProjectService::update(&pool, &id, input)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_project(pool: State<'_, SqlitePool>, id: String) -> Result<(), String> {
    ProjectService::delete(&pool, &id)
        .await
        .map_err(|e| e.to_string())
}
