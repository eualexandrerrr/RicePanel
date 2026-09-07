# Design — Mesa

<!-- impeccable:design-schema 1 -->

Registrado a partir do que foi construído em `painel.html` (27/08/2026), não de intenção.

## O mundo

Uma mesa de som vista de longe numa sala com luz. Chapa de grafite fosco, módulos separados por
sulco escuro com um fio de luz na aresta de cima, rótulos serigrafados na chapa, medidores de
segmento e lâmpadas de painel. O que se lê de canto de olho é **nível e lâmpada** — nunca um card
com número grande e sombra macia.

A metáfora carrega a regra do produto: **erro não resolvido é clipe aceso**. O clipe trava e só
apaga quando o assunto é tratado, exatamente como o LED de clipe de um canal real.

## Tokens

```css
--painel: #14161a;      /* chapa */
--face: #1a1d23;        /* face de módulo */
--face-alta: #20242b;   /* face que pega luz (travessa, botão) */
--sulco: #0a0b0e;       /* rasgo entre módulos, fundo de medidor */
--aresta: #2d323b;      /* fio de luz na aresta de cima */
--serigrafia: #949aa6;  /* rótulo gravado */
--serigrafia-fraca: #6b7280;
--leitura: #eef1f5;     /* número/valor */
--led-off: #23272f;
--verde: #3fd07f;  --ambar: #f2b33d;  --vermelho: #ff4f4f;  --azul: #5aa9e6;
```

Estratégia de cor: **contida**. Neutros de chapa em toda a superfície; verde/âmbar/vermelho existem
só para estado, nunca para decorar. Âmbar é também a cor de interação (chave ligada, botão firme,
seleção de texto, anel de foco).

Escuro não é padrão de categoria: o painel fica num monitor vertical à esquerda dele, ligado o dia
todo ao lado de um monitor de trabalho. Chapa clara ali seria uma lâmpada no canto do olho.

## Tipografia

Duas fontes, self-hosted em `fontes/` (sem CDN — o app roda offline quando a rede cai):

- **Archivo Narrow** — serigrafia. Caixa-alta, 700, `letter-spacing: 0.14em`. Todo rótulo gravado na
  chapa, rótulo de botão de modal, escala do medidor, metadados de linha.
- **Archivo** — leituras e conteúdo. Números em `font-variant-numeric: tabular-nums` com
  `letter-spacing: -0.02em`; contagem de canal em 800/52px, leitura de medidor em 800/30px.

Tracking nunca passa de -0.045em. Nada de monoespaçada como fantasia de "técnico" — as figuras
tabulares do Archivo já alinham a medição. O cronômetro de reset da cota ainda era Cascadia Mono
até 28/08/2026, contrariando esta mesma regra; voltou para Archivo Narrow tabular.

## Componentes

- **Travessa** (54px): marca, hora da última leitura de cota, chave Max/API, botões de chapa.
- **Telas de programa**: os dois consoles do txAdmin em `<webview>`, cada um numa moldura com
  serigrafia, destino e estado de carga. O visual de dentro é de terceiro; o painel só **esconde**
  a moldura dele (`header.sticky`, `aside.tx-sidebar`) por `insertCSS` para o Live Console tomar a
  altura toda. Esconder, e não "mostrar só o console": se o txAdmin mudar de estrutura, a falha é
  o menu reaparecer — nunca o console sumir.
- **Pastilhas de estado** no cabeçalho de cada tela: no ar/fora e jogadores, lidos a cada 10 s de
  dentro do webview (o menu está escondido, não removido — os números seguem no DOM). Uptime saiu
  em 27/08/2026: número que ele não consultava, ocupando a linha que decide qual servidor é qual.
- **Ações de servidor** no mesmo cabeçalho, as duas quentes: *Desligar* (ícone de power) e
  *Reiniciar*. Ambas passam por modal, e o painel ainda lê o diálogo do próprio txAdmin antes de
  confirmar. Desligar exige o diálogo — sem ele, devolve erro em vez de dizer que deu certo,
  porque desligado **não volta sozinho**.
- **Barra de nível, um desenho só**: cota (travessa, faixa e ponte do monitor) e temperatura usam
  a mesma linha — rótulo com período, trilho, leitura e cronômetro de reset. O medidor vertical de
  18 segmentos saiu em 27/08/2026: a mesma cota aparecia em dois desenhos diferentes na mesma
  tela. Na travessa a linha vira pastilha, com fio de nível de 46px ao lado do número.
- **Canais de estado** (Sentry, Anotações) com a marca do serviço, contagem grande e lâmpada de
  clipe — contagem não é nível, então **não finge barra**.
- **Baia de detalhe**: dois módulos de lista. Linha de erro e anotação têm a mesma anatomia —
  marca à esquerda (avatar no Discord, **marca da plataforma** no Sentry, com aro e traço na cor do
  nível), nome e selo de nível na primeira linha, **quando aconteceu numa linha só dele logo
  abaixo** ("Hoje · 20:21", "Ontem · 13:20", "24 ago · 18:52" + "há 3 d"), corpo e ações à direita.
  A plataforma sai do título quando ele entrega a origem (`NS…`/`EXC_` = Apple, `java.lang`/`ANR` =
  Android): o campo `platform` do Sentry é do projeto e vem igual para os dois lados de um app
  React Native.
- **Barra master**: identificação, relógio grande (hora e minuto — segundo virando no canto do
  olho é movimento à toa) e o botão de limpar cache, que segue a faixa em qualquer barramento.
- **Barra central** (28/08/2026): no barramento Servidores a barra de estado deixa de ser rodapé e
  vira o módulo do meio da mesa, em duas faixas. **Bancada**: uma célula por leitura — relógio,
  cota, canais, térmica, sistema —, cada uma com rótulo gravado no alto, todos na mesma linha da
  chapa, e **sulco fresado** entre células (risco escuro com o fio de luz na parede de dentro). A
  leitura fica centrada no que sobra da célula, então a célula mais alta manda na altura sem deixar
  as outras penduradas. Célula sem dado nenhum some inteira: rótulo gravado sobre vazio é pior que
  chapa lisa. **Prateleira**: canal rebaixado embaixo (fundo de sulco, sombra interna), para o que é
  dele e não do trabalho. No pé do app a mesma barra volta a ser a linha rasa de sempre — célula
  vira agrupador invisível, rótulo e prateleira somem. É um nó só de DOM nos dois lugares.
- **Banco de teclas** na célula Sistema (30/08/2026): mesa de verdade não tem botão solto no canto,
  tem bloco de teclas do mesmo tamanho alinhadas na grade. Quatro teclas de 26px — *Cache*,
  *Teclado*, *Telas*, *Painel* — em 2×2 na barra central, e a mesma marcação se desenrola em
  fileira no pé do app, onde a banca volta a ser linha rasa. Ação nova entra **como tecla no
  bloco**, nunca como botão avulso empurrando a banca para o lado; a célula não fica mais larga que
  o botão de Cache sozinho ocupava. Classe `.chapa` (o `.tecla` já era do seletor de barramento).
  Tecla sem resposta para dar (Telas, Painel) pisca âmbar 2,2s em vez de girar: não há o que
  esperar. *Painel* pede segundo clique pela regra 3 — reiniciar no meio de um comando é perda de
  vista, não de dado, mas não pode sair por esbarrão. *Teclado* travado é o único estado que
  **pulsa**, porque clicar ali é a única saída.
- **Contagem de jogadores é porta, não placar** (30/08/2026): clicar no número de online traz a
  barra lateral do próprio txAdmin por cima do log — busca por nome/ID, lista de quem está dentro,
  e o diálogo de cada jogador com o que o txAdmin já sabe fazer. Por cima e não empurrando: o log é
  canvas do xterm, que refaz o atlas de glifos a cada mudança de largura, então reservar espaço
  faria o terminal remontar em toda abertura. É a **mesma** `aside.tx-sidebar` que o painel esconde
  para o console ocupar a tela; abrir é tirar o `display:none` e prendê-la à direita. A tecla fica
  acesa em verde enquanto a lista estiver na tela — estado nunca é só a ausência de coisa.
  O X de fechar mora **dentro** do webview, não no painel: elemento do painel posto por cima do
  `<webview>` não aparece — o guest compõe acima do documento hospedeiro e o botão fica desenhado
  atrás do console. Injetado no guest ele é irmão da lista e sobe junto. O clique volta por
  `console.log("mesa:fechar-lista")`, que o painel escuta em `console-message`: é o único canal de
  mão dupla que existe sem um preload próprio para a página do txAdmin. A contagem no cabeçalho
  continua fechando também — o X é o caminho curto, o que a mão procura sem tirar o olho da lista.
- **Desligar e Reiniciar não dividem cor** (30/08/2026): moldura única, cores separadas — desligar
  em vermelho (não volta sozinho), reiniciar em âmbar (derruba, mas volta), a mesma escala da cota
  e do fio térmico. Duas teclas vermelhas coladas obrigam a ler o rótulo antes de cada clique; com
  cores diferentes a mão acerta pelo lugar e pela cor. A moldura virou grafite para não empurrar as
  duas para o mesmo lado do vermelho.
- **A travessa mostra Sessão e Semana, sempre** (30/08/2026): antes ela caía no limite mais alto
  quando nada passava de 70%, e acabava exibindo um modelo qualquer (Fable) no lugar do que se lê o
  dia todo. Agora as duas leituras fixas ficam ali — quanto sobra agora e quanto sobra até domingo —
  e limite de modelo só entra ao lado delas quando passa do limiar.
- **Limpeza sozinha de 6 em 6 horas** (30/08/2026): a tecla *Cache* deixa de ser a única porta.
  O widget confere a cada 10 min o `finishedAt` do `maintenance.status.json` e, passadas 6 h,
  dispara a mesma tarefa agendada do botão — `WidgetClaude-Manutencao-Agora`, já registrada com
  `RunLevel Highest`, então roda elevada e **sem UAC**. A conta é sobre a hora da última limpeza,
  não sobre um tique de 6 h: máquina desligada um dia limpa na primeira checagem depois de voltar.
  Sem a tarefa registrada a limpeza automática não acontece — abrir UAC sozinho deixaria a caixa
  parada esperando resposta de ninguém. Avisa por toast do Windows nas duas pontas: "Limpando
  cache" ao disparar e "Cache limpo · liberado X MB" quando o status volta a `running=false`.
- **Lançamento do GTA VI** (28/08/2026), primeiro morador da prateleira: marca "VI" desenhada na
  grade de 63×40 com o degradê de pôr do sol da própria Rockstar, nome e data à esquerda, pastilhas
  de plataforma, e a contagem regressiva encostada na borda direita — dias, horas e minutos, **sem
  segundos**, pela mesma razão do relógio. Chegado o dia, a contagem vira recado ("É hoje",
  depois "Lançado"). É o único ponto da mesa onde cor não é estado: marca de terceiro entra pelo
  desenho dela, como as do Sentry e do Discord.

A barra central tem **exatamente 1080px** e não pode vazar por baixo de dado nenhum. Quem cede
espaço é sempre a **cota**: o trilho encurta e o medidor segue legível pela proporção, que é o que
o olho lê de longe. As outras células não encolhem — nelas só existe número e botão, que não ficam
menores sem serem cortados. Testado no pior caso (contagem de 4 dígitos, dia da semana mais longo,
contagem regressiva de 3 dígitos): o botão de Cache continua inteiro dentro da chapa.

A faixa de estado tem altura pelo conteúdo (mínimo de 46px): com três limites de cota, altura fixa
cortava a última linha na borda da janela.

Trilho de medidor é **poço fresado**, não faixa pintada por cima: fundo de sulco com sombra interna.
O mesmo desenho vale para o fio de 46px, que a partir de 28/08/2026 também acompanha a temperatura
na barra central, em escala fixa de 30 a 100 °C.

A janela não aparece na barra de tarefas (`skipTaskbar`): o painel fica aceso o dia todo no monitor
vertical e não tem moldura — botão na barra só convidaria a minimizar uma tela sem como restaurar.

Elevação declarada uma vez: **borda**, nunca borda mais sombra. Raio de 3–6px em toda a chapa
(painel de equipamento não tem canto de card).

## Movimento

Um momento autoral só: quando um canal recebe alerta, a contagem **bate** — `scaleY` 1 → 1.09 → 1
em 900ms com `cubic-bezier(0.16, 1, 0.3, 1)`, saindo de um estado já visível. A lâmpada de clipe
acende e fica; a moldura do módulo fica vermelha por 60s. O resto é estático de propósito: painel
que se mexe à toa vira distração no canto do olho. `prefers-reduced-motion` corta tudo.

## Superfícies do navegador

Barra de rolagem, seleção de texto e anel de foco vêm pintados da paleta — nada de padrão do
Chromium na chapa.

## Ícones

Desenhados à mão em SVG (`<defs>` no topo do documento, usados por `<use href>`): fechar,
recarregar, sair, confirmar, alerta, vassoura, power. Traço 1.5–1.8, 16×16, `currentColor`. Nenhum
emoji e nenhum glifo Unicode fazendo papel de ícone.

Ícone usado acima de 16px **precisa de `viewBox="0 0 16 16"` no `<svg>`** — sem ele o desenho fica
de 16px no canto de uma caixa maior. O helper `icone()` já emite com viewBox.

Exceção: **marca de serviço**. Sentry e Discord entram pela marca deles (a do Sentry redesenhada no
traço da casa; a do Discord é a silhueta oficial encaixada na grade de 16), porque reconhecer o
serviço é mais rápido que ler a palavra. Ícone que cresce acima de 16px precisa de `viewBox` no
`<svg>` — sem ele o desenho fica de 16px no canto de uma caixa maior.

## Regras que o mundo impõe

1. Estado nunca é só cor — sempre acompanha rótulo, número ou posição no medidor.
2. Serviço novo entra como **canal novo** na ponte e, se tiver detalhe, como módulo na baia.
   Nenhum layout novo.
3. Ação que escreve em produção pede segundo clique, com o botão trocando para "Confirmar".
4. Vazio é estado de calma, não de erro: "Tudo reagido — nada pendente." em serigrafia fraca.
