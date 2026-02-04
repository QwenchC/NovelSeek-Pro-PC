// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod db;
mod api;
mod services;
mod models;
mod commands;

use tauri::Manager;

#[tokio::main]
async fn main() {
    env_logger::init();

    tauri::Builder::default()
        .setup(|app| {
            // Initialize database
            let app_handle = app.handle();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = db::init_database(&app_handle).await {
                    log::error!("Failed to initialize database: {}", e);
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::project::create_project,
            commands::project::get_projects,
            commands::project::get_project,
            commands::project::update_project,
            commands::project::delete_project,
            commands::chapter::create_chapter,
            commands::chapter::get_chapters,
            commands::chapter::update_chapter,
            commands::chapter::delete_chapter,
            commands::chapter::recalculate_project_word_count,
            commands::ai::generate_outline,
            commands::ai::generate_chapter,
            commands::ai::generate_image,
            commands::ai::test_deepseek_connection,
            commands::ai::test_pollinations_connection,
            commands::stream::generate_outline_stream,
            commands::stream::generate_chapter_stream,
            commands::stream::cancel_generation,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
