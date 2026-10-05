/**
 * Desktop-pet test harness.
 *
 * Runs the REAL Host half against a stub Cordis context and then stays alive, so
 * an Electron pet window has a genuine bridge to connect to. This is what makes
 * the desktop pet testable without installing anything into the Harness profile
 * and without restarting the running application.
 *
 * It also drives one reasoning fragment through the listener, so the captured
 * frame shows the pet reacting rather than an idle default.
 *
 * Usage: node test/desktop-harness.mjs <dsh-home>
 */

import { mkdirSync } from 'node:fs';

const home = process.argv[2];
if (home === undefined || home === '') {
  console.error('usage: node test/desktop-harness.mjs <dsh-home>');
  process.exit(2);
}
process.env.DSH_HOME = home;
mkdirSync(home, { recursive: true });

const { apply } = await import('../index.js');

/** Balance the stub account reports, so the readout has something real to show. */
const account = {
  async getBalance() {
    return {
      status: 'ready',
      value: [{ currency: 'CNY', balance: '42.5' }],
      bonusWallets: [{ currency: 'CNY', balance: '8.25' }],
    };
  },
};

const disposers = [];
const listeners = new Map();
const context = {
  effect(body) {
    const dispose = body();
    if (typeof dispose === 'function') disposers.push(dispose);
    return dispose;
  },
  on(event, handler) {
    listeners.set(event, handler);
    return () => listeners.delete(event);
  },
  get(name) {
    return name === 'deepseekAccount' ? account : undefined;
  },
};

// Idle chatter is on so the capture can show a speech bubble, with a short delay
// so it does not fire before the window has painted.
apply(context, { idleChatter: true, idleMinMs: 20_000, idleMaxMs: 30_000 });

// Drive a "this path is a dead end" situation once, which the pet turns into a
// confused face plus a line about the road not going anywhere.
setTimeout(() => {
  const handler = listeners.get('agent/assistant-stream');
  if (typeof handler !== 'function') return;
  handler({ frame: { type: 'start' } });
  handler({
    frame: { type: 'chunk', chunk: { type: 'reasoning-delta', index: 0, text: '我先沿着这条路走,但' } },
  });
  handler({
    frame: {
      type: 'chunk',
      chunk: { type: 'reasoning-delta', index: 0, text: '这条路走不通,得换个方案才行' },
    },
  });
}, 900);

console.log('desktop harness ready');

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    for (const dispose of disposers) dispose();
    process.exit(0);
  });
}

// Keep the process (and therefore the bridge) alive for the Electron window.
setInterval(() => {}, 60_000);
