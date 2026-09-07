# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Alexandre, sozinho. Desenvolvedor solo que toca vários apps próprios (MeuEscolar, Fae Terraplanagem,
DamaApp, LigaFoot, MeuMengão) e é staff/dono de um servidor de FiveM (Michigan Roleplay). Trabalha
num PC Windows com dois monitores: um principal 2560x1440 onde ele de fato codifica, e um segundo
vertical 1080x1920 à esquerda, que é onde este produto vive.

**Situação de uso confirmada:** olhada de canto de olho. Ele fica no monitor principal e vira o olho
para o vertical de vez em quando. Precisa ler estado — número, cor, alerta — de longe, sem se
aproximar nem focar. Só se aproxima quando algo aconteceu.

## Product Purpose

Ser o painel de trabalho do segundo monitor: um lugar fixo que mostra, sem ele pedir, o que está
acontecendo nas coisas que ele toca. Sucesso = ele descobrir um problema por causa do painel, não
por causa de um cliente reclamando.

## Positioning

Não é dashboard de time nem produto para vender: é um painel pessoal, de um usuário só, que junta
serviços que normalmente não se falam (Sentry, Discord, txAdmin, cota do Claude Code) porque quem
usa é a mesma pessoa em todos eles.

## Operating Context

- Roda como app Electron (`widget-claude`), tela cheia no monitor vertical, subindo no logon por
  tarefa agendada com watchdog que ressuscita o app a cada minuto.
- Nasceu como widget flutuante de 420x258 com a cota do Claude Code; virou painel em 27/08/2026.
- Os dois consoles do txAdmin (FiveM) são páginas web de terceiro embutidas em `<webview>`; o visual
  delas não é nosso e não pode ser redesenhado — só emoldurado.
- Notificação nativa do Windows está desligada na máquina (`ToastEnabled=0`), então o aviso precisa
  acontecer dentro da própria janela.

## Capabilities and Constraints

**Prioridade confirmada de leitura (do mais para o menos importante):**
1. O que os servidores estão cuspindo (console remoto `192.0.2.10:40120` e local `localhost:40120`)
2. Quanto sobrou da cota do Claude Code (sessão 5h, semana 7d, por modelo)
3. Se tem erro novo no Sentry
4. Anotações pendentes do Discord (não entrou no que ele checa primeiro)

**Dados que o painel tem hoje:**
- Cota do Claude Code: percentual e horário de reset por limite.
- Sentry: issues não resolvidas de todos os projetos da org, nível, contagem de eventos e usuários,
  quando aconteceu por último. Ação de resolver escreve na API.
- Discord: total de mensagens do canal de anotações e quantas estão sem reação. **Regra do produto:
  mensagem sem reação = pendência.** O texto das mensagens não chega (bot sem Message Content
  Intent) — hoje só autor, hora e link.
- Temperaturas de CPU/GPU (LibreHardwareMonitor na porta 8085), relógio, limpeza de cache do Windows
  e troca de credencial do Claude Code entre assinatura Max e API/gateway.

**Constraints técnicos:** HTML/CSS/JS puro no renderer do Electron, sem framework nem build; sem
aceleração de GPU (`disableHardwareAcceleration`); sem rede além das APIs já usadas — CSS e fontes
precisam ser locais ou do sistema.

**Vai crescer:** ele quer, com o tempo, mais serviços dele (builds do EAS/Expo, Firebase, Cloudflare,
status dos apps) e rotina pessoal (agenda, tarefas, e-mail, WhatsApp). O layout precisa aceitar
blocos novos sem ser redesenhado de novo.

## Brand Commitments

Nenhuma marca a preservar. O laranja `#d97757` que existe hoje veio do Claude Code, não é identidade
dele — não é compromisso.

## Evidence on Hand

Dados reais, ao vivo, em 27/08/2026: 5 projetos no Sentry com 3 a 7 issues abertas; canal do Discord
com 659 mensagens e 182 sem reação; cota semanal em 73%. Nada precisa ser inventado — todo número do
painel vem de API real. Não há usuários além dele, nem métricas de negócio, nem provas comerciais.

## Product Principles

1. **Estado antes de detalhe.** De longe ele precisa ver que algo mudou; o detalhe só quando chegar perto.
2. **Silêncio é informação.** Painel calmo significa que está tudo bem; alarme só quando é alarme.
3. **Nada exige clique para ser descoberto.** O que importa aparece sozinho.
4. **Blocos, não layout fixo.** Serviço novo entra sem refazer a tela.
5. **Ação destrutiva pede confirmação.** Resolver issue escreve em produção.

## Accessibility & Inclusion

Uso à distância, de canto de olho, é o requisito dominante: tamanho de texto e contraste de estado
precisam funcionar sem foco. Cor nunca pode ser o único portador de estado.
