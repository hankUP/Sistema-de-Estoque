<#
  Backup diário do banco do controle de estoque.
  - Lê a conexão do .env do projeto (a senha não é exibida nem gravada em log).
  - Gera um dump no formato custom do pg_dump e confere se ele pode ser lido pelo pg_restore.
  - Mantém os últimos $Dias dias de backups.
  - Opcional: copia o dump para uma pasta externa (ex.: OneDrive, HD externo).

  Uso manual:
    powershell -ExecutionPolicy Bypass -File scripts\backup-db.ps1
    powershell -ExecutionPolicy Bypass -File scripts\backup-db.ps1 -CopiaExterna "D:\Backups"
#>
param(
  # Padrão: pasta backups\diario ao lado da pasta do projeto.
  [string]$Destino = '',
  [string]$CopiaExterna = '',
  [int]$Dias = 14
)

$ErrorActionPreference = 'Stop'
$projeto = Split-Path -Parent $PSScriptRoot
if (-not $Destino) { $Destino = Join-Path (Split-Path -Parent $projeto) 'backups\diario' }
$log = Join-Path $Destino 'backup.log'
New-Item -ItemType Directory -Force $Destino | Out-Null

function Registrar([string]$texto) {
  $linha = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $texto"
  Add-Content -Encoding utf8 -Path $log -Value $linha
  Write-Output $linha
}

try {
  $bin = Get-ChildItem 'C:\Program Files\PostgreSQL\*\bin\pg_dump.exe' | Sort-Object FullName -Descending | Select-Object -First 1
  if (-not $bin) { throw 'pg_dump não encontrado em C:\Program Files\PostgreSQL.' }
  $pgRestore = Join-Path $bin.DirectoryName 'pg_restore.exe'

  $vars = @{}
  Get-Content (Join-Path $projeto '.env') | Where-Object { $_ -match '^\s*\w+=' } | ForEach-Object {
    $chave, $valor = $_ -split '=', 2
    $vars[$chave.Trim()] = $valor.Trim()
  }
  foreach ($chave in 'PGHOST', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD') {
    if (-not $vars[$chave]) { throw "Variável $chave ausente no .env." }
  }

  $arquivo = Join-Path $Destino ("estoque-{0}.dump" -f (Get-Date -Format 'yyyy-MM-dd_HHmm'))
  $env:PGPASSWORD = $vars.PGPASSWORD
  try {
    & $bin.FullName -h $vars.PGHOST -p $vars.PGPORT -U $vars.PGUSER -d $vars.PGDATABASE -Fc -f $arquivo
    if ($LASTEXITCODE -ne 0) { throw "pg_dump terminou com código $LASTEXITCODE." }
  } finally {
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  }

  # Confere se o arquivo é um dump válido e não está vazio.
  $conteudo = & $pgRestore --list $arquivo
  if ($LASTEXITCODE -ne 0 -or -not ($conteudo -match 'TABLE DATA public movements')) {
    throw "O dump $arquivo não passou na verificação."
  }
  $tamanho = [math]::Round((Get-Item $arquivo).Length / 1KB)
  Registrar "OK  $arquivo ($tamanho KB)"

  if ($CopiaExterna) {
    New-Item -ItemType Directory -Force $CopiaExterna | Out-Null
    Copy-Item $arquivo $CopiaExterna
    Get-ChildItem $CopiaExterna -Filter 'estoque-*.dump' |
      Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$Dias) } | Remove-Item
    Registrar "Cópia externa em $CopiaExterna"
  }

  $antigos = Get-ChildItem $Destino -Filter 'estoque-*.dump' | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$Dias) }
  if ($antigos) {
    $antigos | Remove-Item
    Registrar "Removidos $($antigos.Count) backup(s) com mais de $Dias dias."
  }
} catch {
  Registrar "ERRO  $($_.Exception.Message)"
  exit 1
}
