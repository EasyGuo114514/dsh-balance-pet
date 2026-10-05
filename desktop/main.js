/**
 * Desktop companion window.
 *
 * WHAT THIS IS FOR
 * The user asked for a pet that can run around the computer, not just inside the
 * Harness window. A Harness plugin cannot do that: plugins run in the Host's
 * Node process, which has no access to Electron's window API (and the Harness
 * window is itself just one window). So the pet gets its own transparent,
 * frameless, always-on-top window, and this file owns it.
 *
 * HOW IT FINDS THE HOST
 * The Host half writes `$DSH_HOME/balance-pet/bridge.json` with the loopback
 * port and the access token. This process reads that file and loads the pet page
 * from the bridge, so the page talks to the Host same-origin and no CORS or
 * credential plumbing is needed. Because the Host may still be starting - or may
 * restart and pick a new port - the file is polled, and the window reloads when
 * the address changes instead of silently going stale.
 *
 * The pet never sees an API key: it renders numbers the Host already computed.
 *
 * Run with: npm start  (from this directory)
 */

// `electron` is a CommonJS module, so named ESM imports of its exports are not
// available; the default export carries them. Importing named bindings here
// fails at load with "does not provide an export named 'BrowserWindow'", which
// means the window never appears and nothing else looks wrong.
import electron from 'electron';
import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const { BrowserWindow, app, ipcMain, screen } = electron;

/** Window size, in device-independent pixels. */
const PET_WIDTH = 200;
const PET_HEIGHT = 190;

/** Walk step, in pixels per tick, and the tick interval. */
const STEP_PX = 2;
const TICK_MS = 33;

/** How long the pet walks and rests, in milliseconds. */
const REST_MIN_MS = 5_000;
const REST_MAX_MS = 16_000;
const WALK_MIN_MS = 2_000;
const WALK_MAX_MS = 7_000;

const here = dirname(fileURLToPath(import.meta.url));
const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh');
const bridgeFile = join(dshHome, 'balance-pet', 'bridge.json');

/**
 * Optional `--self-shot=<path>`: capture the window to a PNG and exit.
 *
 * This exists for automated verification. The pet runs in a transparent
 * always-on-top window, so the only way to check what it actually renders -
 * without a human looking at the screen - is to have it photograph itself. It
 * is off unless the flag is passed, so a normal launch never writes anything.
 */
const selfShot = (() => {
  const arg = process.argv.find((value) => value.startsWith('--self-shot='));
  return arg === undefined ? null : arg.slice('--self-shot='.length);
})();

let window_ = null;
let address = null;
let position = { x: 80, y: 80 };
let direction = 1;
let walking = false;
let ticker = null;

/** Read the bridge address, or `null` when it is not there yet. */
async function readBridge() {
  try {
    const parsed = JSON.parse(await readFile(bridgeFile, 'utf8'));
    if (typeof parsed?.port !== 'number' || typeof parsed?.token !== 'string') return null;
    return { port: parsed.port, token: parsed.token };
  } catch {
    return null;
  }
}

/**
 * The walking track: the union of every display's work area.
 *
 * Using the union rather than one display's area is what lets the pet walk from
 * one monitor to the next instead of turning around at the edge of the screen it
 * happens to be on.
 *
 * @returns bounds the pet may occupy.
 */
function trackBounds() {
  const displays = screen.getAllDisplays();
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const display of displays) {
    const area = display.workArea;
    left = Math.min(left, area.x);
    top = Math.min(top, area.y);
    right = Math.max(right, area.x + area.width);
    bottom = Math.max(bottom, area.y + area.height);
  }
  if (!Number.isFinite(left)) return { x: 0, y: 0, width: 1280, height: 720 };
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Move the window to its current logical position. */
function place() {
  if (window_ === null || window_.isDestroyed()) return;
  window_.setBounds({
    x: Math.round(position.x),
    y: Math.round(position.y),
    width: PET_WIDTH,
    height: PET_HEIGHT,
  });
}

/** Tell the renderer whether the pet is currently running. */
function announceWalk() {
  if (window_ === null || window_.isDestroyed()) return;
  window_.webContents.send('pet:walk', { walking, direction });
}

/**
 * Rest the pet on the floor of whichever display it currently stands on.
 */
function settleOnFloor() {
  const track = trackBounds();
  // Prefer the display the pet is actually near, so it does not jump monitors
  // on startup.
  const display = screen.getDisplayNearestPoint({
    x: Math.round(position.x),
    y: Math.round(position.y),
  });
  const area = display.workArea;
  position.y = area.y + area.height - PET_HEIGHT - 4;
  position.x = Math.min(Math.max(position.x, track.x), track.x + track.width - PET_WIDTH);
}

/** Advance the pet one step, turning around at the ends of the track. */
function step() {
  if (!walking) return;
  const track = trackBounds();
  position.x += direction * STEP_PX;
  const maxX = track.x + track.width - PET_WIDTH;
  if (position.x <= track.x) {
    position.x = track.x;
    direction = 1;
  } else if (position.x >= maxX) {
    position.x = maxX;
    direction = -1;
  }
  place();
}

/** Schedule the next walk-and-rest cycle. */
function scheduleWalk() {
  const rest = REST_MIN_MS + Math.random() * (REST_MAX_MS - REST_MIN_MS);
  setTimeout(() => {
    walking = true;
    announceWalk();
    const duration = WALK_MIN_MS + Math.random() * (WALK_MAX_MS - WALK_MIN_MS);
    setTimeout(() => {
      walking = false;
      announceWalk();
      scheduleWalk();
    }, duration);
  }, rest);
}

/**
 * Create the companion window and point it at the bridge.
 * @param bridge - the resolved loopback port and token.
 */
function createWindow(bridge) {
  address = bridge;
  window_ = new BrowserWindow({
    width: PET_WIDTH,
    height: PET_HEIGHT,
    x: Math.round(position.x),
    y: Math.round(position.y),
    frame: false,
    transparent: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    hasShadow: false,
    // Never steal focus from whatever the user is actually doing.
    focusable: false,
    alwaysOnTop: true,
    webPreferences: {
      preload: join(here, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  // 'screen-saver' keeps the pet above ordinary windows without fighting the
  // Harness window for the foreground.
  window_.setAlwaysOnTop(true, 'screen-saver');

  // Click-through until the pointer is over the character itself.
  window_.setIgnoreMouseEvents(true, { forward: true });

  window_.loadURL(`http://127.0.0.1:${String(bridge.port)}/pet?token=${encodeURIComponent(bridge.token)}`);

  window_.on('closed', () => {
    window_ = null;
  });

  settleOnFloor();
  place();
  announceWalk();
  scheduleWalk();

  ticker = setInterval(step, TICK_MS);

  if (selfShot !== null) {
    window_.webContents.once('did-finish-load', () => {
      // Give the SSE snapshot time to land and the entrance animation to settle,
      // so the capture shows the real resting state rather than an empty frame.
      setTimeout(() => {
        void (async () => {
          try {
            const image = await window_.webContents.capturePage();
            await writeFile(selfShot, image.toPNG());
            console.log(`pet: wrote ${selfShot}`);
          } catch (error) {
            console.error(`pet: capture failed: ${String(error)}`);
          }
          app.exit(0);
        })();
      }, 3500);
    });
  }
}

/**
 * Watch `bridge.json` so a Host restart does not leave the pet frozen.
 */
async function watchBridge() {
  for (;;) {
    const bridge = await readBridge();
    if (bridge !== null) {
      if (address === null) {
        createWindow(bridge);
      } else if (bridge.port !== address.port || bridge.token !== address.token) {
        address = bridge;
        if (window_ !== null && !window_.isDestroyed()) {
          window_.loadURL(
            `http://127.0.0.1:${String(bridge.port)}/pet?token=${encodeURIComponent(bridge.token)}`,
          );
        }
      }
    }
    await new Promise((done) => setTimeout(done, 4000));
  }
}

app.whenReady().then(() => {
  ipcMain.on('pet:interactive', (_event, value) => {
    if (window_ === null || window_.isDestroyed()) return;
    // `forward: true` keeps hover events flowing to this window while clicks
    // pass through, which is what makes "interactive only over the pet" work.
    window_.setIgnoreMouseEvents(value !== true, { forward: true });
  });

  ipcMain.on('pet:quit', () => {
    app.quit();
  });

  screen.on('display-metrics-changed', () => {
    settleOnFloor();
    place();
  });
  screen.on('display-added', () => {
    settleOnFloor();
    place();
  });

  void watchBridge();
});

app.on('window-all-closed', () => {
  if (ticker !== null) clearInterval(ticker);
  app.quit();
});
