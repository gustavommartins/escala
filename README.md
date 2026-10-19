# Escala

**English** · [Português](README.pt-BR.md) · [Español](README.es.md)

Converts videos to a lower resolution (for example, 4K → 1080p) with no visible quality loss.
Drag in one or more videos, pick a resolution, done — no codec settings to worry about.

Built with **Rust + Tauri 2** and a bundled **FFmpeg**.

## How to use

1. Open the app and drag one or more videos onto it (or click **Choose file…**; use **Add videos** later to add more).
2. Pick a resolution (only options smaller than the video's are shown; 1080p is preselected). The choice applies to every video in the queue. To use a different one for a single video, change its **Resolution** in that row.
   Videos whose resolution is not smaller than the chosen one are marked **Skipped** and are not converted.
3. Click **Convert all**. The new file is saved next to the original as `name_1080p.mp4`.
   The original is never modified.

**Queue:** several videos convert at the same time. Set how many in ⚙︎ → **Simultaneous conversions** (1 to 4; by default, 2 on machines with 8 or more cores, otherwise 1). Each row shows the percentage, speed and estimated time left; the bar at the bottom shows the overall progress.

**Hardware decoding** (⚙︎ → **Hardware video decoding**, off by default): uses the GPU only to read the input, which can speed up 4K sources. The output is identical, because encoding still uses x264 with CRF 18. It applies to H.264, HEVC, AV1 and VP9 inputs; if the driver fails, the app falls back to software decoding on its own.

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
| Queue rules (skipped videos, per-video resolution) | `src/queue.ts` |
| Footer with the app version | `src/footer.ts` |
| Screens and flow | `index.html`, `src/main.ts` |
| Translations (add a language here) | `src/i18n.ts` |
| Look and feel (colors, spacing, dark mode) | `src/styles.css` |

### Default quality settings

- Video: H.264 (`libx264`), `-crf 18` (visually lossless), `-preset medium`, Lanczos scaling, aspect ratio preserved. HDR sources are tone-mapped to SDR.
- Audio: copied as-is when it is AAC/MP3; otherwise AAC 192 kbps.
- Output: MP4 with `faststart`, playable almost anywhere.

## Building the installer (maintainers)

1. Bump `version` in `package.json` and in `src-tauri/Cargo.toml` (they must be equal).
2. Run `npm install` and `npm run fetch-ffmpeg`.
3. Run `npm run tauri build`. The NSIS installer is written to `src-tauri/target/release/bundle/nsis/`.
4. Upload the installer manually to the [Releases](../../releases) page on GitHub.

### Benchmark

```bash
npm run bench -- video1.mp4 video2.mov   # add --keep to keep the outputs
```

Needs FFmpeg already fetched (`npm run fetch-ffmpeg`) and Rust installed. It runs the encoding variants (baseline, hardware decoding, parallel) on each video and compares time, speed, size and PSNR/SSIM against the baseline. Use it to decide the defaults for simultaneous conversions and hardware decoding. Outputs go to a temporary folder and are deleted unless `--keep` is passed.

## License

Escala is released under the [MIT License](LICENSE). The installers bundle the GPL build of FFmpeg (needed for the x264 encoder), downloaded from
[BtbN/FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds); see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for its license and source code.
