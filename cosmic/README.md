# RicePanel nativo para o COSMIC

O Mirante, a página de widgets do monitor em pé, reescrito em Rust com
[libcosmic](https://github.com/pop-os/libcosmic). A Estação (consoles do
txAdmin, Dev e Monitor) continua no Electron do diretório de cima e abre sob
demanda pela travessa.

## Por que nativo

| | Electron | Nativo |
|---|---|---|
| CPU com o painel parado | ~50% de um núcleo | ~2% |
| Memória | ~1,2 GB em 10 processos | ~170 MB em 1 |
| Desenho | software (a GPU acelerada não pintava) | wgpu/Vulkan na Radeon |

Medido em 12/09/2026, build de desenvolvimento.

## Como o painel mora na tela

É uma layer surface (`wlr-layer-shell`) na camada de baixo do output configurado:
acima do papel de parede, abaixo das janelas, fora da barra de tarefas. Não há
regra de janela nem script movendo nada. O compositor sabe onde ela fica.

- **Vidro:** o wallpaper vem da config do `cosmic-bg`, é desfocado uma vez e
  guardado em `~/.cache/ricepanel/`. Cada placa recorta o pedaço que está atrás
  dela, com o canto já redondo.
- **Janelas:** `ext-foreign-toplevel-list` e `ext-workspace` pelo cctk, no lugar
  do `hyprctl`.
- **Vídeo do navegador:** MPRIS diz o que toca, o histórico do Chrome dá a URL,
  o `yt-dlp` resolve o fluxo e o GStreamer toca. Sem Chromium e sem anúncio.
  Nasce desligado; a chave fica na ficha da máquina.

## Ajustes

Pelo cosmic-config, em `~/.config/cosmic/br.com.eualexandre.RicePanel/v1/`, um
arquivo por chave, com recarga a quente:

| Chave | Valor |
|---|---|
| `saida` | nome do output, como no `cosmic-randr list` (padrão `"DP-1"`) |
| `agenda_ical` | endereço secreto iCal do Google Calendar |
| `video_ligado` | `true` ou `false` |

## Rodar

```bash
cargo build --release
./target/release/ricepanel
```

Dependências do sistema: `gstreamer` com `gst-plugins-good` e `gst-plugins-base`,
`playerctl`, `sqlite3`, `yt-dlp` e `node` (o yt-dlp usa o node para resolver o
desafio do YouTube).

Variáveis úteis para testar: `RICEPANEL_VIDEO_FAKE=youtube:<id>` finge um vídeo
fora da vista, `ICED_BACKEND=tiny-skia` força o desenho por software.
