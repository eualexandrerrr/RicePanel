# Handoff — RicePanel / Mirante

Sessão de 08/09/2026. Tudo commitado e pushado (`149dd04` em `main`), nos dois repos.

## Objetivo

Duas páginas no painel do monitor vertical:

- **Mirante** (home, padrão) — widgets bonitos sobre o papel de parede: hora, data, calendário,
  agenda do Google Calendar, térmica, carga, música, máquina e a contagem do GTA VI.
- **Estação** — tudo que já existia: os dois consoles do txAdmin, o modo Dev e o Monitor.

Junto disso, terminar o porte de Windows para Linux/Hyprland, que estava pela metade.

## O que está pronto

### Estrutura

- Barramento único na travessa com quatro destinos: `Mirante · Servidores · Dev · Monitor`.
  Um clique leva de qualquer lugar para qualquer lugar. Estado em `localStorage['modo']`.
- `mirante.js` desenha a página 1; `painel.js` segue dono do resto. `window.mirante.acorda(bool)`
  pausa as animações quando a página sai da frente.

### Módulos novos no processo main

| Arquivo | O que faz |
|---|---|
| `agenda.js` | Google Calendar pelo endereço secreto iCal. Parser de VEVENT, desdobra linha, fuso por TZID, expande RRULE, cache em disco. URL cifrada no `safeStorage`. |
| `vidro.js` | Descobre o wallpaper por `awww query`, desfoca com ffmpeg e entrega ao renderer como data: URL. É o backdrop das placas. |
| `dev.js` | Porte do `emulador.ps1` para Linux: sobe o AVD, espera `sys.boot_completed`, `adb reverse`, Expo. |
| `sistema.js` | Leituras de `/proc`, `/sys`, `nvidia-smi`, `hyprctl`, `playerctl`. Já existia. |

### Mundo visual

O `DESIGN.md` está atualizado e é a fonte. Resumo:

- A **Estação** mantém a metáfora antiga (mesa de som), mas agora em ilhas de vidro flutuantes,
  raio 14, com vão de 14px — o papel de parede aparece nas divisas.
- O **Mirante** tem mundo próprio, "luz sobre vidro", com três materiais: LUZ (tipo direto no
  wallpaper), VIDRO (placa, só onde há grade ou lista) e GAZE (véu com máscara radial, sem borda,
  atrás das zonas de luz).
- A travessa fala o idioma da **waybar**, copiado dos valores do `style.css` dele: grupo
  `alpha(base, 0.82)` raio 14, botão raio 9 margem 3, ativo em `linear-gradient(135deg, mauve,
  blue)`, transição de 200ms, JetBrains Mono.

## O que funcionou

- **Blur de verdade sem `backdrop-filter`.** Numa janela transparente o `backdrop-filter` não vê
  nada (atrás não há pixel pintado, há o compositor) e o `blur` do Hyprland pega a janela inteira.
  A saída foi gerar o desfoque fora, com ffmpeg, e usar `background-attachment: fixed` nas placas —
  isso ancora o fundo na viewport, então cada placa mostra o pedaço de wallpaper que está atrás
  dela. `vidro.js`.
- **Escala, não elástico.** Para a coluna chegar no pé do monitor de 1920 o que resolveu foi subir
  a escala tipográfica, não esticar placa. Esticar produzia agenda vazia de 700px ou mês com linhas
  de 160px.
- **Largura estreita.** Placa de ponta a ponta em 1080 lê como barra, não widget. A coluna do
  Mirante tem `min(100%, 620px)` centrado.
- **Vigia de posição por socket2.** Evento do Hyprland mais relógio de 10s, reaplicando a regra
  quando a janela sai do lugar. Pegou o caso real em 19ms.

## O que não funcionou (não repetir)

- **`hl.dsp.window.pin`.** No Hyprland 0.56 ele prende ao workspace **focado**, não ao monitor. Foi
  assim que o painel apareceu por cima da tela de trabalho. Removido.
- **`app.commandLine.appendSwitch('class', ...)`.** No Wayland o Electron ignora e usa o
  `productName`. Não dá para mudar o app_id por aí.
- **`ignore_alpha` em window rule.** É chave de regra de *layer*. Numa janela não separa a zona de
  vidro do chão transparente.
- **Argumento posicional nos dispatchers Lua.** Não dá erro: monta um dispatcher válido que mira a
  **janela ativa**. Todo dispatcher recebe uma tabela nomeada. Wiki:
  <https://raw.githubusercontent.com/hyprwm/hyprland-wiki/main/content/configuring/core/dispatchers.md>
- **`hyprctl keyword`.** Removido no 0.56 ("keyword can't work with non-legacy parsers. Use eval.").
- **Desligar dispositivo de entrada.** Nem `hl.device` nem `hl.config({device=...})` desligam nada:
  aceitam a chamada, devolvem `nil`, o dispositivo continua em `hyprctl -j devices`. Por isso a
  trava de teclado hoje **recusa** em vez de mentir.

## O que mora no `.dotfiles` (repo separado, já pushado)

Posicionamento e autostart **não** ficam neste repo. Em `~/.dotfiles`:

- `hypr/.config/hypr/regras.lua` — regra `ricepanel-vertical`: `match.class = "^RicePanel$"`,
  `workspace = "9 silent"`, `fullscreen`, `opacity = "1.0 1.0"`, sem borda/sombra/blur.
  A classe é sensível a caixa; ela casava `"ricepanel"` e por isso nunca pegou.
- `hypr/.config/hypr/hyprland.lua` — `exec_cmd` do `bin/mirante.sh` no `hyprland.start`.
- `bin/mirante.sh` — sobe o painel com a sessão.
- `bin/waybar-janela.py` — módulo `custom/janela` da waybar: ícone, nome do app e título cortado,
  acompanhando o socket2.

## Estado atual da interface

Página 1, de cima para baixo: calendário+agenda (uma placa), vitais (anéis de térmica e barras de
carga), ficha da máquina, música (some sem player), e a **hora colada no pé** com a prateleira do
GTA VI logo abaixo, no rodapé.

## Próximos passos

O Alexandre ainda não bateu o martelo no visual da página 1 ("ainda tá feio" foi o último veredito
antes do corte de largura). Os caminhos que ficaram na mesa, para ele escolher:

1. Estreitar mais — 620 → 480px, estilo widget de celular.
2. Duas colunas dentro dos 620 — térmica de um lado, carga do outro, em vez de uma placa alta.
3. Tirar a ficha da máquina (kernel, carga, distro): é o que menos muda e menos se lê de longe.
4. Tirar a placa da vitais — anéis e barras soltos no wallpaper, como a hora, sem caixa. Só
   calendário e agenda ficariam com vidro.

Além disso, pendente e combinado:

- **Limpar os arquivos mortos da era Windows**, num commit separado: `maintenance.ps1`,
  `trava-teclado.ps1`, `telas-dormir.ps1`, `encaixar-emulador.ps1`, `watchdog-widget.ps1`,
  `register-*.ps1`, `foreground-watch.ps1`, `restart-widget.ps1`, `index.html`, `widget.log.old`.
- **Ligar a agenda**: falta ele colar o endereço iCal no ajuste do widget Agenda. Sem isso a placa
  fica no estado vazio.
- **Trava de teclado**: achar como desligar o dispositivo no Hyprland 0.56, ou aceitar que a tecla
  fica recusando. Caminho provável é `libinput`/`evdev` direto, fora do compositor.
- **Regra do `.dotfiles` dele**: `fullscreen = true` na regra cai como maximizado com gaps
  (`{8,8} 1064x1904`); quem dá a tela cheia real é o dispatcher, e hoje é a vigia do app que
  corrige isso em ~20ms. Dá para resolver na config se incomodar.

## Como rodar e depurar

```bash
./reiniciar.sh                 # derruba e sobe solto do terminal
tail -f mirante.log            # log do main, com a vigia de posição
grim -o DP-3 /tmp/painel.png   # captura o monitor vertical
node --check <arquivo>.js      # antes de reiniciar
```

**Cuidado que já custou um commit sujo:** para ver uma página específica sem clicar, dá para forçar
`trocaModo('mirante')` no fim do `painel.js`. Se fizer isso, restaure com `cp` do backup e confira
com **`diff -q`**, não com `grep` — um `grep` deu limpo e mesmo assim o `// TESTE` foi para o
commit `6779827` (corrigido no `3b867f0`).

## Regras da casa que valem aqui

- Commit pedido = commit **e** push, sempre, nos dois repos.
- Nenhum rastro de IA em mensagem de commit.
- Comentário em código: **este** repo usa comentário que explica o porquê. O `~/.dotfiles` é o
  oposto — o `CLAUDE.md` de lá proíbe comentário novo.
