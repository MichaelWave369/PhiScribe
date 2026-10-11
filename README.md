# PhiScribe

**Microphone or audio file → text → PDF.** A free, original, dependency-free, local-first transcript and document editor, suitable for GitHub Pages.

## Features (v0.3.0)
- Record live microphone speech via the browser Web Speech API (where supported).
- **Message Fast Lane:** paste real audio files when the clipboard exposes them, or drag/drop a voice note; create six reviewable ChatGPT handoffs (technical explanation, troubleshooting, summary, action items, draft reply, transcript verification). The user explicitly copies and pastes; no automatic AI sending or connection to Facebook.
- **Transcribe an uploaded audio file** in compatible desktop Chromium browsers (Chrome/Edge 135+). Drag/drop or choose an MP3, WAV, M4A, MP4, AAC, OGG, WebM or FLAC clip (max 250 MB). Actual playable codecs depend on the browser.
- Audio file uses a `MediaElementAudioSourceNode` feeding an audio-only `MediaStreamTrack` to `SpeechRecognition.start(audioTrack)`. It is played silently at normal speed and never routed through the microphone. This experimental API is unavailable in Firefox, Safari and most mobile browsers.
- Recognition may be interrupted by the browser during long recordings; PhiScribe attempts limited reconnection and retains partial results. Review transcription accuracy before exporting.
- Browser-service file transcription requires explicit acknowledgment that audio may be transmitted to the browser's recognition provider; strict on-device recognition remains default and refuses if it cannot be guaranteed.
- Choose **strict on-device speech** or **browser speech service** explicitly. Strict mode never silently falls back to the cloud.
- Live partial transcript, editable final text, recording timer and word counter.
- Automatic draft persistence in the browser's `localStorage`.
- Export plain text, Markdown, JSON backup. Import text and PhiScribe JSON backups.
- **Save as PDF** using the browser's native print-to-PDF, with clean pagination and Unicode text support.
- Installable static PWA. Interface/editor can work offline after caching; speech recognition only works offline when the browser's on-device recognizer and language pack do.
- No dependency, account, API key, analytics or paid service.

## Start locally

```bash
python -m http.server 8000
```

Open `http://localhost:8000`. Chrome or Edge desktop are good first choices for speech recognition. The UI, editing and export still work in browsers without it.

## Deploy GitHub Pages

1. Create a public GitHub repo named `PhiScribe` (or any name) and commit these files to `main`.
2. Go to **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Push to `main`. The included workflow runs tests and deploys the static site.
4. Open `https://YOUR-USERNAME.github.io/PhiScribe/` (use the real repo name).

No `npm install` needed. `npm test` runs unit tests with Node 22's built-in runner.

## How to transcribe a recorded clip

1. Open PhiScribe in current desktop Chrome or Edge and choose **Upload / Transcribe → Choose audio clip** (or drop a recording).
2. Pick the correct spoken language. For private recordings, leave privacy mode on **On-device only (strict)** and install the browser language pack if prompted. Switch to **Browser service** only if you consent to remote processing of your clip.
3. Click **Transcribe audio**. The file is read at normal playback speed, silently. You can stop at any time and retain partial transcript text.
4. Edit any recognition errors in the document editor. Click **Save as PDF** and choose Save as PDF in the print dialog, or download TXT/Markdown/JSON backup.

This is a browser API integration, **not** a bundled Whisper model. It cannot guarantee offline transcription everywhere and the exact accuracy, speed and file codec support are determined by the browser.

## Messenger voice-note workflow

1. Save/download the voice recording as an actual audio file from the app or browser **if the platform offers it**. PhiScribe does not sign into Messenger, read your account, scrape private chats, or extract audio from a player/link.
2. Drag the file into **Upload / Transcribe**, choose a local file, or try **Paste audio file** if the clipboard contains audio bytes. A clipboard URL or webpage is not an audio file; the app reports that limitation rather than downloading an unknown link.
3. Choose a recognition privacy mode and transcribe, review errors, then use **Message Fast Lane** to pick one of six handoff goals.
4. Choose **Copy for ChatGPT** and manually paste it into ChatGPT. The copied text includes an explicit untrusted-source boundary and warns ChatGPT to flag uncertain technical commands and addresses rather than inventing them.
5. Sender/source labels and handoff mode are saved with the local document and included in a PhiScribe JSON backup. The audio itself is not retained.

**Current limitation:** File transcription still requires compatible desktop Chromium. Mobile clipboard imports may succeed as file selection, but won't make mobile audio-track recognition work. The next meaningful engine upgrade is reliable on-device file transcription independent of experimental browser speech APIs.

## Privacy and limitations

- **Strict on-device** mode asks the browser to process speech locally; if not supported it refuses to start. Language packs may need downloading. Browser support is experimental and incomplete.
- **Browser service** mode may transmit microphone audio to a browser provider. PhiScribe has no server and doesn't intentionally send transcript data anywhere.
- PhiScribe stores only the edited text in local browser storage. The selected audio file is handled locally by the page while open and is not retained by PhiScribe. Browser-service recognition may send audio to a browser provider after explicit user approval.
- Recognition quality, punctuation, continuity and language support depend on the browser speech engine.
- PDF export opens the system print dialog: select **Save as PDF**. This is the most reliable cross-platform Unicode-aware method without third-party PDF libraries.
- Drafts are stored in `localStorage` and may disappear if site data is cleared, browser storage is evicted, or another device is used. Export a JSON backup for important transcripts.
- GitHub Pages uses HTTPS, required by most browser microphone APIs. HTTPS is also strongly advised on any other deployment.

## Next milestones

- v0.3: Alternative offline transcription engine for browsers that lack audio-track speech recognition, with independently verified local processing and optional model download.
- v0.4: Playback controls, segmentation for long clips, timestamps and stronger file-format decoding.
- v0.5: Speaker segmentation and timestamped paragraphs.
- v0.6: PhiOffice, EVIE and Super Phi.Vessel export adapters, with user-controlled approval and provenance receipts.

MIT Licensed. Copyright © 2026 MichaelWave369.
