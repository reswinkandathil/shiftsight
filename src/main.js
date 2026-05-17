const {
  app,
  BrowserWindow,
  Menu,
  Notification,
  Tray,
  ipcMain,
  nativeImage,
  screen
} = require('electron');
const fs = require('fs');
const path = require('path');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.setAppUserModelId('com.shiftsight.desktop');

const DEFAULT_SETTINGS = {
  intervalMinutes: 20,
  durationSeconds: 20,
  soundEnabled: true,
  startOnLogin: false,
  strictMode: false,
  breakMode: 'overlay'
};

const ONE_HOUR_MS = 60 * 60 * 1000;
const TRAY_STATUS_TICK_MS = 5 * 1000;
const BREAK_REMINDER_MS = 10 * 1000;

let settings = { ...DEFAULT_SETTINGS };
let tray = null;
let settingsWindow = null;
let reminderWindow = null;
let reminderConfig = null;
let overlayWindows = [];
let overlayConfigs = new Map();
let breakTimer = null;
let breakFallbackTimer = null;
let breakReminderTimer = null;
let trayStatusTimer = null;
let nextBreakAt = null;
let pauseUntil = null;
let breakInProgress = false;
let isQuitting = false;
let lastTrayTitle = null;
let lastTrayStatusLabel = null;
const hasSingleInstanceLock = app.requestSingleInstanceLock();

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }

  return Math.round(Math.min(max, Math.max(min, number)));
}

function normalizeSettings(input = {}) {
  const breakMode =
    input.breakMode === 'notification' || input.breakMode === 'overlay'
      ? input.breakMode
      : DEFAULT_SETTINGS.breakMode;

  return {
    intervalMinutes: clampNumber(
      input.intervalMinutes,
      1,
      240,
      DEFAULT_SETTINGS.intervalMinutes
    ),
    durationSeconds: clampNumber(
      input.durationSeconds,
      5,
      300,
      DEFAULT_SETTINGS.durationSeconds
    ),
    soundEnabled: Boolean(input.soundEnabled),
    startOnLogin: Boolean(input.startOnLogin),
    strictMode: Boolean(input.strictMode),
    breakMode
  };
}

function loadSettings() {
  try {
    const file = fs.readFileSync(settingsPath(), 'utf8');
    settings = normalizeSettings({
      ...DEFAULT_SETTINGS,
      ...JSON.parse(file)
    });
  } catch (error) {
    settings = { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(nextSettings) {
  settings = normalizeSettings({
    ...settings,
    ...nextSettings
  });

  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2));
  applyLoginSetting();

  if (!breakInProgress) {
    scheduleNextBreak();
  }

  updateTrayMenu();
  return settings;
}

function applyLoginSetting() {
  if (!app.isPackaged && process.platform === 'darwin') {
    return;
  }

  app.setLoginItemSettings({
    openAtLogin: settings.startOnLogin,
    openAsHidden: true
  });
}

function msUntilNextBreak() {
  return Math.round(settings.intervalMinutes * 60 * 1000);
}

function clearTimer(timer) {
  if (timer) {
    clearTimeout(timer);
  }
}

function isPaused() {
  return pauseUntil !== null && Date.now() < pauseUntil;
}

function scheduleNextBreak(delay = msUntilNextBreak()) {
  clearTimer(breakTimer);
  clearTimer(breakReminderTimer);
  closeReminderWindow();

  if (isPaused()) {
    nextBreakAt = null;
    breakTimer = setTimeout(() => {
      pauseUntil = null;
      updateTrayMenu();
      scheduleNextBreak();
    }, Math.max(0, pauseUntil - Date.now()));
    updateTrayStatus();
    return;
  }

  pauseUntil = null;
  nextBreakAt = Date.now() + Math.max(0, delay);
  breakTimer = setTimeout(() => {
    startBreak();
  }, Math.max(0, delay));

  if (settings.breakMode === 'overlay' && delay > 0) {
    breakReminderTimer = setTimeout(() => {
      showBreakReminder();
    }, Math.max(0, delay - BREAK_REMINDER_MS));
  }

  updateTrayStatus();
}

function getTrayIcon() {
  const iconPath = path.join(__dirname, '..', 'assets', 'tray.png');
  const image = nativeImage.createFromPath(iconPath);

  if (process.platform === 'darwin') {
    const resizedImage = image.resize({ height: 17 });
    resizedImage.setTemplateImage(true);
    return resizedImage;
  }

  return image;
}

function createTray() {
  tray = new Tray(getTrayIcon());
  tray.setToolTip('ShiftSight');

  tray.on('click', () => tray.popUpContextMenu());
  trayStatusTimer = setInterval(updateTrayStatus, TRAY_STATUS_TICK_MS);
  updateTrayStatus();
  updateTrayMenu();
}

function formatRemaining(ms) {
  if (ms <= 0) {
    return 'now';
  }

  if (ms < 60 * 1000) {
    return '<1m';
  }

  return `${Math.ceil(ms / (60 * 1000))}m`;
}

function getStatusLabel() {
  if (breakInProgress) {
    return 'Break in progress';
  }

  if (isPaused()) {
    return `Paused until ${new Date(pauseUntil).toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit'
    })}`;
  }

  if (!nextBreakAt) {
    return 'Breaks active';
  }

  return `Next break in ${formatRemaining(nextBreakAt - Date.now())}`;
}

function getTrayTitle() {
  if (breakInProgress) {
    return 'Break';
  }

  if (isPaused()) {
    return 'Paused';
  }

  if (!nextBreakAt) {
    return '--';
  }

  const remainingMs = nextBreakAt - Date.now();
  return formatRemaining(remainingMs);
}

function updateTrayStatus() {
  if (!tray) {
    return;
  }

  const title = getTrayTitle();
  const statusLabel = getStatusLabel();
  const changed = title !== lastTrayTitle || statusLabel !== lastTrayStatusLabel;

  lastTrayTitle = title;
  lastTrayStatusLabel = statusLabel;
  tray.setToolTip(`${title} - ${statusLabel}`);

  if (process.platform === 'darwin') {
    tray.setTitle(title, { fontType: 'monospaced' });
  }

  if (changed) {
    updateTrayMenu();
  }
}

function updateTrayMenu() {
  if (!tray) {
    return;
  }

  const paused = isPaused();
  const pauseLabel = paused
    ? `Paused until ${new Date(pauseUntil).toLocaleTimeString([], {
        hour: 'numeric',
        minute: '2-digit'
      })}`
    : 'Pause breaks for 1 hour';

  const menu = Menu.buildFromTemplate([
    {
      label:
        settings.breakMode === 'notification'
          ? 'Send break notification'
          : 'Start break now',
      click: () => startBreak(true)
    },
    {
      label: pauseLabel,
      enabled: !paused,
      click: pauseBreaks
    },
    {
      label: 'Resume breaks',
      enabled: paused,
      click: resumeBreaks
    },
    { type: 'separator' },
    {
      label: getStatusLabel(),
      enabled: false
    },
    { type: 'separator' },
    {
      label: 'Settings',
      click: showSettingsWindow
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: quitApp
    }
  ]);

  tray.setContextMenu(menu);
}

function pauseBreaks() {
  pauseUntil = Date.now() + ONE_HOUR_MS;
  scheduleNextBreak();
  updateTrayStatus();
  updateTrayMenu();
}

function resumeBreaks() {
  pauseUntil = null;
  scheduleNextBreak();
  updateTrayStatus();
  updateTrayMenu();
}

function showSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 560,
    height: 760,
    minWidth: 420,
    minHeight: 640,
    resizable: true,
    title: 'ShiftSight Settings',
    backgroundColor: '#00000000',
    autoHideMenuBar: true,
    transparent: true,
    vibrancy: process.platform === 'darwin' ? 'under-window' : undefined,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition:
      process.platform === 'darwin' ? { x: 20, y: 20 } : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  settingsWindow.loadFile(path.join(__dirname, 'renderer', 'settings.html'));
  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}

function sendNativeBreakNotification() {
  if (Notification.isSupported()) {
    const notification = new Notification({
      title: 'Shift Your Sight',
      body: `Shift your vision to something far away for ${settings.durationSeconds} seconds.`,
      icon: path.join(__dirname, '..', 'assets', 'icon.png'),
      silent: !settings.soundEnabled,
      timeoutType: 'default'
    });

    notification.on('click', () => {
      if (settings.breakMode === 'notification') {
        showSettingsWindow();
      }
    });

    notification.show();
  }
}

function getReminderBounds() {
  const display = screen.getPrimaryDisplay();
  const { x, y, width } = display.workArea;
  const reminderWidth = Math.min(780, Math.max(560, width - 48));
  const reminderHeight = 205;

  return {
    width: reminderWidth,
    height: reminderHeight,
    x: Math.round(x + (width - reminderWidth) / 2),
    y: Math.round(y + 72)
  };
}

function showBreakReminder() {
  if (
    breakInProgress ||
    isPaused() ||
    settings.breakMode !== 'overlay' ||
    !nextBreakAt
  ) {
    return;
  }

  showReminderWindow({
    mode: 'prebreak',
    endsAt: nextBreakAt,
    message: 'Almost time. Your eyes will appreciate this.',
    primaryLabel: 'Start this break now',
    showSnooze: !settings.strictMode
  });
}

function showReminderWindow(config) {
  if (reminderWindow && !reminderWindow.isDestroyed()) {
    reminderWindow.show();
    reminderWindow.focus();
    return;
  }

  reminderConfig = {
    mode: 'prebreak',
    endsAt: Date.now() + BREAK_REMINDER_MS,
    message: 'Almost time. Your eyes will appreciate this.',
    primaryLabel: 'Start this break now',
    showSnooze: !settings.strictMode,
    strictMode: settings.strictMode,
    ...config
  };

  reminderWindow = new BrowserWindow({
    ...getReminderBounds(),
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    backgroundColor: '#00000000',
    title: 'ShiftSight Reminder',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  reminderWindow.setAlwaysOnTop(true, 'floating');
  reminderWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  reminderWindow.setMenuBarVisibility(false);

  reminderWindow.once('ready-to-show', () => {
    if (reminderWindow && !reminderWindow.isDestroyed()) {
      reminderWindow.showInactive();
    }
  });

  reminderWindow.on('closed', () => {
    reminderWindow = null;
    reminderConfig = null;
  });

  reminderWindow.loadFile(path.join(__dirname, 'renderer', 'reminder.html'));
}

function closeReminderWindow() {
  if (reminderWindow && !reminderWindow.isDestroyed()) {
    reminderWindow.close();
  }

  reminderWindow = null;
}

function isAppSwitchShortcut(input) {
  const key = input.key.toLowerCase();
  return (
    (input.alt && key === 'tab') ||
    (input.meta && ['tab', '`', 'h', 'm'].includes(key))
  );
}

function isQuitShortcut(input) {
  const key = input.key.toLowerCase();
  return (input.meta && key === 'q') || (input.alt && key === 'f4');
}

function reassertOverlayFocus(overlay) {
  if (!breakInProgress || isQuitting || !overlay || overlay.isDestroyed()) {
    return;
  }

  overlay.setAlwaysOnTop(true, 'screen-saver', 1);
  overlay.moveTop();
  overlay.focus();
}

function createOverlayWindow(display, index) {
  const { x, y, width, height } = display.bounds;
  const overlay = new BrowserWindow({
    x,
    y,
    width,
    height,
    fullscreen: true,
    simpleFullscreen: process.platform === 'darwin',
    kiosk: true,
    frame: false,
    transparent: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    closable: false,
    alwaysOnTop: true,
    roundedCorners: false,
    skipTaskbar: true,
    focusable: true,
    backgroundColor: '#07080b',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlay.setMenuBarVisibility(false);
  const webContentsId = overlay.webContents.id;

  overlay.once('ready-to-show', () => {
    if (!overlay.isDestroyed()) {
      overlay.show();
      overlay.setKiosk(true);
      reassertOverlayFocus(overlay);
    }
  });

  overlay.on('blur', () => {
    setTimeout(() => reassertOverlayFocus(overlay), 80);
  });

  overlay.on('closed', () => {
    overlayConfigs.delete(webContentsId);
  });

  overlay.webContents.on('before-input-event', (event, input) => {
    if (isQuitShortcut(input)) {
      event.preventDefault();
      quitApp();
      return;
    }

    if (isAppSwitchShortcut(input)) {
      event.preventDefault();
      reassertOverlayFocus(overlay);
    }
  });

  overlayConfigs.set(webContentsId, {
    durationSeconds: settings.durationSeconds,
    soundEnabled: settings.soundEnabled,
    strictMode: settings.strictMode,
    breakMode: settings.breakMode,
    isController: index === 0,
    playSound: index === 0
  });

  overlay.loadFile(path.join(__dirname, 'renderer', 'overlay.html'));
  return overlay;
}

function startBreak(manual = false) {
  if (breakInProgress) {
    return;
  }

  clearTimer(breakTimer);
  clearTimer(breakFallbackTimer);
  clearTimer(breakReminderTimer);
  closeReminderWindow();
  nextBreakAt = null;

  if (settings.breakMode === 'notification') {
    startNotificationBreak();
    return;
  }

  breakInProgress = true;
  updateTrayStatus();
  updateTrayMenu();

  const displays = screen.getAllDisplays();
  overlayWindows = displays.map(createOverlayWindow);

  breakFallbackTimer = setTimeout(() => {
    completeBreak('finished');
  }, settings.durationSeconds * 1000 + 2500);

  if (manual && isPaused()) {
    updateTrayMenu();
  }
}

function startNotificationBreak() {
  breakInProgress = true;
  updateTrayStatus();
  updateTrayMenu();
  sendNativeBreakNotification();

  const endsAt = Date.now() + settings.durationSeconds * 1000;
  showReminderWindow({
    mode: 'notification',
    endsAt,
    message: 'Shift your vision to something far away.',
    primaryLabel: 'Done',
    showSnooze: !settings.strictMode
  });

  breakFallbackTimer = setTimeout(() => {
    completeBreak('finished');
  }, settings.durationSeconds * 1000);
}

function closeOverlayWindows() {
  for (const overlay of overlayWindows) {
    if (overlay && !overlay.isDestroyed()) {
      overlay.setKiosk(false);
      overlay.destroy();
    }
  }

  overlayWindows = [];
  overlayConfigs.clear();
}

function completeBreak(reason) {
  if (!breakInProgress) {
    return;
  }

  breakInProgress = false;
  clearTimer(breakFallbackTimer);
  closeReminderWindow();
  closeOverlayWindows();
  scheduleNextBreak();
  updateTrayMenu();
}

function quitApp() {
  isQuitting = true;
  clearTimer(breakTimer);
  clearTimer(breakFallbackTimer);
  clearTimer(breakReminderTimer);
  clearInterval(trayStatusTimer);
  closeReminderWindow();
  closeOverlayWindows();
  app.quit();
}

ipcMain.handle('settings:get', () => settings);

ipcMain.handle('settings:save', (event, nextSettings) => {
  return saveSettings(nextSettings);
});

ipcMain.handle('overlay:get-config', (event) => {
  return (
    overlayConfigs.get(event.sender.id) || {
      durationSeconds: settings.durationSeconds,
      soundEnabled: settings.soundEnabled,
      strictMode: settings.strictMode,
      breakMode: settings.breakMode,
      isController: false,
      playSound: false
    }
  );
});

ipcMain.handle('reminder:get-config', () => {
  return (
    reminderConfig || {
      mode: 'prebreak',
      endsAt: nextBreakAt || Date.now() + BREAK_REMINDER_MS,
      message: 'Almost time. Your eyes will appreciate this.',
      primaryLabel: 'Start this break now',
      showSnooze: !settings.strictMode,
      strictMode: settings.strictMode
    }
  );
});

ipcMain.on('reminder:start-break', () => {
  startBreak(true);
});

ipcMain.on('reminder:finish-break', () => {
  completeBreak('finished');
});

ipcMain.on('reminder:snooze', (event, minutes) => {
  if (settings.strictMode) {
    return;
  }

  breakInProgress = false;
  clearTimer(breakFallbackTimer);
  const snoozeMinutes = clampNumber(minutes, 1, 15, 5);
  scheduleNextBreak(snoozeMinutes * 60 * 1000);
  updateTrayMenu();
});

ipcMain.on('break:skip', () => {
  if (!settings.strictMode) {
    completeBreak('skipped');
  }
});

ipcMain.on('break:finished', () => {
  completeBreak('finished');
});

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', showSettingsWindow);

  app.whenReady().then(() => {
    loadSettings();
    applyLoginSetting();
    createTray();
    scheduleNextBreak();

    if (process.platform === 'darwin') {
      app.dock.hide();
    }

    app.on('activate', showSettingsWindow);
  });
}

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('window-all-closed', () => {});
