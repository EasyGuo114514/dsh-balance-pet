/**
 * Host half of dsh-balance-pet: the single source of truth.
 *
 * WHY THE HOST OWNS THE NUMBERS
 * The peak/off-peak verdict depends on a UTC clock *and* a Chinese holiday
 * calendar, and the balance comes from an authenticated Platform call. If each
 * surface computed its own answer they would drift - the in-window pet, the
 * desktop pet and the settings page would disagree about whether the user is
 * being charged double. So this half computes once, and the Client half and the
 * standalone desktop pet both consume the same snapshot over a loopback bridge.
 *
 * THE BRIDGE
 * A `node:http` server bound to 127.0.0.1 on an ephemeral port, guarded by a
 * per-install random token written to `$DSH_HOME/balance-pet/bridge.json`.
 * The token matters even on loopback: any page in the user's browser can reach
 * 127.0.0.1, and the balance is private. The desktop pet reads that file; the
 * in-window Client half receives the same pair through the page-bootstrap global
 * (`webserver/index-inject`), because a browser page cannot read files.
 *
 * API KEYS NEVER CROSS THE BRIDGE. The desktop pet gets numbers and sentences,
 * never credentials, and it makes no Platform calls of its own.
 *
 * @module @local/dsh-balance-pet
 */

import { randomBytes } from 'node:crypto';
import { appendFile, writeFile } from 'node:fs/promises';
import { mkdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { summarizeBalance } from './shared/budget.js';
import { HOLIDAY_DATA_SOURCE, HOLIDAY_DATA_THROUGH } from './shared/holidays.js';
import { PEAK_MULTIPLIER, describeReason, localWindowLabels, peakStateAt } from './shared/peak.js';
import { classifySituation } from './shared/situation.js';
import { PEAK_WARNING_LINES, pickIdleLine, pickSituationLine, stageName } from './shared/lines.js';

/** Stable Cordis plugin name; must match the patch row's `id`. */
export const name = 'balance-pet';

/**
 * Optional services. Every one of these is feature-detected rather than
 * required, so the plugin still mounts (showing peak state and a clear
 * "balance unavailable" badge) in a profile without an account provider - a
 * missing sibling must not take the whole plugin down.
 */
export const inject = [];

/** Page-bootstrap global carrying the bridge address to the Client half. */
const BRIDGE_GLOBAL = '__DSH_BALANCE_PET__';

/** Snapshot envelope version. Bump when the shape changes incompatibly. */
const SNAPSHOT_VERSION = 1;

/** How often the peak verdict is recomputed, in milliseconds. */
const PEAK_TICK_MS = 30_000;

/** How often the balance is re-read, in milliseconds. */
const BALANCE_TICK_MS = 60_000;

/** Idle-chatter delay bounds, in milliseconds. */
const IDLE_MIN_MS = 90_000;
const IDLE_MAX_MS = 240_000;

/** How much reasoning text is retained for the pet to react to. */
const THINKING_TAIL_CHARS = 400;

/* --------------------------------------------------------------- utilities */

/**
 * Resolve the Harness home directory.
 *
 * @returns the absolute path to `$DSH_HOME` (default `~/.dsh`).
 */
function resolveDshHome() {
  const fromEnv = process.env.DSH_HOME;
  return fromEnv !== undefined && fromEnv !== '' ? fromEnv : join(homedir(), '.dsh');
}

/**
 * The user's offset east of UTC in minutes.
 *
 * `getTimezoneOffset()` returns the opposite sign, which is a classic source of
 * inverted peak labels, so the negation happens in exactly one place.
 *
 * @param date - instant to read the offset for.
 * @returns offset in minutes (UTC+8 -> 480).
 */
function localOffsetMinutes(date) {
  return -date.getTimezoneOffset();
}

/**
 * Local calendar date as `YYYY-MM-DD`.
 *
 * @param date - instant to render.
 * @returns the local date key.
 */
function localDateKey(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Read the plugin's row config with defaults applied.
 *
 * Deliberately hand-rolled: this package lives outside the profile's
 * `node_modules`, so importing the Host's schema library would depend on module
 * resolution the plugin does not control. Plain validation cannot break that way.
 *
 * @param raw - the patch row's `config`, if any.
 * @returns resolved configuration.
 */
function resolveConfig(raw) {
  const source = raw !== null && typeof raw === 'object' ? raw : {};
  const number = (value, fallback) =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  const boolean = (value, fallback) => (typeof value === 'boolean' ? value : fallback);
  const holidays =
    source.holidays !== null && typeof source.holidays === 'object' ? source.holidays : undefined;
  return {
    /** `official` (DeepSeek API pricing) or `off` to hide peak warnings entirely. */
    peakScope: source.peakScope === 'off' ? 'off' : 'official',
    /** Promote a weekend makeup workday (调休补班) to a weekday for billing. */
    treatMakeupWorkdaysAsWeekday: boolean(source.treatMakeupWorkdaysAsWeekday, false),
    /** Warn while the user is about to send during peak. */
    warnOnPeak: boolean(source.warnOnPeak, true),
    /** Holiday overrides merged over the built-in table. */
    holidays,
    peakTickMs: Math.max(5_000, number(source.peakTickMs, PEAK_TICK_MS)),
    balanceTickMs: Math.max(10_000, number(source.balanceTickMs, BALANCE_TICK_MS)),
    /** Idle chatter. Off by default would defeat the point, so it is on. */
    idleChatter: boolean(source.idleChatter, true),
    idleMinMs: Math.max(20_000, number(source.idleMinMs, IDLE_MIN_MS)),
    idleMaxMs: Math.max(30_000, number(source.idleMaxMs, IDLE_MAX_MS)),
    /** React to the agent's reasoning stream. */
    reactToThinking: boolean(source.reactToThinking, true),
    /** Never inject anything into the conversation unless explicitly enabled. */
    injectIntoConversation: boolean(source.injectIntoConversation, false),
    /** Model route for the pet's own dialogue. */
    chatProvider: typeof source.chatProvider === 'string' ? source.chatProvider : 'ds',
    chatModel: typeof source.chatModel === 'string' ? source.chatModel : 'deepseek-v4-flash:free',
    /** Keep thinking off: these are one-line quips, not tasks. */
    chatReasoningEffort: typeof source.chatReasoningEffort === 'string' ? source.chatReasoningEffort : 'off',
    /** Hard ceiling on pet LLM calls per hour, so a bug cannot drain the balance. */
    chatMaxPerHour: Math.max(0, number(source.chatMaxPerHour, 40)),
  };
}

/**
 * A loopback page origin, e.g. `http://127.0.0.1:19387`.
 *
 * The bridge listens on its own port, so the DSH page is cross-origin to it and
 * the browser would refuse both the snapshot fetch and the SSE stream without
 * these headers. Only loopback origins are reflected: a public page must never
 * be able to read the user's balance.
 */
const LOOPBACK_ORIGIN = /^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/u;

/**
 * Build CORS headers for one request.
 *
 * @param request - incoming request.
 * @returns headers to merge into the response, empty for a non-loopback origin.
 */
function corsHeaders(request) {
  const origin = request.headers.origin;
  if (typeof origin !== 'string' || !LOOPBACK_ORIGIN.test(origin)) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-headers': 'content-type, x-balance-pet-token',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-max-age': '600',
    vary: 'Origin',
  };
}

/** This package's directory, for locating the desktop pet's assets. */
const MODULE_ROOT = dirname(fileURLToPath(import.meta.url));

/**
 * Static assets served to the desktop pet window.
 *
 * An explicit map rather than a directory handler: a path-joining static server
 * is a directory-traversal bug waiting to happen, and there are only four files.
 * `character.js` is served from `shared/`, so the desktop window draws with the
 * very same module the Host uses instead of keeping a second copy of 24 faces.
 */
const ASSETS = new Map([
  ['/pet', { file: join(MODULE_ROOT, 'desktop', 'pet.html'), type: 'text/html; charset=utf-8' }],
  ['/pet/pet.css', { file: join(MODULE_ROOT, 'desktop', 'pet.css'), type: 'text/css; charset=utf-8' }],
  ['/pet/pet.js', { file: join(MODULE_ROOT, 'desktop', 'pet.js'), type: 'text/javascript; charset=utf-8' }],
  [
    '/pet/character.js',
    { file: join(MODULE_ROOT, 'shared', 'character.js'), type: 'text/javascript; charset=utf-8' },
  ],
]);

/* ------------------------------------------------------------------- bridge */

/**
 * Start the loopback bridge.
 *
 * @param options - token, snapshot reader and command handler.
 * @returns the bound port and a disposer.
 */
function startBridge(options) {
  const clients = new Set();

  /**
   * Push one frame to every open SSE subscriber.
   * @param event - event name.
   * @param payload - JSON-serializable body.
   */
  const broadcast = (event, payload) => {
    const frame = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const response of clients) {
      try {
        response.write(frame);
      } catch {
        // A dead subscriber is removed by its own 'close' handler; a write
        // failure here must never break the snapshot loop.
        clients.delete(response);
      }
    }
  };

  /**
   * Reject a request that does not carry the bridge token.
   * @param request - incoming request.
   * @param url - parsed URL.
   * @returns whether the caller is authorized.
   */
  const authorized = (request, url) => {
    const header = request.headers['x-balance-pet-token'];
    if (typeof header === 'string' && header === options.token) return true;
    return url.searchParams.get('token') === options.token;
  };

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const cors = corsHeaders(request);

    // Preflight first: the browser sends OPTIONS without the custom token
    // header, so answering it after the auth check would always return 401 and
    // the real request would never be sent.
    if (request.method === 'OPTIONS') {
      response.writeHead(204, cors);
      response.end();
      return;
    }

    // Static assets are served without the token on purpose. They are the
    // window's own code, contain no account data, and the desktop window is
    // opened by URL navigation, which cannot attach a custom header. They are
    // also read per request so an edit shows up on reload.
    if (request.method === 'GET' && ASSETS.has(url.pathname)) {
      const asset = ASSETS.get(url.pathname);
      try {
        const body = readFileSync(asset.file);
        response.writeHead(200, { ...cors, 'content-type': asset.type, 'cache-control': 'no-store' });
        response.end(body);
      } catch (error) {
        response.writeHead(500, { ...cors, 'content-type': 'application/json' });
        response.end(JSON.stringify({ ok: false, error: String(error?.message ?? error) }));
      }
      return;
    }

    if (!authorized(request, url)) {
      response.writeHead(401, { ...cors, 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: false, error: 'unauthorized' }));
      return;
    }

    if (request.method === 'GET' && url.pathname === '/state') {
      const body = JSON.stringify(options.readSnapshot());
      response.writeHead(200, {
        ...cors,
        'content-type': 'application/json',
        'cache-control': 'no-store',
      });
      response.end(body);
      return;
    }

    if (request.method === 'GET' && url.pathname === '/events') {
      response.writeHead(200, {
        ...cors,
        'content-type': 'text/event-stream',
        'cache-control': 'no-store',
        connection: 'keep-alive',
      });
      response.write(`event: snapshot\ndata: ${JSON.stringify(options.readSnapshot())}\n\n`);
      clients.add(response);
      request.on('close', () => clients.delete(response));
      return;
    }

    if (request.method === 'POST') {
      let body = '';
      request.setEncoding('utf8');
      request.on('data', (chunk) => {
        // Bound the body: this is a local convenience endpoint, not a service.
        if (body.length < 64 * 1024) body += chunk;
      });
      request.on('end', () => {
        let payload = {};
        if (body !== '') {
          try {
            payload = JSON.parse(body);
          } catch {
            response.writeHead(400, { ...cors, 'content-type': 'application/json' });
            response.end(JSON.stringify({ ok: false, error: 'bad-json' }));
            return;
          }
        }
        const result = options.onCommand(url.pathname, payload);
        response.writeHead(result.status, { ...cors, 'content-type': 'application/json' });
        response.end(JSON.stringify(result.body));
      });
      return;
    }

    response.writeHead(404, { ...cors, 'content-type': 'application/json' });
    response.end(JSON.stringify({ ok: false, error: 'not-found' }));
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      resolve({
        port,
        broadcast,
        close: () =>
          new Promise((done) => {
            for (const response of clients) {
              try {
                response.end();
              } catch {
                // Already gone.
              }
            }
            clients.clear();
            server.close(() => done());
          }),
      });
    });
  });
}

/* --------------------------------------------------------------- the plugin */

/**
 * Mount the plugin: start the bridge, then keep the snapshot current.
 *
 * @param ctx - Cordis plugin context.
 * @param rawConfig - the patch row's `config`.
 */
export function apply(ctx, rawConfig) {
  const config = resolveConfig(rawConfig);
  const stateDir = join(resolveDshHome(), 'balance-pet');
  const logPath = join(stateDir, 'bridge.log');

  // Created synchronously, and before the first log call: this file is the only
  // evidence a post-restart session has that the plugin mounted at all, so it
  // must not be lost to a race with the async bridge startup.
  try {
    mkdirSync(stateDir, { recursive: true });
  } catch {
    // A read-only home is survivable: logging degrades to the console.
  }

  /** Records a line for post-restart diagnosis; never throws. */
  const log = (message) => {
    const line = `${new Date().toISOString()} ${message}\n`;
    try {
      console.log(`[balance-pet] ${message}`);
    } catch {
      // Console can be closed during teardown.
    }
    appendFile(logPath, line).catch(() => {});
  };

  let bridge;
  /** Bridge token, hoisted so the page-bootstrap hook can read it too. */
  let bridgeToken = '';
  let disposers = [];
  let disposed = false;

  /** Latest values, replaced (not mutated) so consumers see a new object. */
  let balance = summarizeBalance(undefined);
  let balanceError = null;
  let thinking = { situation: 'idle', excerpt: '', at: null };
  let speech = null;
  let mood = 'idle';
  let clientMounts = { client: null, desktop: null };
  /**
   * Most recently seen Session id.
   *
   * The settings page needs one to call `session.selectModel`, and a root-scoped
   * settings slot is not given a session by the framework. The Host can see
   * agents, so it reports the id instead of the Client guessing.
   */
  let activeSessionId = null;

  const rebuildSnapshot = () => {
    const now = new Date();
    const offset = localOffsetMinutes(now);
    const peak = peakStateAt(now, {
      holidays: config.holidays,
      treatMakeupWorkdaysAsWeekday: config.treatMakeupWorkdaysAsWeekday,
    });
    const scope = config.peakScope;
    const effectivePeak = scope === 'off' ? false : peak.peak;
    return {
      version: SNAPSHOT_VERSION,
      generatedAt: now.toISOString(),
      localDate: localDateKey(now),
      localOffsetMinutes: offset,
      peak: {
        ...peak,
        // `peak` is the raw official verdict; `active` is what the UI should
        // show once the user's scope choice is applied. Keeping both means a
        // user who turns warnings off can still see the real state.
        official: peak.peak,
        active: effectivePeak,
        multiplier: effectivePeak ? PEAK_MULTIPLIER : 1,
        scope,
        reasonText: describeReason(peak, offset),
        nextChangeInMs:
          peak.nextChangeAt === null
            ? null
            : new Date(peak.nextChangeAt).getTime() - now.getTime(),
        holidayData: {
          source: HOLIDAY_DATA_SOURCE,
          through: HOLIDAY_DATA_THROUGH,
          covers: peak.dataCovers,
        },
      },
      balance,
      balanceError,
      thinking,
      speech,
      mood,
      activeSessionId,
      // Rule-derived wording is computed here so the in-window pet and the
      // desktop pet phrase the same state identically, instead of each owning a
      // half-copy of the peak logic.
      texts: {
        stageName: stageName(effectivePeak),
        peakDetail: describeReason(peak, offset),
        peakWarning: PEAK_WARNING_LINES[0],
        windowLabels: localWindowLabels(offset),
        holidaySource: HOLIDAY_DATA_SOURCE,
      },
      bridge: { clients: clientMounts },
      config: {
        warnOnPeak: config.warnOnPeak,
        idleChatter: config.idleChatter,
        reactToThinking: config.reactToThinking,
        injectIntoConversation: config.injectIntoConversation,
        chatProvider: config.chatProvider,
        chatModel: config.chatModel,
      },
    };
  };

  /**
   * Emit a snapshot to every subscriber.
   * @param event - SSE event name.
   */
  const publish = (event) => {
    if (bridge === undefined || disposed) return;
    try {
      bridge.broadcast(event, rebuildSnapshot());
    } catch (error) {
      log(`broadcast failed: ${String(error)}`);
    }
  };

  /** Have the pet say something. @param line - the utterance. @param kind - why. */
  const say = (line, kind) => {
    if (line === null || line === undefined || line === '') return;
    speech = { text: String(line), kind: kind ?? 'idle', at: new Date().toISOString() };
    publish('speech');
  };

  /**
   * Read the account balance once.
   *
   * Failures are recorded rather than swallowed: a signed-out user must see
   * "需要登录" instead of a stale or invented number.
   */
  const refreshBalance = async () => {
    const account = typeof ctx.get === 'function' ? ctx.get('deepseekAccount') : undefined;
    if (account === undefined || typeof account.getBalance !== 'function') {
      balance = summarizeBalance(undefined);
      balanceError = 'no-account-provider';
      return;
    }
    try {
      const outcome = await account.getBalance({
        version: '0.1.0',
        locale: 'zh-CN',
        timezoneOffsetSeconds: localOffsetMinutes(new Date()) * 60,
      });
      balance = summarizeBalance(outcome);
      balanceError = null;
    } catch (error) {
      balanceError = String(error?.message ?? error);
      log(`balance read failed: ${balanceError}`);
    }
  };

  ctx.effect(() => {
    const start = async () => {
      bridgeToken = randomBytes(24).toString('hex');
      try {
        bridge = await startBridge({
          token: bridgeToken,
          readSnapshot: rebuildSnapshot,
          onCommand: (pathname, payload) => {
            if (pathname === '/hello') {
              const source = payload.source === 'desktop' ? 'desktop' : 'client';
              clientMounts = { ...clientMounts, [source]: new Date().toISOString() };
              log(`${source} half mounted`);
              publish('hello');
              return { status: 200, body: { ok: true, version: SNAPSHOT_VERSION } };
            }
            if (pathname === '/say') {
              const line =
                typeof payload.text === 'string' && payload.text !== ''
                  ? payload.text
                  : pickIdleLine();
              say(line, 'manual');
              return { status: 200, body: { ok: true } };
            }
            if (pathname === '/state') {
              return { status: 200, body: rebuildSnapshot() };
            }
            return { status: 404, body: { ok: false, error: 'unknown-command' } };
          },
        });
      } catch (error) {
        log(`bridge failed to start: ${String(error)}`);
        return;
      }
      await writeFile(
        join(stateDir, 'bridge.json'),
        JSON.stringify(
          {
            port: bridge.port,
            token: bridgeToken,
            pid: process.pid,
            startedAt: new Date().toISOString(),
          },
          null,
          2,
        ),
      ).catch((error) => log(`bridge.json write failed: ${String(error)}`));
      log(`bridge listening on 127.0.0.1:${String(bridge.port)}`);
    };
    void start();

    if (typeof ctx.on === 'function') {
      // Publish the bridge address into the page bootstrap so the in-window
      // Client half can reach it without filesystem access.
      try {
        ctx.on('webserver/index-inject', (table) => {
          if (bridge === undefined) return;
          table.push({
            kind: 'global',
            name: BRIDGE_GLOBAL,
            // The token travels in the page because a browser page cannot read
            // `bridge.json`. That is safe here: the DSH document is already
            // fully trusted, and a page on any other origin never sees this
            // global - which is exactly what the token defends against.
            value: { port: bridge.port, token: bridgeToken, version: SNAPSHOT_VERSION },
          });
        });
      } catch (error) {
        log(`index-inject hook failed: ${String(error)}`);
      }
    }

    return () => {
      disposed = true;
      for (const dispose of disposers) {
        try {
          dispose();
        } catch {
          // Teardown must continue through a failing disposer.
        }
      }
      disposers = [];
      if (bridge !== undefined) void bridge.close();
    };
  });

  ctx.effect(() => {
    void refreshBalance();
    const timer = setInterval(() => {
      void refreshBalance();
    }, config.balanceTickMs);
    return () => clearInterval(timer);
  });

  ctx.effect(() => {
    const timer = setInterval(() => {
      publish('peak');
    }, config.peakTickMs);
    return () => clearInterval(timer);
  });

  // React to the agent's reasoning stream: the pet's expression follows what
  // the model is actually thinking, which is the difference between a mascot
  // and a companion.
  //
  // The stream arrives as `reasoning-delta` FRAGMENTS, not whole sentences, so
  // the text is accumulated into a rolling tail before classification. Matching
  // a keyword against a single delta would almost never fire: "这条路走不通"
  // can be split across three chunks.
  if (config.reactToThinking && typeof ctx.on === 'function') {
    try {
      let reasoningTail = '';
      const dispose = ctx.on('agent/assistant-stream', (payload) => {
        const frame = payload?.frame;
        if (frame === undefined || frame === null) return;
        if (frame.type === 'start') {
          reasoningTail = '';
          return;
        }
        const chunk = frame.chunk;
        if (chunk === undefined || chunk === null) return;
        if (chunk.type !== 'reasoning-delta' || typeof chunk.text !== 'string') return;
        reasoningTail = (reasoningTail + chunk.text).slice(-THINKING_TAIL_CHARS);
        const situation = classifySituation(reasoningTail);
        if (situation === thinking.situation) return;
        thinking = {
          situation,
          excerpt: reasoningTail.slice(-120),
          at: new Date().toISOString(),
        };
        mood = situation;
        const line = pickSituationLine(situation);
        if (line !== null) say(line, situation);
        else publish('thinking');
      });
      if (typeof dispose === 'function') disposers.push(dispose);
    } catch (error) {
      log(`thinking listener failed: ${String(error)}`);
    }
  }

  if (config.idleChatter) {
    ctx.effect(() => {
      let timer;
      const schedule = () => {
        const span = Math.max(0, config.idleMaxMs - config.idleMinMs);
        const delay = config.idleMinMs + Math.floor(Math.random() * span);
        timer = setTimeout(() => {
          // Only chatter when the pet has nothing better to say.
          if (speech === null || Date.now() - new Date(speech.at).getTime() > config.idleMinMs) {
            say(pickIdleLine(), 'idle');
          }
          schedule();
        }, delay);
      };
      schedule();
      return () => clearTimeout(timer);
    });
  }

  // Track the active Session so the settings page can offer a real model switch.
  // The field names are probed defensively: this listener must never throw,
  // because a failure here stays invisible until someone opens that page.
  if (typeof ctx.on === 'function') {
    try {
      const remember = (payload) => {
        const candidate =
          payload?.session?.id ??
          payload?.agent?.session?.id ??
          payload?.sessionId ??
          payload?.id ??
          null;
        if (typeof candidate === 'string' && candidate !== '') activeSessionId = candidate;
      };
      for (const event of ['agent/created', 'session/created', 'turn/start', 'agent/request']) {
        const dispose = ctx.on(event, remember);
        if (typeof dispose === 'function') disposers.push(dispose);
      }
    } catch (error) {
      log(`session tracking failed: ${String(error)}`);
    }
  }

  log(
    `mounted (peakScope=${config.peakScope}, model=${config.chatProvider}/${config.chatModel}, ` +
      `reasoning=${config.chatReasoningEffort}, warnOnPeak=${String(config.warnOnPeak)})`,
  );
}
