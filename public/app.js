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
const suggestionPanel = $('#suggestionPanel');
const suggestionForm = $('#suggestionForm');
const suggestionInput = $('#suggestionInput');
const suggestionList = $('#suggestionList');
const suggestionFeedback = $('#suggestionFeedback');
const suggestionEmptyState = $('#suggestionEmptyState');
const suggestionButton = $('#btnSuggestionSubmit');

const IMAGE_DISPLAY_DURATION = 10000; // 10 segundos
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.ogv']);
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);
const EXISTENTIAL_TEXT_URL = '/api/existential-texts';
const EXISTENTIAL_MAX_TEXTS = 3000;
const EXISTENTIAL_MAX_LENGTH = 300000000000;
const EXISTENTIAL_REQUEST_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'X-Requested-With': 'MediaWallPlayer'
};
const SUGGESTION_ENDPOINT = '/api/suggestions';
const SUGGESTION_COOLDOWN_MS = 60 * 1000;

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
let existentialBag = [];
let existentialTypewriterTimer = null;
let existentialRenderToken = 0;
let existentialDisplayToken = 0;
let existentialIsWriting = false;
let existentialPendingRequest = false;
let existentialPendingAdvance = false;
let existentialCycleTimer = null;
let suggestionCooldownTimer = null;
let isSendingSuggestion = false;

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

function setSuggestionFeedback(message, tone = 'neutral') {
  if (!suggestionFeedback) return;
  suggestionFeedback.textContent = message || '';
  if (tone === 'success') {
    suggestionFeedback.style.color = 'rgba(134, 239, 172, 0.92)';
  } else if (tone === 'error') {
    suggestionFeedback.style.color = 'rgba(248, 113, 113, 0.92)';
  } else {
    suggestionFeedback.style.color = 'rgba(244, 244, 245, 0.85)';
  }
}

function setSuggestionButtonState(disabled, label) {
  if (!suggestionButton) return;
  suggestionButton.disabled = Boolean(disabled);
  suggestionButton.textContent = label || (disabled ? 'Aguarde...' : 'Enviar');
}

function clearSuggestionCooldown() {
  if (suggestionCooldownTimer) {
    clearTimeout(suggestionCooldownTimer);
    suggestionCooldownTimer = null;
  }
}

function startSuggestionCooldown(duration = SUGGESTION_COOLDOWN_MS) {
  if (!suggestionButton) return;
  clearSuggestionCooldown();
  setSuggestionButtonState(true, 'Aguarde...');
  suggestionCooldownTimer = setTimeout(() => {
    setSuggestionButtonState(false, 'Enviar');
    suggestionCooldownTimer = null;
    setSuggestionFeedback('', 'neutral');
  }, duration);
}

function renderSuggestionList(items) {
  if (!suggestionList || !suggestionEmptyState) return;
  suggestionList.innerHTML = '';
  const entries = Array.isArray(items) ? items : [];
  if (!entries.length) {
    suggestionEmptyState.hidden = false;
    return;
  }
  suggestionEmptyState.hidden = true;
  const formatter = (() => {
    try {
      return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
    } catch (err) {
      return null;
    }
  })();
  entries
    .slice()
    .sort((a, b) => {
      const ta = a && typeof a.timestamp === 'string' ? new Date(a.timestamp).getTime() : 0;
      const tb = b && typeof b.timestamp === 'string' ? new Date(b.timestamp).getTime() : 0;
      const safeA = Number.isFinite(ta) ? ta : 0;
      const safeB = Number.isFinite(tb) ? tb : 0;
      return safeB - safeA;
    })
    .forEach((entry) => {
      if (!entry || typeof entry.text !== 'string') return;
      const li = document.createElement('li');
      const textBlock = document.createElement('div');
      textBlock.textContent = entry.text;
      li.appendChild(textBlock);
      if (entry.timestamp && formatter) {
        const date = new Date(entry.timestamp);
        if (!Number.isNaN(date.getTime())) {
          const timeEl = document.createElement('time');
          timeEl.dateTime = date.toISOString();
          timeEl.textContent = formatter.format(date);
          li.appendChild(timeEl);
        }
      }
      suggestionList.appendChild(li);
    });
}

async function fetchSuggestionList() {
  if (!suggestionPanel) return;
  try {
    const response = await fetch(SUGGESTION_ENDPOINT, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error('Resposta inesperada');
    }
    const data = await response.json();
    renderSuggestionList(data && Array.isArray(data.suggestions) ? data.suggestions : []);
    setSuggestionFeedback('', 'neutral');
    if (!suggestionCooldownTimer && !isSendingSuggestion) {
      setSuggestionButtonState(false, 'Enviar');
    }
  } catch (err) {
    setSuggestionFeedback('Não foi possível carregar as sugestões agora.', 'error');
  }
}

async function submitSuggestion(value) {
  if (!value || isSendingSuggestion || !suggestionPanel) return;
  isSendingSuggestion = true;
  setSuggestionFeedback('Enviando sugestão...', 'neutral');
  setSuggestionButtonState(true, 'Enviando...');
  if (suggestionInput) {
    suggestionInput.disabled = true;
  }

  try {
    const response = await fetch(SUGGESTION_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8'
      },
      body: JSON.stringify({ suggestion: value })
    });

    const data = await response.json().catch(() => ({}));

    if (response.status === 429) {
      setSuggestionFeedback(data && data.error ? data.error : 'Você enviou sugestões demais. Tente novamente em instantes.', 'error');
      startSuggestionCooldown();
      return;
    }

    if (!response.ok) {
      const message = data && data.error ? data.error : 'Não foi possível salvar a sugestão.';
      throw new Error(message);
    }

    const list = data && Array.isArray(data.suggestions) ? data.suggestions : [];
    renderSuggestionList(list);
    const successMessage = data && typeof data.message === 'string'
      ? data.message
      : 'Sugestão enviada! Aguarde um momento antes de enviar outra.';
    setSuggestionFeedback(successMessage, 'success');
    if (suggestionInput) {
      suggestionInput.value = '';
      suggestionInput.blur();
    }
    startSuggestionCooldown();
  } catch (err) {
    setSuggestionFeedback(err.message || 'Não foi possível salvar a sugestão.', 'error');
    setSuggestionButtonState(false, 'Enviar');
    if (suggestionInput) {
      suggestionInput.disabled = false;
      suggestionInput.focus();
    }
  } finally {
    isSendingSuggestion = false;
    if (suggestionInput && suggestionInput.disabled) {
      suggestionInput.disabled = false;
    }
  }
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
      const seen = new Set();
      const normalized = [];

      for (let i = 0; i < list.length && normalized.length < EXISTENTIAL_MAX_TEXTS; i += 1) {
        const raw = typeof list[i] === 'string' ? list[i].trim() : '';
        if (!raw) continue;
        const sliced = raw.length > EXISTENTIAL_MAX_LENGTH ? raw.slice(0, EXISTENTIAL_MAX_LENGTH) : raw;
        if (seen.has(sliced)) continue;
        seen.add(sliced);
        normalized.push(sliced);
      }

      existentialTexts = normalized;
      existentialBag = [];
      return existentialTexts;
    })
    .catch(() => {
      existentialTexts = [];
      existentialBag = [];
      return existentialTexts;
    });

  return existentialTextsPromise;
}

function cancelExistentialTypewriter() {
  if (existentialTypewriterTimer) {
    clearTimeout(existentialTypewriterTimer);
    existentialTypewriterTimer = null;
  }
  existentialIsWriting = false;
}

function maybeTriggerPendingAdvance() {
  if (!existentialPendingAdvance) return;
  advancePlaylist();
}

function clearExistentialCycleTimer() {
  if (existentialCycleTimer) {
    clearTimeout(existentialCycleTimer);
    existentialCycleTimer = null;
  }
}

function scheduleExistentialReflection(min = EXISTENTIAL_INTERVAL.min, max = EXISTENTIAL_INTERVAL.max) {
  const upper = Math.max(max, min + 1);
  clearExistentialCycleTimer();
  existentialCycleTimer = setTimeout(() => {
    existentialCycleTimer = null;
    queueExistentialReflection();
  }, getRandomDelay(min, upper));
}

function pickExistentialText() {
  if (!existentialTexts.length) return null;
  if (!existentialBag.length) {
    existentialBag = shuffle(existentialTexts.map((_, index) => index));
  }
  const nextIndex = existentialBag.splice(Math.floor(Math.random() * existentialBag.length), 1)[0];
  return existentialTexts[nextIndex];
}

const EXISTENTIAL_INTERVAL = {
  min: 9000,
  max: 18000
};

function getRandomDelay(min, max) {
  return min + Math.random() * (max - min);
}

function createTypewriterProfile() {
  const base = 40 + Math.random() * 100; // 220-480ms base delay
  const variability = 30 + Math.random() * 10; // add 160-420ms of variation
  const spaceFactor = 0.5 + Math.random() * 0.35; // spaces are naturally quicker

  const defaultMin = base;
  const defaultMax = base + variability;
  const spaceMin = defaultMin * spaceFactor;
  const spaceMax = defaultMax * spaceFactor;

  const cadenceStates = [
    { range: [0.10, 0.20], weight: 0.21 }, // fast burst
    { range: [0.30, 0.50], weight: 0.22 }, // steady typing
    { range: [0.60, 0.90], weight: 0.23 } // thoughtful slowdown
  ];

  let currentState = cadenceStates[1];
  let stateRemaining = 0;

  const chooseState = () => {
    const roll = Math.random();
    let cumulative = 0;
    for (let i = 0; i < cadenceStates.length; i += 1) {
      cumulative += cadenceStates[i].weight;
      if (roll <= cumulative) {
        return cadenceStates[i];
      }
    }
    return cadenceStates[cadenceStates.length - 1];
  };

  const applyCadence = (delay) => {
    if (stateRemaining <= 0) {
      currentState = chooseState();
      stateRemaining = 2 + Math.floor(Math.random() * 5); // sustain state for a few characters
    }
    stateRemaining -= 1;
    const [min, max] = currentState.range;
    const multiplier = min + Math.random() * (max - min);
    return delay * multiplier;
  };

  const extraPause = (char) => {
    if (char === '\n') {
      return 140 + Math.random() * 20;
    }
    if (/[\.!?,;:]/.test(char)) {
      return 90 + Math.random() * 40;
    }
    if (Math.random() < 0.065) {
      return 30 + Math.random() * 80; // occasional reflective pause
    }
    return 0;
  };

  return {
    space: { min: spaceMin, max: spaceMax },
    default: { min: defaultMin, max: defaultMax },
    applyCadence,
    extraPause
  };
}

function getTypewriterDelay(char, profile) {
  const { min, max } = char === ' ' ? profile.space : profile.default;
  const baseDelay = getRandomDelay(min, max);
  const cadenceDelay = profile.applyCadence(baseDelay);
  const total = cadenceDelay + profile.extraPause(char);
  return Math.max(28, total);
}

function renderExistentialTypewriter(text, token) {
  if (!existentialBox || !existentialText) return;
  existentialText.textContent = '';
  existentialBox.hidden = false;
  existentialBox.classList.add('is-visible');
  const characters = Array.from(text);
  existentialIsWriting = true;
  clearExistentialCycleTimer();
  const typewriterProfile = createTypewriterProfile();

  const finish = () => {
    if (token !== existentialRenderToken) return;
    existentialTypewriterTimer = null;
    existentialIsWriting = false;
    if (existentialPendingRequest) {
      existentialPendingRequest = false;
      displayExistentialReflection();
    }
    if (!existentialIsWriting) {
      maybeTriggerPendingAdvance();
      scheduleExistentialReflection();
    }
  };

  const step = (position) => {
    if (token !== existentialRenderToken) return;
    if (position >= characters.length) {
      finish();
      return;
    }

    existentialText.textContent += characters[position];
    const char = characters[position];
    const delay = getTypewriterDelay(char, typewriterProfile);
    existentialTypewriterTimer = setTimeout(() => {
      step(position + 1);
    }, delay);
  };

  step(0);
}

function displayExistentialReflection() {
  if (!existentialBox || !existentialText) return;
  const token = ++existentialRenderToken;
  existentialPendingRequest = false;
  cancelExistentialTypewriter();
  const text = pickExistentialText();
  if (!text) {
    existentialBox.classList.remove('is-visible');
    existentialBox.hidden = true;
    existentialIsWriting = false;
    maybeTriggerPendingAdvance();
    scheduleExistentialReflection();
    return;
  }
  renderExistentialTypewriter(text, token);
}

function queueExistentialReflection() {
  clearExistentialCycleTimer();
  const displayToken = ++existentialDisplayToken;
  fetchExistentialTexts().then(() => {
    if (displayToken !== existentialDisplayToken) return;
    if (existentialIsWriting) {
      existentialPendingRequest = true;
      return;
    }
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
  if (existentialIsWriting) {
    existentialPendingAdvance = true;
    return;
  }

  existentialPendingAdvance = false;

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

if (suggestionForm) {
  suggestionForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (suggestionButton && suggestionButton.disabled) {
      return;
    }
    const value = suggestionInput ? suggestionInput.value.trim() : '';
    if (!value) {
      setSuggestionFeedback('Escreva uma ideia antes de enviar.', 'error');
      if (suggestionInput) {
        suggestionInput.focus();
      }
      return;
    }
    submitSuggestion(value);
  });
  fetchSuggestionList();
}

fetchExistentialTexts().catch(() => {});
scheduleExistentialReflection(3000, 7000);
updateSoundLabel();
startPlayback();
startLikeFeature();
