import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_AUDIO_BYTES, validateAudioFile, supportsAudioTrackRecognition, humanDuration, appendTranscript } from '../src/audio-import.mjs';

test('accepts common audio formats and rejects invalid file types and excessive size', () => {
  assert.equal(validateAudioFile({ name:'recording.MP3', size:120 }).size, 120);
  assert.equal(validateAudioFile({ name:'note.m4a', size:64 }).size, 64);
  assert.throws(() => validateAudioFile({ name:'run.exe', size:32 }), /audio clip/);
  assert.throws(() => validateAudioFile({ name:'empty.wav', size:0 }), /empty/);
  assert.throws(() => validateAudioFile({ name:'gigantic.wav', size:MAX_AUDIO_BYTES+1 }), /250 MB/);
});

test('file recognition is limited to verified desktop Chromium versions and must have WebAudio + speech engine', () => {
  const chrome = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36';
  const oldChrome = chrome.replace('154.0', '134.0');
  assert.equal(supportsAudioTrackRecognition(chrome, true, true), true);
  assert.equal(supportsAudioTrackRecognition(oldChrome, true, true), false);
  assert.equal(supportsAudioTrackRecognition(chrome, true, false), false);
  assert.equal(supportsAudioTrackRecognition(chrome, false, true), false);
  assert.equal(supportsAudioTrackRecognition(chrome + ' Firefox/154.0', true, true), false);
  assert.equal(supportsAudioTrackRecognition(chrome + ' Mobile', true, true), false);
});

test('formats audio length without rounding up and handles invalid duration', () => {
  assert.equal(humanDuration(69.7), '1:09');
  assert.equal(humanDuration(3661), '1:01:01');
  assert.equal(humanDuration(NaN), 'Unknown duration');
});

test('appends file transcripts without joining words together or losing existing edits', () => {
  assert.equal(appendTranscript('Hi.', ' there'), 'Hi. there');
  assert.equal(appendTranscript('Hi.\n', 'there'), 'Hi.\nthere');
  assert.equal(appendTranscript('Hi.', ' '), 'Hi.');
});
