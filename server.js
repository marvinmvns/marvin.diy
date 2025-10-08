const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const HOST = process.env.HOST || '0.0.0.0';
const PORT = parseInt(process.env.PORT || '3000', 10);
const PUBLIC_DIR = path.join(__dirname, 'public');
const VIDEOS_DIR = path.join(__dirname, 'videos');
const LIKES_FILE = path.join(__dirname, 'likes.json');

const LIKE_PAYLOAD_LIMIT = 8 * 1024; // 8 KB para metadados enviados pelo cliente

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
  const cacheControl = 'public, max-age=604800';

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
});
