import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canListenToTab, tabShareOptions, validateTabStream, describeTabCaptureError } from '../src/tab-listen.mjs';
const chrome = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/154.0.0.0 Safari/537.36';
function stream(surface='browser', audio=true) {
  const videoTrack = {kind:'video',readyState:'live', getSettings:()=>({displaySurface:surface})};
  return { getVideoTracks:()=>[videoTrack],
    getAudioTracks:()=>audio ? [{kind:'audio',readyState:'live'}] : [] };
}
test('only supported secure desktop Chromium can offer tab listening', () => {
  assert.equal(canListenToTab(chrome,true,true,true),true);
  assert.equal(canListenToTab(chrome,true,true,false),false);
  assert.equal(canListenToTab(chrome,false,true,true),false);
  assert.equal(canListenToTab(chrome,true,false,true),false);
  assert.equal(canListenToTab(chrome.replace('154.0.0.0','134.0.0.0'),true,true,true),false);
  assert.equal(canListenToTab('Mozilla/5.0 Android Chrome/154.0.0.0 Mobile',true,true,true),false);
});
test('picker explicitly requests tab audio but never microphone or whole-system audio', () => {
  const opts=tabShareOptions();
  assert.equal(opts.video.displaySurface,'browser');
  assert.ok(opts.audio);
  assert.equal(opts.systemAudio,'exclude');
  assert.equal(opts.selfBrowserSurface,'exclude');
  assert.notEqual(opts.video,false);
  assert.equal('getUserMedia' in opts,false);
});
test('strictly checks shared browser TAB has a live audio track', () => {
  assert.equal(validateTabStream(stream()).audio.kind,'audio');
  for (const surface of ['monitor','window',null]) assert.throws(()=>validateTabStream(stream(surface)),/browser TAB/);
  assert.throws(()=>validateTabStream(stream('browser',false)),/Share tab audio/);
  const stopped=stream(); stopped.getAudioTracks=()=>[{kind:'audio',readyState:'ended'}];
  assert.throws(()=>validateTabStream(stopped),/Share tab audio/);
  assert.throws(()=>validateTabStream(null),/browser TAB/);
});
test('permission failures and missing tracks are visible to user',()=>{
  assert.match(describeTabCaptureError({name:'NotAllowedError'}),/cancelled or blocked/);
  assert.match(describeTabCaptureError({name:'InvalidStateError'}),/clicking Start tab listen/);
  assert.match(describeTabCaptureError(new Error('test failure')),/test failure/);
});
