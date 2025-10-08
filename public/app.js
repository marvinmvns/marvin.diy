const $ = (selector) => document.querySelector(selector);
const player = $('#player');
const image = $('#image');
const btnSound = $('#btnSound');
const btnExit = $('#btnExit');
const btnFullscreen = $('#btnFullscreen');
const msg = $('#msg');

const IMAGE_DISPLAY_DURATION = 10000; // 10 segundos
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.ogv']);
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);

let playlist = [];
let index = 0;
let isStarting = false;
let imageTimer = null;
let currentToken = 0;

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

function detectTypeFromName(name) {
  const extMatch = name.match(/\.([^.]+)$/);
  if (!extMatch) return null;
  const ext = `.${extMatch[1].toLowerCase()}`;
  if (VIDEO_EXTENSIONS.has(ext)) return 'video';
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  return null;
}

function normalizeMedia(list) {
  if (!Array.isArray(list)) return [];
  if (list.every((item) => typeof item === 'string')) {
    return list
      .map((name) => ({ name, type: detectTypeFromName(name) }))
      .filter((item) => item.type);
  }
  return list
    .map((item) => {
      if (!item || typeof item.name !== 'string') return null;
      const typeCandidate = item.type || detectTypeFromName(item.name);
      const type = typeof typeCandidate === 'string' ? typeCandidate.toLowerCase() : null;
      if (type !== 'video' && type !== 'image') return null;
      return { name: item.name, type };
    })
    .filter(Boolean);
}

async function fetchMedia() {
  const response = await fetch('/api/videos', { cache: 'no-store' });
  if (!response.ok) {
    throw new Error('Não foi possível obter a lista de mídias');
  }
  const payload = await response.json();
  return normalizeMedia(payload);
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

function clearImageTimer() {
  if (imageTimer) {
    clearTimeout(imageTimer);
    imageTimer = null;
  }
}

function playMedia(item) {
  if (!item) return;

  currentToken += 1;
  const token = currentToken;

  clearImageTimer();
  showMessage('');

  const source = `/videos/${encodeURIComponent(item.name)}`;

  if (item.type === 'image') {
    btnSound.disabled = true;
    updateSoundLabel();
    player.pause();
    player.removeAttribute('src');
    player.load();
    player.hidden = true;

    image.hidden = false;
    image.onload = () => {
      if (token !== currentToken) return;
      showMessage('');
      clearImageTimer();
      imageTimer = setTimeout(() => {
        if (token === currentToken) {
          advancePlaylist();
        }
      }, IMAGE_DISPLAY_DURATION);
    };

    image.onerror = () => {
      if (token !== currentToken) return;
      handleMediaFailure('Erro ao exibir imagem, avançando...');
    };
    image.src = source;
    return;
  }

  btnSound.disabled = false;
  updateSoundLabel();

  image.hidden = true;
  image.removeAttribute('src');
  image.onload = null;
  image.onerror = null;

  player.hidden = false;
  player.src = source;
  player.load();
  const playPromise = player.play();
  if (playPromise && typeof playPromise.catch === 'function') {
    playPromise.catch(() => {});
  }
}

function handleMediaFailure(message) {
  clearImageTimer();
  showMessage(message);

  if (!playlist.length) {
    return;
  }

  if (playlist.length === 1) {
    playlist = [];
    index = 0;
    currentToken += 1;
    player.pause();
    player.removeAttribute('src');
    player.load();
    image.hidden = true;
    image.removeAttribute('src');
    btnSound.disabled = true;
    updateSoundLabel();
    showMessage(`${message} Nenhuma outra mídia disponível.`);
    return;
  }

  playlist.splice(index, 1);
  index = Math.max(index - 1, -1);
  advancePlaylist();
}

function advancePlaylist() {
  if (!playlist.length) {
    showMessage('Nenhuma mídia disponível para reprodução.');
    btnSound.disabled = true;
    updateSoundLabel();
    return;
  }

  if (playlist.length > 1) {
    index = (index + 1) % playlist.length;
    if (index === 0) {
      playlist = shuffle(playlist.slice());
    }
  } else {
    index = 0;
  }

  const nextItem = playlist[index];
  if (!nextItem) {
    showMessage('Nenhuma mídia disponível para reprodução.');
    btnSound.disabled = true;
    updateSoundLabel();
    return;
  }

  playMedia(nextItem);
}

async function startPlayback() {
  if (isStarting) return;
  isStarting = true;
  showMessage('Carregando mídias...');

  try {
    const media = await fetchMedia();
    if (!media.length) {
      showMessage('Nenhum vídeo ou imagem encontrado na pasta /videos');
      btnSound.disabled = true;
      updateSoundLabel();
      return;
    }

    playlist = shuffle(media.slice());
    index = 0;
    playMedia(playlist[index]);

    await requestFullscreen().catch(() => {});
  } catch (err) {
    showMessage(err.message || String(err));
  } finally {
    isStarting = false;
  }
}

btnFullscreen.addEventListener('click', () => {
  requestFullscreen().catch(() => {});
  if (!playlist.length && !isStarting) {
    startPlayback();
  }
});

btnSound.addEventListener('click', () => {
  if (btnSound.disabled) return;
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
  handleMediaFailure('Erro ao reproduzir vídeo, avançando...');
});

player.addEventListener('playing', () => {
  showMessage('');
});

updateSoundLabel();
startPlayback();
