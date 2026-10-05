/**
 * Desktop pet renderer.
 *
 * Runs inside a transparent, frameless, always-on-top window, so it draws only
 * the character, its balance readout and its speech bubble - there is no page
 * background to paint and no Harness theme to inherit.
 *
 * The character comes from `./character.js`, which is the SAME module the Host
 * half serves and uses. That is deliberate: 24 faces drawn twice would drift,
 * and a pet whose face differs between the Harness window and the desktop is a
 * bug nobody would think to look for.
 */

import { SITUATION_FACE, characterSvg } from './character.js';

const params = new URLSearchParams(window.location.search);
const token = params.get('token') ?? '';

const nodes = {
  pet: document.getElementById('pet'),
  amount: document.getElementById('amount'),
  stageName: document.getElementById('stage-name'),
  bubble: document.getElementById('bubble'),
};

/** The face currently requested by the Host snapshot. */
let situationFace = 'idle';
/** Overridden to `running` while the main process walks the window. */
let walking = false;
/** Skin chosen in the Harness settings page, mirrored onto the desktop pet. */
let skin = 'deepseek';
/** Timestamp of the bubble being shown, so a repeated line does not re-render. */
let shownSpeechAt = null;

/**
 * Repaint the character.
 * @param expression - expression name to draw.
 */
function paint(expression) {
  nodes.pet.innerHTML = characterSvg(skin, expression, 96);
}

/**
 * Apply one snapshot from the Host bridge.
 * @param snapshot - the parsed snapshot.
 */
function apply(snapshot) {
  if (snapshot === null || typeof snapshot !== 'object') return;
  situationFace = SITUATION_FACE[snapshot.thinking?.situation] ?? 'idle';

  const primary = snapshot.balance?.primary ?? null;
  nodes.amount.textContent =
    snapshot.balance?.ready === true && primary !== null ? primary.totalText : '—';

  const peak = snapshot.peak?.active === true;
  const label = snapshot.texts?.stageName ?? '';
  nodes.stageName.textContent = peak ? `×2 ${label}` : label;
  nodes.stageName.className = `stageName ${peak ? 'peak' : 'off'}`;

  const speech = snapshot.speech ?? null;
  if (speech !== null && speech.at !== shownSpeechAt) {
    shownSpeechAt = speech.at;
    nodes.bubble.textContent = speech.text;
    nodes.bubble.classList.toggle('peak', peak);
    nodes.bubble.hidden = false;
    // The warning is a reminder the user asked for, so it stays long enough to
    // read but does not pile up on the desktop forever.
    window.setTimeout(() => {
      if (shownSpeechAt === speech.at) nodes.bubble.hidden = true;
    }, 9000);
  }

  paint(walking ? 'running' : situationFace);
}

/* -------------------------------------------------------------- bridge link */

let source = null;
let retry = null;

/** Subscribe to the Host bridge, retrying while the Host is starting up. */
function connect() {
  if (source !== null) source.close();
  source = new EventSource(`/events?token=${encodeURIComponent(token)}`);

  const accept = (event) => {
    try {
      apply(JSON.parse(event.data));
    } catch {
      // A malformed frame must not blank the pet.
    }
  };
  for (const name of ['snapshot', 'peak', 'speech', 'hello', 'thinking']) {
    source.addEventListener(name, accept);
  }
  source.onerror = () => {
    // A Host restart closes the stream; the browser's own reconnect is not
    // enough because the port may have changed, so the main process reloads
    // this window when bridge.json changes.
    if (retry === null) {
      retry = window.setTimeout(() => {
        retry = null;
        connect();
      }, 5000);
    }
  };
}

connect();

/* ------------------------------------------------------- desktop integration */

const desktop = globalThis.petDesktop ?? null;

if (desktop !== null) {
  desktop.onWalk((state) => {
    walking = state?.walking === true;
    paint(walking ? 'running' : situationFace);
  });

  // Click-through by default: the pet must not eat clicks meant for whatever is
  // underneath it. The main process re-enables input while the pointer is over
  // the character, which is the only part the user can interact with.
  const interactive = (value) => desktop.setInteractive(value);
  nodes.pet.addEventListener('mouseenter', () => interactive(true));
  nodes.pet.addEventListener('mouseleave', () => interactive(false));
  nodes.bubble.addEventListener('mouseenter', () => interactive(true));
  nodes.bubble.addEventListener('mouseleave', () => interactive(false));

  nodes.pet.addEventListener('click', () => {
    nodes.bubble.hidden = false;
    nodes.bubble.textContent = '点击我有什么用,我又不会写代码…要不你去问问 DSH?';
    window.setTimeout(() => {
      nodes.bubble.hidden = true;
    }, 6000);
  });

  // Double-click closes the companion; the Harness settings page can bring it
  // back, so this is not a one-way door.
  nodes.pet.addEventListener('dblclick', () => desktop.quit());
}

paint('idle');
