import { BACKUP_FORMAT, countWords, safeFilename, elapsedClock,
  makeMarkdown, restoreBackup, newDocument } from './transcript-utils.mjs';
import { validateAudioFile, supportsAudioTrackRecognition, humanDuration, appendTranscript } from './audio-import.mjs';
import { clipboardAudioExtension, makeAIHandoff } from './message-fast-lane.mjs';
import { canListenToTab, tabShareOptions, validateTabStream, describeTabCaptureError } from './tab-listen.mjs';
import { localAIStatus, transcribeLocally, cancelLocalJob } from './local-ai.mjs';

const STORAGE_KEY = 'phiscribe.v1.draft';
const $ = (id) => document.getElementById(id);
const ui = {
  title: $('documentTitle'), note: $('documentNote'), text: $('transcriptText'),
  language: $('languageSelect'), mode: $('recognitionMode'),
  start: $('startButton'), stop: $('stopButton'),
  notice: $('recognitionNotice'), status: $('statusPill'), statusText: $('statusText'),
  interim: $('interimText'), timer: $('timer'), hint: $('microphoneHint'),
  saveLabel: $('saveLabel'), saveDot: $('saveDot'),
};
const Recognizer = window.SpeechRecognition || window.webkitSpeechRecognition;
let documentState = newDocument();
let recognition = null;
let wantsRecording = false;
let activeRecognition = false;
let activeSince = null;
let startInProgress = false;
let restartHandle = null;
let saveHandle = null;
let tickHandle = null;
let generation = 0;
// File-transcription state is deliberately separate from microphone recording.
// Browsers that ignore start(audioTrack) are never allowed to silently use the mic.
const AudioContextClass = window.AudioContext || window.webkitAudioContext;
const fileRecognitionSupported = supportsAudioTrackRecognition(navigator.userAgent, Boolean(Recognizer), Boolean(AudioContextClass));
let selectedAudio = null;
let audioTask = null;
let audioToken = 0;
let audioStarting = false;
// Tab Listen never uses getUserMedia or a no-argument SpeechRecognition.start().
const tabListenSupported = canListenToTab(navigator.userAgent, Boolean(Recognizer),
  typeof navigator.mediaDevices?.getDisplayMedia === 'function', window.isSecureContext);
let tabTask = null;
let tabStarting = false;
let tabToken = 0;
let localAI = null;
let localAITask = null;
let localAIConnecting = false;

function setStatus(label, type = 'idle') {
  ui.status.dataset.state = type;
  ui.statusText.textContent = label;
  ui.hint.textContent = type === 'live' ? 'Listening. Speak naturally.' :
    type === 'busy' ? 'Preparing speech recognition…' : 'Microphone ready when you are.';
}
function message(text, isError = false) {
  ui.notice.textContent = text;
  ui.notice.classList.toggle('error', isError);
}
function updateStats() {
  const words = countWords(ui.text.value);
  $('wordCount').textContent = `${words} ${words === 1 ? 'word' : 'words'}`;
  $('charCount').textContent = `${ui.text.value.length.toLocaleString()} characters`;
}
function fullElapsed() {
  return documentState.elapsedMs + (activeSince === null ? 0 : Date.now() - activeSince);
}
function drawTimer() { ui.timer.textContent = elapsedClock(fullElapsed()); }
function syncDocument() {
  documentState.title = ui.title.value;
  documentState.note = ui.note.value;
  documentState.text = ui.text.value;
  documentState.language = ui.language.value;
  documentState.mode = ui.mode.value;
  documentState.handoffSource = $('handoffSource').value;
  documentState.handoffGoal = $('handoffGoal').value;
}
function saveNow() {
  clearTimeout(saveHandle);
  syncDocument();
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(documentState));
    ui.saveLabel.textContent = 'Saved on this device';
    ui.saveDot.classList.remove('error');
  } catch (error) {
    ui.saveLabel.textContent = 'Autosave unavailable: export a backup';
    ui.saveDot.classList.add('error');
    message('Browser storage is unavailable or full. Export a backup to avoid losing your work.', true);
  }
}
function scheduleSave() {
  syncDocument();
  updateStats();
  ui.saveLabel.textContent = 'Saving…';
  clearTimeout(saveHandle);
  saveHandle = setTimeout(saveNow, 300);
}
function populate() {
  ui.title.value = documentState.title;
  ui.note.value = documentState.note;
  ui.text.value = documentState.text;
  ui.language.value = Array.from(ui.language.options).some(option => option.value === documentState.language) ? documentState.language : 'en-US';
  ui.mode.value = ['local', 'browser'].includes(documentState.mode) ? documentState.mode : 'local';
  $('handoffSource').value = documentState.handoffSource || '';
  $('handoffGoal').value = documentState.handoffGoal || 'explain';
  updateStats(); drawTimer(); updatePrivacyHint();
}
function loadSaved() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const document = JSON.parse(raw);
      if (document && typeof document.text === 'string' && typeof document.title === 'string') {
        documentState = { ...newDocument(), ...document, elapsedMs: Number.isFinite(document.elapsedMs) ? document.elapsedMs : 0 };
      }
    }
  } catch { message('Could not load the previous local draft. You can still type and export.', true); }
  populate();
}
function updatePrivacyHint() {
  const strict = ui.mode.value === 'local';
  $('privacyHint').textContent = strict ?
    'Strict mode never intentionally falls back to cloud speech recognition. Requires browser on-device support and an installed language pack.' :
    'The browser may send microphone audio to its speech service. PhiScribe itself does not upload or retain your recording.';
}
function updateAudioConsent() {
  $('audioConsentWrap').hidden = ui.mode.value !== 'browser';
  $('audioServiceConsent').checked = false;
  updateFileControls();
  updateTabConsent();
}
function audioMessage(text, isError = false) {
  const node = $('audioNotice');
  node.textContent = text;
  node.classList.toggle('error', isError);
}
function updateFileControls() {
  $('transcribeAudioButton').disabled = !selectedAudio || !fileRecognitionSupported || Boolean(audioTask) || audioStarting ||
    wantsRecording || startInProgress || Boolean(tabTask) || tabStarting || Boolean(localAITask) || (ui.mode.value === 'browser' && !$('audioServiceConsent').checked);
  $('stopAudioButton').disabled = !audioTask;
  $('chooseAudioButton').disabled = Boolean(audioTask) || audioStarting || Boolean(localAITask);
  $('audioInput').disabled = Boolean(audioTask) || audioStarting || Boolean(localAITask);
}
function updateAudioProgress() {
  if (!audioTask) return;
  const { audio } = audioTask;
  const pct = Number.isFinite(audio.duration) && audio.duration > 0 ? Math.min(100, Math.max(0, Math.round(100 * audio.currentTime / audio.duration))) : 0;
  $('audioProgress').value = pct;
  $('audioProgressLabel').textContent = Number.isFinite(audio.duration) ? `${humanDuration(audio.currentTime)} / ${humanDuration(audio.duration)}` : 'Playing…';
}
function appendRecognizedWords(text) {
  ui.text.value = appendTranscript(ui.text.value, text);
  scheduleSave();
  ui.text.scrollTop = ui.text.scrollHeight;
}
function releaseAudio(task, status, isError = false) {
  if (audioTask !== task) return;
  audioTask = null;
  task.active = false;
  clearTimeout(task.restartHandle);
  clearTimeout(task.finalizeHandle);
  clearInterval(task.progressHandle);
  task.audio.pause();
  task.audio.removeAttribute('src');
  task.audio.load();
  task.engine && (task.engine.onstart = task.engine.onresult = task.engine.onerror = task.engine.onend = null);
  try { task.engine?.abort(); } catch {}
  try { task.track?.stop(); } catch {}
  task.context?.close().catch(() => {});
  URL.revokeObjectURL(task.url);
  $('audioProgressLabel').textContent = status;
  audioMessage(status, isError);
  updateButtonState();
  updateFileControls();
  updateLocalAIControls();
}
function stopAudioTranscription() {
  if (!audioTask) return;
  releaseAudio(audioTask, 'Transcription stopped. Partial text has been kept in the editor.');
}
function audioRecognitionError(event, task) {
  if (audioTask !== task) return;
  const reason = event.error || 'unknown';
  if (reason === 'no-speech') return;
  const errorText = {
    'not-allowed': 'Browser permission denied. Check speech settings and privacy mode.',
    'service-not-allowed': 'The browser denied speech processing for this audio file.',
    'language-not-supported': 'This language is not supported by the selected speech engine.',
    'network': 'The browser speech provider could not be reached. Try strict local mode if installed.',
    'audio-capture': 'The browser cannot read the audio track from this file.',
    'aborted': 'Audio recognition was interrupted.',
  }[reason] || `Speech recognition error: ${reason}`;
  if (reason === 'aborted' && task.finalizing) return;
  releaseAudio(task, errorText + ' Any recognized text is preserved.', true);
}
function runFileRecognizer(task) {
  if (audioTask !== task || task.finalizing) return;
  const engine = new Recognizer();
  task.engine = engine;
  engine.lang = ui.language.value;
  engine.continuous = true;
  engine.interimResults = true;
  engine.maxAlternatives = 1;
  if (ui.mode.value === 'local') engine.processLocally = true;
  engine.onstart = () => {
    if (audioTask !== task) { try { engine.abort(); } catch {} return; }
    audioMessage('Transcribing selected audio track. The microphone is not used. Playback is silent; progress follows the file.');
  };
  engine.onresult = event => {
    if (audioTask !== task) return;
    const finalText = [];
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const item = event.results[i];
      if (item?.isFinal) finalText.push((item[0]?.transcript || '').trim());
    }
    if (finalText.length) appendRecognizedWords(finalText.filter(Boolean).join(' '));
  };
  engine.onerror = event => audioRecognitionError(event, task);
  engine.onend = () => {
    if (audioTask !== task) return;
    if (task.finalizing) { releaseAudio(task, 'Audio finished. Review the transcript, then export to PDF/TXT/MD.'); return; }
    if (++task.restarts > 20) {
      releaseAudio(task, 'The speech engine stopped repeatedly before the file ended. Partial text is preserved.', true);
      return;
    }
    task.restartHandle = setTimeout(() => runFileRecognizer(task), 400);
  };
  try {
    // IMPORTANT: Never call engine.start() without the file track here.
    engine.start(task.track);
  } catch (error) {
    releaseAudio(task, `This browser could not recognize the audio-file track: ${error.message}. No microphone fallback was attempted.`, true);
  }
}
async function beginAudioTranscription() {
  if (!selectedAudio || audioTask || audioStarting || tabTask || tabStarting || !fileRecognitionSupported || wantsRecording || startInProgress) return;
  if (ui.mode.value === 'browser' && !$('audioServiceConsent').checked) return;
  const token = ++audioToken;
  audioStarting = true;
  updateFileControls(); updateButtonState();
  audioMessage('Preparing audio-file recognition…');
  try {
    await ensureLocalAvailable();
    if (token !== audioToken) return;
    const url = URL.createObjectURL(selectedAudio);
    const audio = new Audio();
    audio.preload = 'auto';
    audio.src = url;
    let context;
    try {
      context = new AudioContextClass();
      const source = context.createMediaElementSource(audio);
      const destination = context.createMediaStreamDestination();
      source.connect(destination); // No speakers, mic or remote PhiScribe server involved.
      const track = destination.stream.getAudioTracks()[0];
      if (!track || track.kind !== 'audio' || track.readyState !== 'live') throw new Error('No live audio track was created.');
      const task = { url, audio, context, track, active: true, finalizing: false, restarts: 0, engine: null,
        restartHandle: null, finalizeHandle: null, progressHandle: null };
      audioTask = task;
      audio.onended = () => {
        if (audioTask !== task) return;
        task.finalizing = true;
        clearTimeout(task.restartHandle);
        $('audioProgress').value = 100;
        audioMessage('End of recording. Finishing the last recognized words…');
        try { task.engine?.stop(); } catch {}
        task.finalizeHandle = setTimeout(() => releaseAudio(task, 'Audio finished. Review your text before export.'), 3000);
        if (!task.engine) releaseAudio(task, 'Audio finished. Review your text before export.');
      };
      audio.onerror = () => releaseAudio(task, 'The browser could not play or decode this audio file. Try an MP3 or WAV instead.', true);
      task.progressHandle = setInterval(updateAudioProgress, 250);
      await context.resume();
      if (audioTask !== task) return;
      runFileRecognizer(task);
      if (audioTask !== task) return;
      try { await audio.play(); }
      catch (error) { releaseAudio(task, `The browser blocked audio playback: ${error.message}. Try clicking Transcribe again.`, true); }
      updateFileControls();
    } catch (error) {
      if (audioTask) releaseAudio(audioTask, `Audio processing could not start: ${error.message}`, true);
      else { audio.pause(); audio.removeAttribute('src'); audio.load(); context?.close().catch(() => {}); URL.revokeObjectURL(url); throw error; }
    }
  } catch (error) {
    audioMessage(error.message || 'Unable to transcribe this audio file.', true);
  } finally {
    audioStarting = false;
    updateFileControls(); updateButtonState();
  }
}
function chooseAudio(file) {
  if (audioTask || audioStarting || localAITask || !file) return;
  try { validateAudioFile(file); }
  catch (error) { audioMessage(error.message, true); return; }
  selectedAudio = file;
  $('audioFileInfo').textContent = `${file.name} · ${(file.size / 1024 / 1024).toFixed(1)} MB`;
  $('audioProgress').value = 0;
  $('audioProgressLabel').textContent = '0%';
  $('audioServiceConsent').checked = false;
  if (!fileRecognitionSupported) audioMessage('Audio-track transcription requires desktop Chrome or Edge 135+ with Web Speech support. Your file stays on this device. Try a supported browser.', true);
  else audioMessage(ui.mode.value === 'local' ? 'Ready to transcribe locally, if the browser has an on-device language pack.' : 'Confirm browser-service audio processing above, then transcribe. The browser provider may receive audio.');
  updateFileControls();
  updateLocalAIControls();
}
async function pasteAudioFromClipboard() {
  if (audioTask || audioStarting || localAITask) { audioMessage('Stop the current transcription before importing another clip.', true); return; }
  if (!window.isSecureContext || !navigator.clipboard?.read) {
    audioMessage('Clipboard-file import needs a secure browser with clipboard.read support. Use Choose audio clip instead.', true); return;
  }
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const mime = item.types.find(type => clipboardAudioExtension(type));
      if (!mime) continue;
      const ext = clipboardAudioExtension(mime);
      const blob = await item.getType(mime);
      const file = new File([blob], `clipboard-voice-message.${ext}`, {type: mime});
      chooseAudio(file);
      return;
    }
    audioMessage('Clipboard contains no audio file. Copy/download the actual voice clip first; a Messenger link or player is not an audio file.', true);
  } catch (error) {
    audioMessage(`Clipboard audio unavailable (${error.name || 'blocked'}). Choose or drag the saved recording instead.`, true);
  }
}
function handleAudioPaste(event) {
  const files = Array.from(event.clipboardData?.files || []);
  const audio = files.find(file => {
    try { validateAudioFile(file); return true; } catch { return false; }
  });
  if (!audio) return; // Never intercept normal text pasting into the editor.
  event.preventDefault();
  chooseAudio(audio);
}
function handoffData() {
  return { title: ui.title.value, note: ui.note.value, text: ui.text.value,
    source: $('handoffSource').value, goal: $('handoffGoal').value };
}
function updateHandoffPreview() {
  if (!$('handoffPreviewWrap').open) return;
  try { $('handoffPreview').textContent = makeAIHandoff(handoffData()); }
  catch { $('handoffPreview').textContent = 'Transcribe or type a message first.'; }
}
async function copyHandoff() {
  try {
    const prepared = makeAIHandoff(handoffData());
    await navigator.clipboard.writeText(prepared);
    $('handoffNotice').textContent = 'Copied! Open ChatGPT and paste. Nothing was automatically sent.';
    $('handoffNotice').classList.remove('error');
  } catch (error) {
    $('handoffNotice').textContent = error?.name === 'NotAllowedError' ?
      'Clipboard permission denied. Expand Preview, select the text and copy manually.' :
      (error?.message || 'Copy failed. Expand Preview and copy the text manually.');
    $('handoffNotice').classList.add('error');
    $('handoffPreviewWrap').open = true;
    updateHandoffPreview();
  }
}
function tabMessage(text, isError = false) {
  $('tabListenStatus').textContent = text;
  $('tabListenStatus').classList.toggle('error', isError);
}
function updateTabConsent() {
  $('tabConsentWrap').hidden = ui.mode.value !== 'browser';
  $('tabServiceConsent').checked = false;
  updateTabControls();
}
function updateTabControls() {
  $('startTabButton').disabled = !tabListenSupported || Boolean(tabTask) || tabStarting ||
    wantsRecording || startInProgress || Boolean(audioTask) || audioStarting || Boolean(localAITask) ||
    (ui.mode.value === 'browser' && !$('tabServiceConsent').checked);
  $('stopTabButton').disabled = !tabTask;
  $('startTabButton').textContent = tabStarting ? 'Opening tab picker…' : '◉ Start tab listen';
}
function releaseTab(task, reason, isError = false) {
  if (tabTask !== task) return;
  tabTask = null;
  clearTimeout(task.restartHandle);
  if (task.engine) {
    task.engine.onstart = task.engine.onresult = task.engine.onerror = task.engine.onend = null;
    try { task.engine.abort(); } catch {}
  }
  for (const track of task.stream.getTracks()) {
    track.onended = null;
    try { track.stop(); } catch {}
  }
  $('tabInterim').textContent = 'Sharing ended. Your text stays in the editor.';
  $('tabInterim').classList.remove('active');
  tabMessage(reason, isError);
  updateButtonState();
}
function stopTabListen() {
  if (tabTask) releaseTab(tabTask, 'Tab listening stopped. Partial transcript preserved.');
}
function startTabRecognizer(task) {
  if (tabTask !== task || task.audio.readyState !== 'live') return;
  const engine = new Recognizer();
  task.engine = engine;
  engine.lang = task.language;
  engine.continuous = true;
  engine.interimResults = true;
  engine.maxAlternatives = 1;
  if (task.local) engine.processLocally = true;
  engine.onstart = () => {
    if (tabTask !== task) { try { engine.abort(); } catch {} return; }
    tabMessage(task.local ? 'Listening to shared tab audio on-device. Play the voice note in the shared tab.' :
      'Listening to shared tab audio. Your browser speech provider may receive this audio.');
  };
  engine.onresult = event => {
    if (tabTask !== task) return;
    let interim = '';
    const finals = [];
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const item = event.results[i];
      if (item?.isFinal) finals.push((item[0]?.transcript || '').trim());
      else interim += item?.[0]?.transcript || '';
    }
    if (finals.filter(Boolean).length) {
      appendRecognizedWords(finals.filter(Boolean).join(' '));
      task.restarts = 0;
    }
    $('tabInterim').textContent = interim || 'Listening for the next words…';
    $('tabInterim').classList.toggle('active', Boolean(interim));
  };
  engine.onerror = event => {
    if (tabTask !== task) return;
    if (event.error === 'no-speech') return;
    const errors = {
      'not-allowed': 'Tab audio recognition permission denied.',
      'service-not-allowed': 'The browser speech service refused the shared audio.',
      'network': 'The speech provider could not be reached.',
      'language-not-supported': 'The selected language is not available.',
      'audio-capture': 'The browser could not use the shared tab audio track.',
    };
    releaseTab(task, (errors[event.error] || `Speech error: ${event.error || 'unknown'}`) + ' Partial transcript preserved.', true);
  };
  engine.onend = () => {
    if (tabTask !== task) return;
    if (task.audio.readyState !== 'live' || ++task.restarts > 30) {
      releaseTab(task, 'Tab audio recognition ended repeatedly or sharing stopped. Partial transcript preserved.', true);
      return;
    }
    task.restartHandle = setTimeout(() => startTabRecognizer(task), 500);
  };
  try {
    // Never omit the track; calling start() alone might activate the microphone.
    engine.start(task.audio);
  } catch (error) {
    releaseTab(task, `Tab-track recognition failed (${error.message}). No microphone fallback attempted.`, true);
  }
}
async function beginTabListen() {
  if (!tabListenSupported || tabStarting || tabTask || wantsRecording || startInProgress || audioTask || audioStarting || localAITask ||
      (ui.mode.value === 'browser' && !$('tabServiceConsent').checked)) return;
  const token = ++tabToken;
  tabStarting = true;
  updateButtonState();
  tabMessage('Choose the Messenger tab and enable Share tab audio…');
  let stream;
  try {
    // The picker MUST be invoked immediately inside the button gesture.
    stream = await navigator.mediaDevices.getDisplayMedia(tabShareOptions());
    if (token !== tabToken) return;
    const { video, audio } = validateTabStream(stream);
    // Permission is already granted; check/install local language before recognizing.
    await ensureLocalAvailable();
    if (token !== tabToken || audio.readyState !== 'live' || video.readyState !== 'live') {
      throw new Error('The selected tab stopped sharing before recognition started.');
    }
    const task = { stream, video, audio, engine: null, restartHandle: null,
      language: ui.language.value, local: ui.mode.value === 'local', restarts: 0 };
    tabTask = task;
    audio.onended = () => releaseTab(task, 'The browser stopped sharing tab audio. Partial transcript preserved.');
    video.onended = () => releaseTab(task, 'Tab sharing was ended in the browser. Partial transcript preserved.');
    startTabRecognizer(task);
  } catch (error) {
    tabMessage(describeTabCaptureError(error), true);
  } finally {
    // If activation/validation fails, immediately stop every granted track.
    if (!tabTask && stream) {
      for (const track of stream.getTracks()) { try { track.stop(); } catch {} }
    }
    tabStarting = false;
    updateButtonState();
  }
}
function settleRecordingSegment() {
  if (activeSince !== null) {
    documentState.elapsedMs += Date.now() - activeSince;
    activeSince = null;
  }
  activeRecognition = false;
  drawTimer(); scheduleSave();
}
function updateButtonState() {
  ui.start.disabled = wantsRecording || startInProgress || !Recognizer || Boolean(audioTask) || audioStarting || Boolean(tabTask) || tabStarting || Boolean(localAITask);
  ui.stop.disabled = !wantsRecording && !startInProgress;
  ui.start.innerHTML = documentState.elapsedMs > 0 ? '<span aria-hidden="true">●</span> Resume speaking' : '<span aria-hidden="true">●</span> Start speaking';
  ui.language.disabled = wantsRecording || startInProgress || Boolean(audioTask) || audioStarting || Boolean(tabTask) || tabStarting || Boolean(localAITask);
  ui.mode.disabled = wantsRecording || startInProgress || Boolean(audioTask) || audioStarting || Boolean(tabTask) || tabStarting || Boolean(localAITask);
  updateFileControls();
  updateTabControls();
  updateLocalAIControls();
}
function stopRecognition() {
  wantsRecording = false;
  generation++;
  clearTimeout(restartHandle);
  try { recognition?.stop(); } catch { /* No active recognizer. */ }
  settleRecordingSegment();
  ui.interim.textContent = 'Paused. Start again to continue this document.';
  ui.interim.classList.remove('active');
  setStatus('Paused');
  updateButtonState();
}
async function ensureLocalAvailable() {
  if (ui.mode.value !== 'local') return;
  const probe = new Recognizer();
  if (!('processLocally' in probe)) {
    throw new Error('This browser cannot guarantee on-device recognition. Use a recent desktop Chrome/Edge with a local language pack, or explicitly select browser service mode.');
  }
  if (typeof Recognizer.available === 'function') {
    const options = { langs: [ui.language.value], processLocally: true };
    const availability = await Recognizer.available(options);
    if (availability === 'unavailable') throw new Error('On-device speech recognition is unavailable for this language/browser. No cloud fallback was used.');
    if (availability === 'downloadable') {
      if (typeof Recognizer.install !== 'function') throw new Error('This browser cannot install the required offline language pack.');
      message('Installing the browser language pack. This may require an internet connection once; the transcript itself stays local.');
      const installed = await Recognizer.install(options);
      if (!installed) throw new Error('The browser could not install the local language pack.');
    }
    if (availability === 'downloading') throw new Error('The local language pack is still downloading. Try again when installation finishes.');
  }
}
function handleRecognitionError(event, token) {
  if (token !== generation) return;
  const errorCode = event.error || 'unknown';
  const detail = {
    'not-allowed': 'Microphone access was blocked. Allow mic access in browser site settings.',
    'service-not-allowed': 'Speech recognition was blocked by the browser or system.',
    'audio-capture': 'No working microphone was found. Check your audio input device.',
    'language-not-supported': 'That language is not available in the chosen recognition mode.',
    'network': 'The browser speech service reported a network error.',
    'no-speech': 'No speech detected. Listening will retry if supported.',
    'aborted': 'Speech recognition was interrupted.',
  }[errorCode] || `Speech recognition error: ${errorCode}`;
  const fatal = !['no-speech', 'aborted'].includes(errorCode);
  message(detail, fatal);
  if (fatal) {
    wantsRecording = false;
    clearTimeout(restartHandle);
    setStatus('Unavailable', 'error');
    updateButtonState();
  }
}
function beginRecognition(token) {
  if (token !== generation || !wantsRecording) return;
  const engine = new Recognizer();
  recognition = engine;
  engine.lang = ui.language.value;
  engine.continuous = true;
  engine.interimResults = true;
  engine.maxAlternatives = 1;
  if (ui.mode.value === 'local') engine.processLocally = true;
  engine.onstart = () => {
    if (token !== generation) { try { engine.stop(); } catch {} return; }
    activeRecognition = true;
    if (activeSince === null) activeSince = Date.now();
    setStatus('Recording', 'live');
    message(ui.mode.value === 'local' ? 'On-device mode requested. Speech processing is restricted to the browser’s local recognizer.' :
      'Browser service mode is active. Your browser may process audio remotely.');
    updateButtonState();
  };
  engine.onresult = event => {
    if (token !== generation || !wantsRecording) return;
    let liveText = '';
    const finalized = [];
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const item = event.results[i];
      const resultText = item?.[0]?.transcript || '';
      if (item.isFinal) finalized.push(resultText.trim());
      else liveText += resultText;
    }
    if (finalized.length) {
      const addition = finalized.filter(Boolean).join(' ');
      if (addition) appendRecognizedWords(addition);
    }
    ui.interim.textContent = liveText || 'Listening for your next sentence…';
    ui.interim.classList.toggle('active', Boolean(liveText));
  };
  engine.onerror = event => handleRecognitionError(event, token);
  engine.onend = () => {
    if (token !== generation) return;
    settleRecordingSegment();
    if (wantsRecording) {
      setStatus('Reconnecting', 'busy');
      restartHandle = setTimeout(() => beginRecognition(token), 650);
    } else if (ui.status.dataset.state !== 'error') {
      setStatus('Paused');
    }
    updateButtonState();
  };
  try { engine.start(); }
  catch (error) {
    wantsRecording = false;
    settleRecordingSegment();
    setStatus('Unavailable', 'error');
    message(`Could not start recognition: ${error.message}`, true);
    updateButtonState();
  }
}
async function startRecording() {
  if (!Recognizer || wantsRecording || startInProgress || audioTask || audioStarting || tabTask || tabStarting || localAITask) return;
  const token = ++generation;
  startInProgress = true;
  setStatus('Preparing', 'busy');
  updateButtonState();
  try {
    await ensureLocalAvailable();
    if (token !== generation) return;
    wantsRecording = true;
    beginRecognition(token);
  } catch (error) {
    if (token !== generation) return;
    setStatus('Unavailable', 'error');
    message(error.message || 'Could not start speech recognition.', true);
  } finally {
    startInProgress = false;
    updateButtonState();
  }
}
function localAIMessage(text, error = false) {
  const note = $('localAINotice');
  // Replace only the status text, never interpolate model output as HTML.
  note.textContent = text;
  note.classList.toggle('error', error);
}
function updateLocalAIControls() {
  const busy = Boolean(localAITask) || localAIConnecting;
  const other = Boolean(audioTask) || audioStarting || Boolean(tabTask) || tabStarting || wantsRecording || startInProgress;
  $('connectLocalAIButton').disabled = busy;
  $('transcribeLocalAIButton').disabled = !selectedAudio || !localAI?.ready || busy || other;
  $('stopLocalAIButton').disabled = !localAITask;
}
async function checkLocalAI() {
  if (localAITask || localAIConnecting) return;
  localAIConnecting = true;
  updateLocalAIControls();
  localAIMessage('Checking local engine on 127.0.0.1…');
  try {
    localAI = await localAIStatus();
    if (!localAI.ready) {
      localAIMessage('Local companion detected, but a speech model or executable is missing. Check the Local Companion setup instructions.', true);
    } else {
      localAIMessage(`Local AI ready (${localAI.model || 'model configured'}). Select a file and click Transcribe locally.`);
    }
  } catch {
    localAI = null;
    localAIMessage('Local companion unavailable. Start local/start-windows.ps1 on your PC, or open http://127.0.0.1:8765/ and use PhiScribe there. Browser security may block GitHub Pages connecting to localhost.', true);
  } finally {
    localAIConnecting = false;
    updateLocalAIControls();
  }
}
async function beginLocalAI() {
  if (!selectedAudio || !localAI?.ready || localAITask || audioTask || audioStarting || tabTask || tabStarting || wantsRecording || startInProgress) return;
  const task = { controller: new AbortController(), token: localAI.token };
  localAITask = task;
  updateButtonState();
  localAIMessage('Transcribing privately on this computer. Larger models and longer recordings may take time…');
  try {
    const text = await transcribeLocally(selectedAudio, ui.language.value, task.token, task.controller.signal);
    if (localAITask !== task) return;
    if (text.trim()) appendRecognizedWords(text);
    localAIMessage(text.trim() ? 'Local transcription complete. Review the transcript and export or copy for ChatGPT.' : 'Processing finished, but the model returned no speech.');
  } catch (error) {
    if (localAITask !== task) return;
    if (task.controller.signal.aborted) localAIMessage('Local transcription cancelled. Your existing editor text is safe.');
    else localAIMessage(error?.message || 'Local engine failed. Check the companion console.', true);
  } finally {
    if (localAITask === task) localAITask = null;
    updateButtonState();
  }
}
function stopLocalAI() {
  if (!localAITask) return;
  const task = localAITask;
  task.controller.abort();
  // Separate authenticated cancel request ensures the process is stopped even if the upload is complete.
  cancelLocalJob(task.token).catch(() => {});
  localAIMessage('Cancellation requested. Existing transcript text remains untouched.');
  localAITask = null;
  updateButtonState();
}
function downloadFile(contents, filename, mime) {
  const blob = new Blob([contents], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = filename;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
function exportFile(kind) {
  saveNow();
  const filename = safeFilename(documentState.title);
  if (kind === 'txt') downloadFile(documentState.text, `${filename}.txt`, 'text/plain');
  if (kind === 'md') downloadFile(makeMarkdown(documentState), `${filename}.md`, 'text/markdown');
  if (kind === 'json') downloadFile(JSON.stringify({ format: BACKUP_FORMAT, exportedAt: new Date().toISOString(), document: documentState }, null, 2), `${filename}.phiscribe.json`, 'application/json');
}
function preparePrint() {
  saveNow();
  $('printTitle').textContent = documentState.title || 'Untitled transcript';
  $('printSubtitle').textContent = documentState.note || '';
  $('printDate').textContent = `Created ${new Date(documentState.createdAt).toLocaleString()}`;
  $('printTranscript').textContent = documentState.text || '(No transcript text yet)';
}
async function importFile(file) {
  if (!file) return;
  if (file.size > 2_000_000) throw new Error('Please choose a text or backup file smaller than 2 MB.');
  const raw = await file.text();
  let replacement;
  if (file.name.toLowerCase().endsWith('.json')) {
    replacement = restoreBackup(raw);
  } else {
    replacement = { ...newDocument(), title: file.name.replace(/\.(txt|md)$/i, '').slice(0, 140), text: raw };
  }
  if (documentState.text.trim() && !window.confirm('Replace the current document? Export a backup first if you need it.')) return;
  stopRecognition(); stopAudioTranscription(); stopTabListen(); stopLocalAI();
  documentState = replacement;
  populate(); saveNow();
  message('Imported successfully. Your previous draft was replaced.');
}
function wire() {
  [ui.title, ui.note, ui.text].forEach(el => el.addEventListener('input', scheduleSave));
  ui.language.addEventListener('change', scheduleSave);
  ui.mode.addEventListener('change', () => { updatePrivacyHint(); updateAudioConsent(); scheduleSave(); });
  ui.start.addEventListener('click', startRecording);
  ui.stop.addEventListener('click', stopRecognition);
  $('chooseAudioButton').addEventListener('click', () => $('audioInput').click());
  $('pasteAudioButton').addEventListener('click', pasteAudioFromClipboard);
  document.addEventListener('paste', handleAudioPaste);
  $('audioInput').addEventListener('change', event => { chooseAudio(event.target.files?.[0]); event.target.value = ''; });
  $('audioServiceConsent').addEventListener('change', updateFileControls);
  $('tabServiceConsent').addEventListener('change', updateTabControls);
  $('startTabButton').addEventListener('click', beginTabListen);
  $('stopTabButton').addEventListener('click', stopTabListen);
  $('transcribeAudioButton').addEventListener('click', beginAudioTranscription);
  $('stopAudioButton').addEventListener('click', stopAudioTranscription);
  $('connectLocalAIButton').addEventListener('click', checkLocalAI);
  $('transcribeLocalAIButton').addEventListener('click', beginLocalAI);
  $('stopLocalAIButton').addEventListener('click', stopLocalAI);
  const dropArea = $('audioDrop');
  dropArea.addEventListener('dragover', event => { event.preventDefault(); if (!audioTask) dropArea.classList.add('drag-active'); });
  dropArea.addEventListener('dragleave', () => dropArea.classList.remove('drag-active'));
  dropArea.addEventListener('drop', event => { event.preventDefault(); dropArea.classList.remove('drag-active'); chooseAudio(event.dataTransfer?.files?.[0]); });
  $('handoffSource').addEventListener('input', () => { scheduleSave(); updateHandoffPreview(); });
  $('handoffGoal').addEventListener('change', () => { scheduleSave(); updateHandoffPreview(); });
  $('handoffPreviewWrap').addEventListener('toggle', updateHandoffPreview);
  [ui.title, ui.note, ui.text].forEach(el => el.addEventListener('input', updateHandoffPreview));
  $('copyHandoffButton').addEventListener('click', copyHandoff);
  $('txtButton').addEventListener('click', () => exportFile('txt'));
  $('mdButton').addEventListener('click', () => exportFile('md'));
  $('backupButton').addEventListener('click', () => exportFile('json'));
  $('pdfButton').addEventListener('click', () => { preparePrint(); window.print(); });
  window.addEventListener('beforeprint', preparePrint);
  $('copyButton').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(ui.text.value); message('Transcript copied to the clipboard.'); }
    catch { message('Clipboard unavailable. Select the text and copy it manually.', true); }
  });
  $('importButton').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', async event => {
    try { await importFile(event.target.files?.[0]); }
    catch (error) { message(error.message, true); }
    finally { event.target.value = ''; }
  });
  $('clearButton').addEventListener('click', () => {
    if (!window.confirm('Clear this document and its local autosave? This cannot be undone.')) return;
    stopRecognition(); stopAudioTranscription(); stopTabListen(); stopLocalAI(); documentState = newDocument(); populate(); saveNow();
    message('New empty document ready.');
  });
  window.addEventListener('pagehide', () => { if (wantsRecording) stopRecognition(); stopAudioTranscription(); stopTabListen(); stopLocalAI(); saveNow(); });
  tickHandle = setInterval(drawTimer, 250);
}
loadSaved(); wire(); updateAudioConsent();
if (!Recognizer) {
  message('Speech recognition is not supported in this browser. You can still type, edit, import and export. Try a current desktop Chrome or Edge for voice input.', true);
  setStatus('Not supported', 'error');
} else {
  message('Choose strict on-device recognition or knowingly allow your browser speech service. Your editable transcript is saved only in this browser.');
}
updateButtonState();
updateLocalAIControls();
if (!fileRecognitionSupported) audioMessage('Uploaded-file transcription needs desktop Chrome/Edge 135+ and speech recognition. Editing and export still work here.', true);
if (!tabListenSupported) tabMessage('Tab Listen requires HTTPS and desktop Chrome/Edge 135+ with tab sharing and speech recognition. You can still import audio files.', true);
if ('serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
