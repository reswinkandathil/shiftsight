# ShiftSight

ShiftSight is a small cross-platform Electron desktop app for the 20-20-20 eye strain rule. It runs in the background, shows a tray or menu bar icon, and opens a calm full-screen break overlay every 20 minutes by default.

## Features

- Tray icon on Windows and menu bar icon on macOS
- Glassy 10-second pre-break reminder with quick snooze controls
- Full-screen always-on-top break overlay
- Optional notification mode with native notification plus a small non-fullscreen fallback card
- Attempts to show the overlay on every connected monitor
- 20-second countdown with a smooth progress ring
- Optional soft chime when the break completes
- Skip button when strict mode is off
- Local settings for break style, interval, duration, sound, start on login, and strict mode
- Pause breaks for one hour from the tray menu
- No internet, login, analytics, or tracking

## Setup

```bash
npm install
npm run generate-icons
npm start
```

## Build

```bash
npm run build
npm run build:mac
npm run build:win
```

Build output is written to `dist/`.

## Project Structure

```text
src/main.js              Electron main process, tray menu, timers, windows, settings
src/preload.js           Safe IPC bridge for renderer pages
src/renderer/reminder.*  Pre-break reminder UI
src/renderer/overlay.*   Break overlay UI
src/renderer/settings.*  Settings window UI
assets/                  App and tray icon placeholders
scripts/                 Icon generation helper
```

Settings are saved as JSON in Electron's user data directory, so they persist after restarting the app.
