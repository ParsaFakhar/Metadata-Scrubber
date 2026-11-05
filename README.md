# Metadata Scrubber — Firefox Nightly 161+ (macOS) — v2.8.1

Strips EXIF/GPS/XMP and other identifying metadata from files before a site can receive them,
entirely on-device. Runs in the page's MAIN world at `document_start`, no script manager needed.

## Using it

Click the shield in the toolbar.

- **Pause 10 min / 1 hour / Turn off for this site** — uploads on that site go out untouched.
  Timed pauses end by themselves; the icon turns grey with an OFF badge while paused.
- **Master switch** (top right) — off everywhere.
- **Convert WebP** — per-site switch (re-encode WebP as JPG/PNG when smaller). Option+Shift+C still toggles it.
- **⌃⇧U** — pause/resume the current site (rebind under about:addons → gear → Manage Extension Shortcuts).
- When an upload is **blocked** (a file that cannot be scrubbed safely), the toast has an **Upload anyway**
  button: it pauses the site for 5 minutes and hands the file picker its original files back. For uploads the
  page sends by itself (fetch/XHR) the button says *Turn off for 5 min*; retry the upload afterwards.

## Install

1. `about:config` → `xpinstall.signatures.required` = `false` (Nightly only).
2. `about:addons` → gear → **Install Add-on From File…** → this `.xpi`.
3. Remove the Tampermonkey copy of Metadata Scrubber (two copies double the work).

**Do not run it together with the Tampermonkey copy.** Both would hook the same uploads. (v2.8.1 no longer loops when they do,
but every file is still scrubbed twice.)

Reload tabs that were open before installing; they have no content script until then.

## Notes

- Pause state lives in `storage.local`; nothing leaves the machine. The page cannot see or fake the toasts,
  the pause state or the buttons (random per-load channel name, UI drawn by the extension).
- `main.js` is the MAIN-world bundle: a small prelude (bridge + GM shims) followed by the userscript, patched so every
  interception checks the pause flag first.
- Bundled pdf-lib is byte-identical to the pinned 1.17.1 build (sha256 0f9a5cad…694f).
# Metadata-Scrubber
