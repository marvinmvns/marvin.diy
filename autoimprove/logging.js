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

function safeAppend(targetPath, data) {
  ensureFilePath(targetPath);
  try {
    fs.appendFileSync(targetPath, data, 'utf8');
  } catch (err) {
    console.error('[autoimprove][logging] Falha ao registrar informações em', targetPath, err);
  }
}

function appendHistory(entry) {
  const line = JSON.stringify(entry);
  safeAppend(historyFile, `${line}\n`);
}

function appendReport({ timestamp, summary, nextFocus, changes }) {
  ensureFilePath(reportFile);
  const header = `\n## ${timestamp.toISOString()}\n`;
  const changeLines = changes.length
    ? changes.map((item) => `- **${item.action}** ${item.path}${item.description ? ` — ${item.description}` : ''}`).join('\n')
    : '- Nenhuma alteração aplicada';
  const body = `${header}\n**Resumo do ciclo:** ${summary || 'Sem resumo fornecido.'}\n\n**Alterações aplicadas:**\n${changeLines}\n\n**Próxima avaliação:** ${nextFocus || 'Não informado.'}\n`;
  safeAppend(reportFile, body);
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
  const MAX_REFLECTION_LENGTH = 1000;
  const normalizedReflection =
    reflection.length > MAX_REFLECTION_LENGTH
      ? reflection.slice(0, MAX_REFLECTION_LENGTH)
      : reflection;
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

  payload.texts = [...(payload.texts || []), normalizedReflection];
  ensureFilePath(existentialTextsFile);
  try {
    fs.writeFileSync(existentialTextsFile, JSON.stringify(payload, null, 2));
  } catch (err) {
    console.error('[autoimprove][logging] Não foi possível atualizar existential_texts:', err);
  }
}

function buildReflectionText({ timestamp, summary, changes }) {
  const readableTimestamp = timestamp.toISOString();
  const humanSummary = summary || 'Nenhum resumo fornecido.';

  const changeLogEntries = changes.length
    ? changes.map((change) => {
        const description = change.description ? ` — ${change.description}` : '';
        return `${change.action.toUpperCase()} ${change.path}${description}`;
      })
    : [];

  const changeLogText = changes.length
    ? `Changelog existencial: ${changeLogEntries.join(' | ')}. Ajustes enxutos para manter a trama viva.`
    : 'Changelog existencial: Nenhum arquivo tocado; repouso consciente para que o propósito respire.';

  const lifeMusing = [
    'A cada commit automático, lembro que manter o site vivo exige o mesmo cuidado que manter a esperança acesa.',
    'Enquanto o código evolui, anoto que a vida também se refatora em ciclos — nunca idênticos, sempre intencionais.',
    'Hoje percebi que até logs silenciosos carregam histórias; o silêncio da vida pede ser ouvido como revisamos um diff.'
  ];

  const lifeText = lifeMusing[Math.floor(Math.random() * lifeMusing.length)];

  return [
    `No ciclo ${readableTimestamp}, foram registradas ${changes.length} alteração(ões).`,
    changeLogText,
    `Resumo: ${humanSummary}.`,
    `Pensamento sobre a vida: ${lifeText}`
  ].join(' ');
}

module.exports = {
  appendHistory,
  appendReport,
  readState,
  writeState,
  appendExistentialReflection
};
