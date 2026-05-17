const timerElement = document.querySelector('#timer');
const ringElement = document.querySelector('.progress-ring');
const skipButton = document.querySelector('#skipButton');

let finished = false;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function playSoftChime() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;

  if (!AudioContext) {
    return Promise.resolve();
  }

  const audio = new AudioContext();
  const masterGain = audio.createGain();
  masterGain.gain.setValueAtTime(0.0001, audio.currentTime);
  masterGain.gain.exponentialRampToValueAtTime(0.045, audio.currentTime + 0.04);
  masterGain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.9);
  masterGain.connect(audio.destination);

  [523.25, 659.25, 783.99].forEach((frequency, index) => {
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.55 / (index + 1), audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.85);
    oscillator.connect(gain);
    gain.connect(masterGain);
    oscillator.start(audio.currentTime + index * 0.045);
    oscillator.stop(audio.currentTime + 0.9);
  });

  return delay(950).finally(() => audio.close());
}

async function finishBreak(config) {
  if (finished) {
    return;
  }

  finished = true;
  timerElement.textContent = '0';
  ringElement.style.setProperty('--progress', '360deg');

  if (!config.isController) {
    return;
  }

  if (config.soundEnabled && config.playSound) {
    await playSoftChime();
  } else {
    await delay(250);
  }

  window.shiftsight.breakFinished();
}

function startCountdown(config) {
  const durationMs = config.durationSeconds * 1000;
  const startedAt = performance.now();
  const endsAt = startedAt + durationMs;

  function render(now) {
    const remainingMs = Math.max(0, endsAt - now);
    const remainingSeconds = Math.ceil(remainingMs / 1000);
    const progress = 1 - remainingMs / durationMs;

    timerElement.textContent = String(remainingSeconds);
    ringElement.style.setProperty('--progress', `${progress * 360}deg`);

    if (remainingMs <= 0) {
      finishBreak(config);
      return;
    }

    requestAnimationFrame(render);
  }

  requestAnimationFrame(render);
}

async function init() {
  const config = await window.shiftsight.getOverlayConfig();
  timerElement.textContent = String(config.durationSeconds);
  skipButton.hidden = config.strictMode;

  skipButton.addEventListener('click', () => {
    if (!config.strictMode) {
      finished = true;
      window.shiftsight.skipBreak();
    }
  });

  startCountdown(config);
}

init();
