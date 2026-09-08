#!/usr/bin/env bash
# Derruba o Mirante que estiver de pé e sobe de novo, solto do terminal.
# setsid: sem ele o app morre junto com o shell que o chamou.
cd "$(dirname "$0")"
pkill -f "dist/electron \." 2>/dev/null
sleep 0.6
rm -f mirante-stop.flag
setsid ./node_modules/electron/dist/electron . >/tmp/mirante-saida.log 2>&1 < /dev/null &
disown
sleep 0.3
echo "Mirante subiu"
