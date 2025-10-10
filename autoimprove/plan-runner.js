const fs = require('fs');
const path = require('path');
const { projectRoot } = require('./config');

function ensureDirectoryForFile(filePath) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
}

function applyChange(change) {
  const targetPath = path.join(projectRoot, change.path);
  console.log('[autoimprove][plan-runner] Aplicando alteração:', change.action, change.path);
  if (change.action === 'delete') {
    if (fs.existsSync(targetPath)) {
      fs.unlinkSync(targetPath);
      console.log('[autoimprove][plan-runner] Arquivo removido:', change.path);
    } else {
      console.log('[autoimprove][plan-runner] Arquivo para remoção não encontrado, ignorando:', change.path);
    }
    return { path: change.path, action: 'delete', description: change.description || '' };
  }

  ensureDirectoryForFile(targetPath);
  fs.writeFileSync(targetPath, change.content, 'utf8');
  console.log('[autoimprove][plan-runner] Arquivo escrito com sucesso:', change.path);
  return { path: change.path, action: 'write', description: change.description || '' };
}

function applyPlan(plan) {
  const results = [];
  for (const change of plan.changes) {
    try {
      const outcome = applyChange(change);
      results.push(outcome);
    } catch (err) {
      console.error('[autoimprove][plan-runner] Falha ao aplicar alteração em', change.path, err);
    }
  }
  return results;
}

module.exports = {
  applyPlan
};
