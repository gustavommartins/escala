# Escala

**English** · [Português](README.pt-BR.md) · [Español](README.es.md)

Converts videos to a lower resolution (for example, 4K → 1080p) with no visible quality loss.
Drag in a video, pick a resolution, done — no codec settings to worry about.

Built with **Rust + Tauri 2** and a bundled **FFmpeg**.

## How to use

1. Open the app and drag a video onto it (or click **Choose file…**).
2. Pick a resolution (only options smaller than the video's are shown; 1080p is preselected).
3. Click **Convert**. The new file is saved next to the original as `name_1080p.mp4`.
   The original is never modified.

**Language:** the app follows your system language (English, Português or Español; English otherwise).
You can change it any time with the ⚙︎ button in the top-right corner.

## Download

Get the Windows installer from the [Releases](../../releases) page. FFmpeg is included.

## Development

Requirements: [Rust](https://rustup.rs), Node.js 20+ and the Tauri prerequisites for Windows (WebView2, MSVC Build Tools).

```bash
npm install
npm run fetch-ffmpeg   # downloads FFmpeg into src-tauri/binaries (once)
npm run tauri dev      # runs the app in development mode
npm run tauri build    # builds the installer (FFmpeg included)
cd src-tauri && cargo test   # tests for the conversion logic
```

## Where to change things

| What | Where |
|---|---|
| Quality (CRF), speed (preset), audio, resolution list | `src-tauri/src/video.rs` (constants at the top) |
| Commands the front end calls (probe, convert, cancel) | `src-tauri/src/commands.rs` |
| Screens and flow | `index.html`, `src/main.ts` |
| Translations (add a language here) | `src/i18n.ts` |
| Look and feel (colors, spacing, dark mode) | `src/styles.css` |

### Default quality settings

- Video: H.264 (`libx264`), `-crf 18` (visually lossless), `-preset medium`, Lanczos scaling, aspect ratio preserved. HDR sources are tone-mapped to SDR.
- Audio: copied as-is when it is AAC/MP3; otherwise AAC 192 kbps.
- Output: MP4 with `faststart`, playable almost anywhere.

## License

Escala is released under the [MIT License](LICENSE). The installers bundle the GPL build of FFmpeg (needed for the x264 encoder), downloaded from
[BtbN/FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds); see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for its license and source code.
