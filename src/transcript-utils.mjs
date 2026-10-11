export const BACKUP_FORMAT = 'phiscribe-backup-v1';

export function countWords(value) {
  const text = String(value ?? '').trim();
  if (!text) return 0;
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    try {
      const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
      return Array.from(segmenter.segment(text), part => part.isWordLike).filter(Boolean).length;
    } catch {}
  }
  return text.split(/\s+/u).length;
}

export function safeFilename(value) {
  const name = String(value || 'Untitled transcript').normalize('NFKC')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '').replace(/\s+/g, ' ')
    .trim().replace(/[. ]+$/g, '');
  return (name || 'Untitled transcript').slice(0, 90);
}

export function elapsedClock(ms) {
  const seconds = Math.floor(Math.max(0, ms) / 1000);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = n => String(n).padStart(2, '0');
  return (h ? pad(h) + ':' : '') + pad(m) + ':' + pad(s);
}

export function newDocument() {
  return { title: 'Untitled transcript', note: '', text: '', language: 'en-US',
    mode: 'local', createdAt: Date.now(), elapsedMs: 0 };
}

export function makeMarkdown(doc) {
  const title = String(doc.title || 'Untitled transcript').replace(/[\r\n]+/g, ' ');
  const note = doc.note ? String(doc.note).replace(/[\r\n]+/g, ' ') + '\n\n' : '';
  const stamp = new Date(doc.createdAt || Date.now()).toLocaleString();
  return '# ' + title + '\n\n' + note + '_Created: ' + stamp + '_\n\n' + (doc.text || '') + '\n';
}

export function restoreBackup(raw) {
  const data = JSON.parse(raw);
  if (!data || data.format !== BACKUP_FORMAT || !data.document ||
      typeof data.document !== 'object' || Array.isArray(data.document)) {
    throw new Error('Not a valid PhiScribe backup.');
  }
  const doc = data.document;
  if (typeof doc.text !== 'string' || typeof doc.title !== 'string' ||
      doc.text.length > 2000000 || doc.title.length > 10000) {
    throw new Error('Backup has missing or oversized fields.');
  }
  return {
    title: doc.title.slice(0, 140),
    note: String(doc.note || '').slice(0, 240),
    text: doc.text,
    language: typeof doc.language === 'string' ? doc.language : 'en-US',
    mode: ['local', 'browser'].includes(doc.mode) ? doc.mode : 'local',
    createdAt: Number.isFinite(doc.createdAt) ? doc.createdAt : Date.now(),
    elapsedMs: Number.isFinite(doc.elapsedMs) ? Math.max(0, doc.elapsedMs) : 0
  };
}
