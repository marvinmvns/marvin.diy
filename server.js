const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const HOST = process.env.HOST || '0.0.0.0';
const PORT = parseInt(process.env.PORT || '3000', 10);
const PUBLIC_DIR = path.join(__dirname, 'public');
const VIDEOS_DIR = path.join(__dirname, 'videos');
const DATA_DIR = path.join(__dirname, 'data');
const LIKES_FILE = path.join(__dirname, 'likes.json');
const SUGGESTIONS_FILE = path.join(__dirname, 'sugestoes.json');
const HISTORY_FILE = path.join(__dirname, 'autoimprove', 'history.jsonl');
const REPORTS_FILE = path.join(__dirname, 'autoimprove', 'reports.md');
const EXISTENTIAL_TEXTS_FILE = path.join(DATA_DIR, 'existential_texts.json');

const LIKE_PAYLOAD_LIMIT = 8 * 1024; // 8 KB para metadados enviados pelo cliente
const EXISTENTIAL_REQUEST_HEADER = 'x-requested-with';
const EXISTENTIAL_REQUEST_EXPECTED_VALUE = 'MediaWallPlayer';

const THIRTY_MINUTES_SECONDS = 30 * 60;
const SUGGESTION_PAYLOAD_LIMIT = 2 * 1024;
const SUGGESTION_COOLDOWN_MS = 60 * 1000;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.ogv': 'video/ogg',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp'
};

const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.ogv']);
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);
const HTML_EXTENSIONS = new Set(['.html', '.htm']);

const suggestionCooldowns = new Map();

function resolveStaticCacheControl(filePath, ext) {
  const baseName = path.basename(filePath);

  if (baseName === 'sw.js') {
    return 'no-cache, no-store, must-revalidate';
  }

  if (HTML_EXTENSIONS.has(ext)) {
    return 'public, max-age=0, must-revalidate';
  }

  return `public, max-age=${THIRTY_MINUTES_SECONDS}, must-revalidate`;
}

function ensureLikesStore() {
  try {
    if (!fs.existsSync(LIKES_FILE)) {
      const initial = {
        total: 0,
        entries: []
      };
      fs.writeFileSync(LIKES_FILE, JSON.stringify(initial, null, 2));
      return;
    }

    const raw = fs.readFileSync(LIKES_FILE, 'utf8');
    JSON.parse(raw);
  } catch (err) {
    try {
      const fallback = {
        total: 0,
        entries: []
      };
      fs.writeFileSync(LIKES_FILE, JSON.stringify(fallback, null, 2));
    } catch (writeErr) {
      console.error('Não foi possível preparar o arquivo de curtidas:', writeErr);
    }
  }
}

function ensureSuggestionsStore() {
  try {
    if (!fs.existsSync(SUGGESTIONS_FILE)) {
      const initial = { suggestions: [] };
      fs.writeFileSync(SUGGESTIONS_FILE, JSON.stringify(initial, null, 2));
      return;
    }

    const raw = fs.readFileSync(SUGGESTIONS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.suggestions)) {
      throw new Error('Formato inválido para sugestoes.json');
    }
  } catch (err) {
    try {
      const fallback = { suggestions: [] };
      fs.writeFileSync(SUGGESTIONS_FILE, JSON.stringify(fallback, null, 2));
    } catch (writeErr) {
      console.error('Não foi possível preparar o arquivo de sugestões:', writeErr);
    }
  }
}

let existentialTextsCache = [];
let existentialTextsCacheStamp = 0;

function loadExistentialTexts() {
  try {
    const stat = fs.statSync(EXISTENTIAL_TEXTS_FILE);
    if (!stat.isFile()) {
      throw new Error('O arquivo de textos existenciais não é um arquivo regular');
    }

    if (stat.mtimeMs !== existentialTextsCacheStamp || !existentialTextsCache.length) {
      const raw = fs.readFileSync(EXISTENTIAL_TEXTS_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      const texts = parsed && Array.isArray(parsed.texts) ? parsed.texts : [];
      existentialTextsCache = texts
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter(Boolean);
      existentialTextsCacheStamp = stat.mtimeMs;
    }
  } catch (err) {
    if (!existentialTextsCache.length) {
      existentialTextsCache = [];
    }
  }

  return existentialTextsCache;
}

function readLikesData() {
  try {
    const raw = fs.readFileSync(LIKES_FILE, 'utf8');
    const data = JSON.parse(raw);
    const entries = Array.isArray(data.entries) ? data.entries : [];
    const total = Number.isFinite(data.total) ? data.total : entries.length;
    return { total, entries };
  } catch (err) {
    return { total: 0, entries: [] };
  }
}

function writeLikesData(data) {
  const payload = {
    total: Number.isFinite(data.total) ? data.total : 0,
    entries: Array.isArray(data.entries) ? data.entries : []
  };
  fs.writeFileSync(LIKES_FILE, JSON.stringify(payload, null, 2));
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim() !== '') {
    const [first] = forwarded.split(',');
    if (first && first.trim()) {
      return first.trim();
    }
  }
  return req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : '';
}

function sanitizeString(value, maxLength) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
}

function sanitizeSuggestionText(value) {
  const text = sanitizeString(value, 512);
  return text ? text.replace(/\s+/g, ' ').trim() : undefined;
}

function sanitizeNumber(value) {
  if (typeof value !== 'number') return undefined;
  if (!Number.isFinite(value)) return undefined;
  return value;
}

function sanitizeClientMetadata(payload) {
  if (!payload || typeof payload !== 'object') {
    return {};
  }

  const metadata = {};

  const language = sanitizeString(payload.language, 32);
  if (language) metadata.language = language;

  const platform = sanitizeString(payload.platform, 64);
  if (platform) metadata.platform = platform;

  const timezone = sanitizeString(payload.timezone, 64);
  if (timezone) metadata.timezone = timezone;

  if (payload.screen && typeof payload.screen === 'object') {
    const width = sanitizeNumber(payload.screen.width);
    const height = sanitizeNumber(payload.screen.height);
    if (width || height) {
      metadata.screen = {};
      if (width) metadata.screen.width = width;
      if (height) metadata.screen.height = height;
    }
  }

  const referrer = sanitizeString(payload.referrer, 256);
  if (referrer) metadata.referrer = referrer;

  return metadata;
}

function appendLikeEntry(entry) {
  const current = readLikesData();
  const entries = Array.isArray(current.entries) ? current.entries : [];
  const baseTotal = Number.isFinite(current.total) ? current.total : entries.length;

  entries.push(entry);

  const nextTotal = baseTotal + 1;
  writeLikesData({
    total: nextTotal,
    entries
  });

  return nextTotal;
}

function readSuggestions() {
  try {
    const raw = fs.readFileSync(SUGGESTIONS_FILE, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data.suggestions) ? data.suggestions : [];
  } catch (err) {
    return [];
  }
}

function writeSuggestions(list) {
  const payload = {
    suggestions: Array.isArray(list)
      ? list.map((item) => ({
          text: sanitizeSuggestionText(item.text) || '',
          timestamp: typeof item.timestamp === 'string' ? item.timestamp : undefined
        })).filter((item) => item.text)
      : []
  };
  fs.writeFileSync(SUGGESTIONS_FILE, JSON.stringify(payload, null, 2));
}

function readHistoryEntries() {
  try {
    if (!fs.existsSync(HISTORY_FILE)) return [];
    const lines = fs.readFileSync(HISTORY_FILE, 'utf8').split(/\r?\n/).filter(Boolean);
    return lines
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch (err) {
          return null;
        }
      })
      .filter(Boolean);
  } catch (err) {
    return [];
  }
}

function readReportsText() {
  try {
    if (!fs.existsSync(REPORTS_FILE)) return '';
    return fs.readFileSync(REPORTS_FILE, 'utf8');
  } catch (err) {
    return '';
  }
}

function buildHistorySearchText(entries) {
  if (!Array.isArray(entries) || !entries.length) return '';
  const parts = [];
  entries.forEach((entry) => {
    if (entry.summary) parts.push(String(entry.summary));
    if (entry.correctionSummary) parts.push(String(entry.correctionSummary));
    if (entry.nextFocus) parts.push(String(entry.nextFocus));
    if (Array.isArray(entry.changes)) {
      entry.changes.forEach((change) => {
        if (!change) return;
        if (change.path) parts.push(String(change.path));
        if (change.description) parts.push(String(change.description));
      });
    }
  });
  return parts.join('\n');
}

function cleanupImplementedSuggestions(currentSuggestions) {
  const suggestions = Array.isArray(currentSuggestions) ? currentSuggestions : [];
  if (!suggestions.length) return suggestions;

  const historyText = buildHistorySearchText(readHistoryEntries()).toLowerCase();
  const reportsText = readReportsText().toLowerCase();

  return suggestions.filter((item) => {
    if (!item || !item.text) return false;
    const normalized = item.text.toLowerCase();
    if (!normalized) return false;
    if (historyText.includes(normalized)) return false;
    if (reportsText.includes(normalized)) return false;
    return true;
  });
}

function addSuggestion(text) {
  const sanitized = sanitizeSuggestionText(text);
  if (!sanitized) {
    const error = new Error('Sugestão inválida');
    error.code = 'INVALID_SUGGESTION';
    throw error;
  }

  const existing = cleanupImplementedSuggestions(readSuggestions());
  const lower = sanitized.toLowerCase();
  const historyText = buildHistorySearchText(readHistoryEntries()).toLowerCase();
  const reportsText = readReportsText().toLowerCase();

  if (historyText.includes(lower) || reportsText.includes(lower)) {
    const error = new Error('Sugestão já contemplada');
    error.code = 'SUGGESTION_ALREADY_DONE';
    throw error;
  }

  const alreadyExists = existing.some((item) => typeof item.text === 'string' && item.text.toLowerCase() === lower);
  if (alreadyExists) {
    const error = new Error('Sugestão já registrada');
    error.code = 'SUGGESTION_DUPLICATE';
    throw error;
  }

  const updated = [
    ...existing,
    {
      text: sanitized,
      timestamp: new Date().toISOString()
    }
  ];

  writeSuggestions(updated);
  return updated;
}

function getSuggestions() {
  const cleaned = cleanupImplementedSuggestions(readSuggestions());
  writeSuggestions(cleaned);
  return cleaned;
}

function parseJsonBody(req, limit = LIKE_PAYLOAD_LIMIT) {
  return new Promise((resolve, reject) => {
    let received = 0;
    const chunks = [];

    req.on('data', (chunk) => {
      received += chunk.length;
      if (received > limit) {
        req.destroy();
        const error = new Error('Payload too large');
        error.code = 'PAYLOAD_TOO_LARGE';
        reject(error);
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (!chunks.length) {
        resolve({});
        return;
      }
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        if (!raw) {
          resolve({});
          return;
        }
        const data = JSON.parse(raw);
        resolve(data);
      } catch (err) {
        const error = new Error('Invalid JSON');
        error.code = 'INVALID_JSON';
        reject(error);
      }
    });

    req.on('error', (err) => {
      reject(err);
    });
  });
}

function send(res, status, headers = {}, body) {
  res.writeHead(status, headers);
  if (body instanceof fs.ReadStream) {
    body.pipe(res);
  } else {
    res.end(body || '');
  }
}

function isSuggestionOnCooldown(ip) {
  if (!ip) return false;
  const expiresAt = suggestionCooldowns.get(ip);
  if (!expiresAt) return false;
  const now = Date.now();
  if (expiresAt > now) {
    return true;
  }
  suggestionCooldowns.delete(ip);
  return false;
}

function registerSuggestionCooldown(ip) {
  if (!ip) return;
  suggestionCooldowns.set(ip, Date.now() + SUGGESTION_COOLDOWN_MS);
}

function listMedia() {
  if (!fs.existsSync(VIDEOS_DIR)) return [];
  return fs
    .readdirSync(VIDEOS_DIR)
    .filter((file) => {
      const ext = path.extname(file).toLowerCase();
      return VIDEO_EXTENSIONS.has(ext) || IMAGE_EXTENSIONS.has(ext);
    })
    .map((file) => {
      const ext = path.extname(file).toLowerCase();
      return {
        name: file,
        type: VIDEO_EXTENSIONS.has(ext) ? 'video' : 'image'
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function buildEtag(stat) {
  return `"${stat.size}-${stat.mtimeMs}"`;
}

function serveStatic(filePath, req, res) {
  let stat;
  try {
    stat = fs.statSync(filePath);
    if (stat.isDirectory()) throw new Error('Is directory');
  } catch (err) {
    return send(res, 404, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Not found');
  }

  const ext = path.extname(filePath).toLowerCase();
  const etag = buildEtag(stat);
  const lastModified = stat.mtime.toUTCString();
  const cacheControl = resolveStaticCacheControl(filePath, ext);

  if (req.headers['if-none-match'] === etag) {
    return send(res, 304, {
      ETag: etag,
      'Last-Modified': lastModified,
      'Cache-Control': cacheControl
    });
  }

  const headers = {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': stat.size,
    ETag: etag,
    'Last-Modified': lastModified,
    'Cache-Control': cacheControl
  };

  return send(res, 200, headers, fs.createReadStream(filePath));
}

function serveMedia(filePath, req, res) {
  let stat;
  try {
    stat = fs.statSync(filePath);
    if (stat.isDirectory()) throw new Error('Is directory');
  } catch (err) {
    return send(res, 404, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Arquivo não encontrado');
  }

  const ext = path.extname(filePath).toLowerCase();
  const isVideo = VIDEO_EXTENSIONS.has(ext);
  const isImage = IMAGE_EXTENSIONS.has(ext);

  if (!isVideo && !isImage) {
    return send(res, 415, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Tipo de arquivo não suportado');
  }

  const total = stat.size;
  const etag = buildEtag(stat);
  const lastModified = stat.mtime.toUTCString();

  const baseHeaders = {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    ETag: etag,
    'Last-Modified': lastModified,
    'Cache-Control': 'public, max-age=31536000, immutable'
  };

  const conditionalHeaders = isVideo ? { ...baseHeaders, 'Accept-Ranges': 'bytes' } : baseHeaders;

  if (req.headers['if-none-match'] === etag) {
    return send(res, 304, conditionalHeaders);
  }

  if (!isVideo) {
    return send(res, 200, { ...baseHeaders, 'Content-Length': total }, fs.createReadStream(filePath));
  }

  const range = req.headers.range;

  if (!range) {
    return send(
      res,
      200,
      {
        ...baseHeaders,
        'Content-Length': total,
        'Accept-Ranges': 'bytes'
      },
      fs.createReadStream(filePath)
    );
  }

  const matches = range.match(/bytes=(\d*)-(\d*)/);
  if (!matches) {
    return send(res, 416, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Bad Range');
  }

  const startRaw = matches[1];
  const endRaw = matches[2];

  let start;
  let end;

  if (startRaw === '' && endRaw === '') {
    return send(res, 416, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Range Not Satisfiable');
  }

  if (startRaw === '') {
    const suffixLength = parseInt(endRaw, 10);
    if (Number.isNaN(suffixLength)) {
      return send(res, 416, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Range Not Satisfiable');
    }
    end = total - 1;
    start = Math.max(total - suffixLength, 0);
  } else {
    start = parseInt(startRaw, 10);
    if (Number.isNaN(start)) {
      return send(res, 416, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Range Not Satisfiable');
    }
    if (endRaw === '') {
      end = total - 1;
    } else {
      end = parseInt(endRaw, 10);
      if (Number.isNaN(end)) {
        return send(res, 416, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Range Not Satisfiable');
      }
    }
  }

  if (start < 0 || end < 0 || start > end || start >= total) {
    return send(res, 416, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Range Not Satisfiable');
  }

  if (end >= total) {
    end = total - 1;
  }

  const chunkSize = end - start + 1;

  const headers = {
    ...baseHeaders,
    'Accept-Ranges': 'bytes',
    'Content-Range': `bytes ${start}-${end}/${total}`,
    'Content-Length': chunkSize
  };

  res.writeHead(206, headers);
  fs.createReadStream(filePath, { start, end }).pipe(res);
}

function safeJoin(base, target) {
  const sanitizedTarget = target.replace(/^[/\\]+/, '');
  const resolvedPath = path.join(base, sanitizedTarget);
  if (!resolvedPath.startsWith(base)) {
    return null;
  }
  return resolvedPath;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = decodeURIComponent(url.pathname);

  if (pathname === '/healthz') {
    return send(res, 200, { 'Content-Type': 'text/plain; charset=utf-8' }, 'ok');
  }

  if (pathname === '/api/videos' && req.method === 'GET') {
    const files = listMedia();
    return send(
      res,
      200,
      {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
      },
      JSON.stringify(files)
    );
  }

  if (pathname === '/api/likes') {
    if (req.method === 'GET') {
      const likes = readLikesData();
      const body = JSON.stringify({ total: Number.isFinite(likes.total) ? likes.total : 0 });
      return send(
        res,
        200,
        {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store'
        },
        body
      );
    }

    if (req.method === 'POST') {
      parseJsonBody(req)
        .then((payload) => {
          try {
            const metadata = sanitizeClientMetadata(payload);
            const userAgent = sanitizeString(req.headers['user-agent'], 256) || undefined;
            const ip = sanitizeString(getClientIp(req), 64) || undefined;
            const entry = {
              timestamp: new Date().toISOString(),
              ...(ip ? { ip } : {}),
              ...(userAgent ? { userAgent } : {}),
              ...(Object.keys(metadata).length ? { metadata } : {})
            };

            const total = appendLikeEntry(entry);

            send(
              res,
              201,
              {
                'Content-Type': 'application/json; charset=utf-8',
                'Cache-Control': 'no-store'
              },
              JSON.stringify({ total })
            );
          } catch (err) {
            console.error('Falha ao registrar curtida:', err);
            send(
              res,
              500,
              {
                'Content-Type': 'application/json; charset=utf-8',
                'Cache-Control': 'no-store'
              },
              JSON.stringify({ error: 'Erro interno' })
            );
          }
        })
        .catch((err) => {
          if (err && err.code === 'PAYLOAD_TOO_LARGE') {
            return send(
              res,
              413,
              {
                'Content-Type': 'application/json; charset=utf-8',
                'Cache-Control': 'no-store'
              },
              JSON.stringify({ error: 'Payload muito grande' })
            );
          }
          if (err && err.code === 'INVALID_JSON') {
            return send(
              res,
              400,
              {
                'Content-Type': 'application/json; charset=utf-8',
                'Cache-Control': 'no-store'
              },
              JSON.stringify({ error: 'JSON inválido' })
            );
          }
          console.error('Erro ao processar curtida:', err);
          return send(
            res,
            400,
            {
              'Content-Type': 'application/json; charset=utf-8',
              'Cache-Control': 'no-store'
            },
            JSON.stringify({ error: 'Requisição inválida' })
          );
        });
      return;
    }

    return send(
      res,
      405,
      {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
      },
      JSON.stringify({ error: 'Método não permitido' })
    );
  }

  if (pathname === '/api/suggestions') {
    if (req.method === 'GET') {
      const suggestions = getSuggestions();
      return send(
        res,
        200,
        {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store'
        },
        JSON.stringify({ suggestions })
      );
    }

    if (req.method === 'POST') {
      const ip = getClientIp(req);
      if (isSuggestionOnCooldown(ip)) {
        return send(
          res,
          429,
          {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store'
          },
          JSON.stringify({ error: 'Aguarde antes de enviar outra sugestão.' })
        );
      }

      parseJsonBody(req, SUGGESTION_PAYLOAD_LIMIT)
        .then((payload) => {
          try {
            const suggestion = sanitizeSuggestionText(payload && payload.suggestion);
            if (!suggestion) {
              const error = new Error('Sugestão inválida');
              error.code = 'INVALID_SUGGESTION';
              throw error;
            }

            const updated = addSuggestion(suggestion);
            registerSuggestionCooldown(ip);
            send(
              res,
              201,
              {
                'Content-Type': 'application/json; charset=utf-8',
                'Cache-Control': 'no-store'
              },
              JSON.stringify({ suggestions: updated })
            );
          } catch (err) {
            if (err && err.code === 'INVALID_SUGGESTION') {
              return send(
                res,
                400,
                {
                  'Content-Type': 'application/json; charset=utf-8',
                  'Cache-Control': 'no-store'
                },
                JSON.stringify({ error: 'Sugestão inválida.' })
              );
            }
            if (err && err.code === 'SUGGESTION_DUPLICATE') {
              registerSuggestionCooldown(ip);
              return send(
                res,
                409,
                {
                  'Content-Type': 'application/json; charset=utf-8',
                  'Cache-Control': 'no-store'
                },
                JSON.stringify({ error: 'Sugestão já registrada.' })
              );
            }
            if (err && err.code === 'SUGGESTION_ALREADY_DONE') {
              registerSuggestionCooldown(ip);
              return send(
                res,
                200,
                {
                  'Content-Type': 'application/json; charset=utf-8',
                  'Cache-Control': 'no-store'
                },
                JSON.stringify({
                  message: 'Essa sugestão já foi implementada, então removemos duplicatas.',
                  suggestions: getSuggestions()
                })
              );
            }

            console.error('Erro ao registrar sugestão:', err);
            return send(
              res,
              500,
              {
                'Content-Type': 'application/json; charset=utf-8',
                'Cache-Control': 'no-store'
              },
              JSON.stringify({ error: 'Erro interno ao salvar sugestão.' })
            );
          }
        })
        .catch((err) => {
          if (err && err.code === 'PAYLOAD_TOO_LARGE') {
            return send(
              res,
              413,
              {
                'Content-Type': 'application/json; charset=utf-8',
                'Cache-Control': 'no-store'
              },
              JSON.stringify({ error: 'Sugestão muito grande.' })
            );
          }
          if (err && err.code === 'INVALID_JSON') {
            return send(
              res,
              400,
              {
                'Content-Type': 'application/json; charset=utf-8',
                'Cache-Control': 'no-store'
              },
              JSON.stringify({ error: 'JSON inválido.' })
            );
          }
          console.error('Erro ao processar sugestão:', err);
          return send(
            res,
            400,
            {
              'Content-Type': 'application/json; charset=utf-8',
              'Cache-Control': 'no-store'
            },
            JSON.stringify({ error: 'Requisição inválida.' })
          );
        });
      return;
    }

    return send(
      res,
      405,
      {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
      },
      JSON.stringify({ error: 'Método não permitido' })
    );
  }

  if (pathname === '/api/existential-texts') {
    if (req.method !== 'POST') {
      return send(
        res,
        405,
        {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store'
        },
        JSON.stringify({ error: 'Método não permitido' })
      );
    }

    const headerValue = req.headers[EXISTENTIAL_REQUEST_HEADER] || '';
    if (headerValue !== EXISTENTIAL_REQUEST_EXPECTED_VALUE) {
      return send(
        res,
        403,
        {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store'
        },
        JSON.stringify({ error: 'Requisição não autorizada' })
      );
    }

    req.resume();
    const texts = loadExistentialTexts();
    return send(
      res,
      200,
      {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
      },
      JSON.stringify({ texts })
    );
  }

  if (pathname.startsWith('/videos/')) {
    const fileName = pathname.replace('/videos/', '');
    const filePath = safeJoin(VIDEOS_DIR, fileName);
    if (!filePath) {
      return send(res, 403, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Forbidden');
    }
    return serveMedia(filePath, req, res);
  }

  const filePath = pathname === '/' ? path.join(PUBLIC_DIR, 'index.html') : safeJoin(PUBLIC_DIR, pathname);

  if (!filePath) {
    return send(res, 403, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Forbidden');
  }

  return serveStatic(filePath, req, res);
});

server.listen(PORT, HOST, () => {
  console.log(`Server running at http://${HOST}:${PORT}`);
  if (!fs.existsSync(VIDEOS_DIR)) {
    console.warn('Atenção: crie a pasta ./videos e coloque seus arquivos de vídeo (.mp4/.webm/.ogv) ou imagem (.jpg/.jpeg/.png/.gif/.webp)');
  }
  ensureLikesStore();
  ensureSuggestionsStore();
  if (!fs.existsSync(EXISTENTIAL_TEXTS_FILE)) {
    console.warn('Atenção: o arquivo data/existential_texts.json não foi encontrado. Os textos existenciais não serão exibidos.');
  } else {
    loadExistentialTexts();
  }
});
