# Metadata Scrubber

**A Firefox extension that strips identifying metadata from files before a website can receive them.**

Metadata Scrubber sits between the page and the network. When a site tries to upload a file, the extension removes EXIF, GPS, XMP, PDF document info and other identifying metadata first, so the site only ever receives the cleaned copy. Everything runs locally in your browser. There are no servers, no network calls and no telemetry.

> **Version:** 2.8.2 &nbsp;|&nbsp; **Browser:** Firefox 160.0a1 or newer &nbsp;|&nbsp; **Manifest:** V3 &nbsp;|&nbsp; **Data collection:** none

---

## Contents

- [Features](#features)
- [What gets scrubbed](#what-gets-scrubbed)
- [How it works](#how-it-works)
- [Installation](#installation)
- [Usage](#usage)
- [Configuration](#configuration)
- [Threat model and limitations](#threat-model-and-limitations)
- [Project layout](#project-layout)
- [Privacy](#privacy)
- [License](#license)

---

## Features

- **Broad interception.** Catches uploads from file inputs (including detached and shadow-DOM inputs), drag and drop, clipboard paste, native form submits, `FormData`, `fetch`, `XMLHttpRequest`, `sendBeacon`, WebSocket, RTCDataChannel and WebTransport (best effort).
- **Many formats.** JPEG, PNG, WebP, GIF, JPEG 2000, PDF, plain ZIP archives (recursively), HTML and TXT.
- **Fail-closed by default.** If a recognised file cannot be scrubbed, the upload is blocked instead of sending the original.
- **Filename randomisation.** Original filenames are replaced with random ones so they can't leak.
- **Per-site controls.** Pause scrubbing for 10 minutes, 1 hour, or turn it off for one site, from the toolbar popup or a keyboard shortcut.
- **Optional WebP conversion.** Re-encode static WebP uploads to JPG or PNG, whichever is smaller, for sites that reject WebP.
- **Optional size optimisation.** Compress large images before upload, then strip them.
- **Honest feedback.** On-page toasts tell you what was cleaned, what passed through untouched, and what was blocked.
- **On-device only.** Nothing is sent anywhere. The only bundled dependency is [pdf-lib](https://github.com/Hopding/pdf-lib).

## What gets scrubbed

| Format | What is removed or handled |
| --- | --- |
| **JPEG** | EXIF (including GPS, embedded thumbnails and maker notes), XMP, IPTC and other application segments, comments. Orientation and sanitised ICC profiles are kept by default. Malformed files are repaired or rebuilt rather than passed through. |
| **PNG** | Everything outside a whitelist of rendering-critical chunks (`IHDR`, `PLTE`, `IDAT`, `IEND`, `tRNS`, `gAMA`, `cHRM`, `sRGB`, `iCCP`, `cICP` and the APNG animation chunks). Text, EXIF and timestamp chunks are dropped. |
| **WebP** | EXIF and XMP chunks, with the matching header flags cleared. |
| **GIF** | Comment and non-essential extension blocks. Looping application blocks are preserved so animations keep working. |
| **JPEG 2000** | Metadata boxes and comment markers in the main header. |
| **PDF** | Info dictionary, XMP, document ID, annotation authors and dates, stale page thumbnails, embedded files, auto-run and launch actions, layer names and old revisions. Pages are copied into a fresh document. Signed PDFs are left alone by default, because scrubbing would break the signature. |
| **ZIP** | Each entry is scrubbed recursively. OS junk (`__MACOSX`, `.DS_Store`, `Thumbs.db` and similar) is removed, user-profile paths are trimmed, and CRC-32 is verified. Zip-bomb limits apply. |
| **HTML** | Metadata and comments are stripped, with a tokenizer that leaves visible text and script content intact. |
| **TXT** | Invisible watermark characters such as zero-width spaces, Unicode tag characters and variation-selector supplements. |

Other file types pass through with a warning toast, or are blocked if you enable `blockUnsupported`. Filenames are still randomised for pass-through files.

## How it works

The extension injects two content scripts into every page and frame at `document_start`:

1. **`bridge.js`** runs in the extension's isolated world. It holds your settings, talks to the background page and draws toasts.
2. **`main.js`** runs in the page's own JavaScript world, so it can hook upload APIs before any page script has a chance to capture the native ones. It talks to the bridge over a private, per-page, randomly named event channel.

The scrubber works at two layers:

- **At selection time.** Files that arrive through inputs, drag and drop or paste are swapped for cleaned copies before the page can read them.
- **At the network layer.** `fetch`, XHR, `sendBeacon`, WebSockets and the other hooks act as a backstop and catch anything that didn't arrive through a hooked path.

## Installation

The extension ships as `metadata-scrubber-v2_8_2.xpi` and declares `strict_min_version` 160.0a1, so it needs Firefox 160 or newer (Nightly counts).

**Release and Beta builds only run Mozilla-signed add-ons.** Pick whichever route fits you:

1. **Temporary install (any Firefox, resets on restart).**
   Open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on…** and choose the `.xpi` (or the `manifest.json` from the unpacked folder).
2. **Permanent unsigned install (Nightly, Developer Edition, ESR or unbranded builds).**
   Set `xpinstall.signatures.required` to `false` in `about:config`, then open the `.xpi` in Firefox, or drag it onto a window.
3. **Signed install.**
   Submit the `.xpi` to [addons.mozilla.org](https://addons.mozilla.org/developers/) as an unlisted add-on to get a signed build you can install on any Firefox.

After installing, **reload any tabs that were already open**. The content scripts only attach to pages loaded after the extension is active.

### Building from source

The `.xpi` is a plain zip of the extension files:

```bash
zip -r metadata-scrubber.xpi manifest.json *.js popup.html popup.css icons/
```

## Usage

Once installed, scrubbing is **on everywhere by default**. Just upload files as normal.

**Toolbar popup**

- **Global switch** turns scrubbing on or off for every site.
- **Pause 10 min / Pause 1 hour / Turn off for this site** control the current site only.
- **Convert WebP** (per site) converts static WebP uploads to JPG or PNG, whichever is smaller. Animated WebP is left alone because a canvas would keep only the first frame.
- **Size Optimization** (per site) re-encodes JPEG, PNG and WebP images over 2 MB as compressed JPEG, downscaled so the longest side is at most 3840 px, and then strips them. It only applies when the result is actually smaller.
- **Debug Console Logs** enables `[MetadataScrubber]` diagnostics in the web console. It is off by default, so pages can't observe the extension's logging.

**Toolbar icon.** The icon and badge show whether scrubbing is active, paused (`OFF`) or disabled globally.

**Keyboard shortcuts**

| Shortcut | Action |
| --- | --- |
| `Ctrl`+`Shift`+`U` (macOS, the `Control` key) | Pause or resume scrubbing on the current site. A default is only suggested on macOS. On other platforms, assign one at `about:addons` → gear icon → **Manage Extension Shortcuts**. |
| `Alt`+`Shift`+`C` | Toggle WebP conversion for the current site. |

**When an upload is blocked.** In fail-closed mode, a toast explains why and offers **Upload anyway**. That pauses scrubbing on the site for 5 minutes and replays the original selection. Use it deliberately.

## Configuration

Behaviour is controlled by a `CONFIG` object near the top of `main.js`. Edit it and repackage the extension to change defaults. The most useful options:

| Option | Default | Effect |
| --- | --- | --- |
| `failClosed` | `true` | Block the upload if a recognised file can't be scrubbed. |
| `blockUnsupported` | `false` | Also block file types the scrubber can't handle at all (Office files, video and so on). |
| `renameFiles` | `true` | Replace filenames with random ones. Can break sites that depend on the original name. |
| `keepOrientation` | `true` | Keep an orientation-only EXIF block so photos don't rotate. |
| `keepICC` | `true` | Keep sanitised ICC colour profiles. Set `false` to drop them (colours may shift). |
| `jpegReencode` | `false` | Re-encode JPEGs through a canvas. Lossy, but removes even the quantisation-table fingerprint. |
| `skipSignedPdfs` | `true` | Leave digitally signed PDFs untouched (with a warning). |
| `stripStegoCharacters` | `false` | Also strip ZWJ/ZWNJ and variation selectors from text. Closes more zero-width channels but breaks emoji sequences. |
| `maxBytes` | 200 MiB | Files above this size are not read into memory (blocked under `failClosed`). |
| `convertTargets` | `['jpg','png']` | Formats a WebP may be converted to. |
| `convertJpegQuality` | `0.85` | JPEG quality for WebP conversion. |
| `zipFlattenPaths` / `zipRandomizeEntryNames` / `zipAsciiNames` | `false` | Additional zip entry-name hardening (the latter two can break references between files). |
| `includeHosts` / `excludeHosts` | `[]` | Limit scrubbing to, or exclude, specific hosts. |

## Threat model and limitations

Metadata Scrubber protects against **honest-but-nosy sites**: pages and servers that simply receive whatever your browser sends. It is **not** a defence against a page that is actively hostile to the scrubber.

**Not covered**

- Hostile pages: same-origin iframes (their `window` has pristine `fetch` and XHR), Web, Service and Shared Workers, pre-captured native API references, and prototype poisoning of builtins.
- Uploads the hooks can't see: fragmented WebTransport writes, base64-in-JSON bodies, hand-built multipart bodies, chunked uploads built from slices of a file that didn't arrive through a hooked path, inputs triggered by synthetic click events, declarative shadow DOM, and drops or pastes inside closed shadow roots.
- File types: Office documents (docx, xlsx, pptx), OpenDocument, EPUB, JAR, MP4/MOV/audio, SVG, HEIC and RAW/DNG pass through unscrubbed (or are blocked with `blockUnsupported`).
- PDF caveats: inline images, JBIG2, and Flate+DCT image streams with predictor parameters are not scrubbed. Forms, bookmarks, named destinations and tagged structure are lost, PDF/A and PDF/UA conformance is destroyed, and font name tables and text content are untouched.
- Content, not metadata: link URLs inside HTML and PDF, visible text and pixel content are left alone by design. Sensor noise (PRNU) and encoder fingerprints are also out of scope.

**For anything high-stakes, strip metadata at the source** with [`exiftool -all=`](https://exiftool.org/) or [`mat2`](https://0xacab.org/jvoisin/mat2), and treat this extension as a safety net.

## Project layout

```
manifest.json     MV3 manifest, permissions, content-script registration
common.js         Shared settings and per-site rule logic (storage.local)
background.js     Event page: toolbar icon/badge, toast relay, keyboard command
bridge.js         Isolated-world content script: settings, toasts, MAIN-world channel
main.js           MAIN-world scrubber: hooks and all format parsers (~190 KB)
pdf-lib.min.js    Bundled pdf-lib, used for the PDF rewrite
popup.html/.css/.js   Toolbar popup UI
icons/            Extension and toolbar icons
```

**Permissions:** only `storage`. The content scripts match `*://*/*` in all frames (including `about:blank`), because that is where uploads happen.

## Privacy

- 100% on-device processing. The extension makes no network requests of its own.
- Declared `data_collection_permissions: none`.
- Settings (global switch, per-site pause, convert and optimise flags, debug flag) are stored in `storage.local` and never leave your browser.
- Filenames appear only in the optional debug console, never in the page DOM.

## License

MIT. `pdf-lib` is bundled under its own MIT license.
