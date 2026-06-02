use tauri::State;
use sqlx::SqlitePool;
use std::collections::HashSet;
use crate::models::{ImportContentInput, ExportContent, ImportProject};
use crate::services::{ProjectService, ChapterService};

/// Build a minimal placeholder project so an orphan chapter (one whose project_id isn't in the
/// backup's `projects` array, nor already in the DB) can still be imported without tripping the
/// `chapters.project_id → projects.id` foreign key.
fn stub_project(id: String) -> ImportProject {
    ImportProject {
        id,
        title: "导入的项目 / Imported".to_string(),
        author: None,
        genre: None,
        description: None,
        language: None,
        target_word_count: None,
        current_word_count: 0,
        status: None,
        created_at: None,
        updated_at: None,
        cover_images: None,
        default_cover_id: None,
    }
}

/// Bulk-upsert whole projects + chapters (text bodies + illustrations) from a backup file.
/// Incoming wins on conflict, mirroring the Android `AppRepository.importBackup` merge semantics.
/// Word counts are recomputed once per affected project after the bulk upsert.
#[tauri::command]
pub async fn import_novel_content(
    pool: State<'_, SqlitePool>,
    input: ImportContentInput,
) -> Result<(), String> {
    // 1) Upsert incoming projects and remember every known project id.
    let mut known: HashSet<String> = HashSet::new();
    for project in input.projects {
        known.insert(project.id.clone());
        ProjectService::upsert(&pool, project)
            .await
            .map_err(|e| e.to_string())?;
    }

    // 2) Projects already in the DB are valid FK targets too.
    let existing: Vec<String> = sqlx::query_scalar("SELECT id FROM projects")
        .fetch_all(pool.inner())
        .await
        .map_err(|e| e.to_string())?;
    for id in existing {
        known.insert(id);
    }

    // 3) Create stub projects for any chapter pointing at an unknown project (avoids FK failure
    //    and never drops chapters — the user can rename/merge the placeholder afterwards).
    let mut stub_count = 0u32;
    for chapter in &input.chapters {
        if !known.contains(&chapter.project_id) {
            ProjectService::upsert(&pool, stub_project(chapter.project_id.clone()))
                .await
                .map_err(|e| e.to_string())?;
            known.insert(chapter.project_id.clone());
            stub_count += 1;
        }
    }
    if stub_count > 0 {
        log::warn!("import_novel_content: created {} placeholder project(s) for orphan chapters", stub_count);
    }

    // 4) Upsert chapters now that every referenced project exists.
    let mut affected: HashSet<String> = HashSet::new();
    for chapter in input.chapters {
        affected.insert(chapter.project_id.clone());
        ChapterService::upsert(&pool, chapter)
            .await
            .map_err(|e| e.to_string())?;
    }

    // 5) Recompute totals (does not bump project.updated_at, preserving imported timestamps).
    for project_id in affected {
        ChapterService::update_project_word_count_only(&pool, &project_id)
            .await
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

/// Read every project + chapter back out so the PC backup can embed the same `projects` array
/// and chapter content (bodies / illustrations) that the Android backup carries.
#[tauri::command]
pub async fn export_novel_content(pool: State<'_, SqlitePool>) -> Result<ExportContent, String> {
    let projects = ProjectService::get_all(&pool)
        .await
        .map_err(|e| e.to_string())?;
    let chapters = ChapterService::get_all(&pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(ExportContent { projects, chapters })
}
