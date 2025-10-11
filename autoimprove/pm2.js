const { spawn } = require('child_process');
const {
  pm2ProcessId,
  logMonitorDurationMs,
  logErrorPreContext,
  logErrorPostContext,
  logMaxCapturedLines
} = require('./config');

const ERROR_PATTERN = /(error|exception|unhandled|rejection|trace|typeerror|referenceerror|syntaxerror)/i;

function runCommand(command, args = []) {
  console.log('[autoimprove][pm2] Executando comando:', command, args.join(' '));
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout = [];
    const stderr = [];

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout.push(text);
      console.log('[autoimprove][pm2][stdout]', text.trim());
    });
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr.push(text);
      console.error('[autoimprove][pm2][stderr]', text.trim());
    });

    child.on('error', (error) => {
      console.error('[autoimprove][pm2] Erro ao executar comando:', command, args.join(' '), error);
      reject(error);
    });
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout: stdout.join(''), stderr: stderr.join('') });
      } else {
        const error = new Error(`${command} ${args.join(' ')} exited with code ${code}`);
        error.stdout = stdout.join('');
        error.stderr = stderr.join('');
        reject(error);
      }
    });
  });
}

async function restartApp() {
  try {
    console.log('[autoimprove][pm2] Parando aplicação com pm2 stop.');
    await runCommand('pm2', ['stop', pm2ProcessId]);
  } catch (err) {
    console.error('[autoimprove][pm2] Não foi possível parar a aplicação. Prosseguindo para restart.', err);
  }

  try {
    console.log('[autoimprove][pm2] Reiniciando aplicação com pm2 restart.');
    await runCommand('pm2', ['restart', pm2ProcessId]);
  } catch (err) {
    console.error('[autoimprove][pm2] Falha ao reiniciar a aplicação via pm2 restart:', err);
    throw err;
  }
}

async function monitorLogs() {
  console.log('[autoimprove][pm2] Limpando logs anteriores com pm2 flush para capturar apenas a nova inicialização.');
  let flushSucceeded = false;
  try {
    await runCommand('pm2', ['flush', pm2ProcessId]);
    flushSucceeded = true;
  } catch (err) {
    console.error('[autoimprove][pm2] Falha ao limpar logs do processo específico. Tentando flush global.', err);
    try {
      await runCommand('pm2', ['flush']);
      flushSucceeded = true;
    } catch (globalErr) {
      console.error('[autoimprove][pm2] Falha ao limpar logs globalmente. Prosseguindo com leitura mesmo assim.', globalErr);
    }
  }

  if (!flushSucceeded) {
    console.warn('[autoimprove][pm2] Não foi possível limpar os logs. Logs antigos podem aparecer na leitura a seguir.');
  }
  console.log('[autoimprove][pm2] Iniciando captura dos logs via pm2 logs.');
  return new Promise((resolve, reject) => {
    const child = spawn('pm2', ['logs', pm2ProcessId, '--lines', '200'], { stdio: ['ignore', 'pipe', 'pipe'] });

    const recentLines = [];
    const capturedLines = [];
    let capturing = false;
    let postContextRemaining = 0;
    let hasError = false;
    let stopped = false;

    const stopMonitoring = (reason) => {
      if (stopped) {
        return;
      }
      stopped = true;
      if (reason) {
        console.log(`[autoimprove][pm2] ${reason}`);
      }
      try {
        child.kill('SIGTERM');
      } catch (killErr) {
        console.error('[autoimprove][pm2] Falha ao encerrar leitura de logs:', killErr);
      }
    };

    const appendRecent = (line) => {
      recentLines.push(line);
      if (recentLines.length > Math.max(1, logErrorPreContext)) {
        recentLines.shift();
      }
    };

    const appendCaptured = (line) => {
      if (!line) {
        return;
      }
      capturedLines.push(line);
      if (capturedLines.length >= logMaxCapturedLines) {
        stopMonitoring('Número máximo de linhas capturadas atingido. Encerrando leitura de logs.');
      }
    };

    const handleLine = (rawLine, source) => {
      if (stopped) {
        return;
      }
      const line = rawLine.trim();
      if (!line) {
        if (capturing) {
          appendCaptured(`[${source}]`);
          postContextRemaining = Math.max(0, postContextRemaining - 1);
          if (postContextRemaining === 0) {
            stopMonitoring('Janela de pós-contexto atingida. Encerrando leitura de logs.');
          }
        }
        return;
      }

      const formatted = `[${source}] ${line}`;
      console.log(`[autoimprove][pm2][logs-${source.toLowerCase()}]`, line);

      if (!capturing && ERROR_PATTERN.test(line)) {
        hasError = true;
        capturing = true;
        recentLines.forEach((recent) => appendCaptured(recent));
        appendCaptured(formatted);
        postContextRemaining = Math.max(1, logErrorPostContext);
        return;
      }

      if (capturing) {
        appendCaptured(formatted);
        if (ERROR_PATTERN.test(line)) {
          postContextRemaining = Math.max(1, logErrorPostContext);
        } else {
          postContextRemaining = Math.max(0, postContextRemaining - 1);
        }
        if (postContextRemaining === 0) {
          stopMonitoring('Janela de pós-contexto atingida. Encerrando leitura de logs.');
        }
        return;
      }

      appendRecent(formatted);
    };

    const timeout = setTimeout(() => {
      stopMonitoring('Tempo de monitoramento atingido. Encerrando leitura de logs.');
    }, logMonitorDurationMs);

    child.stdout.on('data', (chunk) => {
      chunk
        .toString()
        .split('\n')
        .forEach((line) => handleLine(line, 'STDOUT'));
    });

    child.stderr.on('data', (chunk) => {
      chunk
        .toString()
        .split('\n')
        .forEach((line) => handleLine(line, 'STDERR'));
    });

    child.on('error', (err) => {
      clearTimeout(timeout);
      console.error('[autoimprove][pm2] Erro ao monitorar logs:', err);
      reject(err);
    });

    child.on('close', () => {
      clearTimeout(timeout);
      console.log('[autoimprove][pm2] Captura de logs finalizada.');
      const outputLines = capturedLines.length ? capturedLines : recentLines;
      const normalized = outputLines.join('\n');
      const errorLines = outputLines.filter((line) => ERROR_PATTERN.test(line)).join('\n');
      if (!hasError && !capturedLines.length) {
        console.log('[autoimprove][pm2] Nenhum erro identificado durante a captura de logs.');
      }
      resolve({ logs: normalized, errors: errorLines });
    });
  });
}

function extractErrors(logOutput) {
  const combined = `${logOutput.logs}\n${logOutput.errors}`;
  const seen = new Set();
  return combined
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length)
    .filter((line) => ERROR_PATTERN.test(line))
    .map((line) => line.replace(/^\[(STDOUT|STDERR)\]\s*/, ''))
    .filter((line) => {
      if (seen.has(line)) {
        return false;
      }
      seen.add(line);
      return true;
    })
    .slice(0, 5);
}

module.exports = {
  restartApp,
  monitorLogs,
  extractErrors
};
