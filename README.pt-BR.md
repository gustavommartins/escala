# Escala

[English](README.md) · **Português** · [Español](README.es.md)

Converte vídeos para uma resolução menor (por exemplo, 4K → 1080p) sem perda visível de qualidade.
Arraste um ou mais vídeos, escolha a resolução e pronto — sem ajustes de codec.

Feito com **Rust + Tauri 2** e **FFmpeg** embutido.

## Como usar

1. Abra o app e arraste um ou mais vídeos (ou clique em **Escolher arquivo…**; depois, use **Adicionar vídeos** para incluir mais).
2. Escolha a resolução (só aparecem opções menores que a do vídeo; 1080p vem pré-selecionada). A escolha vale para todos os vídeos da fila. Para usar outra resolução em um vídeo específico, troque a **Resolução** na linha dele.
   Vídeos cuja resolução não é menor que a escolhida ficam marcados como **Pulado** e não são convertidos.
3. Clique em **Converter tudo**. O novo arquivo é salvo na mesma pasta, como `nome_1080p.mp4`.
   O original nunca é alterado.

**Fila:** vários vídeos são convertidos ao mesmo tempo. Defina quantos em ⚙︎ → **Conversões simultâneas** (de 1 a 4; por padrão, 2 em máquinas com 8 núcleos ou mais, senão 1). Cada linha mostra o percentual, a velocidade e o tempo restante estimado; a barra no fim mostra o progresso geral.

**Decodificação por hardware** (⚙︎ → **Decodificação de vídeo por hardware**, desligada por padrão): usa a GPU só para ler o arquivo de entrada, o que pode acelerar vídeos em 4K. A saída é idêntica, pois o encode continua com x264 em CRF 18. Vale para entradas H.264, HEVC, AV1 e VP9; se o driver falhar, o app volta sozinho para a decodificação por software.

**Atualizações:** o Escala verifica se há nova versão ao abrir e baixa a atualização em segundo plano. Quando ela está pronta, aparece um botão **Reiniciar** no rodapé. O app nunca reinicia no meio de uma conversão: se você clicar enquanto há vídeos convertendo, ele espera a fila esvaziar. A versão atual aparece no rodapé.

**Idioma:** o app segue o idioma do sistema (English, Português ou Español; inglês nos demais casos).
Você pode trocar a qualquer momento pelo botão ⚙︎ no canto superior direito.

## Download

Baixe o instalador para Windows na página de [Releases](../../releases). O FFmpeg já está incluído.

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
| Regras da fila (vídeos pulados, resolução por vídeo) | `src/queue.ts` |
| Atualização automática e rodapé | `src/updater.ts` (endpoint e chave de assinatura em `src-tauri/tauri.conf.json`) |
| Telas e fluxo | `index.html`, `src/main.ts` |
| Traduções (adicione um idioma aqui) | `src/i18n.ts` |
| Visual (cores, espaçamentos, modo escuro) | `src/styles.css` |

### Configuração de qualidade padrão

- Vídeo: H.264 (`libx264`), `-crf 18` (visualmente sem perdas), `-preset medium`, redimensionamento Lanczos, proporção preservada. Vídeos HDR passam por tone-mapping para SDR.
- Áudio: copiado sem recompressão quando for AAC/MP3; senão AAC 192 kbps.
- Saída: MP4 com `faststart`, compatível com praticamente qualquer player.

## Publicar uma versão (mantenedores)

Configuração única:

1. Gere o par de chaves de assinatura (escolha uma senha quando solicitado e guarde-a com segurança):
   ```bash
   npx tauri signer generate -w ~/.tauri/escala.key
   ```
2. Copie a **chave pública** para `plugins.updater.pubkey` em `src-tauri/tauri.conf.json`, substituindo `REPLACE_WITH_PUBLIC_KEY`. Sem ela, o app não consegue verificar as atualizações.
3. No repositório do GitHub, vá em **Settings → Secrets and variables → Actions** e crie:
   - `TAURI_SIGNING_PRIVATE_KEY`: conteúdo do arquivo da chave privada (`~/.tauri/escala.key`).
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: a senha que você escolheu.

A cada release:

1. Suba o `version` em `package.json` (e em `src-tauri/Cargo.toml`, para manter os dois iguais). O app exibe essa versão e o updater a compara com a publicada.
2. Faça o commit e crie e envie a tag:
   ```bash
   git tag vX.Y.Z && git push origin vX.Y.Z
   ```
3. O workflow **release** (`.github/workflows/release.yml`) roda os testes Rust, compila, assina e publica o instalador e o `latest.json` como GitHub Release. As cópias instaladas recebem a atualização na próxima abertura.

### Benchmark

```bash
npm run bench -- video1.mp4 video2.mov   # acrescente --keep para manter as saídas
```

Exige o FFmpeg já baixado (`npm run fetch-ffmpeg`) e o Rust instalado. Ele roda as variantes de encode (baseline, decodificação por hardware, paralela) em cada vídeo e compara tempo, velocidade, tamanho e PSNR/SSIM com o baseline. Use-o para decidir os padrões de conversões simultâneas e de decodificação por hardware. As saídas vão para uma pasta temporária e são apagadas, a menos que se use `--keep`.

## Licença

O Escala é distribuído sob a [Licença MIT](LICENSE). Os instaladores incluem o build GPL do FFmpeg (necessário para o encoder x264), baixado de
[BtbN/FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds); veja [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) para a licença e o código-fonte.
