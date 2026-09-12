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

Desde o porte para Linux (07/09/2026) a paleta é **Catppuccin Mocha**, a mesma do resto do rice
(Hyprland, Waybar, terminal). Os nomes de cor ficam em inglês de propósito — são os nomes da
paleta, e traduzir quebraria a conferência com os outros arquivos do rice. Em cima deles vem uma
camada de **papéis**, e é só por ela que o painel fala: trocar de flavour (Macchiato, Latte) é
reescrever um bloco só.

```css
/* papéis — o CSS nunca usa o hex direto */
--painel: var(--crust);        /* chapa, atrás das ilhas */
--face: var(--base);           /* face da ilha */
--face-alta: var(--surface0);  /* face que recebe toque: tecla, botão */
--sulco: var(--mantle);        /* poço: trilho, campo, fundo de lista */
--aresta: var(--surface1);     /* borda — a elevação é declarada uma vez */
--serigrafia: var(--subtext0); /* rótulo */
--leitura: var(--text);        /* número, valor */
--acento: var(--mauve);        /* interação: ligado, foco, seleção */
--verde: var(--green);  --ambar: var(--yellow);  --vermelho: var(--red);  --azul: var(--blue);
```

O acento de interação mudou de âmbar para **mauve** junto com a paleta. Âmbar seguiu como cor de
aviso (tecla sem resposta a dar, reiniciar) e como faixa média da escala térmica e de carga.

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

## Duas páginas (08/09/2026)

O painel passou a ter dois níveis de barramento. Em cima, duas páginas: **Mirante** e **Estação**.
Embaixo, dentro da Estação, o barramento que já existia — Servidores, Dev, Monitor. Na página do
Mirante o barramento de baixo some: seletor de coisa escondida é ruído.

- **Mirante** é a página padrão, a que fica na tela quando ninguém pediu nada. É o que se lê de
  canto de olho o dia todo: hora, data, mês, agenda, térmica, carga, música e a máquina.
- **Estação** é o trabalho, e não perdeu nada: os dois consoles do txAdmin, o modo Dev e o Monitor
  continuam exatamente onde estavam, com a mesma barra central entre os terminais.

### Mirante nativo, Estação no Electron (12/09/2026)

As duas páginas deixaram de morar no mesmo processo. O **Mirante** é app nativo do COSMIC em `cosmic/`
(Rust e libcosmic), numa layer surface abaixo das janelas; a **Estação** continua no Electron e só sobe
quando uma tecla da travessa pede. O mundo visual não mudou: mesmos tokens, mesma escala, mesma
travessa copiada da waybar. O que mudou foi o material do vidro, que agora é recortado com o canto
redondo no próprio alfa, porque o iced não honra raio em imagem.

Na Estação a tecla **Mirante** fecha a janela: a parede já está embaixo dela.

### O Mirante tem mundo próprio: luz sobre vidro (08/09/2026)

A metáfora da mesa de som continua mandando na **Estação**, que é tela de trabalho. O **Mirante**
não: ali ela produzia uma fileira de lajotas de grafite com muito vazio dentro, que é justamente o
que ele apontou como feio. A página 1 ganhou mundo próprio, e ele tem dois materiais, só:

- **LUZ** — tipo fino e filete desenhados direto no papel de parede, sem recipiente nenhum. É a
  hora, a linha de semana/dia/uptime e a ficha da máquina.
- **VIDRO** — placa translúcida de raio 28, um fio de luz na aresta de cima e **nenhuma sombra
  projetada**. Existe só onde há grade ou lista para agrupar: mês+agenda numa placa, vitais em
  outra. Nunca como moldura de um número solto.
- **BRUMA** — quatro massas de cor enormes à deriva atrás da página inteira, no ritmo de um minuto
  por volta, desfocadas e mascaradas. É atmosfera, nunca informação.

O que o Mirante **não** faz: fileira de cards do mesmo tamanho, cada um com seu rótulo no canto.
Era isso que dava cara de tela de depuração.

#### Tudo centrado, menos a travessa (08/09/2026)

A coluna se centra nos dois eixos, e o que se centra junto é o conteúdo de dentro dela: o rótulo do
cabeçalho fica no meio da placa (os botões saem do fluxo, encostados na direita), a ficha da máquina
e a linha de rede ficam no meio, a lista da agenda vira uma coluna de 430px centrada — nela a linha
continua alinhada à esquerda, porque agenda com margem esquerda serrilhada não se lê.

A **travessa é a única coisa que continua ancorada no topo**: é barra de navegação, não conteúdo, e
barra no meio da tela não existe.

O desenho anterior colava a hora no pé (`margin-top: auto`) e empilhava o resto no alto. O que
sobrava — quase um terço do monitor — virava um buraco no **meio** da tela, e vão grande no meio lê
como falha de layout. O mesmo vão dividido em cima e embaixo lê como margem.

Nada aqui é obrigado a ser retângulo. A placa da música é **pílula** (uma linha de conteúdo, nenhuma
grade dentro: o canto reto não estava separando nada), o workspace é pastilha redonda, o trilho do
medidor e o botão de cabeçalho são de raio total. A gaze é elipse estreita e de queda longa — com a
coluna centrada as duas zonas de LUZ ficaram vizinhas, e a gaze quase retangular de antes encostava
uma na outra e lia como uma caixa translúcida só.

**A escala é de painel de parede, não de app de mesa.** Hora em 152px/200, dia do mês em 19px em
célula de 62px, anel térmico de 124px com o número em 34px/300. Foi a escala, e não esticar caixa,
que fez a coluna chegar no pé do monitor de 1920. Esticar uma placa até caber produzia ou uma
agenda vazia de 700px ou um mês com linhas de 160px — as duas coisas são vão, não conteúdo. A sobra
vira respiro entre os blocos (`space-between`).

Hierarquia é **peso e tamanho**, não cor: 200 na hora, 300–400 nas leituras, 700 comprimido e
tracado em 0,28em nos rótulos. Cor é estado (verde/âmbar/vermelho nas escalas) mais um acento
mauve; todo o resto da cor da página vem do papel de parede.

#### O vidro é de verdade, e foi preciso construí-lo

A janela nasce **transparente** (`transparent: true`, opção de criação — não dá para ligar depois).
Daí o pedido: papel de parede **nítido** onde não há widget, e desfoque **atrás de cada placa**.
Nenhum dos dois caminhos óbvios entrega isso:

- `backdrop-filter` do CSS só desfoca o que está pintado dentro da própria página. Atrás desta
  janela não há nada pintado — há o compositor. Numa janela transparente ele não faz nada.
- `blur` do Hyprland desfoca a **janela inteira**. Como o painel ocupa o monitor todo, ligar blur
  borra o wallpaper de ponta a ponta. O `ignore_alpha`, que separaria placa de chão vazio, é chave
  de regra de *layer*, não de janela — testado, não pega.

A saída é `vidro.js`: descobre pelo `awww query` qual imagem está no monitor em pé, gera uma cópia
desfocada com ffmpeg (`gblur=sigma=34`, cortada no formato exato do monitor) e entrega ao renderer
como data: URL. Lá ela entra como `background-image` das placas com **`background-attachment:
fixed`**, que ancora o fundo na viewport — então cada placa mostra exatamente o pedaço de wallpaper
que está atrás dela. É backdrop-filter de verdade, só calculado fora. Ele troca de wallpaper pelo
menu; uma varredura de 60 s acompanha.

#### GAZE, o terceiro material

O material LUZ só se lê sobre um wallpaper calmo, e o dele é ilustração cheia de rosto e cor
saturada. A **gaze** resolve sem trazer a caixa de volta: o mesmo fundo desfocado, com máscara
radial, então não tem borda, não tem canto e não tem onde começar. De longe não se vê véu; vê-se
que o texto está legível. Só as duas zonas de LUZ a usam.

#### Detalhes que o mundo impõe

- Célula de calendário **não tem fundo**. O mês é uma tabela de números, não uma parede de lajotas;
  só o hoje ganha corpo, um círculo de 44px no acento. (O `::before` do hoje precisa de
  `z-index: 0` na célula: sem contexto de empilhamento próprio, ele some atrás do fundo da placa.)
- Linha de agenda é **linha**, não cartão: hora, filete de estado à esquerda, texto. Fundo por item
  traria a lajota de volta.
- Medidor de carga tem **rótulo e valor na mesma linha e trilho curto embaixo**. O fio atravessando
  a placa inteira, com o valor na outra ponta, obrigava o olho a viajar para juntar as duas metades
  do mesmo dado.
- Preenchimento de trilho anda por `transform: scaleX()`, nunca por `width`: largura animada remede
  o layout a cada quadro, e isto roda 24 h numa janela sem aceleração de GPU.
- **Nenhum halo colorido de raio zero.** O círculo do hoje já tinha um `box-shadow` mauve de 22px;
  saiu. É o brilho padrão de interface gerada, e aqui não carrega informação nenhuma.
- Traço de anel é **3px**. Anel grosso vira rosquinha de dashboard, que é o oposto do que esta
  página é.
- A opacidade da janela **não é cravada**: quem abre a fresta é o `inactive_opacity` do desktop
  (0,90, no menu do Meta+O). Assim o painel obedece o mesmo slider que o resto dos apps.

#### O rodapé também é do idioma da travessa (08/09/2026)

No Mirante o rodapé deixa de ser ilha e vira dois grupos de pílula soltos, com os mesmos valores do
`.barramento` — `alpha(base, 0.82)`, aresta de `surface0`, raio 14. E eles fecham na **mesma prumada
da coluna** (620px centrados), não nas bordas do monitor.

Enquanto ele era uma placa de 1080 de ponta a ponta, era a última coisa da página que não obedecia à
coluna: o olho descia da placa de 620 e batia numa faixa do dobro da largura, com outro raio e outro
material. Espalhados nos 1080, os dois grupos ficavam a mais de 200px de qualquer coisa da página e
liam como sobra, não como rodapé.

#### A escala é de leitura a dois metros

Rótulo é **11,5px em `subtext0`**, não 10px em `overlay1`; valor de ficha (kernel, distro, máquina) é
**14px em `text`**, não 12px em `subtext0`. Isto fica num monitor em pé a dois metros, sobre uma
ilustração saturada — o cinza médio de card de app não sobrevive ali, e rótulo que some leva junto o
número que ele nomeia. Quando um par rótulo+valor precisa perder peso, quem perde é o **rótulo**:
`7.2.3-zen1-3-zen` se reconhece sem a palavra KERNEL na frente.

A janela em foco não escreve o nome do próprio painel: ele está na frente o dia todo, e a linha
passava a maior parte do tempo dizendo "Mirante" para quem já olha para o Mirante.

A hora deixou de ser o pé da coluna e passou a ser o bloco que a fecha dentro do grupo centrado.
O gesto continua o mesmo — é a leitura de mais longe, e é a última coisa da pilha.

Relógio e térmica **saem do rodapé** enquanto o Mirante está na frente: os widgets já dizem os dois,
em tamanho de ler de longe. A mesma informação em dois lugares da mesma tela é ruído, não
redundância — a mesma regra que aposentou o medidor vertical da cota em 27/08/2026.

### Movimento, revisto

A regra antiga era "um momento autoral só, o resto é estático". Continua valendo para a **Estação**,
que é tela de trabalho. O Mirante abre uma exceção medida:

- **Aurora Lottie** atrás da hora. Ambiente, nunca informação: fica atrás, recortada pela ilha, a
  30% de opacidade e desfocada, e nunca disputa contraste com o número.
- **Bruma Lottie** atrás da página inteira, a 30% e com `blur(46px)`. Ela existe por causa da
  centralização: com a coluna no meio sobra papel de parede em cima e embaixo, e sobra parada lê como
  tela travada. O ciclo é de 60 s de propósito — isto fica no canto do olho o dia todo, e movimento
  que se repete a cada poucos segundos vira tique.
- **Calmo Lottie** no vazio da agenda: um aro que respira devagar acima da frase. A frase sozinha no
  meio de uma placa alta lia como espera de carregamento, e não como a regra 4. Ele é montado e
  desmontado a cada pintura da lista, porque o `innerHTML` apaga o container — guardá-lo no array
  geral deixaria um Lottie órfão cobrando quadro para sempre.
- **Dois-pontos do relógio** piscando a cada segundo. É o único lugar do painel onde o segundo
  aparece — e como brilho, não como dígito girando no canto do olho. O resto do número só é
  reescrito na virada do minuto: reescrever a hora 60 vezes por minuto obriga o Chromium a remedir
  a fonte gigante à toa.
- **Anéis térmicos e barras de carga** deslizam do valor velho para o novo (700ms) em vez de saltar
  a cada tique de 2 s.
- **Onda de música** só anda com som andando. Parada, ela mentiria.

Nada disso desenha quando a página não está na frente: `window.mirante.acorda(false)` pausa as
animações, porque `display:none` não impede o Lottie de cobrar quadro.

`prefers-reduced-motion` corta a aurora, a onda e todas as transições.

### Escalas

Duas, fixas, e as mesmas da barra central: **térmica de 30 a 100 °C** (verde até 65, âmbar até 82,
vermelho acima) e **carga de 0 a 100%** (acento até 70, âmbar até 90, vermelho acima). Escala fixa é
o que deixa comparar CPU com GPU de relance sem ler o eixo.

Dia com compromisso ganha **ponto** no calendário, nunca cor de fundo: estado nunca é só cor
(regra 1).

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
- **Limpeza sozinha de 6 em 6 horas** (30/08/2026, portada em 07/09/2026): a tecla *Cache* deixa de
  ser a única porta. O painel confere a cada 10 min o `finishedAt` do `maintenance.status.json` e,
  passadas 6 h, dispara o mesmo `manutencao.sh` do botão. A conta é sobre a hora da última limpeza,
  não sobre um tique de 6 h: máquina desligada um dia limpa na primeira checagem depois de voltar.
  No Linux não há elevação a pedir — o script roda como o usuário e só toca no que mora dentro de
  `$HOME` (yay, paru, npm, pnpm, Yarn, pip, Electron, Gradle, miniaturas, shader, lixeira, journal).
  O cache do pacman em `/var/cache` fica de fora de propósito: exigiria root, e pedir senha sem
  ninguém na frente da máquina deixaria a limpeza parada esperando resposta de ninguém — o mesmo
  raciocínio que valia para o UAC. Avisa por notificação nas duas pontas: "Limpando cache" ao
  disparar e "Cache limpo · liberado X MB" quando o status volta a `running=false`.
- **Lançamento do GTA VI** (28/08/2026), primeiro morador da prateleira. Desde 08/09/2026 ela é a
  **última placa da coluna do Mirante**, e não mais uma faixa do rodapé: enquanto ocupava os 1080 de
  ponta a ponta colada no pé, era o único elemento da página que não obedecia à coluna de 620 —
  largura, raio e material todos diferentes do resto —, e de longe lia como pedaço de outra tela
  grudado embaixo. O desenho de dentro é o mesmo: marca "VI" desenhada na
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
