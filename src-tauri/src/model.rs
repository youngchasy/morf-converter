use std::collections::HashMap;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FileKind {
    Image,
    Video,
    Audio,
    Document,
    Pdf,
    Data,
    Archive,
    Unknown,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkFile {
    pub id: String,
    pub path: String,
    pub name: String,
    pub extension: String,
    pub size: u64,
    pub kind: FileKind,
    pub detail: Option<String>,
    pub page_count: Option<usize>,
    pub status: String,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineInfo {
    pub id: String,
    pub name: String,
    pub installed: bool,
    pub version: Option<String>,
    pub path: Option<String>,
    pub description: String,
    pub formats: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversionOptions {
    pub quality: u8,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub fit: String,
    pub rotation: u16,
    pub grayscale: bool,
    pub preserve_metadata: bool,
    pub audio_bitrate: u16,
    pub trim_start: Option<f64>,
    pub trim_duration: Option<f64>,
    #[serde(default)]
    pub hardware_encoder: String,
    #[serde(default)]
    pub watermark_path: Option<String>,
    #[serde(default = "default_watermark_opacity")]
    pub watermark_opacity: u8,
    #[serde(default = "default_watermark_scale")]
    pub watermark_scale: u8,
    #[serde(default = "default_watermark_position")]
    pub watermark_position: String,
    #[serde(default)]
    pub subtitle_path: Option<String>,
    #[serde(default = "default_subtitle_mode")]
    pub subtitle_mode: String,
}

fn default_watermark_opacity() -> u8 {
    70
}

fn default_watermark_scale() -> u8 {
    22
}

fn default_watermark_position() -> String {
    "bottom-right".to_string()
}

fn default_subtitle_mode() -> String {
    "off".to_string()
}

impl Default for ConversionOptions {
    fn default() -> Self {
        Self {
            quality: 88,
            width: None,
            height: None,
            fit: "contain".to_string(),
            rotation: 0,
            grayscale: false,
            preserve_metadata: false,
            audio_bitrate: 192,
            trim_start: None,
            trim_duration: None,
            hardware_encoder: "software".to_string(),
            watermark_path: None,
            watermark_opacity: default_watermark_opacity(),
            watermark_scale: default_watermark_scale(),
            watermark_position: default_watermark_position(),
            subtitle_path: None,
            subtitle_mode: default_subtitle_mode(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversionRequest {
    pub inputs: Vec<String>,
    pub output_dir: String,
    pub target_format: String,
    pub overwrite: bool,
    pub options: ConversionOptions,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobResult {
    pub input: String,
    pub output: Option<String>,
    pub success: bool,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchResult {
    pub items: Vec<JobResult>,
    pub output_dir: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CombineItem {
    pub path: String,
    pub name: String,
    pub kind: FileKind,
    pub page_range: String,
    pub scale: u16,
    pub rotation: u16,
    pub margin: f32,
    pub offset_x: f32,
    pub offset_y: f32,
    pub border_width: f32,
    pub border_color: String,
    pub fit: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CombineRequest {
    pub items: Vec<CombineItem>,
    pub output_path: String,
    pub mode: String,
    pub page_preset: String,
    pub orientation: String,
    pub background: String,
    pub quality: u8,
    pub dpi: u16,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SplitRequest {
    pub input: String,
    pub output_dir: String,
    pub mode: String,
    pub target_format: String,
    pub rows: u32,
    pub columns: u32,
    pub pages_per_file: u32,
    pub segment_seconds: u32,
    pub dpi: u16,
    pub quality: u8,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobSnapshot {
    pub id: String,
    pub operation: String,
    pub status: String,
    pub progress: u8,
    pub completed: usize,
    pub total: usize,
    pub current_file: Option<String>,
    pub message: Option<String>,
    pub result: Option<BatchResult>,
    pub created_at: u128,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    #[serde(default = "default_parallel_jobs")]
    pub max_parallel_jobs: usize,
    #[serde(default)]
    pub engine_paths: HashMap<String, String>,
    #[serde(default = "default_hardware_encoder")]
    pub hardware_encoder: String,
}

fn default_parallel_jobs() -> usize {
    2
}

fn default_hardware_encoder() -> String {
    "software".to_string()
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            max_parallel_jobs: default_parallel_jobs(),
            engine_paths: HashMap::new(),
            hardware_encoder: default_hardware_encoder(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineInstallPlan {
    pub engine_id: String,
    pub title: String,
    pub command: String,
    pub website: String,
    pub note: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrRequest {
    pub input: String,
    pub output_dir: String,
    pub language: String,
    pub output_format: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveCreateRequest {
    pub inputs: Vec<String>,
    pub output_path: String,
    pub format: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveExtractRequest {
    pub input: String,
    pub output_dir: String,
}
