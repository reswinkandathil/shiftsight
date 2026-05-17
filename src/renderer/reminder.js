const countdown = document.getElementById('countdown');
const message = document.getElementById('message');
const startNow = document.getElementById('startNow');
const snoozeButtons = [...document.querySelectorAll('.snooze-action')];

let reminderMode = 'prebreak';
let endsAt = Date.now() + 10 * 1000;

function formatCountdown(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function updateCountdown() {
  countdown.textContent = formatCountdown(endsAt - Date.now());
}

async function init() {
  const config = await window.shiftsight.getReminderConfig();
  reminderMode = config.mode || reminderMode;
  endsAt = config.endsAt || endsAt;
  message.textContent = config.message || message.textContent;
  startNow.textContent = config.primaryLabel || startNow.textContent;

  if (config.strictMode || !config.showSnooze) {
    snoozeButtons.forEach((button) => {
      button.hidden = true;
    });
  }

  updateCountdown();
  setInterval(updateCountdown, 250);
}

startNow.addEventListener('click', () => {
  if (reminderMode === 'notification') {
    window.shiftsight.finishReminderBreak();
    return;
  }

  window.shiftsight.startReminderBreak();
});

snoozeButtons.forEach((button) => {
  button.addEventListener('click', () => {
    window.shiftsight.snoozeReminder(Number(button.dataset.minutes));
  });
});

init();
