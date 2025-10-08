const $ = (selector) => document.querySelector(selector);
const player = $('#player');
const overlay = $('#overlay');
const btnStart = $('#btnStart');
const btnSound = $('#btnSound');
const btnExit = $('#btnExit');
const msg = $('#msg');

let playlist = [];
let index = 0;
let isStarting = false;

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function updateSoundLabel() {
  btnSound.textContent = `Som: ${player.muted ? 'OFF' : 'ON'}`;
}

function showMessage(text) {
  msg.textContent = text || '';
}

async function fetchVideos() {
  const response = await fetch('/api/videos', { cache: 'no-store' });
  if (!response.ok) {
    throw new Error('Não foi possível obter a lista de vídeos');
  }
  return response.json();
}

function requestFullscreen() {
  const el = document.documentElement;
  if (el.requestFullscreen) return el.requestFullscreen();
  if (el.webkitRequestFullscreen) return el.webkitRequestFullscreen();
  if (el.mozRequestFullScreen) return el.mozRequestFullScreen();
  if (el.msRequestFullscreen) return el.msRequestFullscreen();
  return Promise.resolve();
}

function exitFullscreen() {
  const doc = document;
  if (doc.exitFullscreen) return doc.exitFullscreen();
  if (doc.webkitExitFullscreen) return doc.webkitExitFullscreen();
  if (doc.mozCancelFullScreen) return doc.mozCancelFullScreen();
  if (doc.msExitFullscreen) return doc.msExitFullscreen();
  return Promise.resolve();
}

function setVideo(filename) {
  player.src = `/videos/${encodeURIComponent(filename)}`;
  player.load();
}

function advancePlaylist() {
  if (!playlist.length) {
    return;
  }

  index = (index + 1) % playlist.length;
  if (index === 0) {
    playlist = shuffle(playlist.slice());
  }

  const nextFile = playlist[index];
  setVideo(nextFile);
  player.play().catch(() => {
    // Falhou novamente, pula para o próximo
    advancePlaylist();
  });
}

async function startPlayback() {
  if (isStarting) return;
  isStarting = true;
  showMessage('Carregando vídeos...');

  try {
    const videos = await fetchVideos();
    if (!videos.length) {
      showMessage('Nenhum vídeo encontrado na pasta /videos');
      overlay.style.display = 'flex';
      isStarting = false;
      return;
    }

    playlist = shuffle(videos.slice());
    index = 0;
    setVideo(playlist[index]);

    overlay.style.display = 'none';

    await requestFullscreen().catch(() => {});

    const playPromise = player.play();
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch(() => {});
    }

    showMessage('');
  } catch (err) {
    overlay.style.display = 'flex';
    showMessage(err.message || String(err));
  } finally {
    isStarting = false;
  }
}

btnStart.addEventListener('click', startPlayback);

btnSound.addEventListener('click', () => {
  player.muted = !player.muted;
  updateSoundLabel();
  if (!player.paused) {
    const playPromise = player.play();
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch(() => {});
    }
  }
});

btnExit.addEventListener('click', () => {
  exitFullscreen().catch(() => {});
});

player.addEventListener('ended', () => {
  advancePlaylist();
});

player.addEventListener('error', () => {
  showMessage('Erro ao reproduzir vídeo, avançando...');
  advancePlaylist();
});

player.addEventListener('playing', () => {
  showMessage('');
});

updateSoundLabel();
