// Microsoft Edge "Read Aloud" online TTS over WebSocket — a faithful port of the Android
// EdgeTtsService. Same free neural voices the Edge browser uses (no subscription key). One call
// streams one text segment and returns its full MP3 bytes (base64). Custom WS headers + the
// `Sec-MS-GEC` DRM token are required (browsers can't set those, hence this lives in Rust).

use base64::{engine::general_purpose::STANDARD, Engine};
use chrono::Utc;
use futures_util::{SinkExt, StreamExt};
use sha2::{Digest, Sha256};
use std::time::{SystemTime, UNIX_EPOCH};
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::Message;
use uuid::Uuid;

const TRUSTED_CLIENT_TOKEN: &str = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const SEC_MS_GEC_VERSION: &str = "1-143.0.3650.75";
const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0";
const ORIGIN: &str = "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold";

fn now_string() -> String {
    // "EEE MMM dd yyyy HH:mm:ss 'GMT+0000 (Coordinated Universal Time)'" in UTC.
    Utc::now()
        .format("%a %b %d %Y %H:%M:%S GMT+0000 (Coordinated Universal Time)")
        .to_string()
}

/// Replicates edge-tts's `Sec-MS-GEC` token: round Windows-epoch time down to a 5-minute window,
/// scale to 100-ns ticks, then uppercase hex SHA-256 of "<ticks><token>".
fn generate_sec_ms_gec() -> String {
    let mut ticks = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs_f64();
    ticks += 11_644_473_600.0; // Unix epoch → Windows epoch (seconds)
    ticks -= ticks % 300.0; // round down to a 5-minute window
    ticks *= 1e7; // seconds → 100-ns intervals
    let input = format!("{:.0}{}", ticks, TRUSTED_CLIENT_TOKEN);
    let digest = Sha256::digest(input.as_bytes());
    let mut out = String::with_capacity(digest.len() * 2);
    for b in digest {
        out.push_str(&format!("{:02X}", b));
    }
    out
}

fn speech_config_message() -> String {
    let json = r#"{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}"#;
    format!(
        "X-Timestamp:{}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n{}",
        now_string(),
        json
    )
}

fn escape_xml(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

fn ssml_message(text: &str, voice: &str, rate_percent: i32) -> String {
    let rate = if rate_percent >= 0 { format!("+{}%", rate_percent) } else { format!("{}%", rate_percent) };
    let ssml = format!(
        "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='zh-CN'><voice name='{}'><prosody rate='{}' pitch='+0Hz'>{}</prosody></voice></speak>",
        voice, rate, escape_xml(text)
    );
    format!(
        "X-RequestId:{}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:{}\r\nPath:ssml\r\n\r\n{}",
        Uuid::new_v4().simple(),
        now_string(),
        ssml
    )
}

#[tauri::command]
pub async fn edge_tts_synthesize(text: String, voice: String, rate_percent: i32) -> Result<String, String> {
    let sec = generate_sec_ms_gec();
    let conn = Uuid::new_v4().simple().to_string();
    let url = format!(
        "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken={}&Sec-MS-GEC={}&Sec-MS-GEC-Version={}&ConnectionId={}",
        TRUSTED_CLIENT_TOKEN, sec, SEC_MS_GEC_VERSION, conn
    );

    let mut request = url.into_client_request().map_err(|e| e.to_string())?;
    {
        let h = request.headers_mut();
        h.insert("User-Agent", HeaderValue::from_static(USER_AGENT));
        h.insert("Origin", HeaderValue::from_static(ORIGIN));
        h.insert("Pragma", HeaderValue::from_static("no-cache"));
        h.insert("Cache-Control", HeaderValue::from_static("no-cache"));
        h.insert("Accept-Encoding", HeaderValue::from_static("gzip, deflate, br"));
        h.insert("Accept-Language", HeaderValue::from_static("en-US,en;q=0.9"));
    }

    let (ws, _) = tokio_tungstenite::connect_async(request)
        .await
        .map_err(|e| format!("Edge TTS connect failed: {}", e))?;
    let (mut write, mut read) = ws.split();

    write.send(Message::Text(speech_config_message())).await.map_err(|e| e.to_string())?;
    write.send(Message::Text(ssml_message(&text, &voice, rate_percent))).await.map_err(|e| e.to_string())?;

    let mut audio: Vec<u8> = Vec::new();
    while let Some(msg) = read.next().await {
        match msg.map_err(|e| e.to_string())? {
            Message::Binary(b) => {
                // [2-byte BE header length][header text][audio bytes]
                if b.len() >= 2 {
                    let header_len = ((b[0] as usize) << 8) | (b[1] as usize);
                    let audio_start = 2 + header_len;
                    if audio_start < b.len() {
                        audio.extend_from_slice(&b[audio_start..]);
                    }
                }
            }
            Message::Text(t) => {
                if t.contains("Path:turn.end") {
                    break;
                }
            }
            Message::Close(_) => break,
            _ => {}
        }
    }

    if audio.is_empty() {
        return Err("Edge TTS returned no audio".to_string());
    }
    Ok(STANDARD.encode(&audio))
}
