use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::fs;
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use tauri::Emitter;
use notify::{Watcher, RecommendedWatcher, RecursiveMode, Event, EventKind};
use winreg::enums::*;
use winreg::RegKey;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WhisperEvent {
    pub is_trade: bool,
    pub from: String,
    pub message: String,
    pub item_name: Option<String>,
}

static WATCHER_HANDLE: Mutex<Option<Arc<Mutex<Option<RecommendedWatcher>>>>> = Mutex::new(None);
static LAST_POSITION: Mutex<u64> = Mutex::new(0);

/// Find the Diablo II installation directory
/// If custom_path is provided and exists, use it. Otherwise, try auto-detection.
pub fn find_diablo2_directory(custom_path: Option<&str>) -> Option<PathBuf> {
    // If custom path is provided and exists, use it
    if let Some(custom) = custom_path {
        if !custom.is_empty() {
            let path = PathBuf::from(custom);
            if path.exists() {
                return Some(path);
            }
        }
    }

    // Try registry first
    if let Some(path) = find_diablo2_in_registry() {
        if path.exists() {
            return Some(path);
        }
    }

    // Try common installation paths
    let common_paths = vec![
        PathBuf::from(r"C:\Diablo II"),
        PathBuf::from(r"D:\Diablo II"),
        PathBuf::from(r"E:\Diablo II"),
        PathBuf::from(r"C:\Program Files\Diablo II"),
        PathBuf::from(r"C:\Program Files (x86)\Diablo II"),
        PathBuf::from(r"D:\Program Files\Diablo II"),
        PathBuf::from(r"D:\Program Files (x86)\Diablo II"),
    ];

    for path in common_paths {
        if path.exists() {
            return Some(path);
        }
    }

    None
}

/// Auto-detect the Diablo II installation directory (without using custom path)
pub fn auto_detect_diablo2_directory() -> Option<PathBuf> {
    find_diablo2_directory(None)
}

fn find_diablo2_in_registry() -> Option<PathBuf> {
    // Try HKEY_LOCAL_MACHINE\SOFTWARE\Blizzard Entertainment\Diablo II
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    if let Ok(key) = hklm.open_subkey(r"SOFTWARE\Blizzard Entertainment\Diablo II") {
        if let Ok(install_path) = key.get_value::<String, _>("InstallPath") {
            return Some(PathBuf::from(install_path));
        }
    }

    // Try HKEY_CURRENT_USER
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    if let Ok(key) = hkcu.open_subkey(r"SOFTWARE\Blizzard Entertainment\Diablo II") {
        if let Ok(install_path) = key.get_value::<String, _>("InstallPath") {
            return Some(PathBuf::from(install_path));
        }
    }

    None
}

/// Get the chat log file path, creating directories if needed
pub fn get_chat_log_path(custom_d2_dir: Option<&str>) -> Option<PathBuf> {
    let d2_dir = find_diablo2_directory(custom_d2_dir)?;
    let logs_dir = d2_dir.join("ProjectD2").join("pd2logs");
    
    // Create directories if they don't exist
    if let Err(e) = fs::create_dir_all(&logs_dir) {
        eprintln!("Failed to create logs directory: {}", e);
        return None;
    }

    let log_file = logs_dir.join("pd2_chat.log");
    
    // Create file if it doesn't exist
    if !log_file.exists() {
        if let Err(e) = fs::File::create(&log_file) {
            eprintln!("Failed to create chat log file: {}", e);
            return None;
        }
    }

    Some(log_file)
}

/// Parse a whisper from a log line
/// Format: "2,From <character> (*<account>): Hi, I'm interested in your Frostburn listed for 2 wss"
fn parse_whisper(line: &str) -> Option<WhisperEvent> {
    // Check if it's a whisper (starts with "2,")
    if !line.starts_with("2,") {
        return None;
    }

    // Extract the message part after "From"
    let from_start = line.find("From ")?;
    let after_from = &line[from_start + 5..]; // Skip "From "
    
    // Find the colon that separates sender from message
    let colon_pos = after_from.find(':')?;
    let sender_part = &after_from[..colon_pos].trim();
    let message = after_from[colon_pos + 1..].trim();

    // Extract sender name - prefer account name from parentheses, otherwise use character name
    // Format: "shrackx (*shrack)" or "shrackx (*shrack)" or just "shrackx"
    let sender = if let Some(paren_start) = sender_part.find('(') {
        // Extract account name from parentheses (e.g., "*shrack" from "(*shrack)")
        if let Some(paren_end) = sender_part[paren_start..].find(')') {
            let account_name = &sender_part[paren_start + 1..paren_start + paren_end].trim();
            // Remove "*" prefix if present
            account_name.strip_prefix('*').unwrap_or(account_name)
        } else {
            // Fallback to character name if parentheses are malformed
            sender_part.split_whitespace().next().unwrap_or(sender_part)
        }
    } else if let Some(space_pos) = sender_part.find(' ') {
        &sender_part[..space_pos]
    } else {
        sender_part
    };

    // Check if it's a trade whisper
    let is_trade = message.starts_with("Hi, I'm interested in your");
    
    // Extract item name from trade whisper
    let item_name = if is_trade {
        // Format: "Hi, I'm interested in your Frostburn listed for 2 wss"
        // Extract item name between "your" and "listed"
        if let Some(your_pos) = message.find("your ") {
            let after_your = &message[your_pos + 5..];
            if let Some(listed_pos) = after_your.find(" listed") {
                Some(after_your[..listed_pos].trim().to_string())
            } else {
                None
            }
        } else {
            None
        }
    } else {
        None
    };

    Some(WhisperEvent {
        is_trade,
        from: sender.to_string(),
        message: message.to_string(),
        item_name,
    })
}

/// Read new lines from the chat log file
fn read_new_lines(file_path: &Path, app_handle: tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let file = fs::File::open(file_path)?;
    let mut reader = BufReader::new(file);
    
    let mut last_pos = LAST_POSITION.lock().unwrap();
    
    // Seek to last position
    reader.seek(SeekFrom::Start(*last_pos))?;
    
    let mut line = String::new();
    while reader.read_line(&mut line)? > 0 {
        if let Some(whisper) = parse_whisper(&line) {
            // Emit whisper event to frontend
            let _ = app_handle.emit("whisper-received", whisper.clone());
        }
        line.clear();
    }
    
    // Update last position
    *last_pos = reader.seek(SeekFrom::Current(0))?;
    
    Ok(())
}

/// Start watching the chat log file
pub fn start_watching(app_handle: tauri::AppHandle, custom_d2_dir: Option<String>) -> Result<(), String> {
    let log_path = get_chat_log_path(custom_d2_dir.as_deref()).ok_or("Could not find or create chat log file")?;
    
    // Initialize last position to end of file
    if let Ok(file) = fs::File::open(&log_path) {
        if let Ok(metadata) = file.metadata() {
            *LAST_POSITION.lock().unwrap() = metadata.len();
        }
    }

    // Create watcher
    let log_path_for_watcher = log_path.clone();
    let mut watcher: RecommendedWatcher = notify::recommended_watcher(move |result: Result<Event, notify::Error>| {
        match result {
            Ok(event) => {
                if matches!(event.kind, EventKind::Modify(_)) {
                    let app_handle_clone = app_handle.clone();
                    let log_path_clone = log_path_for_watcher.clone();
                    
                    // Small delay to ensure file is fully written
                    std::thread::sleep(std::time::Duration::from_millis(100));
                    
                    if let Err(e) = read_new_lines(&log_path_clone, app_handle_clone) {
                        eprintln!("Error reading chat log: {}", e);
                    }
                }
            }
            Err(e) => {
                eprintln!("Watcher error: {}", e);
            }
        }
    }).map_err(|e| format!("Failed to create file watcher: {}", e))?;

    // Watch the log file
    watcher.watch(&log_path, RecursiveMode::NonRecursive)
        .map_err(|e| format!("Failed to watch chat log file: {}", e))?;

    // Store watcher handle
    *WATCHER_HANDLE.lock().unwrap() = Some(Arc::new(Mutex::new(Some(watcher))));

    Ok(())
}

/// Stop watching the chat log file
pub fn stop_watching() -> Result<(), String> {
    let mut handle_guard = WATCHER_HANDLE.lock().unwrap();
    if let Some(arc_watcher) = handle_guard.take() {
        if let Ok(mut watcher_guard) = arc_watcher.lock() {
            watcher_guard.take();
        }
    }
    Ok(())
}

