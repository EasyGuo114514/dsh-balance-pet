/**
 * Host-half integration check.
 *
 * This runs the REAL `apply()` from index.js against a stub Cordis context and
 * then talks to the REAL bridge over HTTP. That matters: the alternative is to
 * install the plugin into the profile and restart DeepSeek Harness, and a
 * restart ends the very session doing the testing. Exercising the same code path
 * against a stub keeps the feedback loop honest without that cost.
 *
 * What this proves: the plugin mounts, the bridge binds with a token, an
 * unauthenticated caller is refused, the snapshot carries real peak/balance
 * data, a `hello` from the desktop pet is recorded, SSE frames arrive, and a
 * reasoning stream split across several deltas is classified end to end.
 *
 * What this does NOT prove: how any of it looks on screen. That still needs a
 * human looking at the running GUI.
 *
 * Usage: node test/host.mjs
 */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let passed = 0;
const failures = [];

/**
 * Run one named async assertion group.
 * @param name - what the group proves.
 * @param body - the assertions.
 */
async function check(name, body) {
  try {
    await body();
    passed += 1;
  } catch (error) {
    failures.push({ name, error });
  }
}

/** Wait until a predicate holds, or give up. @returns whether it held. */
async function waitFor(predicate, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      if (await predicate()) return true;
    } catch {
      // Not ready yet.
    }
    if (Date.now() > deadline) return false;
    await new Promise((done) => setTimeout(done, 40));
  }
}

const home = await mkdtemp(join(tmpdir(), 'balance-pet-host-'));
process.env.DSH_HOME = home;

const { apply } = await import('../index.js');

/** Balance the fake account provider reports. */
const balanceCalls = [];
const account = {
  async getBalance(metadata) {
    balanceCalls.push(metadata);
    return {
      status: 'ready',
      value: [{ currency: 'CNY', balance: '12.5' }],
      bonusWallets: [{ currency: 'CNY', balance: '3.25' }],
    };
  },
};

/** Every request the pet's chat path sent, so the routing can be asserted. */
const chatRequests = [];

/**
 * Stub model service.
 *
 * Shaped like the real one: an async iterable of token-level chunks ending in a
 * terminal `finish`, which is what `ctx.llm.stream` yields.
 */
const llm = {
  stream(request) {
    chatRequests.push(request);
    const chunks = [
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: '余额还够,' },
      { type: 'text-delta', index: 0, text: '放心用。' },
      { type: 'finish', kind: 'stop' },
    ];
    return {
      async *[Symbol.asyncIterator]() {
        for (const chunk of chunks) yield chunk;
      },
    };
  },
};

/** Minimal stand-in for the Cordis context surface index.js actually uses. */
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
    if (name === 'deepseekAccount') return account;
    if (name === 'llm') return llm;
    return undefined;
  },
};

// A small budget so the same suite can prove the ceiling actually holds. The
// chat assertions below are ordered to spend it deliberately: one successful
// call, one that fails inside the provider, then one that must be refused.
apply(context, { peakTickMs: 5000, balanceTickMs: 10000, idleChatter: false, chatMaxPerHour: 2 });

const stateDir = join(home, 'balance-pet');
const bridgeFile = join(stateDir, 'bridge.json');

const started = await waitFor(async () => {
  const raw = await readFile(bridgeFile, 'utf8');
  return JSON.parse(raw).port > 0;
});

let bridge = { port: 0, token: '' };
if (started) bridge = JSON.parse(await readFile(bridgeFile, 'utf8'));

const base = `http://127.0.0.1:${String(bridge.port)}`;
const authorized = { headers: { 'x-balance-pet-token': bridge.token } };

/** Read the current snapshot over the bridge. @returns the parsed snapshot. */
async function snapshot() {
  const response = await fetch(`${base}/state`, authorized);
  assert.equal(response.status, 200);
  return response.json();
}

await check('host: the bridge writes its address and binds loopback', async () => {
  assert.equal(started, true, 'bridge.json never appeared');
  assert.ok(bridge.port > 0);
  assert.equal(typeof bridge.token, 'string');
  assert.ok(bridge.token.length >= 32, 'the token must not be guessable');
});

await check('host: an unauthenticated caller is refused', async () => {
  const response = await fetch(`${base}/state`);
  assert.equal(response.status, 401);
  const wrong = await fetch(`${base}/state`, { headers: { 'x-balance-pet-token': 'nope' } });
  assert.equal(wrong.status, 401);
});

await check('host: the snapshot carries the peak verdict and its wording', async () => {
  const state = await snapshot();
  assert.equal(state.version, 1);
  assert.equal(typeof state.peak.peak, 'boolean');
  assert.equal(typeof state.peak.official, 'boolean');
  assert.equal(typeof state.peak.reasonText, 'string');
  assert.ok(state.peak.reasonText.length > 0);
  assert.ok(['peak-window', 'weekend', 'holiday', 'off-hours', 'makeup-workday'].includes(state.peak.reason));
  assert.equal(state.peak.holidayData.through, 2026);
  assert.ok(Array.isArray(state.balance.wallets));
});

await check('host: peak arithmetic agrees with the shared module', async () => {
  const { peakStateAt } = await import('../shared/peak.js');
  const state = await snapshot();
  const expected = peakStateAt(new Date(state.generatedAt), undefined);
  assert.equal(state.peak.peak, expected.peak);
  assert.equal(state.peak.reason, expected.reason);
});

await check('host: the account metadata reports this machine, not a default', async () => {
  assert.ok(balanceCalls.length > 0, 'getBalance was never called');
  const metadata = balanceCalls.at(-1);
  assert.equal(typeof metadata.version, 'string');
  assert.equal(metadata.locale, 'zh-CN');
  // Seconds east of UTC, and this machine must not report exactly zero unless
  // it really is on UTC - a sign error here is the classic inverted-peak bug.
  assert.equal(typeof metadata.timezoneOffsetSeconds, 'number');
  assert.equal(metadata.timezoneOffsetSeconds, -new Date().getTimezoneOffset() * 60);
});

await check('host: the live balance is summarized, not passed through raw', async () => {
  const state = await snapshot();
  assert.equal(state.balance.ready, true);
  assert.equal(state.balance.primary.totalText, '¥15.75');
  assert.equal(state.balance.primary.normalText, '¥12.50');
  assert.equal(state.balance.hasCredit, true);
  assert.equal(state.balanceError, null);
});

await check('host: a desktop pet announcing itself is recorded', async () => {
  const response = await fetch(`${base}/hello`, {
    method: 'POST',
    headers: { ...authorized.headers, 'content-type': 'application/json' },
    body: JSON.stringify({ source: 'desktop' }),
  });
  assert.equal(response.status, 200);
  const state = await snapshot();
  assert.equal(typeof state.bridge.clients.desktop, 'string');
});

await check('host: the in-window client announcing itself is recorded too', async () => {
  const response = await fetch(`${base}/hello`, {
    method: 'POST',
    headers: { ...authorized.headers, 'content-type': 'application/json' },
    body: JSON.stringify({ source: 'client' }),
  });
  assert.equal(response.status, 200);
  const state = await snapshot();
  assert.equal(typeof state.bridge.clients.client, 'string');
});

await check('host: a command can make the pet speak', async () => {
  const response = await fetch(`${base}/say`, {
    method: 'POST',
    headers: { ...authorized.headers, 'content-type': 'application/json' },
    body: JSON.stringify({ text: '这是一句测试台词' }),
  });
  assert.equal(response.status, 200);
  const state = await snapshot();
  assert.equal(state.speech.text, '这是一句测试台词');
  assert.equal(state.speech.kind, 'manual');
});

await check('host: a malformed body is rejected without killing the bridge', async () => {
  const response = await fetch(`${base}/say`, {
    method: 'POST',
    headers: { ...authorized.headers, 'content-type': 'application/json' },
    body: '{not json',
  });
  assert.equal(response.status, 400);
  const state = await snapshot();
  assert.equal(state.version, 1, 'the bridge must still answer afterwards');
});

await check('host: unknown routes answer 404 rather than hanging', async () => {
  const response = await fetch(`${base}/nope`, authorized);
  assert.equal(response.status, 404);
});

await check('host: the desktop pet page and its modules are served', async () => {
  // The desktop window is opened by URL navigation, so these must be reachable
  // WITHOUT the token header - they are the window's own code, not data.
  for (const path of ['/pet', '/pet/pet.css', '/pet/pet.js', '/pet/character.js']) {
    const response = await fetch(`${base}${path}`);
    assert.equal(response.status, 200, `${path} was not served`);
    const body = await response.text();
    assert.ok(body.length > 0, `${path} is empty`);
  }
  const html = await (await fetch(`${base}/pet`)).text();
  assert.ok(html.includes('/pet/pet.js'), 'the page does not load its module');
  const character = await (await fetch(`${base}/pet/character.js`)).text();
  assert.ok(character.includes('export function characterSvg'), 'the shared character module is not the real one');
});

await check('host: an unauthenticated data request is still refused', async () => {
  // Serving static assets openly must not have opened up the account data.
  assert.equal((await fetch(`${base}/state`)).status, 401);
  assert.equal((await fetch(`${base}/events`)).status, 401);
});

await check('host: a loopback page origin is allowed through CORS', async () => {
  // Without this the DSH page (port 19387) could never read the bridge (its own
  // port): the browser would block both the fetch and the SSE stream.
  const origin = 'http://127.0.0.1:19387';
  const response = await fetch(`${base}/state`, {
    headers: { ...authorized.headers, origin },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), origin);
  assert.equal(response.headers.get('vary'), 'Origin');
});

await check('host: the preflight is answered without the token', async () => {
  // The browser sends OPTIONS before the real request and cannot attach the
  // custom header, so a 401 here would silently break every bridge call.
  const response = await fetch(`${base}/state`, {
    method: 'OPTIONS',
    headers: { origin: 'http://127.0.0.1:19387', 'access-control-request-headers': 'x-balance-pet-token' },
  });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), 'http://127.0.0.1:19387');
});

await check('host: a non-loopback origin gets no CORS grant', async () => {
  const response = await fetch(`${base}/state`, {
    headers: { ...authorized.headers, origin: 'https://example.com' },
  });
  assert.equal(response.headers.get('access-control-allow-origin'), null);
});

await check('host: the page bootstrap carries the address AND the token', async () => {
  const handler = listeners.get('webserver/index-inject');
  assert.equal(typeof handler, 'function', 'the inject hook was never registered');
  const table = [];
  handler(table);
  const entry = table.find((row) => row.name === '__DSH_BALANCE_PET__');
  assert.ok(entry !== undefined, 'the client half cannot reach the bridge without this global');
  assert.equal(entry.value.port, bridge.port);
  assert.equal(entry.value.token, bridge.token);
  assert.equal(entry.value.version, 1);
});

await check('host: the SSE stream opens with a full snapshot frame', async () => {
  const abort = new AbortController();
  const response = await fetch(`${base}/events`, { ...authorized, signal: abort.signal });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'text/event-stream');
  const reader = response.body.getReader();
  const first = await reader.read();
  abort.abort();
  const text = new TextDecoder().decode(first.value);
  assert.ok(text.startsWith('event: snapshot\n'), `unexpected frame: ${text.slice(0, 40)}`);
  const payload = JSON.parse(text.split('data: ')[1].split('\n')[0]);
  assert.equal(payload.version, 1);
});

await check('host: a reasoning stream split across deltas drives the pet', async () => {
  const handler = listeners.get('agent/assistant-stream');
  assert.equal(typeof handler, 'function', 'the reasoning listener was never registered');
  // A fresh attempt resets the rolling buffer.
  handler({ frame: { type: 'start' } });
  // The phrase arrives in fragments, exactly as the real stream delivers it;
  // classifying one fragment alone would never match the keyword.
  for (const fragment of ['我先看看这条', '路,感觉', '这条路走不通,得换方案']) {
    handler({ frame: { type: 'chunk', chunk: { type: 'reasoning-delta', index: 0, text: fragment } } });
  }
  const state = await snapshot();
  assert.equal(state.thinking.situation, 'dead-end');
  assert.ok(state.thinking.excerpt.includes('走不通'));
  assert.equal(state.mood, 'dead-end');
});

await check('host: unrelated chunks are ignored, not misclassified', async () => {
  const handler = listeners.get('agent/assistant-stream');
  handler({ frame: { type: 'start' } });
  // A text delta is model output, not reasoning, and must not move the pet's face.
  handler({ frame: { type: 'chunk', chunk: { type: 'text-delta', index: 0, text: '报错 报错 报错' } } });
  const state = await snapshot();
  assert.notEqual(state.thinking.situation, 'error');
});

await check('host: the pet talks to its own model and the reply is spoken', async () => {
  const response = await fetch(`${base}/chat`, {
    method: 'POST',
    headers: { ...authorized.headers, 'content-type': 'application/json' },
    body: JSON.stringify({ text: '我余额还够吗' }),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.text, '余额还够,放心用。');

  const state = await snapshot();
  assert.equal(state.speech.text, '余额还够,放心用。');
  assert.equal(state.speech.kind, 'chat');
});

await check('host: the chat call routes exactly as configured, thinking off', async () => {
  assert.ok(chatRequests.length > 0, 'the model service was never called');
  const request = chatRequests.at(-1);
  assert.equal(request.provider, 'ds');
  assert.equal(request.model, 'deepseek-v4-flash:free');
  // The user asked for thinking to be off: these are one-line quips and a
  // reasoning pass would cost more than the answer.
  assert.equal(request.reasoningEffort, 'off');
  assert.equal(request.messages.length, 1);
  const text = request.messages[0].content[0].text;
  assert.ok(text.includes('余额小人'), 'the persona is missing from the prompt');
  assert.ok(text.includes('我余额还够吗'), 'the user text was not forwarded');
});

await check('host: an empty chat message is rejected before spending anything', async () => {
  const response = await fetch(`${base}/chat`, {
    method: 'POST',
    headers: { ...authorized.headers, 'content-type': 'application/json' },
    body: JSON.stringify({ text: '   ' }),
  });
  assert.equal(response.status, 400);
});

await check('host: a failing model service degrades instead of breaking the bridge', async () => {
  // Swap in a stream that throws, and give the budget back so it is reached.
  const original = llm.stream;
  llm.stream = () => ({
    async *[Symbol.asyncIterator]() {
      yield { type: 'text-delta', index: 0, text: '半句' };
      throw new Error('provider exploded');
    },
  });
  const response = await fetch(`${base}/chat`, {
    method: 'POST',
    headers: { ...authorized.headers, 'content-type': 'application/json' },
    body: JSON.stringify({ text: '在吗' }),
  });
  llm.stream = original;
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.equal(body.error, 'stream-failed');
  // The bridge must still answer normally afterwards.
  const state = await snapshot();
  assert.equal(state.version, 1);
});

await check('host: the pet chat is rate-limited, because it spends the balance shown', async () => {
  // Two calls have now been spent (one successful, one that failed inside the
  // provider). A stream that fails still costs an attempt, so it counts.
  const before = chatRequests.length;
  const response = await fetch(`${base}/chat`, {
    method: 'POST',
    headers: { ...authorized.headers, 'content-type': 'application/json' },
    body: JSON.stringify({ text: '再来一句' }),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.equal(body.error, 'rate-limited');
  // And it must not have reached the provider.
  assert.equal(chatRequests.length, before, 'a refused call still hit the provider');
});

await check('host: the peak snapshot exposes a countdown target', async () => {
  const state = await snapshot();
  if (state.peak.nextChangeAt === null) return;
  const delta = new Date(state.peak.nextChangeAt).getTime() - new Date(state.generatedAt).getTime();
  assert.ok(delta > 0, 'the next change must be in the future');
  assert.ok(delta <= 14 * 24 * 3600 * 1000, 'and inside the search bound');
  // Every transition is hour-aligned, so the target must land on the hour.
  assert.equal(new Date(state.peak.nextChangeAt).getUTCMinutes(), 0);
});

/* ---------------------------------------------------------------- teardown */

await check('host: disposal stops the bridge and clears its timers', async () => {
  for (const dispose of disposers) dispose();
  const alive = await waitFor(async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 300);
    try {
      await fetch(`${base}/state`, { ...authorized, signal: controller.signal });
      return false;
    } catch {
      return true;
    } finally {
      clearTimeout(timer);
    }
  }, 3000);
  assert.equal(alive, true, 'the bridge kept serving after disposal');
});

await rm(home, { recursive: true, force: true }).catch(() => {});

// Let the server socket finish closing before the process ends. Calling
// process.exit() while an async handle is mid-close trips a libuv assertion on
// Windows, which would report a clean run as a crash.
await new Promise((done) => setTimeout(done, 300));

const total = passed + failures.length;
if (failures.length === 0) {
  console.log(`dsh-balance-pet host check: ${String(passed)}/${String(total)} passed`);
  process.exit(0);
}
console.error(
  `dsh-balance-pet host check: ${String(passed)}/${String(total)} passed, ${String(failures.length)} FAILED\n`,
);
for (const { name, error } of failures) {
  console.error(`FAIL  ${name}`);
  console.error(`      ${String(error.message).split('\n').join('\n      ')}\n`);
}
process.exit(1);
