import { supportsAudioTrackRecognition } from './audio-import.mjs';

/** Browser-only, explicit tab sharing. Never falls back to recording the microphone. */
export function canListenToTab(userAgent, hasRecognizer, hasDisplayMedia, secureContext) {
  return Boolean(secureContext && hasDisplayMedia &&
    supportsAudioTrackRecognition(userAgent, hasRecognizer, true));
}
export function tabShareOptions() {
  // Video is required for the picker, but PhiScribe never processes its frames.
  return {
    video: { displaySurface: 'browser' },
    audio: { suppressLocalAudioPlayback: false },
    preferCurrentTab: false,
    selfBrowserSurface: 'exclude',
    surfaceSwitching: 'exclude',
    systemAudio: 'exclude',
  };
}
export function validateTabStream(stream) {
  const video = stream?.getVideoTracks?.()?.[0];
  const audio = stream?.getAudioTracks?.()?.[0];
  if (!video || video.kind !== 'video' || video.readyState !== 'live' ||
      video.getSettings?.().displaySurface !== 'browser') {
    throw new Error('Choose a browser TAB, not a screen or application window. No audio was transcribed.');
  }
  if (!audio || audio.kind !== 'audio' || audio.readyState !== 'live') {
    throw new Error('The selected tab has no shared audio track. Choose the Messenger tab and enable “Share tab audio” in the browser picker.');
  }
  return { video, audio };
}
export function describeTabCaptureError(error) {
  if (error?.name === 'NotAllowedError' || error?.name === 'AbortError') {
    return 'Tab sharing was cancelled or blocked. Nothing was captured.';
  }
  if (error?.name === 'InvalidStateError') {
    return 'The tab picker must be opened by clicking Start tab listen in a focused browser window.';
  }
  if (error?.name === 'NotReadableError') {
    return 'Your browser could not read that tab. Close other sharing sessions and try again.';
  }
  return error?.message || 'Could not start tab audio capture.';
}
