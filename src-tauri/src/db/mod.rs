use sqlx::{sqlite::SqlitePool, migrate::MigrateDatabase, Sqlite};
use tauri::{AppHandle, Manager};
use std::path::PathBuf;
use anyhow::Result;

pub mod schema;

pub async fn init_database(app_handle: &AppHandle) -> Result<()> {
    let app_dir = app_handle.path_resolver()
        .app_data_dir()
        .expect("Failed to get app data directory");
    
    // Ensure directory exists
    std::fs::create_dir_all(&app_dir)?;
    
    let db_path = app_dir.join("novelseek.db");
    let db_url = format!("sqlite:{}", db_path.display());
    
    // Create database if it doesn't exist
    if !Sqlite::database_exists(&db_url).await? {
        log::info!("Creating database at {}", db_url);
        Sqlite::create_database(&db_url).await?;
    }
    
    // Connect to database
    let pool = SqlitePool::connect(&db_url).await?;
    
    // Run migrations
    schema::run_migrations(&pool).await?;
    
    // Store pool in app state
    app_handle.manage(pool);
    
    log::info!("Database initialized successfully");
    Ok(())
}

pub fn get_pool(app_handle: &AppHandle) -> SqlitePool {
    app_handle.state::<SqlitePool>().inner().clone()
}
