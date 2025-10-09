const fs = require('fs');
const path = require('path');

const TEXT_EXTENSIONS = new Set(['.js', '.json', '.md', '.html', '.css', '.txt', '.mjs', '.cjs', '.ts', '.tsx', '.jsx']);

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
  const snapshot = [];

  for (const relativePath of files) {
    const fullPath = path.join(rootDir, relativePath);
    const content = readTextFileSync(fullPath);
    if (content === null) {
      continue;
    }
    snapshot.push({ path: relativePath, content });
  }

  return snapshot;
}

module.exports = {
  buildProjectSnapshot
};
