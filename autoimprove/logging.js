const fs = require('fs');
const path = require('path');
const { historyFile, reportFile, stateFile } = require('./config');

function ensureFilePath(targetPath) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
}

function appendHistory(entry) {
  const line = JSON.stringify(entry);
  ensureFilePath(historyFile);
  fs.appendFileSync(historyFile, `${line}\n`, 'utf8');
}

function appendReport({ timestamp, summary, nextFocus, changes }) {
  ensureFilePath(reportFile);
  const header = `\n## ${timestamp.toISOString()}\n`;
  const changeLines = changes.length
    ? changes.map((item) => `- **${item.action}** ${item.path}${item.description ? ` — ${item.description}` : ''}`).join('\n')
    : '- Nenhuma alteração aplicada';
  const body = `${header}\n**Resumo do ciclo:** ${summary || 'Sem resumo fornecido.'}\n\n**Alterações aplicadas:**\n${changeLines}\n\n**Próxima avaliação:** ${nextFocus || 'Não informado.'}\n`;
  fs.appendFileSync(reportFile, body, 'utf8');
}

function readState() {
  try {
    const raw = fs.readFileSync(stateFile, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    return { lastRun: 0 };
  }
}

function writeState(state) {
  ensureFilePath(stateFile);
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
}

module.exports = {
  appendHistory,
  appendReport,
  readState,
  writeState
};
