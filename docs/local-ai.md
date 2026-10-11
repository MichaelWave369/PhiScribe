# PhiScribe Local AI Companion v0.5

Upload an audio file → run local speech recognition → edit the transcript → export PDF/TXT or send a reviewed ChatGPT handoff.

The PhiScribe companion is original Node.js code with **zero npm dependencies**. It runs on **127.0.0.1:8765** on your own PC. It does NOT send audio to a cloud speech API, automatically download models, or install third-party software. The user supplies compatible **whisper.cpp whisper-cli**, **FFmpeg**, and a locally stored **GGML Whisper model** separately, according to their own licenses.

## Windows 11 setup

1. Install Node.js 20+ and confirm in PowerShell using node --version.
2. Obtain and install a compatible whisper-cli.exe using official whisper.cpp instructions: https://github.com/ggml-org/whisper.cpp . CPU builds work; to use an NVIDIA GPU you need a correctly built CUDA-enabled version. PhiScribe doesn't build CUDA for you.
3. Download a whisper.cpp-compatible GGML .bin model through documented download instructions. ggml-base.en.bin is English only; ggml-base.bin supports multiple languages. Review the model license.
4. Install a suitable FFmpeg executable: https://ffmpeg.org/download.html.
5. Open PowerShell from your checked-out PhiScribe repository root and run:

~~~powershell
.\local\start-windows.ps1 -Model "C:\models\ggml-base.en.bin" -WhisperCli "C:\tools\whisper\whisper-cli.exe" -FFmpeg "C:\tools\ffmpeg\bin\ffmpeg.exe"
~~~

You can alternatively set environment variables PHISCRIBE_MODEL, PHISCRIBE_WHISPER_CLI and PHISCRIBE_FFMPEG and execute npm run local.

**Open http://127.0.0.1:8765/ (not GitHub Pages)** after starting the companion. Choose or drop an audio recording, click **Check local engine**, then **Transcribe locally**. Chrome may block HTTPS GitHub Pages reaching a loopback HTTP server due to Private Network Access; the localhost page avoids this cross-origin limitation.

## Safeguards and boundaries

- Listens on loopback only, never a LAN/public interface.
- Browser origins other than localhost and the official PhiScribe GitHub Pages origin are refused, and each process launch generates a random session token.
- Allows one transcription job at a time. Uploads capped at 250 MiB, audio conversion capped at 60 minutes, output text capped at 8 MiB.
- Uploads and intermediate files are kept in randomly named OS temporary folders and cleaned up afterward. Cancellation signals the running process.
- Invokes FFmpeg and Whisper with argument arrays, not shell interpolation.
- No bundled model or speech binary, no analytics, no cloud transcript upload, no background inbox monitoring.
- Existing microphone and **Tab Listen** still use browser speech recognition. **Only uploaded-file transcription** is implemented by this local companion.
- PhiScribe's editor still stores text in browser localStorage, which is not encrypted. Export backups for important documents. Verify IP addresses, names, code and commands: models can make errors.

## Troubleshooting

- **Engine not ready:** check model path and CLI executable. A CLI set by PATH may appear ready until actually invoked.
- **FFmpeg launch error:** supply its absolute path.
- **Whisper model load error:** confirm the model format and executable compatibility.
- **Unsupported language:** choose a multilingual model rather than an English-only one.
- **GitHub Pages can't reach localhost:** open http://127.0.0.1:8765/ directly.
- **Slow inference:** try a smaller model or an independently built CUDA-enabled whisper.cpp.
- **Port already taken:** stop the process on 8765, then retry.
