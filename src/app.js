import { BACKUP_FORMAT, countWords, safeFilename, elapsedClock, makeMarkdown,
  restoreBackup, newDocument } from './transcript-utils.mjs';

const $ = id => document.getElementById(id);
const STORAGE = 'phiscribe.v1.draft';
const Recognizer = window.SpeechRecognition || window.webkitSpeechRecognition;
const ui = {
  title: $('documentTitle'), note: $('documentNote'), text: $('transcriptText'),
  lang: $('languageSelect'), mode: $('recognitionMode'),
  start: $('startButton'), stop: $('stopButton'),
  status: $('statusPill'), statusText: $('statusText'),
  notice: $('recognitionNotice'), interim: $('interimText'),
  timer: $('timer'), micHint: $('microphoneHint')
};
let doc = newDocument();
let recorder = null, requested = false, preparing = false, running = false;
let segmentStart = null, generation = 0, restartTimer = null, saveTimer = null;

function notice(message, error = false) {
  ui.notice.textContent = message;
  ui.notice.classList.toggle('error', error);
}
function status(label, kind = 'idle') {
  ui.status.dataset.state = kind;
  ui.statusText.textContent = label;
  ui.micHint.textContent = kind === 'live' ? 'Listening. Speak naturally.' :
    kind === 'busy' ? 'Preparing speech recognition…' : 'Microphone ready when you are.';
}
function sync() {
  doc.title = ui.title.value; doc.note = ui.note.value;
  doc.text = ui.text.value; doc.language = ui.lang.value; doc.mode = ui.mode.value;
}
function stats() {
  const words = countWords(ui.text.value);
  $('wordCount').textContent = words + (words === 1 ? ' word' : ' words');
  $('charCount').textContent = ui.text.value.length.toLocaleString() + ' characters';
}
function save() {
  clearTimeout(saveTimer); sync();
  try {
    localStorage.setItem(STORAGE, JSON.stringify(doc));
    $('saveLabel').textContent = 'Saved on this device';
    $('saveDot').classList.remove('error');
  } catch {
    $('saveLabel').textContent = 'Autosave unavailable: export a backup';
    $('saveDot').classList.add('error');
    notice('Local storage unavailable. Download a backup to avoid data loss.', true);
  }
}
function autosave() {
  sync(); stats();
  $('saveLabel').textContent = 'Saving…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 300);
}
function refreshPrivacy() {
  $('privacyHint').textContent = ui.mode.value === 'local' ?
    'Strict mode never falls back to cloud speech recognition. Requires browser on-device support and a language pack.' :
    'Browser service mode may transmit audio to its provider. PhiScribe has no transcription server and does not store your recordings.';
}
function draw() {
  ui.title.value = doc.title; ui.note.value = doc.note; ui.text.value = doc.text;
  ui.lang.value = Array.from(ui.lang.options).some(o => o.value === doc.language) ?
    doc.language : 'en-US';
  ui.mode.value = ['local','browser'].includes(doc.mode) ? doc.mode : 'local';
  stats(); refreshPrivacy(); clock(); controls();
}
function load() {
  try {
    const raw = localStorage.getItem(STORAGE);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed.title === 'string' && typeof parsed.text === 'string') {
        doc = { ...newDocument(), ...parsed };
        doc.elapsedMs = Number.isFinite(parsed.elapsedMs) && parsed.elapsedMs >= 0 ?
          parsed.elapsedMs : 0;
      }
    }
  } catch { notice('Previous draft could not be loaded. Editing and export still work.', true); }
  draw();
}
function elapsed() {
  return doc.elapsedMs + (segmentStart === null ? 0 : Date.now() - segmentStart);
}
function clock() { ui.timer.textContent = elapsedClock(elapsed()); }
function segmentEnd() {
  if (segmentStart !== null) {
    doc.elapsedMs += Date.now() - segmentStart;
    segmentStart = null;
  }
  running = false; clock(); autosave();
}
function controls() {
  ui.start.disabled = !Recognizer || requested || preparing;
  ui.stop.disabled = !requested && !preparing;
  ui.lang.disabled = requested || preparing;
  ui.mode.disabled = requested || preparing;
  ui.start.innerHTML = '<span aria-hidden="true">●</span> ' +
    (doc.elapsedMs ? 'Resume speaking' : 'Start speaking');
}
function stop() {
  requested = false; preparing = false; generation++;
  clearTimeout(restartTimer);
  try { recorder?.stop(); } catch {}
  segmentEnd(); controls(); status('Paused');
  ui.interim.textContent = 'Paused. Start again to continue this document.';
  ui.interim.classList.remove('active');
}
async function localReady() {
  if (ui.mode.value !== 'local') return;
  const probe = new Recognizer();
  if (!('processLocally' in probe)) {
    throw new Error('This browser cannot guarantee on-device recognition. Choose browser service mode explicitly or use a compatible browser.');
  }
  if (typeof Recognizer.available !== 'function') return;
  const options = { langs: [ui.lang.value], processLocally: true };
  const state = await Recognizer.available(options);
  if (state === 'unavailable') throw new Error('On-device recognition unavailable for this language. No cloud fallback occurred.');
  if (state === 'downloading') throw new Error('Local language pack is still downloading. Retry afterward.');
  if (state === 'downloadable') {
    if (typeof Recognizer.install !== 'function') throw new Error('Cannot install a local language pack in this browser.');
    notice('Installing local language pack. This may require a one-time download.');
    if (!await Recognizer.install(options)) throw new Error('Could not install local speech language pack.');
  }
}
function startEngine(token) {
  if (!requested || token !== generation) return;
  const engine = new Recognizer(); recorder = engine;
  engine.lang = ui.lang.value; engine.continuous = true;
  engine.interimResults = true; engine.maxAlternatives = 1;
  if (ui.mode.value === 'local') engine.processLocally = true;
  engine.onstart = () => {
    if (token !== generation || !requested) { try { engine.stop(); } catch {} return; }
    running = true;
    if (segmentStart === null) segmentStart = Date.now();
    status('Recording', 'live');
    notice(ui.mode.value === 'local' ?
      'On-device recognition requested. The browser must process this locally.' :
      'Browser service mode is active. Your provider may process the microphone stream remotely.');
    controls();
  };
  engine.onresult = event => {
    if (token !== generation || !requested) return;
    let live = ''; const final = [];
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const item = event.results[i]; const phrase = item?.[0]?.transcript || '';
      if (item.isFinal) final.push(phrase.trim()); else live += phrase;
    }
    const addition = final.filter(Boolean).join(' ');
    if (addition) {
      const current = ui.text.value;
      ui.text.value += current && !/[\s\n]$/u.test(current) ? ' ' + addition : addition;
      autosave(); ui.text.scrollTop = ui.text.scrollHeight;
    }
    ui.interim.textContent = live || 'Listening for your next sentence…';
    ui.interim.classList.toggle('active', Boolean(live));
  };
  engine.onerror = event => {
    if (token !== generation) return;
    const labels = {
      'not-allowed': 'Microphone denied. Allow microphone access in browser settings.',
      'service-not-allowed': 'Speech recognition blocked by the browser.',
      'audio-capture': 'No working microphone was found.',
      'language-not-supported': 'Chosen language is not supported.',
      'network': 'Browser speech engine reported a network error.',
      'no-speech': 'No speech detected. Will retry if available.',
      'aborted': 'Speech recognition was interrupted.'
    };
    const reason = event.error || 'unknown';
    const fatal = reason !== 'no-speech' && reason !== 'aborted';
    notice(labels[reason] || 'Recognition error: ' + reason, fatal);
    if (fatal) {
      requested = false; clearTimeout(restartTimer);
      status('Unavailable', 'error'); controls();
    }
  };
  engine.onend = () => {
    if (token !== generation) return;
    segmentEnd();
    if (requested) {
      status('Reconnecting', 'busy');
      restartTimer = setTimeout(() => startEngine(token), 650);
    } else if (ui.status.dataset.state !== 'error') status('Paused');
    controls();
  };
  try { engine.start(); }
  catch (error) {
    requested = false; segmentEnd(); status('Unavailable', 'error');
    notice('Cannot start recognition: ' + error.message, true); controls();
  }
}
async function start() {
  if (!Recognizer || requested || preparing) return;
  const token = ++generation;
  preparing = true; status('Preparing', 'busy'); controls();
  try {
    await localReady();
    if (token !== generation) return;
    requested = true; startEngine(token);
  } catch (error) {
    if (token === generation) {
      status('Unavailable', 'error');
      notice(error.message || 'Speech recognition unavailable.', true);
    }
  } finally { preparing = false; controls(); }
}
function download(contents, name, mime) {
  const blob = new Blob([contents], { type: mime + ';charset=utf-8' });
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = name;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
function exportAs(type) {
  save(); const name = safeFilename(doc.title);
  if (type === 'txt') download(doc.text, name + '.txt', 'text/plain');
  if (type === 'md') download(makeMarkdown(doc), name + '.md', 'text/markdown');
  if (type === 'json') download(JSON.stringify({
    format: BACKUP_FORMAT, exportedAt: new Date().toISOString(), document: doc
  }, null, 2), name + '.phiscribe.json', 'application/json');
}
function preparePrint() {
  save();
  $('printTitle').textContent = doc.title || 'Untitled transcript';
  $('printSubtitle').textContent = doc.note || '';
  $('printDate').textContent = 'Created ' + new Date(doc.createdAt).toLocaleString();
  $('printTranscript').textContent = doc.text || '(No transcript text yet)';
}
async function importDocument(file) {
  if (!file) return;
  if (file.size > 2000000) throw new Error('Choose a text or backup file below 2 MB.');
  const raw = await file.text();
  const replacement = file.name.toLowerCase().endsWith('.json') ?
    restoreBackup(raw) : { ...newDocument(),
      title: file.name.replace(/\.(txt|md)$/i, '').slice(0,140), text: raw };
  if (doc.text.trim() && !window.confirm('Replace your current document? Export a backup first if needed.')) return;
  stop(); doc = replacement; draw(); save();
  notice('Imported successfully. Previous draft was replaced.');
}
function connect() {
  [ui.title, ui.note, ui.text].forEach(el => el.addEventListener('input', autosave));
  ui.lang.addEventListener('change', autosave);
  ui.mode.addEventListener('change', () => { refreshPrivacy(); autosave(); });
  ui.start.addEventListener('click', start);
  ui.stop.addEventListener('click', stop);
  $('txtButton').addEventListener('click', () => exportAs('txt'));
  $('mdButton').addEventListener('click', () => exportAs('md'));
  $('backupButton').addEventListener('click', () => exportAs('json'));
  $('pdfButton').addEventListener('click', () => { preparePrint(); window.print(); });
  window.addEventListener('beforeprint', preparePrint);
  $('copyButton').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(ui.text.value);
      notice('Copied transcript to clipboard.');
    } catch { notice('Clipboard unavailable. Select text and copy it manually.', true); }
  });
  $('importButton').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', async event => {
    try { await importDocument(event.target.files?.[0]); }
    catch (error) { notice(error.message, true); }
    finally { event.target.value = ''; }
  });
  $('clearButton').addEventListener('click', () => {
    if (!window.confirm('Clear this document and its local autosave? This cannot be undone.')) return;
    stop(); doc = newDocument(); draw(); save(); notice('New empty document ready.');
  });
  window.addEventListener('pagehide', () => { if (requested) stop(); save(); });
  setInterval(clock, 250);
}
load(); connect();
if (!Recognizer) {
  status('Not supported', 'error');
  notice('Speech recognition is unavailable here. Text editing and exports still work. Try desktop Chrome or Edge for voice input.', true);
} else {
  notice('Choose on-device recognition or explicitly opt into browser service mode. Transcript data is saved locally in this browser.');
}
controls();
if ('serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () =>
    navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
