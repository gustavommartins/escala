// Benchmark do pipeline de conversão (espelha src-tauri/src/video.rs): mede tempo,
// velocidade, tamanho e qualidade (PSNR/SSIM contra o baseline) de variantes do ffmpeg.
// Rode: node scripts/bench.mjs <video1> [video2 ...] [--keep]
import { execSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, rmdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const binDir = join(root, "src-tauri", "binaries");

const triple = execSync("rustc -vV").toString().match(/host: (\S+)/)?.[1];
if (!triple) throw new Error("Não consegui descobrir o target triple (rustc instalado?)");
const ext = process.platform === "win32" ? ".exe" : "";
const FFMPEG = join(binDir, `ffmpeg-${triple}${ext}`);
const FFPROBE = join(binDir, `ffprobe-${triple}${ext}`);
for (const bin of [FFMPEG, FFPROBE]) {
  if (!existsSync(bin)) throw new Error(`Binário não encontrado: ${bin} (rode npm run fetch-ffmpeg)`);
}

const argv = process.argv.slice(2);
const keep = argv.includes("--keep");
const videos = argv.filter((a) => a !== "--keep");
if (videos.length === 0) {
  console.error("Uso: node scripts/bench.mjs <video1> [video2 ...] [--keep]");
  process.exit(1);
}
for (const v of videos) {
  if (!existsSync(v)) {
    console.error(`Arquivo não existe: ${v}`);
    process.exit(1);
  }
}

// Constantes iguais às de src-tauri/src/video.rs.
const PRESET = "medium";
const CRF = "18";
const AUDIO_BITRATE = "192k";

const VARIANTS = [
  { name: "baseline", hw: false, faststart: true },
  { name: "hwdec", hw: true, faststart: true },
  { name: "hwdec-nofaststart", hw: true, faststart: false },
  { name: "2x-parallel", parallel: true },
];

function run(bin, args) {
  return new Promise((resolve) => {
    const started = performance.now();
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (err) =>
      resolve({ ok: false, code: -1, stdout, stderr: String(err), seconds: 0 }),
    );
    child.on("close", (code) =>
      resolve({
        ok: code === 0,
        code,
        stdout,
        stderr,
        seconds: (performance.now() - started) / 1000,
      }),
    );
  });
}

// Mesma lógica de parse_ffprobe_json (video.rs).
async function probe(input) {
  const r = await run(FFPROBE, ["-show_streams", "-show_format", "-print_format", "json", input]);
  if (!r.ok) throw new Error(`ffprobe falhou: ${r.stderr.trim()}`);
  const out = JSON.parse(r.stdout);
  const streams = out.streams ?? [];
  const video = streams.find(
    (s) =>
      s.codec_type === "video" &&
      s.width != null &&
      (s.disposition?.attached_pic ?? 0) === 0,
  );
  if (!video) throw new Error("Nenhum stream de vídeo");

  let width = video.width;
  let height = video.height;
  const sideRot = video.side_data_list?.find((d) => d.rotation != null)?.rotation;
  const tagRot = parseFloat(video.tags?.rotate);
  const rotation = sideRot ?? (Number.isFinite(tagRot) ? tagRot : 0);
  if (Math.trunc(Math.abs(rotation) / 90) % 2 === 1) [width, height] = [height, width];

  const duration = parseFloat(out.format?.duration ?? video.duration) || 0;
  const audioCodec = streams.find((s) => s.codec_type === "audio")?.codec_name ?? null;
  const hdr = ["smpte2084", "arib-std-b67"].includes(video.color_transfer);
  const videoIndex = streams.filter(
    (s) => s.codec_type === "video" && (s.index ?? 0) < (video.index ?? 0),
  ).length;

  return { width, height, duration, audioCodec, videoIndex, hdr };
}

// Espelha build_ffmpeg_args (video.rs), exceto -progress (não afeta a saída).
function buildArgs(input, output, target, info, { hw = false, faststart = true } = {}) {
  const scale =
    info.width >= info.height
      ? `scale=-2:${target}:flags=lanczos`
      : `scale=${target}:-2:flags=lanczos`;
  // Mesma string da Rust (inclui os espaços do literal).
  const filter = info.hdr
    ? `${scale},zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,             tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p`
    : scale;

  const args = ["-hide_banner", "-nostdin", "-y"];
  if (hw) args.push("-hwaccel", "d3d11va");
  args.push(
    "-i", input,
    "-map", `0:v:${info.videoIndex}`, "-map", "0:a:0?",
    "-vf", filter,
    "-c:v", "libx264", "-preset", PRESET, "-crf", CRF,
    "-pix_fmt", "yuv420p",
    "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
  );
  if (info.audioCodec === "aac" || info.audioCodec === "mp3") {
    args.push("-c:a", "copy");
  } else {
    args.push("-c:a", "aac", "-b:a", AUDIO_BITRATE);
  }
  if (faststart) args.push("-movflags", "+faststart");
  args.push("-nostats", output);
  return args;
}

// Último "average:" (PSNR) ou "All:" (SSIM) do stderr; null se não achar.
// Obs.: o filtro ssim do ffmpeg não imprime "average:", imprime "All:".
async function quality(variantFile, reference, kind) {
  const filter = kind === "psnr" ? "[0:v][1:v]psnr" : "[0:v][1:v]ssim";
  const r = await run(FFMPEG, [
    "-hide_banner", "-nostdin",
    "-i", variantFile, "-i", reference,
    "-lavfi", filter, "-f", "null", "-",
  ]);
  if (!r.ok) return null;
  const re = kind === "psnr" ? /average:(\S+)/g : /All:(\S+)/g;
  const matches = [...r.stderr.matchAll(re)];
  return matches.length ? matches[matches.length - 1][1] : null;
}

const fmt = (n, d = 2) => (Number.isFinite(n) ? n.toFixed(d) : "—");
const mb = (file) => fmt(statSync(file).size / 1048576);

async function benchVideo(idx, input, outDir, created) {
  const info = await probe(input);
  const target = Math.min(info.width, info.height) > 1080 ? 1080 : 720;
  console.log(
    `${basename(input)}: ${info.width}x${info.height}, ${fmt(info.duration)}s, ` +
      `alvo ${target}p, HDR=${info.hdr}, áudio=${info.audioCodec ?? "nenhum"}`,
  );

  const out = (tag) => join(outDir, `v${idx}-${tag}.mp4`);
  const baselineFile = out("baseline");
  const rows = [];

  for (const v of VARIANTS) {
    let ok;
    let seconds;
    let file;
    let speed;

    if (v.parallel) {
      const a = out("2x-a");
      const b = out("2x-b");
      created.push(a, b);
      const started = performance.now();
      const [ra, rb] = await Promise.all([
        run(FFMPEG, buildArgs(input, a, target, info)),
        run(FFMPEG, buildArgs(input, b, target, info)),
      ]);
      seconds = (performance.now() - started) / 1000;
      ok = ra.ok && rb.ok;
      file = a;
      // Velocidade efetiva: duas conversões de `duration` em `seconds`.
      speed = (2 * info.duration) / seconds;
    } else {
      file = out(v.name);
      created.push(file);
      const r = await run(FFMPEG, buildArgs(input, file, target, info, v));
      ok = r.ok;
      seconds = r.seconds;
      speed = info.duration / seconds;
    }

    if (!ok) {
      rows.push({ variante: v.name, "tempo (s)": "FALHOU", speed: "—", MB: "—", PSNR: "—", SSIM: "—" });
      continue;
    }

    const psnr = await quality(file, baselineFile, "psnr");
    const ssim = await quality(file, baselineFile, "ssim");
    rows.push({
      variante: v.name,
      "tempo (s)": fmt(seconds),
      speed: fmt(speed),
      MB: mb(file),
      PSNR: psnr ?? "—",
      SSIM: ssim ?? "—",
    });
  }
  return rows;
}

async function main() {
  const outDir = join(tmpdir(), "escala-bench");
  mkdirSync(outDir, { recursive: true });
  const created = [];
  try {
    for (let i = 0; i < videos.length; i++) {
      console.log(`\n=== ${videos[i]} ===`);
      try {
        const rows = await benchVideo(i, videos[i], outDir, created);
        console.table(rows);
      } catch (err) {
        console.error(`Falha no vídeo: ${err.message}`);
        process.exitCode = 1;
      }
    }
  } finally {
    if (keep) {
      console.log(`\nSaídas mantidas em ${outDir}`);
    } else {
      for (const f of created) rmSync(f, { force: true });
      try {
        rmdirSync(outDir);
      } catch {
        // diretório não vazio (outra execução) — deixa como está
      }
    }
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
