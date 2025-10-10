const { spawn } = require('child_process');
const { pm2ProcessId, logMonitorDurationMs } = require('./config');

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

function monitorLogs() {
  console.log('[autoimprove][pm2] Iniciando captura dos logs via pm2 logs.');
  return new Promise((resolve, reject) => {
    const child = spawn('pm2', ['logs', pm2ProcessId, '--lines', '200'], { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = [];
    const errors = [];

    const timeout = setTimeout(() => {
      console.log('[autoimprove][pm2] Tempo de monitoramento atingido. Encerrando leitura de logs.');
      child.kill('SIGTERM');
    }, logMonitorDurationMs);

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      chunks.push(text);
      console.log('[autoimprove][pm2][logs]', text.trim());
    });
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      errors.push(text);
      console.error('[autoimprove][pm2][logs-err]', text.trim());
    });

    child.on('error', (err) => {
      clearTimeout(timeout);
      console.error('[autoimprove][pm2] Erro ao monitorar logs:', err);
      reject(err);
    });

    child.on('close', () => {
      clearTimeout(timeout);
      console.log('[autoimprove][pm2] Captura de logs finalizada.');
      resolve({ logs: chunks.join(''), errors: errors.join('') });
    });
  });
}

function extractErrors(logOutput) {
  const combined = `${logOutput.logs}\n${logOutput.errors}`;
  return combined
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /error|exception|unhandled/i.test(line));
}

module.exports = {
  restartApp,
  monitorLogs,
  extractErrors
};
