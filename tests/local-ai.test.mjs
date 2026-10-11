import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, chmod, rm } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createPhiScribeServer } from '../local/server.mjs';
import { validateFilename, validateLanguage, transcribeFile, configured } from '../local/engine.mjs';
import { localAIStatus, transcribeLocally, cancelLocalJob } from '../src/local-ai.mjs';

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'phi-local-tests-'));
  const model = join(dir, 'ggml-base.en.bin');
  await writeFile(model, Buffer.alloc(1025));
  const config = { model, whisper:'whisper-cli', ffmpeg:'ffmpeg' };
  const server = createPhiScribeServer({ port:0, config, processAudio:async (path, _config, {language, signal}) => {
    assert.equal(signal.aborted, false);
    return 'Recognized '+language+' from '+await readFile(path,'utf8');
  }});
  server.listen(0, '127.0.0.1');
  await once(server,'listening');
  const url = 'http://127.0.0.1:'+server.address().port;
  return {dir, model, config, server, url, close:async () => { await new Promise(r=>server.close(r)); await rm(dir,{recursive:true,force:true}); }};
}
test('local language and extension guards are strict', () => {
  assert.equal(validateLanguage('en-US'), 'en');
  assert.equal(validateLanguage('auto'), 'auto');
  assert.equal(validateFilename('message.M4A'), 'm4a');
  assert.throws(()=>validateFilename('malware.exe'),/Unsupported/);
  assert.throws(()=>validateFilename('bad\n.wav'),/Invalid/);
  assert.throws(()=>validateLanguage('xx'),/Unsupported/);
});
test('companion status, token, transcription and static allowlist', async () => {
  const s=await setup();
  try {
    const status=await (await fetch(s.url+'/api/local/status')).json();
    assert.equal(status.ready,true);
    assert.match(status.token,/^[0-9a-f]{64}$/);
    assert.equal((await fetch(s.url+'/local/server.mjs')).status,404);
    assert.equal((await fetch(s.url+'/src/local-ai.mjs')).status,200);
    const response=await fetch(s.url+'/api/local/transcribe?lang=en-US',{method:'POST',headers:{
      'Content-Type':'application/octet-stream','X-PhiScribe-Filename':'voice.wav','X-PhiScribe-Token':status.token
    },body:Buffer.from('test audio')});
    assert.equal(response.status,200);
    assert.equal((await response.json()).text,'Recognized en from test audio');
    assert.equal((await fetch(s.url+'/api/local/status').then(r=>r.json())).busy,false);
  } finally { await s.close(); }
});
test('origin restrictions, token check and bad file guard', async () => {
  const s=await setup();
  try {
    const status=await (await fetch(s.url+'/api/local/status')).json();
    assert.equal((await fetch(s.url+'/api/local/status',{headers:{Origin:'https://evil.example'}})).status,403);
    const badToken=await fetch(s.url+'/api/local/transcribe',{method:'POST',headers:{
      'Content-Type':'application/octet-stream','X-PhiScribe-Filename':'test.wav','X-PhiScribe-Token':'wrong'},body:'a'});
    assert.equal(badToken.status,403);
    const badType=await fetch(s.url+'/api/local/transcribe',{method:'POST',headers:{
      'Content-Type':'application/octet-stream','X-PhiScribe-Filename':'test.exe','X-PhiScribe-Token':status.token},body:'a'});
    assert.equal(badType.status,400);
    const code=await new Promise((done,reject)=>{
      const req=request(s.url+'/api/local/transcribe',{method:'POST',headers:{
        'Content-Type':'application/octet-stream','X-PhiScribe-Filename':'test.wav',
        'X-PhiScribe-Token':status.token,'Content-Length':'262144001'
      }},res=>{res.resume();done(res.statusCode);});
      req.once('error',reject);req.end();
    });
    assert.equal(code,413);
  } finally { await s.close(); }
});
test('client helper sends only an audio file to loopback, and supports cancellation', async () => {
  const token='f'.repeat(64);
  const calls=[];
  const fetcher=async (url,init)=>{
    calls.push({url,init});
    return {ok:true,json:async()=>url.endsWith('/status')?{token,ready:true}:{text:'test'}};
  };
  assert.equal((await localAIStatus(fetcher)).ready,true);
  const file={name:'clip.ogg'};
  assert.equal(await transcribeLocally(file,'fr-FR',token,undefined,fetcher),'test');
  assert.match(calls[1].url,/^http:\/\/127\.0\.0\.1:8765\/api\/local\/transcribe\?lang=fr$/);
  assert.equal(calls[1].init.headers['X-PhiScribe-Filename'],'recording.ogg');
  assert.equal(calls[1].init.body,file);
  await cancelLocalJob(token,fetcher);
  assert.match(calls[2].url,/local\/cancel/);
});
test('mock local FFmpeg and whisper pipeline deletes intermediate artifacts', async () => {
  if (process.platform==='win32') return;
  const dir=await mkdtemp(join(tmpdir(),'phi-pipeline-tests-'));
  try {
    const input=join(dir,'voice.m4a'), model=join(dir,'ggml-base.en.bin');
    await writeFile(input,'spoken audio');
    await writeFile(model,Buffer.alloc(1025));
    const ffmpeg=join(dir,'ffmpeg'), whisper=join(dir,'whisper-cli');
    await writeFile(ffmpeg, "#!/usr/bin/env node\nconst fs=require('fs');const a=process.argv.slice(2);fs.copyFileSync(a[a.indexOf('-i')+1],a[a.length-1]);");
    await writeFile(whisper, "#!/usr/bin/env node\nconst fs=require('fs');const a=process.argv.slice(2);fs.writeFileSync(a[a.indexOf('-of')+1]+'.txt','actual local fake engine text');");
    await Promise.all([chmod(ffmpeg,0o755),chmod(whisper,0o755)]);
    assert.equal(await transcribeFile(input,{ffmpeg,whisper,model},{language:'en'}),'actual local fake engine text');
    assert.equal(await configured({whisper,model}),true);
  } finally { await rm(dir,{recursive:true,force:true}); }
});
