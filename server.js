const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const HOST = process.env.HOST || '0.0.0.0';
const PORT = parseInt(process.env.PORT || '3000', 10);
const PUBLIC_DIR = path.join(__dirname, 'public');
const VIDEOS_DIR = path.join(__dirname, 'videos');

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
});
