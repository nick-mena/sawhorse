//! Saving a file without ever leaving it half written (lane 16).
//!
//! The fs plugin's `writeFile` truncates the file and writes it in place: a crash, a power
//! cut or a full disk halfway leaves a truncated `.shz` (its zip directory is written last)
//! and the previous good copy is gone. [`write_atomic`] instead writes the bytes to a
//! temporary file in the same folder, flushes it to disk, reads it back and compares it
//! byte for byte, keeps the previous file as `<name>.bak`, and only then renames the
//! temporary file over the original (a rename within one folder replaces it whole or not
//! at all). Any failure removes the temporary file and leaves the original as it was.

use std::fmt;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

/// Why a save failed. The original file is unchanged.
#[derive(Debug)]
pub enum SaveError {
    /// The path has no folder or file name to write beside.
    BadPath(String),
    /// Writing, syncing, reading back or renaming failed.
    Io(String),
    /// What was read back is not what was written (a full disk, a failing drive).
    Mismatch,
}

impl fmt::Display for SaveError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            SaveError::BadPath(p) => write!(f, "cannot save to {p}"),
            SaveError::Io(e) => write!(f, "could not write the file: {e}"),
            SaveError::Mismatch => write!(
                f,
                "the file read back differently from what was written (is the disk full?); the original was kept"
            ),
        }
    }
}

impl std::error::Error for SaveError {}

/// The temporary file and backup next to `path`.
fn siblings(path: &Path) -> Result<(PathBuf, PathBuf), SaveError> {
    let name = path
        .file_name()
        .ok_or_else(|| SaveError::BadPath(path.display().to_string()))?
        .to_string_lossy()
        .into_owned();
    let dir = path.parent().unwrap_or(Path::new("."));
    Ok((
        dir.join(format!(".{name}.saving")),
        dir.join(format!("{name}.bak")),
    ))
}

/// Write `bytes` to `path` atomically (see the module docs). The previous file, if any, is
/// kept as `<name>.bak` when that can be done: a backup that cannot be written never stops
/// the save, which is the copy the person asked for.
///
/// A symlink is written through (the file it names is the one replaced), and the replaced
/// file's permissions carry over. The rename is flushed to disk with its folder, so a
/// power cut after a save that reported success cannot bring the old file back.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), SaveError> {
    let target = fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let (tmp, bak) = siblings(&target)?;
    let io = |e: std::io::Error| SaveError::Io(e.to_string());
    let previous = fs::metadata(&target).ok();
    // The name is ours alone: a stale temporary file is cleared, and a link planted there
    // is never followed (create_new refuses anything already at the path).
    match fs::symlink_metadata(&tmp) {
        Ok(m) if !m.is_dir() => fs::remove_file(&tmp).map_err(io)?,
        _ => {}
    }
    let result = (|| {
        {
            let mut f = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&tmp)
                .map_err(io)?;
            f.write_all(bytes).map_err(io)?;
            f.sync_all().map_err(io)?;
        }
        // Read back: the bytes on disk must be the bytes given.
        let mut back = Vec::with_capacity(bytes.len());
        fs::File::open(&tmp)
            .map_err(io)?
            .read_to_end(&mut back)
            .map_err(io)?;
        if back != bytes {
            return Err(SaveError::Mismatch);
        }
        drop(back);
        if let Some(p) = &previous {
            let _ = fs::copy(&target, &bak);
            // After the read-back, so a file that was read-only can still be checked. Best
            // effort: not every file system keeps permissions.
            let _ = fs::set_permissions(&tmp, p.permissions());
        }
        fs::rename(&tmp, &target).map_err(io)?;
        sync_folder(&target);
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}

/// Flush the folder holding `path`, so a rename in it survives a power cut. Best effort: the
/// file is already whole, and not every file system can sync a folder.
fn sync_folder(path: &Path) {
    #[cfg(unix)]
    if let Some(dir) = path.parent() {
        if let Ok(d) = fs::File::open(dir) {
            let _ = d.sync_all();
        }
    }
    #[cfg(not(unix))]
    let _ = path;
}

/// Percent-decode a path sent from the webview in a header (`encodeURIComponent`).
pub fn percent_decode(s: &str) -> Option<String> {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' {
            let h = std::str::from_utf8(b.get(i + 1..i + 3)?).ok()?;
            out.push(u8::from_str_radix(h, 16).ok()?);
            i += 3;
        } else {
            out.push(b[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dir(name: &str) -> PathBuf {
        let d =
            std::env::temp_dir().join(format!("sawhorse-safe-save-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn writes_keeps_a_backup_and_leaves_no_temporary_file() {
        let d = dir("basic");
        let p = d.join("Bench.shz");
        write_atomic(&p, b"first").unwrap();
        assert_eq!(fs::read(&p).unwrap(), b"first");
        assert!(
            !d.join("Bench.shz.bak").exists(),
            "nothing to back up the first time"
        );
        write_atomic(&p, b"second version").unwrap();
        assert_eq!(fs::read(&p).unwrap(), b"second version");
        assert_eq!(fs::read(d.join("Bench.shz.bak")).unwrap(), b"first");
        assert!(!d.join(".Bench.shz.saving").exists());
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn a_failed_save_leaves_the_original() {
        let d = dir("fail");
        let p = d.join("Shelf.shz");
        write_atomic(&p, b"good").unwrap();
        // The temporary file's place is taken by a folder: the write fails, the original stays.
        fs::create_dir_all(d.join(".Shelf.shz.saving")).unwrap();
        assert!(matches!(write_atomic(&p, b"new"), Err(SaveError::Io(_))));
        assert_eq!(fs::read(&p).unwrap(), b"good");
        let _ = fs::remove_dir_all(&d);
    }

    #[cfg(unix)]
    #[test]
    fn a_save_keeps_the_permissions_of_the_file_it_replaces() {
        use std::os::unix::fs::PermissionsExt;
        let d = dir("mode");
        let p = d.join("Private.shz");
        write_atomic(&p, b"first").unwrap();
        fs::set_permissions(&p, fs::Permissions::from_mode(0o600)).unwrap();
        write_atomic(&p, b"second").unwrap();
        let mode = fs::metadata(&p).unwrap().permissions().mode() & 0o777;
        let _ = fs::remove_dir_all(&d);
        assert_eq!(mode, 0o600, "keeps its permissions");
    }

    #[cfg(unix)]
    #[test]
    fn a_save_through_a_symlink_reaches_the_linked_file() {
        let d = dir("link");
        let real = d.join("Real.shz");
        let link = d.join("Link.shz");
        write_atomic(&real, b"first").unwrap();
        std::os::unix::fs::symlink(&real, &link).unwrap();
        write_atomic(&link, b"second").unwrap();
        let bytes = fs::read(&real).unwrap();
        let link_was_kept = fs::symlink_metadata(&link).unwrap().is_symlink();
        let _ = fs::remove_dir_all(&d);
        assert_eq!(bytes, b"second", "reaches the linked file");
        assert!(link_was_kept);
    }

    #[test]
    fn a_backup_that_cannot_be_written_does_not_stop_the_save() {
        let d = dir("bak");
        let p = d.join("Shelf.shz");
        write_atomic(&p, b"good").unwrap();
        fs::create_dir_all(d.join("Shelf.shz.bak")).unwrap();
        let saved = write_atomic(&p, b"new");
        let _ = fs::remove_dir_all(&d);
        assert!(saved.is_ok(), "a backup that cannot be written: {saved:?}");
    }

    #[cfg(unix)]
    #[test]
    fn a_link_planted_at_the_temporary_name_is_not_followed() {
        let d = dir("planted");
        let victim = d.join("victim");
        fs::write(&victim, b"untouched").unwrap();
        std::os::unix::fs::symlink(&victim, d.join(".Doc.shz.saving")).unwrap();
        write_atomic(&d.join("Doc.shz"), b"mine").unwrap();
        let (kept, saved) = (
            fs::read(&victim).unwrap(),
            fs::read(d.join("Doc.shz")).unwrap(),
        );
        let _ = fs::remove_dir_all(&d);
        assert_eq!(kept, b"untouched");
        assert_eq!(saved, b"mine");
    }

    #[test]
    fn paths_come_through_percent_encoding() {
        assert_eq!(
            percent_decode("C%3A%5CUsers%5Cme%5CBench%20%C3%A9.shz").as_deref(),
            Some("C:\\Users\\me\\Bench é.shz")
        );
        assert_eq!(percent_decode("bad%zz"), None);
        assert!(siblings(Path::new("/")).is_err());
    }
}
