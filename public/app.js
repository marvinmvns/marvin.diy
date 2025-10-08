const $ = (selector) => document.querySelector(selector);
const player = $('#player');
const image = $('#image');
const btnSound = $('#btnSound');
const btnExit = $('#btnExit');
const btnFullscreen = $('#btnFullscreen');
const msg = $('#msg');
const likeButton = $('#floatingLike');
const likeCount = $('#likeCount');
const existentialBox = $('#existentialBox');
const existentialText = $('#existentialText');

const IMAGE_DISPLAY_DURATION = 10000; // 10 segundos
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.ogv']);
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);
const EXISTENTIAL_TEXT_URL = '/api/existential-texts';
const EXISTENTIAL_REQUEST_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'X-Requested-With': 'MediaWallPlayer'
};

let playlist = [];
let index = 0;
let isStarting = false;
let imageTimer = null;
let currentToken = 0;
let likeMoveTimer = null;
let likeFlashTimer = null;
let isSendingLike = false;
let existentialTexts = [];
let existentialTextsPromise = null;
let existentialLastIndex = -1;
let existentialTypewriterTimer = null;
let existentialRenderToken = 0;
let existentialDisplayToken = 0;

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

function setLikeCount(value) {
  if (!likeCount) return;
  const display = Number.isFinite(value) ? value : 0;
  likeCount.textContent = String(display);
}

function fetchExistentialTexts() {
  if (existentialTextsPromise) {
    return existentialTextsPromise;
  }

  existentialTextsPromise = fetch(EXISTENTIAL_TEXT_URL, {
    method: 'POST',
    headers: EXISTENTIAL_REQUEST_HEADERS,
    body: JSON.stringify({ purpose: 'playlist' }),
    cache: 'no-store',
    credentials: 'same-origin'
  })
    .then((response) => {
      if (!response.ok) {
        throw new Error('Falha ao carregar textos existenciais');
      }
      return response.json();
    })
    .then((data) => {
      const list = data && Array.isArray(data.texts) ? data.texts : [];
      existentialTexts = list
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter(Boolean);
      return existentialTexts;
    })
    .catch(() => {
      existentialTexts = [];
      return existentialTexts;
    });

  return existentialTextsPromise;
}

function cancelExistentialTypewriter() {
  if (existentialTypewriterTimer) {
    clearTimeout(existentialTypewriterTimer);
    existentialTypewriterTimer = null;
  }
}

function pickExistentialText() {
  if (!existentialTexts.length) return null;
  let nextIndex = Math.floor(Math.random() * existentialTexts.length);
  if (existentialTexts.length > 1) {
    let attempts = 0;
    while (nextIndex === existentialLastIndex && attempts < 5) {
      nextIndex = Math.floor(Math.random() * existentialTexts.length);
      attempts += 1;
    }
  }
  existentialLastIndex = nextIndex;
  return existentialTexts[nextIndex];
}

function renderExistentialTypewriter(text, token) {
  if (!existentialBox || !existentialText) return;
  existentialText.textContent = '';
  existentialBox.hidden = false;
  existentialBox.classList.add('is-visible');
  const characters = Array.from(text);

  const step = (position) => {
    if (token !== existentialRenderToken) return;
    if (position >= characters.length) return;

    existentialText.textContent += characters[position];
    const char = characters[position];
    const delay = char === ' ' ? 20 : 45 + Math.random() * 55;
    existentialTypewriterTimer = setTimeout(() => {
      step(position + 1);
    }, delay);
  };

  step(0);
}

function displayExistentialReflection() {
  if (!existentialBox || !existentialText) return;
  const token = ++existentialRenderToken;
  cancelExistentialTypewriter();
  const text = pickExistentialText();
  if (!text) {
    existentialBox.classList.remove('is-visible');
    existentialBox.hidden = true;
    return;
  }
  renderExistentialTypewriter(text, token);
}

function queueExistentialReflection() {
  const displayToken = ++existentialDisplayToken;
  fetchExistentialTexts().then(() => {
    if (displayToken !== existentialDisplayToken) return;
    displayExistentialReflection();
  });
}

function clearLikeMovementTimer() {
  if (likeMoveTimer) {
    clearTimeout(likeMoveTimer);
    likeMoveTimer = null;
  }
}

function markLikeFeedback(state) {
  if (!likeButton) return;
  likeButton.classList.remove('floating-like--success', 'floating-like--error');
  if (likeFlashTimer) {
    clearTimeout(likeFlashTimer);
    likeFlashTimer = null;
  }
  if (!state) return;

  const className = state === 'success' ? 'floating-like--success' : 'floating-like--error';
  likeButton.classList.add(className);
  likeFlashTimer = setTimeout(() => {
    likeButton.classList.remove(className);
    likeFlashTimer = null;
  }, state === 'success' ? 700 : 900);
}

function applyLikePosition(x, y, immediate) {
  if (!likeButton) return;
  if (immediate) {
    likeButton.style.transition = 'none';
  }
  likeButton.style.setProperty('--like-x', `${Math.round(x)}px`);
  likeButton.style.setProperty('--like-y', `${Math.round(y)}px`);
  if (immediate) {
    // força reflow para reabilitar a transição suavemente
    void likeButton.offsetHeight;
    likeButton.style.transition = '';
  }
}

function moveLike(immediate = false) {
  if (!likeButton) return;
  const rect = likeButton.getBoundingClientRect();
  const margin = 40;
  const maxX = Math.max(window.innerWidth - rect.width - margin, 0);
  const maxY = Math.max(window.innerHeight - rect.height - margin, 0);
  const x = Math.random() * maxX + margin / 2;
  const y = Math.random() * maxY + margin / 2;
  applyLikePosition(x, y, immediate);
}

function scheduleLikeMovement(delay = 4500) {
  if (!likeButton) return;
  clearLikeMovementTimer();
  likeMoveTimer = setTimeout(() => {
    moveLike();
    scheduleLikeMovement(4000 + Math.random() * 4000);
  }, delay);
}

async function fetchLikeTotal() {
  if (!likeButton) return;
  try {
    const response = await fetch('/api/likes', { cache: 'no-store' });
    if (!response.ok) return;
    const data = await response.json();
    if (typeof data.total === 'number') {
      setLikeCount(data.total);
    }
  } catch (err) {
    // ignora erros silenciosamente
  }
}

async function registerLike() {
  if (!likeButton || isSendingLike) return;
  isSendingLike = true;
  likeButton.classList.add('floating-like--sending');
  markLikeFeedback();

  const timezone = (() => {
    try {
      if (typeof Intl !== 'undefined' && typeof Intl.DateTimeFormat === 'function') {
        const options = Intl.DateTimeFormat().resolvedOptions();
        if (options && typeof options.timeZone === 'string') {
          return options.timeZone;
        }
      }
    } catch (err) {
      // ignora
    }
    return null;
  })();

  const payload = {
    language: navigator.language || null,
    platform: navigator.platform || null,
    timezone,
    screen: {
      width: (window.screen && Number.isFinite(window.screen.width) ? window.screen.width : window.innerWidth) || null,
      height: (window.screen && Number.isFinite(window.screen.height) ? window.screen.height : window.innerHeight) || null
    },
    referrer: document.referrer || null
  };

  try {
    const response = await fetch('/api/likes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error('Falha na requisição');
    }

    const data = await response.json();
    if (typeof data.total === 'number') {
      setLikeCount(data.total);
    }
    markLikeFeedback('success');
    scheduleLikeMovement(1500);
  } catch (err) {
    markLikeFeedback('error');
    scheduleLikeMovement(2000);
  } finally {
    likeButton.classList.remove('floating-like--sending');
    isSendingLike = false;
  }
}

function startLikeFeature() {
  if (!likeButton) return;
  setLikeCount(0);
  moveLike(true);
  scheduleLikeMovement(1200);
  fetchLikeTotal();
  likeButton.addEventListener('click', registerLike);
  window.addEventListener('resize', () => {
    moveLike(true);
    scheduleLikeMovement(2000);
  });
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
  queueExistentialReflection();

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

fetchExistentialTexts().catch(() => {});
updateSoundLabel();
startPlayback();
startLikeFeature();
