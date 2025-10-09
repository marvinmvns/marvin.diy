const { spawn } = require('child_process');
const { pm2ProcessId, logMonitorDurationMs } = require('./config');

function runCommand(command, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout = [];
    const stderr = [];

    child.stdout.on('data', (chunk) => stdout.push(chunk.toString()));
    child.stderr.on('data', (chunk) => stderr.push(chunk.toString()));

    child.on('error', reject);
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
  await runCommand('pm2', ['stop', pm2ProcessId]);
  await runCommand('pm2', ['start', pm2ProcessId]);
}

function monitorLogs() {
  return new Promise((resolve, reject) => {
    const child = spawn('pm2', ['logs', pm2ProcessId, '--lines', '200'], { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = [];
    const errors = [];

    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
    }, logMonitorDurationMs);

    child.stdout.on('data', (chunk) => chunks.push(chunk.toString()));
    child.stderr.on('data', (chunk) => errors.push(chunk.toString()));

    child.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    child.on('close', () => {
      clearTimeout(timeout);
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
