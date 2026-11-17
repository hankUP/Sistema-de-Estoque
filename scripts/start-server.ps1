<#
  Inicia o servidor do controle de estoque (usado pela tarefa agendada
  "Gravae - Servidor do estoque"). A saída vai para logs\servidor.log na pasta do projeto.
  Uso manual: powershell -ExecutionPolicy Bypass -File scripts\start-server.ps1
#>
$ErrorActionPreference = 'Stop'
$projeto = Split-Path -Parent $PSScriptRoot
$logs = Join-Path $projeto 'logs'
New-Item -ItemType Directory -Force $logs | Out-Null
$log = Join-Path $logs 'servidor.log'

# Mantém o log pequeno: guarda o anterior e começa um novo a cada início.
if ((Test-Path $log) -and (Get-Item $log).Length -gt 5MB) { Move-Item -Force $log "$log.1" }

$node = (Get-Command node -ErrorAction Stop).Source
Set-Location $projeto

# Se o servidor cair (ex.: banco reiniciando), espera e sobe de novo.
while ($true) {
  Add-Content -Encoding utf8 $log "`n==== $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') iniciando servidor ===="
  & $node --env-file-if-exists=.env server/start.mjs *>> $log
  Add-Content -Encoding utf8 $log "==== $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') servidor parou (código $LASTEXITCODE); reiniciando em 10 s ===="
  Start-Sleep -Seconds 10
}
