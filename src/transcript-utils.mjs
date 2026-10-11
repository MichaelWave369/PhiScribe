export const BACKUP_FORMAT = 'phiscribe-backup-v1';

export function countWords(value) {
  const text = String(value ?? '').trim();
  if (!text) return 0;
  // Unicode-aware fallback includes CJK text where whitespace word counts are insufficient.
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    try {
      const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
      return Array.from(segmenter.segment(text), segment => segment.isWordLike).filter(Boolean).length;
    } catch { /* Fall back below. */ }
  }
  return text.split(/\s+/u).length;
}

export function safeFilename(value) {
  const sanitized = String(value || 'Untitled transcript')
    .normalize('NFKC')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
    .replace(/\s+/g, ' ').trim().replace(/[. ]+$/g, '');
  return (sanitized || 'Untitled transcript').slice(0, 90);
}

export function elapsedClock(milliseconds) {
  const totalSeconds = Math.floor(Math.max(0, milliseconds) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return (hours ? `${String(hours).padStart(2, '0')}:` : '') +
    `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function makeMarkdown(document) {
  const title = (document.title || 'Untitled transcript').replace(/[\r\n]+/g, ' ');
  const date = new Date(document.createdAt || Date.now()).toLocaleString();
  const heading = `# ${title}\n\n`;
  const subtitle = document.note ? `${document.note.replace(/[\r\n]+/g, ' ')}\n\n` : '';
  return `${heading}${subtitle}_Created: ${date}_\n\n${document.text || ''}\n`;
}

export function restoreBackup(raw) {
  const parsed = JSON.parse(raw);
  if (!parsed || parsed.format !== BACKUP_FORMAT || !parsed.document ||
      typeof parsed.document !== 'object' || Array.isArray(parsed.document)) {
    throw new Error('Not a valid PhiScribe backup.');
  }
  const document = parsed.document;
  if (typeof document.text !== 'string' || typeof document.title !== 'string' ||
      document.text.length > 2_000_000 || document.title.length > 10_000) {
    throw new Error('Backup has missing or oversized fields.');
  }
  return {
    title: document.title.slice(0, 140),
    note: String(document.note || '').slice(0, 240),
    text: document.text,
    language: typeof document.language === 'string' ? document.language : 'en-US',
    mode: ['local', 'browser'].includes(document.mode) ? document.mode : 'local',
    handoffSource: typeof document.handoffSource === 'string' ? document.handoffSource.slice(0, 120) : '',
    handoffGoal: ['explain', 'troubleshoot', 'summarize', 'actions', 'reply', 'verify'].includes(document.handoffGoal) ? document.handoffGoal : 'explain',
    createdAt: Number.isFinite(document.createdAt) ? document.createdAt : Date.now(),
    elapsedMs: Number.isFinite(document.elapsedMs) ? Math.max(0, document.elapsedMs) : 0,
  };
}

export function newDocument() {
  return { title: 'Untitled transcript', note: '', text: '', language: 'en-US',
    mode: 'local', handoffSource: '', handoffGoal: 'explain', createdAt: Date.now(), elapsedMs: 0 };
}
