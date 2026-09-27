# Registra o host de native messaging da ponte no Chrome do Windows.
#
# Sem administrador: a chave fica em HKCU. O manifesto do host precisa de
# caminho absoluto, então é gerado aqui, em %LOCALAPPDATA%\RicePanel, apontando
# para a host.bat deste repositório. O ID da extensão sai do id.txt da
# RiceExtension, projeto ao lado deste (fixo: o manifest.json leva a "key").
#
# A extensão em si é carregada no Chrome à mão, uma vez:
#   chrome://extensions > Modo do desenvolvedor > Carregar sem compactação >
#   D:\Apps\desktop\RiceExtension\dist\Chrome  (depois de `npm run build` lá)
$ErrorActionPreference = 'Stop'

$nome = 'br.com.eualexandre.ricepanel'
$raiz = Split-Path -Parent $PSScriptRoot
$id = (Get-Content (Join-Path (Split-Path -Parent $raiz) 'RiceExtension\id.txt') -Raw).Trim()
if ($id -notmatch '^[a-p]{32}$') { throw "ID de extensão inválido em id.txt: $id" }

$pasta = Join-Path $env:LOCALAPPDATA 'RicePanel'
New-Item -ItemType Directory -Force $pasta | Out-Null
$manifesto = Join-Path $pasta "$nome.json"

$conteudo = [ordered]@{
  name            = $nome
  description     = 'Ponte do RicePanel: abas de vídeo do Chrome para o painel'
  path            = (Join-Path $PSScriptRoot 'host.bat')
  type            = 'stdio'
  allowed_origins = @("chrome-extension://$id/")
} | ConvertTo-Json

# UTF-8 sem BOM: o Chrome não aceita manifesto de host com BOM.
[IO.File]::WriteAllText($manifesto, $conteudo, (New-Object System.Text.UTF8Encoding $false))

$chave = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$nome"
New-Item -Path $chave -Force | Out-Null
Set-Item -Path $chave -Value $manifesto

Write-Host "Host registrado: $chave -> $manifesto"
Write-Host "Extensão esperada: chrome-extension://$id/"
