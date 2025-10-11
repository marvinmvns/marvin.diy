#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const {
  projectRoot,
  projectScanIgnore,
  cycleIntervalMs
} = require('./config');
const { buildProjectSnapshot } = require('./file-system');
const { requestCompletion } = require('./model-client');
const { parsePlan } = require('./plan-parser');
const { applyPlan } = require('./plan-runner');
const {
  appendHistory,
  appendReport,
  appendExistentialReflection,
  readState,
  writeState
} = require('./logging');
const { restartApp, monitorLogs, extractErrors } = require('./pm2');

const suggestionsFile = path.join(projectRoot, 'sugestoes.json');

function normalizeForSearch(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function readSuggestionEntries() {
  if (!fs.existsSync(suggestionsFile)) {
    return [];
  }

  try {
    const raw = fs.readFileSync(suggestionsFile, 'utf8');
    const parsed = JSON.parse(raw);
    const suggestions = Array.isArray(parsed.suggestions) ? parsed.suggestions : [];
    return suggestions
      .map((entry) => {
        if (!entry) return '';
        if (typeof entry === 'string') {
          return entry.trim();
        }
        if (typeof entry.text === 'string') {
          return entry.text.trim();
        }
        return '';
      })
      .filter(Boolean);
  } catch (err) {
    return [];
  }
}

function clearSuggestionEntries() {
  const emptyPayload = {
    suggestions: []
  };

  try {
    fs.writeFileSync(
      suggestionsFile,
      `${JSON.stringify(emptyPayload, null, 2)}\n`
    );
  } catch (err) {
    console.error('[autoimprove] Não foi possível limpar sugestoes.json:', err);
  }
}

function categorizeSuggestionTexts(texts) {
  const activities = [];
  const others = [];

  texts.forEach((text) => {
    const normalized = normalizeForSearch(text);
    if (normalized.includes('atividades a fazer')) {
      activities.push(text);
    } else {
      others.push(text);
    }
  });

  return { activities, others };
}

function buildSuggestionsPromptSection() {
  const entries = readSuggestionEntries();
  if (!entries.length) {
    return '';
  }

  const { activities, others } = categorizeSuggestionTexts(entries);
  const lines = [];

  if (activities.length) {
    lines.push('Atividades a fazer registradas em sugestoes.json (prioritárias e obrigatórias):');
    lines.push(activities.map((text, index) => `- [A${index + 1}] ${text}`).join('\n'));
  }

  if (others.length) {
    lines.push('Outras sugestões registradas em sugestoes.json (trate como backlog obrigatório):');
    lines.push(others.map((text, index) => `- [S${index + 1}] ${text}`).join('\n'));
  }

  if (activities.length) {
    lines.push('Conclua todas as atividades a fazer antes de planejar melhorias novas. Não ignore nenhum item listado.');
  } else if (others.length) {
    lines.push('Implemente as sugestões acima antes de inventar novos aprimoramentos ou reflexões.');
  }

  return lines.join('\n').trim();
}

let isRunningCycle = false;

function formatSnapshot(snapshot) {
  return snapshot
    .map((file) => `FILE: ${file.path}\n${file.content}`)
    .join('\n\n');
}

function buildSystemPrompt() {
  return [
    'Você é um assistente de engenharia de software responsável por aprimorar continuamente este projeto.',
    'Seu objetivo é otimizar o site e escrever textos sobre a vida alinhados com o estilo de data/existential_texts.json.',
    'Analise todo o código conhecido do projeto antes de sugerir alterações e sempre proponha melhorias concretas, justificadas e aplicáveis.',
    'Responda **apenas** com JSON seguindo o formato:',
    '{',
    '  "summary": string,',
    '  "changes": [',
    '    { "path": string, "action": "write" | "delete", "description": string, "content": string }',
    '  ],',
    '  "next_focus": string',
    '}',
    'Cada arquivo listado em "changes" deve conter o conteúdo completo atualizado em "content" quando a ação for "write".',
    'Priorize melhorias que elevem a qualidade do site (UX, performance, acessibilidade, arquitetura) e garanta que textos sobre a vida e pequenos changelogs apareçam quando apropriado.',
    'Você pode e deve editar data/existential_texts.json mantendo o formato existente quando gerar reflexões.',
    'Explique sucintamente em "summary" o que mudou e em "next_focus" o que avaliar no próximo ciclo.'
  ].join(' ');
}

function buildPlanPrompt({ snapshot, reason, knownIssues = [] }) {
  const sections = [
    `Motivo do ciclo: ${reason}.`,
    'Objetivo permanente: otimizar o site e escrever textos sobre a vida.',
    'Contexto do projeto (arquivos de texto relevantes):',
    formatSnapshot(snapshot)
  ];

  const suggestionsSection = buildSuggestionsPromptSection();
  if (suggestionsSection) {
    sections.splice(2, 0, suggestionsSection);
  }

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
  console.log('[autoimprove] Iniciando novo ciclo com motivo:', reason);
  const suggestionsBeforeCycle = readSuggestionEntries();
  let snapshot;
  try {
    snapshot = buildProjectSnapshot(projectRoot, projectScanIgnore);
    console.log('[autoimprove] Total de arquivos analisados no snapshot:', snapshot.length);
  } catch (err) {
    console.error('[autoimprove] Falha ao montar o snapshot do projeto:', err);
    throw err;
  }

  writeState({ lastRun: Date.now() });

  let plan;
  try {
    console.log('[autoimprove] Solicitando plano ao modelo com objetivo de otimizar o site e escrever textos sobre a vida...');
    plan = await askModel({ snapshot, reason });
    console.log('[autoimprove] Plano recebido com resumo:', plan.summary || 'sem resumo informado');
  } catch (err) {
    console.error('[autoimprove] Erro ao consultar o modelo:', err);
    throw err;
  }

  let appliedChanges = [];
  try {
    appliedChanges = await runPlan(plan);
    if (appliedChanges.length) {
      console.log('[autoimprove] Alterações aplicadas com sucesso:', appliedChanges);
    } else {
      console.log('[autoimprove] Nenhuma alteração sugerida neste ciclo.');
    }
  } catch (err) {
    console.error('[autoimprove] Falha ao aplicar plano sugerido:', err);
    throw err;
  }

  let logOutput = { logs: '', errors: '' };
  try {
    console.log('[autoimprove] Reiniciando aplicação via PM2 para validar alterações...');
    await restartApp();
    console.log('[autoimprove] Aplicação reiniciada. Acompanhando logs para detectar possíveis erros.');
    logOutput = await monitorLogs();
  } catch (err) {
    console.error('[autoimprove] Falha ao reiniciar ou monitorar logs da aplicação:', err);
  }

  let detectedIssues = extractErrors(logOutput);

  let correctionSummary = '';
  const cumulativeChanges = [...appliedChanges];
  let nextFocus = plan.nextFocus || '';
  let summaryText = plan.summary || '';

  if (detectedIssues.length) {
    console.warn('[autoimprove] Problemas detectados nos logs:', detectedIssues);
    let correctionPlan;
    try {
      console.log('[autoimprove] Solicitando plano de correção ao modelo...');
      correctionPlan = await askModel({ snapshot: buildProjectSnapshot(projectRoot, projectScanIgnore), reason: 'Correção automática após erro', knownIssues: detectedIssues });
    } catch (err) {
      console.error('[autoimprove] Erro ao solicitar plano de correção:', err);
      correctionSummary = 'Falha ao solicitar plano de correção ao modelo.';
      correctionPlan = null;
    }

    let correctionChanges = [];
    if (correctionPlan) {
      try {
        correctionChanges = await runPlan(correctionPlan);
      } catch (err) {
        console.error('[autoimprove] Falha ao aplicar plano de correção:', err);
        correctionSummary = 'Falha ao aplicar correções sugeridas.';
      }
    }

    if (correctionChanges.length) {
      cumulativeChanges.push(...correctionChanges);
      summaryText = [summaryText, correctionPlan.summary].filter(Boolean).join(' | ');
      nextFocus = correctionPlan.nextFocus || nextFocus;
      try {
        console.log('[autoimprove] Reiniciando aplicação após correções...');
        await restartApp();
        console.log('[autoimprove] Monitorando logs após correções.');
        const retryLogs = await monitorLogs();
        detectedIssues = extractErrors(retryLogs);
      } catch (err) {
        console.error('[autoimprove] Falha ao reiniciar ou ler logs após correção:', err);
        correctionSummary = 'Não foi possível validar as correções devido a erro no PM2 ou na leitura de logs.';
      }
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
  const combinedSummary = [summaryText, correctionSummary].filter(Boolean).join(' | ');
  appendReport({ timestamp, summary: combinedSummary, nextFocus, changes: cumulativeChanges });
  appendExistentialReflection({ timestamp, summary: combinedSummary, changes: cumulativeChanges });

  if (suggestionsBeforeCycle.length && cumulativeChanges.length && !detectedIssues.length) {
    console.log('[autoimprove] Sugestões consumidas com sucesso. Limpando sugestoes.json.');
    clearSuggestionEntries();
  }

  if (detectedIssues.length) {
    console.error('[autoimprove] Erros ainda presentes após correções automáticas:\n', detectedIssues.join('\n'));
  } else {
    console.log('[autoimprove] Ciclo concluído sem erros pendentes.');
  }
}

async function maybeRunCycle(reason, { ignoreInterval = false } = {}) {
  if (isRunningCycle) {
    console.log('[autoimprove] Ignorando execução: já existe um ciclo em andamento.');
    return;
  }
  const state = readState();
  const now = Date.now();
  const lastRun = state.lastRun || 0;
  if (!ignoreInterval && now - lastRun < cycleIntervalMs) {
    console.log('[autoimprove] Intervalo mínimo ainda não atingido. Última execução em', new Date(lastRun).toISOString());
    return;
  }

  isRunningCycle = true;
  try {
    await executeCycle({ reason });
  } catch (err) {
    console.error('[autoimprove] Falha ao executar ciclo de autoaperfeiçoamento:', err);
  } finally {
    isRunningCycle = false;
  }
}

(async () => {
  const reason = process.argv[2] ? `Execução manual: ${process.argv[2]}` : 'Execução agendada';
  console.log('[autoimprove] Processo iniciado. Razão inicial:', reason);
  try {
    await maybeRunCycle(reason, { ignoreInterval: true });
  } catch (err) {
    console.error('[autoimprove] Erro inesperado na execução inicial:', err);
  }
  setInterval(() => {
    console.log('[autoimprove] Agendando nova verificação automática.');
    maybeRunCycle('Execução agendada');
  }, cycleIntervalMs);
})();
