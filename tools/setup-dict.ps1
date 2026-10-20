$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$root = Split-Path -Parent $PSScriptRoot
$dataDir = Join-Path $root 'data'
$dictPath = Join-Path $dataDir 'stardict.db'
$verifyScript = Join-Path $PSScriptRoot 'verify-dict.mjs'
if ($env:ES_ECDICT_URL) { $url = $env:ES_ECDICT_URL } else { $url = 'https://github.com/skywind3000/ECDICT/releases/download/1.0.28/ecdict-sqlite-28.zip' }
$zip = Join-Path $env:TEMP 'ecdict-sqlite-28.zip'
$extractDir = Join-Path $env:TEMP 'ecdict-sqlite-28'

if (Test-Path $dictPath) {
  Write-Host "Dictionary already exists: $dictPath"
  exit 0
}

Write-Host "Downloading ECDICT sqlite zip (~207 MB)..."
Write-Host "  $url"
try {
  if (Test-Path $zip) { Remove-Item $zip -Force }
  # 优先 curl.exe: 有实时进度条, 比 Invoke-WebRequest 更快更透明(Windows 10 1803+ 自带)
  if (Get-Command curl.exe -ErrorAction SilentlyContinue) {
    & curl.exe -L --fail --retry 5 --retry-all-errors --retry-delay 3 --progress-bar -o $zip $url
    if ($LASTEXITCODE -ne 0) { throw "curl exited with code $LASTEXITCODE" }
  } else {
    Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
  }
} catch {
  Write-Host "[ERROR] Download failed: $($_.Exception.Message)"
  Write-Host "Please download it manually and extract stardict.db to: $dictPath"
  Write-Host "  $url"
  exit 1
}

$zipSize = (Get-Item $zip).Length
# 官方包约 207MB(下限 100MB); 用 ES_ECDICT_URL 指向本地/镜像测试时放宽体积检查
$minZipSize = if ($env:ES_ECDICT_URL) { 1 } else { 100MB }
if ($zipSize -lt $minZipSize) {
  Write-Host "[ERROR] Downloaded file is too small ($zipSize bytes), download may be incomplete."
  Remove-Item $zip -Force -ErrorAction SilentlyContinue
  exit 1
}
Write-Host ("Downloaded {0:N1} MB" -f ($zipSize / 1MB))

Write-Host "Extracting..."
try {
  if (Test-Path $extractDir) { Remove-Item $extractDir -Recurse -Force }
  Expand-Archive -Path $zip -DestinationPath $extractDir -Force
} catch {
  Write-Host "[ERROR] Extract failed: $($_.Exception.Message)"
  Remove-Item $zip -Force -ErrorAction SilentlyContinue
  exit 1
}

$dbFile = Get-ChildItem $extractDir -Recurse -File -Filter '*.db' |
  Sort-Object Length -Descending |
  Select-Object -First 1
if (-not $dbFile) {
  Write-Host "[ERROR] No .db file found in the downloaded archive."
  Write-Host "Please download it manually and extract stardict.db to: $dictPath"
  exit 1
}

New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
Copy-Item $dbFile.FullName $dictPath -Force
Write-Host ("Dictionary placed: {0} ({1:N1} MB)" -f $dictPath, ((Get-Item $dictPath).Length / 1MB))

Write-Host "Verifying dictionary..."
& node $verifyScript $dictPath
if ($LASTEXITCODE -ne 0) {
  Write-Host "[ERROR] Dictionary verification failed. Removing incomplete file."
  Remove-Item $dictPath -Force -ErrorAction SilentlyContinue
  exit 1
}

Remove-Item $zip -Force -ErrorAction SilentlyContinue
Remove-Item $extractDir -Recurse -Force -ErrorAction SilentlyContinue
Write-Host "Dictionary ready."
exit 0
