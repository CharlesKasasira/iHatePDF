use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

const KEYRING_SERVICE: &str = "ihatepdf-desktop";
const KEYRING_USER: &str = "api-key";

#[derive(Debug, Serialize)]
struct DesktopFile {
    path: String,
    name: String,
    size: u64,
    mime_type: String,
}

#[derive(Debug, thiserror::Error)]
enum DesktopError {
    #[error("{0}")]
    Message(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Keyring(#[from] keyring::Error),
}

impl serde::Serialize for DesktopError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::ser::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("document")
        .to_string()
}

fn infer_mime(path: &Path) -> String {
    match path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "pdf" => "application/pdf",
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "pptx" => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        _ => "application/octet-stream",
    }
    .to_string()
}

fn desktop_file(path: PathBuf) -> Result<DesktopFile, DesktopError> {
    let metadata = fs::metadata(&path)?;
    Ok(DesktopFile {
        name: file_name(&path),
        mime_type: infer_mime(&path),
        path: path.to_string_lossy().to_string(),
        size: metadata.len(),
    })
}

#[tauri::command]
async fn select_files(app: AppHandle, multiple: bool) -> Result<Vec<DesktopFile>, DesktopError> {
    let picker = app
        .dialog()
        .file()
        .add_filter("Documents", &["pdf", "jpg", "jpeg", "png", "docx", "xlsx", "pptx"]);

    let paths = if multiple {
        picker
            .blocking_pick_files()
            .unwrap_or_default()
            .into_iter()
            .filter_map(|path| path.into_path().ok())
            .collect::<Vec<_>>()
    } else {
        picker
            .blocking_pick_file()
            .and_then(|path| path.into_path().ok())
            .into_iter()
            .collect::<Vec<_>>()
    };

    paths.into_iter().map(desktop_file).collect()
}

#[tauri::command]
async fn select_output_folder(app: AppHandle) -> Result<Option<String>, DesktopError> {
    Ok(app
        .dialog()
        .file()
        .blocking_pick_folder()
        .and_then(|path| path.into_path().ok())
        .map(|path| path.to_string_lossy().to_string()))
}

#[tauri::command]
async fn read_file_bytes(path: String) -> Result<Vec<u8>, DesktopError> {
    Ok(fs::read(path)?)
}

#[tauri::command]
async fn save_downloaded_file(
    output_folder: String,
    file_name: String,
    bytes: Vec<u8>,
) -> Result<String, DesktopError> {
    let folder = PathBuf::from(output_folder);
    if !folder.is_dir() {
        return Err(DesktopError::Message("Choose a valid output folder.".to_string()));
    }

    let safe_name = file_name
        .replace(['/', '\\', ':', '*', '?', '"', '<', '>', '|'], "_")
        .trim()
        .to_string();
    let path = folder.join(if safe_name.is_empty() { "output.pdf" } else { &safe_name });
    fs::write(&path, bytes)?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
async fn open_file(path: String) -> Result<(), DesktopError> {
    open::that(path).map_err(|error| DesktopError::Message(error.to_string()))
}

#[tauri::command]
async fn reveal_in_folder(path: String) -> Result<(), DesktopError> {
    #[cfg(target_os = "macos")]
    {
        Command::new("open").arg("-R").arg(path).status()?;
        return Ok(());
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("explorer").arg(format!("/select,{}", path)).status()?;
        return Ok(());
    }

    #[cfg(target_os = "linux")]
    {
        let folder = PathBuf::from(path)
            .parent()
            .map(|value| value.to_path_buf())
            .ok_or_else(|| DesktopError::Message("Cannot locate containing folder.".to_string()))?;
        open::that(folder).map_err(|error| DesktopError::Message(error.to_string()))?;
        return Ok(());
    }
}

#[tauri::command]
async fn get_secure_token() -> Result<Option<String>, DesktopError> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)?;
    match entry.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(error.into()),
    }
}

#[tauri::command]
async fn set_secure_token(token: String) -> Result<(), DesktopError> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)?;
    entry.set_password(&token)?;
    Ok(())
}

#[tauri::command]
async fn clear_secure_token() -> Result<(), DesktopError> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(error.into()),
    }
}

#[tauri::command]
async fn device_name() -> Result<String, DesktopError> {
    Ok(std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "Desktop".to_string()))
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            select_files,
            select_output_folder,
            read_file_bytes,
            save_downloaded_file,
            open_file,
            reveal_in_folder,
            get_secure_token,
            set_secure_token,
            clear_secure_token,
            device_name
        ])
        .setup(|app| {
            let _ = app.get_webview_window("main");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running iHatePDF desktop app");
}
