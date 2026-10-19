# Escala

[English](README.md) · [Português](README.pt-BR.md) · **Español**

Convierte videos a una resolución menor (por ejemplo, 4K → 1080p) sin pérdida visible de calidad.
Arrastra uno o más videos, elige la resolución y listo — sin ajustes de códec.

Hecho con **Rust + Tauri 2** y **FFmpeg** integrado.

## Cómo usar

1. Abre la app y arrastra uno o más videos (o haz clic en **Elegir archivo…**; luego usa **Añadir videos** para agregar más).
2. Elige la resolución (solo aparecen opciones menores que la del video; 1080p viene preseleccionada). La elección vale para todos los videos de la cola. Para usar otra resolución en un video concreto, cambia su **Resolución** en esa fila.
   Los videos cuya resolución no es menor que la elegida se marcan como **Omitido** y no se convierten.
3. Haz clic en **Convertir todo**. El archivo nuevo se guarda en la misma carpeta, como `nombre_1080p.mp4`.
   El original nunca se modifica.

**Cola:** varios videos se convierten al mismo tiempo. Define cuántos en ⚙︎ → **Conversiones simultáneas** (de 1 a 4; por defecto, 2 en equipos con 8 núcleos o más, si no 1). Cada fila muestra el porcentaje, la velocidad y el tiempo restante estimado; la barra al final muestra el progreso general.

**Decodificación por hardware** (⚙︎ → **Decodificación de video por hardware**, desactivada por defecto): usa la GPU solo para leer el archivo de entrada, lo que puede acelerar videos en 4K. La salida es idéntica, porque la codificación sigue usando x264 con CRF 18. Aplica a entradas H.264, HEVC, AV1 y VP9; si el controlador falla, la app vuelve sola a la decodificación por software.

**Actualizaciones:** Escala busca una nueva versión al abrirse y descarga la actualización en segundo plano. Cuando está lista, aparece un botón **Reiniciar** en el pie de página. La app nunca se reinicia en medio de una conversión: si haces clic mientras hay videos convirtiéndose, espera a que la cola se vacíe. La versión actual aparece en el pie de página.

**Idioma:** la app sigue el idioma del sistema (English, Português o Español; inglés en los demás casos).
Puedes cambiarlo en cualquier momento con el botón ⚙︎ de la esquina superior derecha.

## Descarga

Descarga el instalador para Windows desde la página de [Releases](../../releases). FFmpeg ya está incluido.

## Desarrollo

Requisitos: [Rust](https://rustup.rs), Node.js 20+ y los requisitos de Tauri para Windows (WebView2, MSVC Build Tools).

```bash
npm install
npm run fetch-ffmpeg   # descarga FFmpeg en src-tauri/binaries (una sola vez)
npm run tauri dev      # abre la app en modo desarrollo
npm run tauri build    # genera el instalador (FFmpeg incluido)
cd src-tauri && cargo test   # pruebas de la lógica de conversión
```

## Dónde modificar

| Qué | Dónde |
|---|---|
| Calidad (CRF), velocidad (preset), audio, lista de resoluciones | `src-tauri/src/video.rs` (constantes al inicio) |
| Comandos que llama el front end (analizar, convertir, cancelar) | `src-tauri/src/commands.rs` |
| Reglas de la cola (videos omitidos, resolución por video) | `src/queue.ts` |
| Actualización automática y pie de página | `src/updater.ts` (endpoint y clave de firma en `src-tauri/tauri.conf.json`) |
| Pantallas y flujo | `index.html`, `src/main.ts` |
| Traducciones (agrega un idioma aquí) | `src/i18n.ts` |
| Aspecto (colores, espaciados, modo oscuro) | `src/styles.css` |

### Calidad predeterminada

- Video: H.264 (`libx264`), `-crf 18` (visualmente sin pérdidas), `-preset medium`, escalado Lanczos, proporción conservada. Los videos HDR se convierten a SDR con tone-mapping.
- Audio: se copia sin recomprimir si es AAC/MP3; si no, AAC 192 kbps.
- Salida: MP4 con `faststart`, compatible con casi cualquier reproductor.

## Publicar una versión (mantenedores)

Configuración única:

1. Genera el par de claves de firma (elige una contraseña cuando se pida y guárdala bien):
   ```bash
   npx tauri signer generate -w ~/.tauri/escala.key
   ```
2. Copia la **clave pública** en `plugins.updater.pubkey` de `src-tauri/tauri.conf.json`, reemplazando `REPLACE_WITH_PUBLIC_KEY`. Sin ella, la app no puede verificar las actualizaciones.
3. En el repositorio de GitHub, ve a **Settings → Secrets and variables → Actions** y crea:
   - `TAURI_SIGNING_PRIVATE_KEY`: contenido del archivo de la clave privada (`~/.tauri/escala.key`).
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: la contraseña que elegiste.

En cada release:

1. Sube el `version` en `package.json` (y en `src-tauri/Cargo.toml`, para que ambos coincidan). La app muestra esa versión y el updater la compara con la publicada.
2. Haz commit, y luego crea y sube la etiqueta:
   ```bash
   git tag vX.Y.Z && git push origin vX.Y.Z
   ```
3. El workflow **release** (`.github/workflows/release.yml`) ejecuta las pruebas de Rust, compila, firma y publica el instalador y el `latest.json` como GitHub Release. Las copias instaladas reciben la actualización al abrirse la próxima vez.

### Benchmark

```bash
npm run bench -- video1.mp4 video2.mov   # agrega --keep para conservar las salidas
```

Requiere FFmpeg ya descargado (`npm run fetch-ffmpeg`) y Rust instalado. Ejecuta las variantes de codificación (baseline, decodificación por hardware, paralela) sobre cada video y compara tiempo, velocidad, tamaño y PSNR/SSIM frente al baseline. Úsalo para decidir los valores predeterminados de conversiones simultáneas y decodificación por hardware. Las salidas van a una carpeta temporal y se borran, salvo que se use `--keep`.

## Licencia

Escala se distribuye bajo la [Licencia MIT](LICENSE). Los instaladores incluyen la compilación GPL de FFmpeg (necesaria para el codificador x264), descargada de
[BtbN/FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds); consulta [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) para su licencia y código fuente.
