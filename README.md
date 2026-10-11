# PhiScribe

**Voice → text → PDF.** A free, original, dependency-free, local-first transcript and document editor, suitable for GitHub Pages.

## Features (v0.1.0)
- Record live microphone speech via the browser Web Speech API (where supported).
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

## Privacy and limitations

- **Strict on-device** mode asks the browser to process speech locally; if not supported it refuses to start. Language packs may need downloading. Browser support is experimental and incomplete.
- **Browser service** mode may transmit microphone audio to a browser provider. PhiScribe has no server and doesn't intentionally send transcript data anywhere.
- PhiScribe does **not** store recorded audio or transcribe uploaded audio files in this version. Transcription is only live microphone input.
- Recognition quality, punctuation, continuity and language support depend on the browser speech engine.
- PDF export opens the system print dialog: select **Save as PDF**. This is the most reliable cross-platform Unicode-aware method without third-party PDF libraries.
- Drafts are stored in `localStorage` and may disappear if site data is cleared, browser storage is evicted, or another device is used. Export a JSON backup for important transcripts.
- GitHub Pages uses HTTPS, required by most browser microphone APIs. HTTPS is also strongly advised on any other deployment.

## Next milestones

- v0.2: Full offline transcription via an independently implemented local inference adapter, with opt-in model download and verified on-device processing; not falsely advertised as working until verified.
- v0.3: Optional audio recording and import transcription after a vetted offline engine is integrated.
- v0.4: Speaker segmentation and timestamped paragraphs.
- v0.5: PhiOffice, EVIE and Super Phi.Vessel export adapters, with user-controlled approval and provenance receipts.

MIT Licensed. Copyright © 2026 MichaelWave369.