# Escala

Converte vídeos para uma resolução menor (por exemplo, 4K → 1080p) sem perda visível de qualidade.
Arraste o vídeo, escolha a resolução e pronto — sem ajustes de codec.

Feito com **Rust + Tauri 2** e **FFmpeg** embutido.

## Como usar

1. Abra o app e arraste um vídeo (ou clique em **Escolher arquivo…**).
2. Escolha a resolução (só aparecem opções menores que a do vídeo; 1080p vem pré-selecionada).
3. Clique em **Converter**. O novo arquivo é salvo na mesma pasta, como `nome_1080p.mp4`.
   O original nunca é alterado.

## Desenvolvimento

Requisitos: [Rust](https://rustup.rs), Node.js 20+ e as dependências do Tauri para Windows (WebView2, Build Tools do MSVC).

```bash
npm install
npm run fetch-ffmpeg   # baixa o FFmpeg para src-tauri/binaries (uma vez só)
npm run tauri dev      # abre o app em modo desenvolvimento
npm run tauri build    # gera o instalador (FFmpeg incluído)
cd src-tauri && cargo test   # testes da lógica de conversão
```

## Onde mexer

| O quê | Onde |
|---|---|
| Qualidade (CRF), velocidade (preset), áudio, lista de resoluções | `src-tauri/src/video.rs` (constantes no topo) |
| Comandos que o front chama (analisar, converter, cancelar) | `src-tauri/src/commands.rs` |
| Telas e fluxo | `index.html`, `src/main.ts` |
| Visual (cores, espaçamentos, modo escuro) | `src/styles.css` |

### Configuração de qualidade padrão

- Vídeo: H.264 (`libx264`), `-crf 18` (visualmente sem perdas), `-preset slow`, redimensionamento Lanczos, proporção preservada.
- Áudio: copiado sem recompressão quando for AAC/MP3; senão AAC 192 kbps.
- Saída: MP4 com `faststart`, compatível com praticamente qualquer player.

## Licença do FFmpeg

O app usa o build GPL do FFmpeg (necessário para o encoder x264), baixado de
[BtbN/FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds). Se distribuir o app, respeite a licença GPL.
