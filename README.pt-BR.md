[English](README.md)

# RicePanel

Um painel de parede para o segundo monitor — o vertical, aquele que fica ligado
o dia todo e que ninguém usa para trabalhar. Ele responde de longe às perguntas
que a gente faz de relance: que horas são, o que tem hoje, a máquina está quente,
o servidor caiu, o que está tocando, quando é o próximo jogo.

Electron sobre Arch Linux e Hyprland. Sem framework de interface, sem build
step: é HTML, CSS e JavaScript lidos direto do disco.

## As duas páginas

**Mirante** — a página que fica aberta. Relógio grande, calendário do mês com os
dias marcados, agenda do Google, térmica da máquina (um anel por peça, com foto
real da peça), medidores de CPU, RAM e discos, rede, o que está tocando no
Spotify com controles, o próximo jogo do Flamengo e a contagem para o GTA VI.

**Estação** — a página de trabalho. Dois consoles do txAdmin lado a lado
(remoto e local), com detector de erro que avisa por notificação; uma coluna de
projetos Expo com emulador Android; e um monitor de cotas, Sentry e anotações
do Discord.

## Como as leituras são feitas

Tudo local, sem serviço extra rodando:

| Leitura | De onde vem |
|---|---|
| CPU, memória, discos, rede, uptime | `/proc`, `/sys`, `statfs` do próprio Node |
| Temperatura de CPU e SSD | `/sys/class/hwmon` (k10temp, coretemp, nvme) |
| Placa de vídeo NVIDIA | `nvidia-smi --query-gpu` |
| Placa de vídeo AMD | `/sys/class/hwmon` do `amdgpu` + a pasta PCI do dispositivo |
| Workspaces e janela em foco | `hyprctl -j` |
| O que está tocando | `playerctl` (MPRIS) |
| Atualizações pendentes | `checkupdates` (repo) e `paru -Qua` (AUR) |
| Agenda | endereço secreto do Google Calendar em formato iCal |
| Próximo jogo | API pública de placar do ESPN |

Nada disso pede sudo, e nada consulta um serviço que precise ficar de pé.

## Decisões que valem explicação

**O blur não é do CSS.** As placas parecem vidro fosco sobre o papel de parede,
mas `backdrop-filter` não enxerga o compositor do Wayland: por baixo da janela
não existe nada para desfocar. Então o `vidro.js` gera com ffmpeg uma cópia
borrada do wallpaper e serve como `background-attachment: fixed` — o recorte
acompanha a placa e o efeito fecha.

**A agenda é iCal, não OAuth.** O painel fica sozinho num monitor. Um refresh
token que expira quando a senha muda deixaria a agenda muda esperando alguém
que não está na frente da máquina. O endereço secreto é uma URL de leitura que
só o dono revoga.

**A escala é de parede, não de mesa.** O piso do texto é 11,5px em `subtext0` —
não 10px em cinza médio. Ele lê isso a dois metros de distância, do outro
monitor, sobre um papel de parede de ilustração saturada. Rótulo que some leva
junto o número que ele nomeia.

**Um anel por peça, montado a partir do retrato.** Quantas placas de vídeo a
máquina tem é dela, não do HTML. A foto real ao lado do anel é o que se
reconhece de longe — de dois metros ninguém lê "RTX 3090", mas todo mundo
reconhece um cooler de três hélices.

**Aceleração de GPU desligada por padrão, e isso é medido, não crença.** Nesta
máquina (duas placas, Wayland, janela transparente) toda combinação acelerada
terminou em janela que não pinta nada: com `use-angle=vulkan` o gpu-process
morre em laço e leva o compositor junto; com `use-angle=gl`, com ou sem
`render-node-override` na Radeon, o `eglCreateImage` falha com `EGL_BAD_MATCH`,
o filho de GPU é morto e o painel vira um retângulo invisível sobre o papel de
parede — o app segue vivo, com log e tudo, e a tela fica vazia. Então: software
por padrão, que é o único estado em que a página aparece, e o engasgo do vídeo
se resolve pelo outro lado, limitando a qualidade do player a 720p.
`RICEPANEL_COM_GPU=1` liga de volta a versão acelerada para quem quiser tentar
de novo.

**O app_id que vai para o Hyprland é minúsculo.** O Electron anunciaria o
`productName` ("RicePanel"), e a regra de janela em `hypr/.config/hypr/regras.lua`
casa `class = "ricepanel"` — o match é sensível a caixa. Então quem cede é o
app: `--class=ricepanel`, e o compositor continua sendo o dono da colocação,
que no Wayland é o lugar certo dessa decisão.

## Rodando

```bash
npm install
npm start          # ou ./reiniciar.sh, que derruba o que estiver de pé
```

Precisa de: Electron 33, `playerctl`, `hyprctl` (opcional), `nvidia-smi` ou
`amdgpu` (opcional), `checkupdates` do `pacman-contrib`, `paru` (opcional),
`ffmpeg` para o vidro e `awww` (o daemon de wallpaper que ele consulta para
saber o papel de parede atual).

Nada de configuração fica no repositório. O que é seu mora em
`~/.config/RicePanel/`:

| Arquivo | O quê |
|---|---|
| `servidores.json` | host e porta dos dois consoles do txAdmin |
| `discord-notas.json` | guild, canal e caminho do `config.json` do txAdmin |
| `agenda-url.txt` ou `agenda-url.bin` | endereço secreto do iCal, cifrado quando há keyring |

Sem esses arquivos o painel sobe igual, com os módulos correspondentes
desligados — nenhum deles é obrigatório.

## Licença

Código sob MIT. As fotos em `fotos/` e as fontes em `fontes/` têm licença
própria, creditada em `fotos/CREDITOS.md` e no `LICENSE`.
