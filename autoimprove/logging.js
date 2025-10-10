const fs = require('fs');
const path = require('path');
const {
  historyFile,
  reportFile,
  stateFile,
  existentialTextsFile
} = require('./config');

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

function appendExistentialReflection({ timestamp, summary, changes }) {
  const reflection = buildReflectionText({ timestamp, summary, changes });
  let payload = { texts: [] };

  try {
    const raw = fs.readFileSync(existentialTextsFile, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.texts)) {
      payload = parsed;
    }
  } catch (err) {
    // If the file does not exist or is invalid, start from an empty payload.
  }

  payload.texts = [...(payload.texts || []), reflection];
  ensureFilePath(existentialTextsFile);
  fs.writeFileSync(existentialTextsFile, JSON.stringify(payload, null, 2));
}

function buildReflectionText({ timestamp, summary, changes }) {
  const readableTimestamp = timestamp.toISOString();
  const humanSummary = summary || 'Nenhum resumo fornecido.';

  if (!changes.length) {
    return `No ciclo ${readableTimestamp}, nenhuma alteração foi aplicada, mas o sistema registrou: ${humanSummary}`;
  }

  const formattedChanges = changes
    .map((change) => {
      const description = change.description ? ` — ${change.description}` : '';
      return `${change.action.toUpperCase()} ${change.path}${description}`;
    })
    .join('; ');

  return `No ciclo ${readableTimestamp}, o sistema aplicou ${changes.length} alteração(ões): ${formattedChanges}. Resumo: ${humanSummary}`;
}

module.exports = {
  appendHistory,
  appendReport,
  readState,
  writeState,
  appendExistentialReflection
};
