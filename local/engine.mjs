/** PhiScribe local speech pipeline. No external JavaScript dependencies. */
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, isAbsolute } from 'node:path';

export const MAX_UPLOAD_BYTES = 250 * 1024 * 1024;
export const ACCEPTED_EXTENSIONS = new Set(['mp3', 'm4a', 'mp4', 'wav', 'wave', 'ogg', 'oga', 'webm', 'flac', 'aac']);
const LANGS = new Set(['auto', 'en', 'es', 'fr', 'de', 'pt', 'hi', 'ja', 'it', 'nl', 'ko', 'zh', 'ru', 'ar', 'uk', 'pl', 'tr', 'sv', 'no', 'da', 'fi']);

export function validateLanguage(value) {
  const lang = String(value || 'en').toLowerCase().split('-')[0];
  if (!LANGS.has(lang)) throw new Error('Unsupported language.');
  return lang;
}
export function validateFilename(value) {
  if (typeof value !== 'string' || value.length > 220 || /[\r\n\x00-\x1f]/u.test(value)) throw new Error('Invalid filename.');
  const extension = value.split('.').at(-1)?.toLowerCase();
  if (!ACCEPTED_EXTENSIONS.has(extension)) throw new Error('Unsupported audio format.');
  return extension;
}
export async function configured(config) {
  if (!config.model || !config.whisper) return false;
  try {
    const model = await stat(resolve(config.model));
    if (!model.isFile() || model.size < 1024) return false;
    if (isAbsolute(config.whisper)) {
      const executable = await stat(config.whisper);
      if (!executable.isFile()) return false;
    }
    return true;
  } catch { return false; }
}
export function runCommand(executable, args, { signal, timeoutMs = 30 * 60_000 } = {}) {
  return new Promise((resolveCommand, reject) => {
    let child;
    try { child = spawn(executable, args, { shell:false, windowsHide:true, stdio:['ignore','ignore','pipe'], signal }); }
    catch (error) { reject(error); return; }
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stderr?.on('data', bytes => { stderr = (stderr + bytes.toString('utf8')).slice(-3000); });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => {
      clearTimeout(timer);
      if (signal?.aborted) reject(new Error('Transcription cancelled.'));
      else if (code !== 0) reject(new Error('Local processing failed (exit '+code+'). '+stderr.slice(-600)));
      else resolveCommand();
    });
  });
}
export async function transcribeFile(input, config, { language = 'en', signal } = {}) {
  const lang = validateLanguage(language);
  const workdir = await mkdtemp(join(tmpdir(), 'phiscribe-process-'));
  const wav = join(workdir, 'audio.wav');
  const prefix = join(workdir, 'transcript');
  try {
    await runCommand(config.ffmpeg || 'ffmpeg',
      ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
        '-protocol_whitelist', 'file,pipe', '-i', input, '-t', '3600',
        '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wav], { signal });
    await runCommand(config.whisper || 'whisper-cli',
      ['-m', resolve(config.model), '-f', wav, '-l', lang, '-otxt', '-of', prefix, '-nt'], { signal });
    const transcriptFile = prefix+'.txt';
    const info = await stat(transcriptFile);
    if (info.size > 8*1024*1024) throw new Error('Transcript exceeds safe size.');
    return (await readFile(transcriptFile, 'utf8')).trim();
  } finally { await rm(workdir, { recursive:true, force:true }); }
}
