/** Local PhiScribe transcription companion client. Sends audio only to loopback. */
export const LOCAL_AI_BASE = 'http://127.0.0.1:8765';
export async function localAIStatus(fetcher = fetch) {
  const response = await fetcher(LOCAL_AI_BASE + '/api/local/status', {cache:'no-store', signal:AbortSignal.timeout(3500)});
  if (!response.ok) throw new Error('Local companion did not respond.');
  const status = await response.json();
  if (!status || typeof status.token !== 'string' || !/^[0-9a-f]{64}$/.test(status.token)) throw new Error('Invalid companion response.');
  return status;
}
export async function transcribeLocally(file, language, token, signal, fetcher = fetch) {
  if (!file || typeof file.name !== 'string') throw new Error('Select an audio file first.');
  if (!/^[0-9a-f]{64}$/.test(String(token))) throw new Error('Connect to the local companion first.');
  const lang = String(language || 'en').split('-')[0].toLowerCase();
  const response = await fetcher(LOCAL_AI_BASE+'/api/local/transcribe?lang='+encodeURIComponent(lang), {
    method:'POST', headers:{'Content-Type':'application/octet-stream','X-PhiScribe-Token':token,
      'X-PhiScribe-Filename':'recording.'+file.name.split('.').at(-1).toLowerCase()},
    body:file, signal, cache:'no-store'
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Local transcription failed ('+response.status+').');
  if (typeof result.text !== 'string') throw new Error('Invalid local transcript response.');
  return result.text;
}
export async function cancelLocalJob(token, fetcher = fetch) {
  if (!/^[0-9a-f]{64}$/.test(String(token))) return;
  await fetcher(LOCAL_AI_BASE+'/api/local/cancel', {method:'POST',headers:{'X-PhiScribe-Token':token}});
}
