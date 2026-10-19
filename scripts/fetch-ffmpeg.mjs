// Baixa o FFmpeg/ffprobe (Windows) e coloca em src-tauri/binaries com o sufixo
// do target triple que o Tauri exige para sidecars. Rode: npm run fetch-ffmpeg
import { execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ZIP_URL = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip";
const root = fileURLToPath(new URL("..", import.meta.url));
const outDir = join(root, "src-tauri", "binaries");

const triple = execSync("rustc -vV").toString().match(/host: (\S+)/)?.[1];
if (!triple) throw new Error("Não consegui descobrir o target triple (rustc instalado?)");
const ext = process.platform === "win32" ? ".exe" : "";

if (process.platform !== "win32") {
  throw new Error("Este script baixa o build do Windows. Em outros sistemas, copie ffmpeg/ffprobe para src-tauri/binaries/ com o sufixo -" + triple);
}

const targets = ["ffmpeg", "ffprobe"].map((n) => join(outDir, `${n}-${triple}${ext}`));
if (targets.every(existsSync)) {
  console.log("FFmpeg já está em src-tauri/binaries — nada a fazer.");
  process.exit(0);
}

mkdirSync(outDir, { recursive: true });
const tmp = mkdtempSync(join(tmpdir(), "escala-ffmpeg-"));
const zip = join(tmp, "ffmpeg.zip");

console.log("Baixando FFmpeg (~190 MB)…");
const res = await fetch(ZIP_URL);
if (!res.ok) throw new Error(`Download falhou: HTTP ${res.status}`);
writeFileSync(zip, Buffer.from(await res.arrayBuffer()));

console.log("Extraindo…");
// tar.exe do Windows (bsdtar): o tar do Git Bash não entende caminhos "C:\...".
const tar = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
execSync(`"${tar}" -xf "${zip}" -C "${tmp}"`);

const folder = readdirSync(tmp).find((d) => d.startsWith("ffmpeg-") && d !== "ffmpeg.zip");
if (!folder) throw new Error("Estrutura inesperada no zip do FFmpeg.");

for (const name of ["ffmpeg", "ffprobe"]) {
  copyFileSync(join(tmp, folder, "bin", `${name}${ext}`), join(outDir, `${name}-${triple}${ext}`));
}
console.log("Pronto:", targets.join("\n       "));
