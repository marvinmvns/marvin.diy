const path = require('path');

const projectRoot = path.resolve(__dirname, '..');

module.exports = {
  projectRoot,
  endpoint: process.env.AUTOIMPROVE_ENDPOINT || 'http://192.168.31.29:8000/v1/chat/completions',
  model: process.env.AUTOIMPROVE_MODEL || 'gpt-4o-mini',
  temperature: Number.parseFloat(process.env.AUTOIMPROVE_TEMPERATURE || '0.2'),
  maxTokens: Number.parseInt(process.env.AUTOIMPROVE_MAX_TOKENS || '2048', 10),
  cycleIntervalMs: Number.parseInt(process.env.AUTOIMPROVE_INTERVAL_MS || String(60 * 60 * 1000), 10),
  logMonitorDurationMs: Number.parseInt(process.env.AUTOIMPROVE_LOG_WINDOW_MS || String(30 * 1000), 10),
  projectScanIgnore: [
    'node_modules',
    '.git',
    '.DS_Store',
    'videos',
    'pm2.log',
    'autoimprove/state.json',
    'autoimprove/history.jsonl',
    'autoimprove/reports.md'
  ],
  historyFile: path.join(projectRoot, 'autoimprove', 'history.jsonl'),
  reportFile: path.join(projectRoot, 'autoimprove', 'reports.md'),
  stateFile: path.join(projectRoot, 'autoimprove', 'state.json'),
  existentialTextsFile: path.join(projectRoot, 'data', 'existential_texts.json'),
  pm2ProcessId: process.env.AUTOIMPROVE_PM2_ID || '0'
};
