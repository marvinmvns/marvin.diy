#!/usr/bin/env node
const { projectRoot, projectScanIgnore, cycleIntervalMs } = require('./config');
const { buildProjectSnapshot } = require('./file-system');
const { requestCompletion } = require('./model-client');
const { parsePlan } = require('./plan-parser');
const { applyPlan } = require('./plan-runner');
const { appendHistory, appendReport, readState, writeState } = require('./logging');
const { restartApp, monitorLogs, extractErrors } = require('./pm2');

let isRunningCycle = false;

function formatSnapshot(snapshot) {
  return snapshot
    .map((file) => `FILE: ${file.path}\n${file.content}`)
    .join('\n\n');
}

function buildSystemPrompt() {
  return [
    'Você é um assistente de engenharia de software responsável por aprimorar continuamente este projeto.',
    'Responda **apenas** com JSON seguindo o formato:',
    '{',
    '  "summary": string,',
    '  "changes": [',
    '    { "path": string, "action": "write" | "delete", "description": string, "content": string }',
    '  ],',
    '  "next_focus": string',
    '}',
    'Cada arquivo listado em "changes" deve conter o conteúdo completo atualizado em "content" quando a ação for "write".',
    'Mantenha o código funcional, consistente e testável.',
    'Inclua melhorias de desempenho, clareza, segurança, arquitetura e organização quando apropriado.',
    'Você pode editar data/existential_texts.json seguindo o formato existente.',
    'Explique sucintamente em "summary" o que mudou e em "next_focus" o que avaliar no próximo ciclo.'
  ].join(' ');
}

function buildPlanPrompt({ snapshot, reason, knownIssues = [] }) {
  const sections = [
    `Motivo do ciclo: ${reason}.`,
    'Contexto do projeto (apenas arquivos de texto relevantes):',
    formatSnapshot(snapshot)
  ];

  if (knownIssues.length) {
    sections.push('Problemas detectados nos logs recentes:', knownIssues.map((issue) => `- ${issue}`).join('\n'));
  }

  sections.push('Gere melhorias no código conforme necessário e retorne apenas o JSON especificado.');

  return sections.join('\n\n');
}

async function askModel(params) {
  const messages = [
    { role: 'system', content: buildSystemPrompt() },
    { role: 'user', content: buildPlanPrompt(params) }
  ];
  const response = await requestCompletion(messages);
  return parsePlan(response);
}

async function runPlan(plan) {
  if (!plan.changes.length) {
    return [];
  }
  return applyPlan(plan);
}

async function executeCycle({ reason }) {
  const snapshot = buildProjectSnapshot(projectRoot, projectScanIgnore);
  writeState({ lastRun: Date.now() });
  const plan = await askModel({ snapshot, reason });
  const appliedChanges = await runPlan(plan);

  if (appliedChanges.length) {
    console.log('Alterações aplicadas:', appliedChanges);
  } else {
    console.log('Nenhuma alteração sugerida neste ciclo.');
  }

  await restartApp();
  const logOutput = await monitorLogs();
  let detectedIssues = extractErrors(logOutput);

  let correctionSummary = '';
  const cumulativeChanges = [...appliedChanges];
  let nextFocus = plan.nextFocus || '';
  let summaryText = plan.summary || '';

  if (detectedIssues.length) {
    console.warn('Problemas detectados nos logs:', detectedIssues);
    const correctionPlan = await askModel({ snapshot: buildProjectSnapshot(projectRoot, projectScanIgnore), reason: 'Correção automática após erro', knownIssues: detectedIssues });
    const correctionChanges = await runPlan(correctionPlan);
    if (correctionChanges.length) {
      cumulativeChanges.push(...correctionChanges);
      summaryText = [summaryText, correctionPlan.summary].filter(Boolean).join(' | ');
      nextFocus = correctionPlan.nextFocus || nextFocus;
      await restartApp();
      const retryLogs = await monitorLogs();
      detectedIssues = extractErrors(retryLogs);
      if (detectedIssues.length) {
        correctionSummary = `Persistem problemas após correção: ${detectedIssues.join('; ')}`;
      } else {
        correctionSummary = 'Correções aplicadas e logs limpos.';
      }
    } else {
      correctionSummary = 'Modelo não sugeriu correção para os erros detectados.';
    }
  }

  const timestamp = new Date();
  const historyEntry = {
    timestamp: timestamp.toISOString(),
    reason,
    summary: summaryText,
    correctionSummary,
    nextFocus,
    changes: cumulativeChanges
  };

  appendHistory(historyEntry);
  appendReport({ timestamp, summary: [summaryText, correctionSummary].filter(Boolean).join(' | '), nextFocus, changes: cumulativeChanges });

  if (detectedIssues.length) {
    console.error('Erros ainda presentes após correções automáticas:', detectedIssues.join('\n'));
  }
}

async function maybeRunCycle(reason) {
  if (isRunningCycle) {
    return;
  }
  const state = readState();
  const now = Date.now();
  const lastRun = state.lastRun || 0;
  if (now - lastRun < cycleIntervalMs) {
    return;
  }

  isRunningCycle = true;
  try {
    await executeCycle({ reason });
  } catch (err) {
    console.error('Falha ao executar ciclo de autoaperfeiçoamento:', err);
  } finally {
    isRunningCycle = false;
  }
}

(async () => {
  const reason = process.argv[2] ? `Execução manual: ${process.argv[2]}` : 'Execução agendada';
  await maybeRunCycle(reason);
  setInterval(() => {
    maybeRunCycle('Execução agendada');
  }, cycleIntervalMs);
})();
