#!/usr/bin/env node
/** PhiScribe loopback-only companion. No auth-free LAN listener. No cloud upload. */
import http from 'node:http';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { configured, transcribeFile, MAX_UPLOAD_BYTES, validateLanguage, validateFilename } from './engine.mjs';

const DEFAULT_PORT = 8765;
const ROOT = resolve(fileURLToPath(new URL('../', import.meta.url)));
const HOSTS = new Set(['localhost', '127.0.0.1']);
const ALLOWED_ORIGINS = new Set(['https://michaelwave369.github.io', 'http://127.0.0.1:8765', 'http://localhost:8765']);
const STATIC = new Set(['index.html', 'styles.css', 'manifest.webmanifest', 'sw.js', 'assets/icon.svg',
  'src/app.js', 'src/audio-import.mjs', 'src/message-fast-lane.mjs', 'src/tab-listen.mjs',
  'src/transcript-utils.mjs', 'src/local-ai.mjs']);
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.mjs':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8', '.svg':'image/svg+xml', '.webmanifest':'application/manifest+json' };

function reply(res, status, value) {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(status, { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff' });
  res.end(JSON.stringify(value));
}
function tokenValid(given, expected) {
  if (typeof given !== 'string' || given.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}
export function createPhiScribeServer(options = {}) {
  const port = options.port ?? DEFAULT_PORT;
  const config = options.config ?? {
    whisper:process.env.PHISCRIBE_WHISPER_CLI || 'whisper-cli',
    ffmpeg:process.env.PHISCRIBE_FFMPEG || 'ffmpeg',
    model:process.env.PHISCRIBE_MODEL || ''
  };
  const processAudio = options.processAudio || transcribeFile;
  const token = randomBytes(32).toString('hex');
  const allowed = new Set(ALLOWED_ORIGINS);
  allowed.add('http://127.0.0.1:'+port);
  allowed.add('http://localhost:'+port);
  let running = false;
  let currentJob = null;
  const server = http.createServer(async (req, res) => {
    const incomingHost = req.headers.host || '';
    if (!HOSTS.has(incomingHost.split(':')[0].toLowerCase())) { reply(res, 403, {error:'Loopback host required.'}); return; }
    const origin = req.headers.origin;
    if (origin && !allowed.has(origin)) { reply(res, 403, {error:'Origin not approved.'}); return; }
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Private-Network', 'true');
    }
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    let url;
    try { url = new URL(req.url, 'http://127.0.0.1:'+port); }
    catch { reply(res, 400, {error:'Bad URL.'}); return; }
    if (req.method === 'OPTIONS' && url.pathname.startsWith('/api/local/')) {
      res.writeHead(204, {'Access-Control-Allow-Methods':'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers':'Content-Type, X-PhiScribe-Token, X-PhiScribe-Filename',
        'Access-Control-Max-Age':'300'}); res.end(); return;
    }
    if (req.method === 'GET' && url.pathname === '/api/local/status') {
      reply(res, 200, {ready:await configured(config), engine:'whisper.cpp (local)',
        model:config.model ? basename(config.model) : null, token, busy:running}); return;
    }
    if (req.method === 'POST' && url.pathname === '/api/local/cancel') {
      if (!tokenValid(req.headers['x-phiscribe-token'], token)) { reply(res, 403, {error:'Bad session token.'}); return; }
      currentJob?.abort();
      reply(res, 200, {cancelled:Boolean(currentJob)}); return;
    }
    if (req.method === 'POST' && url.pathname === '/api/local/transcribe') {
      if (!tokenValid(req.headers['x-phiscribe-token'], token)) { reply(res, 403, {error:'Bad session token.'}); return; }
      if (running) { reply(res, 409, {error:'A transcription is already running.'}); return; }
      if (!await configured(config)) { reply(res, 503, {error:'Configure a local whisper-cli executable and model before transcribing.'}); return; }
      let language;
      try {
        language = validateLanguage(url.searchParams.get('lang'));
        validateFilename(req.headers['x-phiscribe-filename']);
        if (req.headers['content-type']?.split(';')[0] !== 'application/octet-stream') throw new Error('Expected raw audio upload.');
        if (Number(req.headers['content-length'] || 0) > MAX_UPLOAD_BYTES) { reply(res, 413, {error:'Audio exceeds 250 MB.'}); return; }
      } catch (error) { reply(res, 400, {error:error.message}); return; }
      running = true;
      const controller = new AbortController();
      currentJob = controller;
      res.on('close', () => { if (!res.writableEnded) controller.abort(); });
      let dir;
      let resultStatus = 500;
      let resultBody = {error:'Unexpected local processing failure.'};
      try {
        dir = await mkdtemp(join(tmpdir(), 'phiscribe-upload-'));
        const input = join(dir, 'incoming-audio');
        let length = 0;
        const limiter = new Transform({transform(chunk, _encoding, cb) {
          length += chunk.length;
          if (length > MAX_UPLOAD_BYTES) cb(new Error('Audio exceeds 250 MB.'));
          else cb(null, chunk);
        }});
        await pipeline(req, limiter, createWriteStream(input), {signal:controller.signal});
        if (length === 0) throw new Error('Audio file is empty.');
        const text = await processAudio(input, config, {language, signal:controller.signal});
        resultStatus = 200;
        resultBody = {text, engine:'whisper.cpp', language, privacy:'local-device'};
      } catch (error) {
        const cancelled = controller.signal.aborted;
        resultStatus = cancelled ? 499 : /250 MB/.test(error.message) ? 413 : 500;
        resultBody = {error:cancelled ? 'Transcription cancelled.' : error.message.slice(0,500)};
      } finally {
        if (dir) await rm(dir, {force:true, recursive:true});
        currentJob = null;
        running = false;
      }
      reply(res, resultStatus, resultBody);
      return;
    }
    if (req.method === 'GET') {
      let pathname;
      try { pathname = decodeURIComponent(url.pathname).replace(/^\//,'') || 'index.html'; }
      catch { reply(res, 400, {error:'Bad path.'}); return; }
      if (!STATIC.has(pathname)) { reply(res, 404, {error:'Not found.'}); return; }
      try {
        const file = join(ROOT,pathname);
        const info = await stat(file);
        res.writeHead(200, {'Content-Type':MIME[extname(file)] || 'application/octet-stream', 'X-Content-Type-Options':'nosniff'});
        createReadStream(file).pipe(res);
      } catch { reply(res, 404, {error:'Missing resource.'}); }
      return;
    }
    reply(res, 404, {error:'Not found.'});
  });
  return server;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createPhiScribeServer();
  server.listen(DEFAULT_PORT, '127.0.0.1', () => {
    console.log('PhiScribe Local AI: http://127.0.0.1:'+DEFAULT_PORT);
    console.log('Speech processing runs on this machine. Press Ctrl+C to stop.');
    if (!process.env.PHISCRIBE_MODEL) console.log('Set PHISCRIBE_MODEL to your ggml model path before transcribing.');
  });
}
