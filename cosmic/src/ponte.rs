// Ponte com a extensão do Chrome (`extensao/`), por native messaging.
//
// O Chrome sobe este mesmo binário com a origem da extensão como argumento
// (`chrome-extension://<id>/`). Nesse modo não há interface: mensagens chegam
// pela entrada padrão (4 bytes de tamanho + JSON) e viram o arquivo
// `$XDG_RUNTIME_DIR/ricepanel/abas.json`, que o painel lê no tique. Comandos do
// painel para uma aba vão por `comandos.jsonl` na mesma pasta: o host lê as
// linhas novas e as manda à extensão pela saída padrão.

use std::io::{Read, Write};
use std::path::PathBuf;
use std::time::{Duration, SystemTime};

use serde::{Deserialize, Serialize};

pub fn pasta() -> PathBuf {
    std::env::var_os("XDG_RUNTIME_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
        .join("ricepanel")
}

pub fn eh_chamada_do_chrome() -> bool {
    std::env::args().skip(1).any(|a| a.starts_with("chrome-extension://"))
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Aba {
    pub aba: i64,
    pub janela: i64,
    pub url: String,
    pub ativa: bool,
    #[serde(default)]
    pub janela_focada: bool,
    #[serde(default)]
    pub audivel: bool,
    pub tocando: bool,
    pub posicao: f64,
    pub duracao: Option<f64>,
    pub volume: f64,
    pub titulo: String,
}

#[derive(Debug, Deserialize)]
struct Relato {
    abas: Vec<Aba>,
}

/// Abas relatadas há menos de 6 s. `None` quando a extensão não está de pé:
/// o painel volta para o caminho antigo (MPRIS e histórico).
pub fn abas() -> Option<Vec<Aba>> {
    let arq = pasta().join("abas.json");
    let idade = std::fs::metadata(&arq).ok()?.modified().ok()?.elapsed().ok()?;
    if idade > Duration::from_secs(6) {
        return None;
    }
    let texto = std::fs::read_to_string(arq).ok()?;
    serde_json::from_str::<Relato>(&texto).ok().map(|r| r.abas)
}

pub fn comando(tipo: &str, aba: i64) {
    let _ = std::fs::create_dir_all(pasta());
    let linha = format!("{{\"tipo\":\"{tipo}\",\"aba\":{aba}}}\n");
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(pasta().join("comandos.jsonl")) {
        let _ = f.write_all(linha.as_bytes());
    }
}

fn envia(saida: &mut impl Write, json: &str) -> std::io::Result<()> {
    saida.write_all(&(json.len() as u32).to_le_bytes())?;
    saida.write_all(json.as_bytes())?;
    saida.flush()
}

pub fn rodar() {
    let dir = pasta();
    let _ = std::fs::create_dir_all(&dir);
    let arq_comandos = dir.join("comandos.jsonl");
    // Comando velho de outra sessão não vale: começa do fim do arquivo.
    let inicio = std::fs::metadata(&arq_comandos).map(|m| m.len()).unwrap_or(0);

    std::thread::spawn(move || {
        let mut lido = inicio;
        let mut saida = std::io::stdout();
        loop {
            std::thread::sleep(Duration::from_millis(250));
            let Ok(texto) = std::fs::read(&arq_comandos) else { continue };
            if (texto.len() as u64) < lido {
                lido = 0; // arquivo recriado
            }
            let novo = &texto[lido as usize..];
            let Some(ultima_quebra) = novo.iter().rposition(|&b| b == b'\n') else { continue };
            for linha in novo[..=ultima_quebra].split(|&b| b == b'\n') {
                let linha = String::from_utf8_lossy(linha);
                if !linha.trim().is_empty() && envia(&mut saida, linha.trim()).is_err() {
                    std::process::exit(0);
                }
            }
            lido += ultima_quebra as u64 + 1;
        }
    });

    let mut entrada = std::io::stdin().lock();
    let tmp = dir.join("abas.json.tmp");
    let alvo = dir.join("abas.json");
    loop {
        let mut tam = [0u8; 4];
        if entrada.read_exact(&mut tam).is_err() {
            break; // Chrome fechou a porta
        }
        let n = u32::from_le_bytes(tam) as usize;
        if n > 8 * 1024 * 1024 {
            break;
        }
        let mut corpo = vec![0u8; n];
        if entrada.read_exact(&mut corpo).is_err() {
            break;
        }
        // Escrita atômica: o painel nunca lê meio JSON.
        if std::fs::write(&tmp, &corpo).is_ok() {
            let _ = std::fs::rename(&tmp, &alvo);
        }
    }
    let _ = std::fs::remove_file(&alvo);
    let _ = SystemTime::now();
}
