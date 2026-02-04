use sqlx::SqlitePool;
use chrono::Utc;
use uuid::Uuid;
use anyhow::Result;
use crate::models::{Project, CreateProjectInput};

pub struct ProjectService;

impl ProjectService {
    pub async fn create(pool: &SqlitePool, input: CreateProjectInput) -> Result<Project> {
        let now = Utc::now().to_rfc3339();
        let project = Project {
            id: Uuid::new_v4().to_string(),
            title: input.title,
            author: input.author,
            genre: input.genre,
            description: input.description,
            target_word_count: input.target_word_count,
            current_word_count: 0,
            status: "draft".to_string(),
            created_at: now.clone(),
            updated_at: now,
        };

        sqlx::query(
            r#"
            INSERT INTO projects (id, title, author, genre, description, target_word_count, current_word_count, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#
        )
        .bind(&project.id)
        .bind(&project.title)
        .bind(&project.author)
        .bind(&project.genre)
        .bind(&project.description)
        .bind(project.target_word_count)
        .bind(project.current_word_count)
        .bind(&project.status)
        .bind(&project.created_at)
        .bind(&project.updated_at)
        .execute(pool)
        .await?;

        Ok(project)
    }

    pub async fn get_all(pool: &SqlitePool) -> Result<Vec<Project>> {
        let projects = sqlx::query_as::<_, Project>(
            "SELECT * FROM projects ORDER BY updated_at DESC"
        )
        .fetch_all(pool)
        .await?;

        Ok(projects)
    }

    pub async fn get_by_id(pool: &SqlitePool, id: &str) -> Result<Option<Project>> {
        let project = sqlx::query_as::<_, Project>(
            "SELECT * FROM projects WHERE id = ?"
        )
        .bind(id)
        .fetch_optional(pool)
        .await?;

        Ok(project)
    }

    pub async fn update(pool: &SqlitePool, id: &str, input: CreateProjectInput) -> Result<Project> {
        let now = Utc::now().to_rfc3339();
        
        sqlx::query(
            r#"
            UPDATE projects 
            SET title = ?, author = ?, genre = ?, description = ?, target_word_count = ?, updated_at = ?
            WHERE id = ?
            "#
        )
        .bind(&input.title)
        .bind(&input.author)
        .bind(&input.genre)
        .bind(&input.description)
        .bind(input.target_word_count)
        .bind(&now)
        .bind(id)
        .execute(pool)
        .await?;

        Self::get_by_id(pool, id).await?
            .ok_or_else(|| anyhow::anyhow!("Project not found after update"))
    }

    pub async fn delete(pool: &SqlitePool, id: &str) -> Result<()> {
        sqlx::query("DELETE FROM projects WHERE id = ?")
            .bind(id)
            .execute(pool)
            .await?;

        Ok(())
    }

    pub async fn update_word_count(pool: &SqlitePool, id: &str, count: i64) -> Result<()> {
        let now = Utc::now().to_rfc3339();
        
        sqlx::query(
            "UPDATE projects SET current_word_count = ?, updated_at = ? WHERE id = ?"
        )
        .bind(count)
        .bind(now)
        .bind(id)
        .execute(pool)
        .await?;

        Ok(())
    }
}
