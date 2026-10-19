# Third-party notices

The Escala source code in this repository is licensed under the [MIT License](LICENSE).
The installers published in [Releases](../../releases) additionally bundle the third-party
software below, which is **not** covered by the MIT License.

## FFmpeg (bundled in the installers)

- Binaries: `ffmpeg.exe` and `ffprobe.exe`, the **GPL v3** build (`--enable-gpl --enable-version3`,
  includes libx264) from [BtbN/FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds).
- Version bundled in the releases: `N-127650-geceaa54a38` (FFmpeg git commit `eceaa54a38`, built 2026-10-18).
- License: GNU General Public License v3 — <https://www.gnu.org/licenses/gpl-3.0.html>
- Source code:
  - FFmpeg: <https://github.com/FFmpeg/FFmpeg> (commit `eceaa54a38`)
  - Build scripts and the other bundled libraries (x264 etc.): <https://github.com/BtbN/FFmpeg-Builds>
- FFmpeg is run as a separate program (`ffmpeg`/`ffprobe` sidecars); Escala does not link against it.
- The binaries are not stored in this repository; `npm run fetch-ffmpeg` downloads them.
- If you cannot obtain the source from the links above, open an issue in this repository and it will be provided.

FFmpeg is a trademark of Fabrice Bellard, originator of the FFmpeg project.

## Libraries used by the app

Escala is built with [Tauri](https://tauri.app) (MIT / Apache-2.0) and the Rust crates listed in
`src-tauri/Cargo.lock` and the npm packages in `package-lock.json`, each under its own license.
