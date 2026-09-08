#!/usr/bin/env bash
# Limpeza de cache — Linux (substitui maintenance.ps1).
#
# Roda como o usuário, sem sudo: só toca no que mora dentro de $HOME. O cache do
# pacman em /var/cache exigiria root, e pedir senha sem ninguém na frente da
# máquina deixaria a limpeza parada esperando resposta de ninguém — igual ao UAC
# no Windows. Quem quiser incluir o cache do sistema chama `paccache` pelo timer
# de root, não por aqui.
#
# Grava o mesmo maintenance.status.json que o painel já sabe ler:
#   { running, ok, startedAt, finishedAt, steps: [ { name, freedMB } ] }

set -uo pipefail

AQUI="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
STATUS="$AQUI/maintenance.status.json"

CACHE="${XDG_CACHE_HOME:-$HOME/.cache}"
DADOS="${XDG_DATA_HOME:-$HOME/.local/share}"

agora() { date -u +%Y-%m-%dT%H:%M:%S.000Z; }

# Tamanho em bytes de um caminho; 0 quando não existe.
tamanho() {
  [ -e "$1" ] || { echo 0; return; }
  du -sb --apparent-size "$1" 2>/dev/null | cut -f1 || echo 0
}

PASSOS=()

# Apaga o CONTEÚDO do diretório, nunca o diretório: app que espera a pasta
# existir quebra quando ela some, e recriar depois não devolve as permissões.
limpa_dir() {
  local rotulo="$1" alvo="$2" antes depois liberado
  [ -d "$alvo" ] || return 0
  antes="$(tamanho "$alvo")"
  find "$alvo" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} + 2>/dev/null
  depois="$(tamanho "$alvo")"
  liberado=$(( (antes - depois) ))
  [ "$liberado" -lt 0 ] && liberado=0
  PASSOS+=("{\"name\":\"$rotulo\",\"freedMB\":$(awk -v b="$liberado" 'BEGIN{printf "%.1f", b/1048576}')}")
}

# Arquivos mais velhos que N dias, para cache que ainda serve (shader, thumbs).
limpa_velhos() {
  local rotulo="$1" alvo="$2" dias="$3" antes depois liberado
  [ -d "$alvo" ] || return 0
  antes="$(tamanho "$alvo")"
  find "$alvo" -type f -atime "+$dias" -delete 2>/dev/null
  find "$alvo" -type d -empty -delete 2>/dev/null
  depois="$(tamanho "$alvo")"
  liberado=$(( (antes - depois) ))
  [ "$liberado" -lt 0 ] && liberado=0
  PASSOS+=("{\"name\":\"$rotulo\",\"freedMB\":$(awk -v b="$liberado" 'BEGIN{printf "%.1f", b/1048576}')}")
}

INICIO="$(agora)"
printf '{"running":true,"ok":true,"startedAt":"%s","steps":[]}\n' "$INICIO" > "$STATUS"

# --- Caches de AUR helper: reconstruídos sozinhos no próximo build ---------
limpa_dir "Cache do yay"        "$CACHE/yay"
limpa_dir "Cache do paru"       "$CACHE/paru"

# --- Ferramentas de desenvolvimento --------------------------------------
limpa_dir "Cache do npm"        "$HOME/.npm/_cacache"
limpa_dir "Cache do pnpm"       "$CACHE/pnpm"
limpa_dir "Cache do Yarn"       "$CACHE/yarn"
limpa_dir "Cache do pip"        "$CACHE/pip"
limpa_dir "Binários do Electron" "$CACHE/electron"
limpa_dir "Cache do Gradle"     "$HOME/.gradle/caches/build-cache-1"

# --- Desktop ---------------------------------------------------------------
limpa_dir    "Miniaturas"        "$CACHE/thumbnails"
limpa_velhos "Cache de shader"   "$CACHE/mesa_shader_cache" 14
limpa_velhos "Cache de shader"   "$CACHE/nv" 14
limpa_dir    "Lixeira"           "$DADOS/Trash/files"
limpa_dir    "Lixeira (info)"    "$DADOS/Trash/info"

# --- Journal do usuário: corta o histórico, mantém a semana ---------------
if command -v journalctl >/dev/null 2>&1; then
  antes_j="$(journalctl --user --disk-usage 2>/dev/null | grep -oE '[0-9.]+[KMG]' | head -1)"
  journalctl --user --vacuum-time=7d >/dev/null 2>&1
  PASSOS+=("{\"name\":\"Journal do usuário (${antes_j:-?} antes)\",\"freedMB\":0}")
fi

JOIN="$(IFS=,; echo "${PASSOS[*]}")"
printf '{"running":false,"ok":true,"startedAt":"%s","finishedAt":"%s","steps":[%s]}\n' \
  "$INICIO" "$(agora)" "$JOIN" > "$STATUS"

exit 0
