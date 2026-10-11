/** Pure, auditable guards for PhiScribe's uploaded-audio workflow. */
export const MAX_AUDIO_BYTES = 250 * 1024 * 1024;
export const ACCEPTED_AUDIO_EXTENSIONS = new Set(['mp3', 'm4a', 'mp4', 'wav', 'wave', 'ogg', 'oga', 'webm', 'flac', 'aac']);

export function validateAudioFile(file) {
  if (!file || typeof file.name !== 'string' || typeof file.size !== 'number') {
    throw new Error('Choose an audio file to transcribe.');
  }
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (!ACCEPTED_AUDIO_EXTENSIONS.has(extension)) {
    throw new Error('Choose an audio clip such as MP3, WAV, M4A, OGG, WebM, AAC, or FLAC.');
  }
  if (file.size === 0) throw new Error('That audio file is empty.');
  if (file.size > MAX_AUDIO_BYTES) throw new Error('This version accepts audio files up to 250 MB.');
  return file;
}

export function supportsAudioTrackRecognition(userAgent = '', hasRecognizer = false, hasWebAudio = false) {
  if (!hasRecognizer || !hasWebAudio) return false;
  // Audio-track recognition is only verified for DESKTOP Chromium 135+.
  // No fallback to start() without a track: that could turn on the microphone instead.
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(userAgent)) return false;
  const match = /(?:Chrome|Chromium)\/(\d+)/.exec(userAgent);
  if (!match || Number(match[1]) < 135) return false;
  if (/Firefox|FxiOS|CriOS|EdgiOS|OPiOS/i.test(userAgent)) return false;
  return true;
}

export function humanDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return 'Unknown duration';
  const rounded = Math.floor(seconds);
  const h = Math.floor(rounded / 3600);
  const m = Math.floor((rounded % 3600) / 60);
  const s = rounded % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

export function appendTranscript(existing, addition) {
  const next = String(addition || '').trim();
  if (!next) return String(existing || '');
  const base = String(existing || '');
  return base + (base && !/\s$/u.test(base) ? ' ' : '') + next;
}
