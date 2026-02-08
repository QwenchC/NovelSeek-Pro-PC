use base64::{engine::general_purpose, Engine as _};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

const WINDOWS_FONTS_DIR: &str = r"C:\Windows\Fonts";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemFontOption {
    pub key: String,
    pub label: String,
    pub file_name: String,
    pub pdf_family: String,
}

fn is_font_ext(path: &Path) -> bool {
    match path.extension().and_then(|value| value.to_str()) {
        Some(extension) => {
            let lower = extension.to_ascii_lowercase();
            lower == "ttf" || lower == "otf"
        }
        None => false,
    }
}

fn is_chinese_font_candidate(file_name_lower: &str) -> bool {
    const KEYWORDS: [&str; 15] = [
        "simsun",
        "simhei",
        "simkai",
        "simfang",
        "msyh",
        "deng",
        "kaiti",
        "fangsong",
        "stsong",
        "stkaiti",
        "noto",
        "sourcehan",
        "source han",
        "cjk",
        "han",
    ];

    KEYWORDS.iter().any(|keyword| file_name_lower.contains(keyword))
}

fn font_priority(file_name_lower: &str) -> u8 {
    if file_name_lower.contains("simsun") {
        0
    } else if file_name_lower.contains("simhei") {
        1
    } else if file_name_lower.contains("simkai") || file_name_lower.contains("stkaiti") {
        2
    } else if file_name_lower.contains("msyh") {
        3
    } else if file_name_lower.contains("deng") {
        4
    } else if file_name_lower.contains("noto") {
        5
    } else {
        10
    }
}

fn display_name(file_name_lower: &str) -> &'static str {
    if file_name_lower.contains("simsun") || file_name_lower.contains("stsong") {
        "宋体"
    } else if file_name_lower.contains("simhei") {
        "黑体"
    } else if file_name_lower.contains("simkai") || file_name_lower.contains("stkaiti") {
        "楷体"
    } else if file_name_lower.contains("msyh") {
        "微软雅黑"
    } else if file_name_lower.contains("deng") {
        "等线"
    } else if file_name_lower.contains("noto") && file_name_lower.contains("serif") {
        "思源宋体"
    } else if file_name_lower.contains("noto") {
        "思源黑体"
    } else {
        "中文字体"
    }
}

fn sanitize_pdf_family(file_name: &str) -> String {
    let stem = Path::new(file_name)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("font");

    let mut family = String::from("sys_");
    for ch in stem.chars() {
        if ch.is_ascii_alphanumeric() {
            family.push(ch);
        } else {
            family.push('_');
        }
    }
    family
}

fn is_safe_file_name(file_name: &str) -> bool {
    if file_name.trim().is_empty() {
        return false;
    }
    if file_name.contains('/') || file_name.contains('\\') {
        return false;
    }
    if file_name.contains("..") {
        return false;
    }
    true
}

#[tauri::command]
pub fn list_system_fonts() -> Result<Vec<SystemFontOption>, String> {
    let fonts_dir = PathBuf::from(WINDOWS_FONTS_DIR);
    let read_dir = fs::read_dir(&fonts_dir)
        .map_err(|error| format!("读取系统字体目录失败: {}", error))?;

    let mut fonts: Vec<(u8, String, SystemFontOption)> = Vec::new();

    for entry in read_dir.flatten() {
        let path = entry.path();
        if !path.is_file() || !is_font_ext(&path) {
            continue;
        }

        let file_name = match path.file_name().and_then(|value| value.to_str()) {
            Some(value) => value.to_string(),
            None => continue,
        };

        let lower = file_name.to_ascii_lowercase();
        if !is_chinese_font_candidate(&lower) {
            continue;
        }

        let priority = font_priority(&lower);
        let label = format!("{} ({})", display_name(&lower), file_name);
        let option = SystemFontOption {
            key: file_name.clone(),
            label,
            file_name: file_name.clone(),
            pdf_family: sanitize_pdf_family(&file_name),
        };
        fonts.push((priority, file_name, option));
    }

    fonts.sort_by(|left, right| left.0.cmp(&right.0).then_with(|| left.1.cmp(&right.1)));
    let result: Vec<SystemFontOption> = fonts
        .into_iter()
        .map(|(_, _, option)| option)
        .take(80)
        .collect();

    if result.is_empty() {
        return Err("未找到可用中文系统字体".to_string());
    }

    Ok(result)
}

#[tauri::command]
pub fn get_system_font_base64(file_name: String) -> Result<String, String> {
    if !is_safe_file_name(&file_name) {
        return Err("字体文件名不合法".to_string());
    }

    let path = PathBuf::from(WINDOWS_FONTS_DIR).join(&file_name);
    if !path.exists() || !path.is_file() {
        return Err(format!("字体文件不存在: {}", file_name));
    }
    if !is_font_ext(&path) {
        return Err("仅支持 TTF/OTF 字体".to_string());
    }

    let bytes = fs::read(&path)
        .map_err(|error| format!("读取字体文件失败: {}", error))?;
    Ok(general_purpose::STANDARD.encode(bytes))
}
