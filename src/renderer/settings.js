const form = document.querySelector('#settingsForm');
const statusElement = document.querySelector('#status');

const fields = {
  intervalMinutes: document.querySelector('#intervalMinutes'),
  durationSeconds: document.querySelector('#durationSeconds'),
  modeOverlay: document.querySelector('#modeOverlay'),
  modeNotification: document.querySelector('#modeNotification'),
  soundEnabled: document.querySelector('#soundEnabled'),
  startOnLogin: document.querySelector('#startOnLogin'),
  strictMode: document.querySelector('#strictMode')
};

let statusTimer = null;

const defaultSettings = {
  intervalMinutes: 20,
  durationSeconds: 20,
  breakMode: 'overlay',
  soundEnabled: true,
  startOnLogin: false,
  strictMode: false
};

function setStatus(message) {
  statusElement.textContent = message;
  clearTimeout(statusTimer);

  if (message) {
    statusTimer = setTimeout(() => {
      statusElement.textContent = '';
    }, 2500);
  }
}

function readForm() {
  return {
    intervalMinutes: Number(fields.intervalMinutes.value),
    durationSeconds: Number(fields.durationSeconds.value),
    breakMode: fields.modeNotification.checked ? 'notification' : 'overlay',
    soundEnabled: fields.soundEnabled.checked,
    startOnLogin: fields.startOnLogin.checked,
    strictMode: fields.strictMode.checked
  };
}

function writeForm(settings) {
  fields.intervalMinutes.value = settings.intervalMinutes;
  fields.durationSeconds.value = settings.durationSeconds;
  fields.modeOverlay.checked = settings.breakMode !== 'notification';
  fields.modeNotification.checked = settings.breakMode === 'notification';
  fields.soundEnabled.checked = settings.soundEnabled;
  fields.startOnLogin.checked = settings.startOnLogin;
  fields.strictMode.checked = settings.strictMode;
}

async function loadSettings() {
  if (!window.shiftsight) {
    writeForm(defaultSettings);
    return;
  }

  const settings = await window.shiftsight.getSettings();
  writeForm(settings);
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  if (!form.reportValidity()) {
    return;
  }

  if (!window.shiftsight) {
    writeForm(readForm());
    setStatus('Saved');
    return;
  }

  const savedSettings = await window.shiftsight.saveSettings(readForm());
  writeForm(savedSettings);
  setStatus('Saved');
});

loadSettings().catch(() => {
  setStatus('Could not load settings');
});
