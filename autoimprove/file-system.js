const fs = require('fs');
const path = require('path');
const {
  maxPromptCharacters,
  snapshotFileCharLimit,
  snapshotMinTruncatedLength
} = require('./config');

const TEXT_EXTENSIONS = new Set(['.js', '.json', '.md', '.html', '.css', '.txt', '.mjs', '.cjs', '.ts', '.tsx', '.jsx']);
const TRUNCATION_MARKER = '\n--- Conteúdo truncado para caber no prompt ---\n';

function applyContentLimit(fullContent, limit) {
  if (!Number.isFinite(limit) || limit <= 0 || fullContent.length <= limit) {
    return { text: fullContent, truncated: false };
  }

  if (limit <= TRUNCATION_MARKER.length + 20) {
    return { text: `${fullContent.slice(0, limit - 1)}…`, truncated: true };
  }

  const available = limit - TRUNCATION_MARKER.length;
  const headLength = Math.floor(available / 2);
  const tailLength = available - headLength;
  const head = fullContent.slice(0, headLength);
  const tail = fullContent.slice(fullContent.length - tailLength);

  return {
    text: `${head}${TRUNCATION_MARKER}${tail}`,
    truncated: true
  };
}

function condenseSnapshot(files) {
  const prepared = files.map(({ path: filePath, content }) => ({
    path: filePath,
    fullContent: content,
    originalLength: content.length,
    minLimit: Math.min(snapshotMinTruncatedLength, content.length),
    currentLimit: Math.min(snapshotFileCharLimit, content.length),
    truncated: false,
    content: content
  }));

  let totalChars = 0;

  for (const file of prepared) {
    const { text, truncated } = applyContentLimit(file.fullContent, file.currentLimit);
    file.content = text;
    file.truncated = truncated;
    totalChars += file.content.length;
  }

  if (!Number.isFinite(maxPromptCharacters) || maxPromptCharacters <= 0) {
    return prepared;
  }

  const MAX_ITERATIONS = 2000;
  let iterations = 0;
  while (totalChars > maxPromptCharacters && iterations < MAX_ITERATIONS) {
    iterations += 1;
    let candidate = null;
    for (const file of prepared) {
      if (file.currentLimit > file.minLimit) {
        if (!candidate || file.content.length > candidate.content.length) {
          candidate = file;
        }
      }
    }

    if (!candidate) {
      break;
    }

    const previousLength = candidate.content.length;
    const nextLimit = Math.max(candidate.minLimit, Math.floor(candidate.currentLimit * 0.8));
    if (nextLimit >= candidate.currentLimit) {
      candidate.currentLimit = candidate.minLimit;
    } else {
      candidate.currentLimit = nextLimit;
    }

    const { text, truncated } = applyContentLimit(candidate.fullContent, candidate.currentLimit);
    candidate.content = text;
    candidate.truncated = truncated;
    totalChars += candidate.content.length - previousLength;
  }

  return prepared;
}

function matchesIgnore(relativePath, ignoreList) {
  return ignoreList.some((pattern) => {
    if (pattern.endsWith('/')) {
      return relativePath.startsWith(pattern.slice(0, -1));
    }
    return relativePath === pattern || relativePath.startsWith(`${pattern}/`);
  });
}

function collectFiles(rootDir, subPath = '', ignoreList = []) {
  const absolutePath = subPath ? path.join(rootDir, subPath) : rootDir;
  const entries = fs.readdirSync(absolutePath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const relativePath = subPath ? path.join(subPath, entry.name) : entry.name;
    if (matchesIgnore(relativePath, ignoreList)) {
      continue;
    }

    if (entry.isDirectory()) {
      files.push(...collectFiles(rootDir, relativePath, ignoreList));
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }

  return files;
}

function readTextFileSync(fullPath) {
  const ext = path.extname(fullPath).toLowerCase();
  if (!TEXT_EXTENSIONS.has(ext)) {
    return null;
  }
  return fs.readFileSync(fullPath, 'utf8');
}

function buildProjectSnapshot(rootDir, ignoreList = []) {
  const files = collectFiles(rootDir, '', ignoreList).sort((a, b) => a.localeCompare(b));
  const rawSnapshot = [];

  for (const relativePath of files) {
    const fullPath = path.join(rootDir, relativePath);
    const content = readTextFileSync(fullPath);
    if (content === null) {
      continue;
    }
    rawSnapshot.push({ path: relativePath, content });
  }

  const condensed = condenseSnapshot(rawSnapshot);
  const totalChars = condensed.reduce((sum, file) => sum + file.content.length, 0);
  const truncatedCount = condensed.filter((file) => file.truncated).length;
  console.log(
    '[autoimprove][file-system] Snapshot preparado:',
    JSON.stringify(
      {
        files: condensed.length,
        totalChars,
        truncated: truncatedCount
      }
    )
  );

  return condensed.map(({ path: filePath, content, truncated, originalLength }) => ({
    path: filePath,
    content,
    truncated,
    originalLength
  }));
}

module.exports = {
  buildProjectSnapshot
};
