const fs = require('fs');
const path = require('path');
const { projectRoot } = require('./config');

function ensureDirectoryForFile(filePath) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
}

function applyChange(change) {
  const targetPath = path.join(projectRoot, change.path);
  if (change.action === 'delete') {
    if (fs.existsSync(targetPath)) {
      fs.unlinkSync(targetPath);
    }
    return { path: change.path, action: 'delete', description: change.description || '' };
  }

  ensureDirectoryForFile(targetPath);
  fs.writeFileSync(targetPath, change.content, 'utf8');
  return { path: change.path, action: 'write', description: change.description || '' };
}

function applyPlan(plan) {
  const results = [];
  for (const change of plan.changes) {
    const outcome = applyChange(change);
    results.push(outcome);
  }
  return results;
}

module.exports = {
  applyPlan
};
