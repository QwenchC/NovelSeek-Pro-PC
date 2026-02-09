use sqlx::{SqlitePool, Row};
use anyhow::Result;

pub async fn run_migrations(pool: &SqlitePool) -> Result<()> {
    // Enable foreign keys
    sqlx::query("PRAGMA foreign_keys = ON;")
        .execute(pool)
        .await?;

    // Projects table
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS projects (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            author TEXT,
            genre TEXT,
            description TEXT,
            language TEXT NOT NULL DEFAULT 'zh',
            target_word_count INTEGER,
            current_word_count INTEGER DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'draft',
            cover_images TEXT,
            default_cover_id TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        "#
    )
    .execute(pool)
    .await?;

    // Ensure new columns exist for older databases
    let project_columns = sqlx::query("PRAGMA table_info(projects);")
        .fetch_all(pool)
        .await?;
    let has_cover_images = project_columns
        .iter()
        .any(|row| row.get::<String, _>("name") == "cover_images");
    if !has_cover_images {
        sqlx::query("ALTER TABLE projects ADD COLUMN cover_images TEXT")
            .execute(pool)
            .await?;
    }
    let has_default_cover_id = project_columns
        .iter()
        .any(|row| row.get::<String, _>("name") == "default_cover_id");
    if !has_default_cover_id {
        sqlx::query("ALTER TABLE projects ADD COLUMN default_cover_id TEXT")
            .execute(pool)
            .await?;
    }
    let has_language = project_columns
        .iter()
        .any(|row| row.get::<String, _>("name") == "language");
    if !has_language {
        sqlx::query("ALTER TABLE projects ADD COLUMN language TEXT NOT NULL DEFAULT 'zh'")
            .execute(pool)
            .await?;
    }

    // Chapters table
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS chapters (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL,
            title TEXT NOT NULL,
            order_index INTEGER NOT NULL,
            outline_goal TEXT,
            conflict TEXT,
            twist TEXT,
            cliffhanger TEXT,
            draft_text TEXT,
            final_text TEXT,
            illustrations TEXT,
            word_count INTEGER DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'draft',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        )
        "#
    )
    .execute(pool)
    .await?;

    // Ensure new columns exist for older databases
    let chapter_columns = sqlx::query("PRAGMA table_info(chapters);")
        .fetch_all(pool)
        .await?;
    let has_illustrations = chapter_columns
        .iter()
        .any(|row| row.get::<String, _>("name") == "illustrations");
    if !has_illustrations {
        sqlx::query("ALTER TABLE chapters ADD COLUMN illustrations TEXT")
            .execute(pool)
            .await?;
    }

    // Characters table
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS characters (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL,
            name TEXT NOT NULL,
            role TEXT,
            description TEXT,
            personality TEXT,
            background TEXT,
            motivation TEXT,
            voice_style TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        )
        "#
    )
    .execute(pool)
    .await?;

    // World building / Lore table
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS lore (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL,
            category TEXT NOT NULL,
            title TEXT NOT NULL,
            content TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        )
        "#
    )
    .execute(pool)
    .await?;

    // Timeline events table
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS timeline_events (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL,
            title TEXT NOT NULL,
            description TEXT,
            event_time TEXT,
            order_index INTEGER,
            created_at TEXT NOT NULL,
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        )
        "#
    )
    .execute(pool)
    .await?;

    // Generation tasks table
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS generation_tasks (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL,
            task_type TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            input_params TEXT NOT NULL,
            output_result TEXT,
            error_message TEXT,
            token_count INTEGER,
            cost REAL,
            created_at TEXT NOT NULL,
            completed_at TEXT,
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        )
        "#
    )
    .execute(pool)
    .await?;

    // Snapshots table (version control)
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS snapshots (
            id TEXT PRIMARY KEY,
            target_type TEXT NOT NULL,
            target_id TEXT NOT NULL,
            content TEXT NOT NULL,
            content_hash TEXT NOT NULL,
            note TEXT,
            created_at TEXT NOT NULL
        )
        "#
    )
    .execute(pool)
    .await?;

    // Assets table (images, covers, etc.)
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS assets (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL,
            asset_type TEXT NOT NULL,
            file_path TEXT NOT NULL,
            linked_to_type TEXT,
            linked_to_id TEXT,
            metadata TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        )
        "#
    )
    .execute(pool)
    .await?;

    // Create indexes
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_chapters_project ON chapters(project_id);")
        .execute(pool)
        .await?;
    
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_characters_project ON characters(project_id);")
        .execute(pool)
        .await?;
    
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_tasks_project ON generation_tasks(project_id);")
        .execute(pool)
        .await?;

    log::info!("Database migrations completed");
    Ok(())
}
