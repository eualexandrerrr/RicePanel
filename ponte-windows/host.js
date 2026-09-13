// Host de native messaging da extensão ponte, no Windows.
//
// O Chrome sobe este processo quando a extensão chama `connectNative` e fala
// com ele pelo stdin/stdout: cada mensagem é um inteiro de 4 bytes (little
// endian) com o tamanho, seguido do JSON. O host não entende nada do conteúdo:
// repassa ao painel pelo named pipe, uma mensagem por linha, e devolve ao Chrome
// o que o painel mandar. Painel fechado: tenta de novo a cada 2 s.
//
// Nada pode ir para o stdout além do protocolo — um console.log aqui quebra a
// conexão com a extensão.

const net = require('net');

const CANO = '\\\\.\\pipe\\ricepanel-ponte';

let cano = null;

function paraOChrome(json) {
  const corpo = Buffer.from(json, 'utf8');
  const cabeca = Buffer.alloc(4);
  cabeca.writeUInt32LE(corpo.length, 0);
  process.stdout.write(Buffer.concat([cabeca, corpo]));
}

function conecta() {
  const sock = net.connect(CANO);
  sock.setEncoding('utf8');
  let resto = '';
  sock.on('connect', () => { cano = sock; });
  sock.on('data', (pedaco) => {
    resto += pedaco;
    let i;
    while ((i = resto.indexOf('\n')) >= 0) {
      const linha = resto.slice(0, i);
      resto = resto.slice(i + 1);
      if (linha.trim()) paraOChrome(linha);
    }
  });
  sock.on('close', () => {
    if (cano === sock) cano = null;
    setTimeout(conecta, 2000);
  });
  sock.on('error', () => {});
}

let entrada = Buffer.alloc(0);
process.stdin.on('data', (pedaco) => {
  entrada = Buffer.concat([entrada, pedaco]);
  while (entrada.length >= 4) {
    const tamanho = entrada.readUInt32LE(0);
    if (entrada.length < 4 + tamanho) break;
    const json = entrada.subarray(4, 4 + tamanho).toString('utf8');
    entrada = entrada.subarray(4 + tamanho);
    // Sem painel a mensagem se perde: a extensão manda a lista de novo em 2 s.
    if (cano) { try { cano.write(json.replace(/[\r\n]+/g, ' ') + '\n'); } catch (e) {} }
  }
});
// Chrome fechou a porta (extensão recarregada, navegador fechado): acabou.
process.stdin.on('end', () => process.exit(0));

conecta();
