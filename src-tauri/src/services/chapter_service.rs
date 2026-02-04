use sqlx::SqlitePool;
use chrono::Utc;
use uuid::Uuid;
use anyhow::Result;
use crate::models::{Chapter, CreateChapterInput};

pub struct ChapterService;

impl ChapterService {
    pub async fn create(pool: &SqlitePool, input: CreateChapterInput) -> Result<Chapter> {
        let now = Utc::now().to_rfc3339();
        let chapter = Chapter {
            id: Uuid::new_v4().to_string(),
            project_id: input.project_id,
            title: input.title,
            order_index: input.order_index,
            outline_goal: input.outline_goal,
            conflict: input.conflict,
            twist: None,
            cliffhanger: None,
            draft_text: None,
            final_text: None,
            word_count: 0,
            status: "draft".to_string(),
            created_at: now.clone(),
            updated_at: now,
        };

        sqlx::query(
            r#"
            INSERT INTO chapters (id, project_id, title, order_index, outline_goal, conflict, twist, cliffhanger, draft_text, final_text, word_count, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#
        )
        .bind(&chapter.id)
        .bind(&chapter.project_id)
        .bind(&chapter.title)
        .bind(chapter.order_index)
        .bind(&chapter.outline_goal)
        .bind(&chapter.conflict)
        .bind(&chapter.twist)
        .bind(&chapter.cliffhanger)
        .bind(&chapter.draft_text)
        .bind(&chapter.final_text)
        .bind(chapter.word_count)
        .bind(&chapter.status)
        .bind(&chapter.created_at)
        .bind(&chapter.updated_at)
        .execute(pool)
        .await?;

        Ok(chapter)
    }

    pub async fn get_by_project(pool: &SqlitePool, project_id: &str) -> Result<Vec<Chapter>> {
        let chapters = sqlx::query_as::<_, Chapter>(
            "SELECT * FROM chapters WHERE project_id = ? ORDER BY order_index ASC"
        )
        .bind(project_id)
        .fetch_all(pool)
        .await?;

        Ok(chapters)
    }

    pub async fn get_by_id(pool: &SqlitePool, id: &str) -> Result<Option<Chapter>> {
        let chapter = sqlx::query_as::<_, Chapter>(
            "SELECT * FROM chapters WHERE id = ?"
        )
        .bind(id)
        .fetch_optional(pool)
        .await?;

        Ok(chapter)
    }

    pub async fn update_text(
        pool: &SqlitePool,
        id: &str,
        draft_text: Option<String>,
        final_text: Option<String>,
    ) -> Result<()> {
        let now = Utc::now().to_rfc3339();
        
        // Calculate word count from final_text or draft_text
        let word_count = final_text.as_ref()
            .or(draft_text.as_ref())
            .map(|text| text.chars().filter(|c| !c.is_whitespace()).count() as i64)
            .unwrap_or(0);

        sqlx::query(
            r#"
            UPDATE chapters 
            SET draft_text = ?, final_text = ?, word_count = ?, updated_at = ?
            WHERE id = ?
            "#
        )
        .bind(draft_text)
        .bind(final_text)
        .bind(word_count)
        .bind(now.clone())
        .bind(id)
        .execute(pool)
        .await?;

        // 获取章节的 project_id 并更新项目总字数
        if let Some(chapter) = sqlx::query_as::<_, Chapter>(
            "SELECT * FROM chapters WHERE id = ?"
        )
        .bind(id)
        .fetch_optional(pool)
        .await? {
            Self::update_project_word_count(pool, &chapter.project_id).await?;
        }

        Ok(())
    }

    /// 重新计算并更新项目的总字数
    pub async fn update_project_word_count(pool: &SqlitePool, project_id: &str) -> Result<()> {
        let total: i64 = sqlx::query_scalar(
            "SELECT COALESCE(SUM(word_count), 0) FROM chapters WHERE project_id = ?"
        )
        .bind(project_id)
        .fetch_one(pool)
        .await?;

        let now = Utc::now().to_rfc3339();
        sqlx::query(
            "UPDATE projects SET current_word_count = ?, updated_at = ? WHERE id = ?"
        )
        .bind(total)
        .bind(now)
        .bind(project_id)
        .execute(pool)
        .await?;

        Ok(())
    }

    pub async fn delete(pool: &SqlitePool, id: &str) -> Result<()> {
        // 先获取 project_id
        let project_id = sqlx::query_scalar::<_, String>(
            "SELECT project_id FROM chapters WHERE id = ?"
        )
        .bind(id)
        .fetch_optional(pool)
        .await?;

        sqlx::query("DELETE FROM chapters WHERE id = ?")
            .bind(id)
            .execute(pool)
            .await?;

        // 删除后更新项目总字数
        if let Some(pid) = project_id {
            Self::update_project_word_count(pool, &pid).await?;
        }

        Ok(())
    }
}
