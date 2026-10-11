param(
  [Parameter(Mandatory=$true)][string]$Model,
  [string]$WhisperCli = "whisper-cli.exe",
  [string]$FFmpeg = "ffmpeg.exe"
)
$ErrorActionPreference = "Stop"
if (-not (Test-Path -LiteralPath $Model -PathType Leaf)) { throw "Model file not found: $Model" }
$env:PHISCRIBE_MODEL = (Resolve-Path -LiteralPath $Model).Path
$env:PHISCRIBE_WHISPER_CLI = $WhisperCli
$env:PHISCRIBE_FFMPEG = $FFmpeg
Write-Host "PhiScribe Local AI starting on 127.0.0.1:8765. No remote server." -ForegroundColor Cyan
node (Join-Path $PSScriptRoot 'server.mjs')
