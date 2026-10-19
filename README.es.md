# Escala

[English](README.md) · [Português](README.pt-BR.md) · **Español**

Convierte videos a una resolución menor (por ejemplo, 4K → 1080p) sin pérdida visible de calidad.
Arrastra el video, elige la resolución y listo — sin ajustes de códec.

Hecho con **Rust + Tauri 2** y **FFmpeg** integrado.

## Cómo usar

1. Abre la app y arrastra un video (o haz clic en **Elegir archivo…**).
2. Elige la resolución (solo aparecen opciones menores que la del video; 1080p viene preseleccionada).
3. Haz clic en **Convertir**. El archivo nuevo se guarda en la misma carpeta, como `nombre_1080p.mp4`.
   El original nunca se modifica.

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
| Pantallas y flujo | `index.html`, `src/main.ts` |
| Traducciones (agrega un idioma aquí) | `src/i18n.ts` |
| Aspecto (colores, espaciados, modo oscuro) | `src/styles.css` |

### Calidad predeterminada

- Video: H.264 (`libx264`), `-crf 18` (visualmente sin pérdidas), `-preset medium`, escalado Lanczos, proporción conservada. Los videos HDR se convierten a SDR con tone-mapping.
- Audio: se copia sin recomprimir si es AAC/MP3; si no, AAC 192 kbps.
- Salida: MP4 con `faststart`, compatible con casi cualquier reproductor.

## Licencia

Escala se distribuye bajo la [Licencia MIT](LICENSE). Los instaladores incluyen la compilación GPL de FFmpeg (necesaria para el codificador x264), descargada de
[BtbN/FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds); consulta [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) para su licencia y código fuente.
