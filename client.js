/**
 * Client half of dsh-balance-pet: the Q-version pet inside the DeepSeek Harness
 * window.
 *
 * ARCHITECTURE NOTE
 * This half owns NO billing logic. Peak/off-peak is a UTC window against a
 * Chinese holiday calendar, and the balance is an authenticated Platform read;
 * both are computed once in the Host half and delivered here as a snapshot over
 * the loopback bridge. Re-deriving either here is how the badge and the pet
 * would start disagreeing about whether the user is being charged double.
 *
 * WHY EVERY DSH CALL IS DEFENSIVE
 * Nothing in this file can be exercised without a browser, so a thrown error
 * would blank the slot entry (the console reports "slot entry crashed"), and the
 * user would see nothing at all rather than a partial pet. Every optional
 * service is feature-detected and every await is guarded.
 *
 * STYLING
 * Chrome uses only `--dsw-*` semantic tokens, per the Harness plugin rules, so a
 * host restyle or a third-party theme keeps working. The character itself is
 * artwork and uses its own palette, which the rules allow.
 */

window.__ModuleLoader__.load({
  id: '@local/dsh-balance-pet',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = '@local/dsh-balance-pet';
    const STORAGE = {
      skin: 'dsh-balance-pet.skin',
      collapsed: 'dsh-balance-pet.collapsed',
      wander: 'dsh-balance-pet.wander',
    };

    /* ------------------------------------------------------------ expressions */

    /**
     * The expression set: 24 distinct faces.
     *
     * Each entry is data, not markup, so a face is one line to read and the
     * renderers stay small. `mark` is the floating symbol above the head.
     */
    const EXPRESSIONS = {
      idle: { eyes: 'open', mouth: 'smile', brow: 'none', mark: null, anim: 'breathe' },
      blink: { eyes: 'closed', mouth: 'smile', brow: 'none', mark: null, anim: null },
      happy: { eyes: 'happy', mouth: 'grin', brow: 'raised', mark: null, anim: 'bounce' },
      excited: { eyes: 'star', mouth: 'open', brow: 'raised', mark: 'sparkle', anim: 'bounce' },
      sad: { eyes: 'sad', mouth: 'frown', brow: 'sad', mark: 'tear', anim: 'droop' },
      crying: { eyes: 'teary', mouth: 'wavy', brow: 'sad', mark: 'tear', anim: 'shake' },
      angry: { eyes: 'sharp', mouth: 'frown', brow: 'furrowed', mark: 'anger', anim: 'shake' },
      confused: { eyes: 'side', mouth: 'wavy', brow: 'one', mark: 'question', anim: 'tilt' },
      surprised: { eyes: 'wide', mouth: 'o', brow: 'raised', mark: 'exclaim', anim: 'pop' },
      thinking: { eyes: 'half', mouth: 'flat', brow: 'one', mark: 'dots', anim: 'float' },
      sleepy: { eyes: 'half', mouth: 'small', brow: 'none', mark: 'zzz', anim: 'droop' },
      sleeping: { eyes: 'closed', mouth: 'small', brow: 'none', mark: 'zzz', anim: 'breathe' },
      working: { eyes: 'open', mouth: 'flat', brow: 'furrowed', mark: null, anim: 'type' },
      running: { eyes: 'happy', mouth: 'open', brow: 'raised', mark: 'sweat', anim: 'run' },
      waving: { eyes: 'happy', mouth: 'grin', brow: 'none', mark: null, anim: 'wave' },
      love: { eyes: 'heart', mouth: 'smile', brow: 'raised', mark: 'heart', anim: 'bounce' },
      panic: { eyes: 'wide', mouth: 'o', brow: 'furrowed', mark: 'sweat', anim: 'shake' },
      money: { eyes: 'star', mouth: 'grin', brow: 'raised', mark: 'coin', anim: 'bounce' },
      meeting: { eyes: 'open', mouth: 'smile', brow: 'none', mark: 'note', anim: 'float' },
      smug: { eyes: 'half', mouth: 'smirk', brow: 'one', mark: null, anim: null },
      dead: { eyes: 'cross', mouth: 'flat', brow: 'none', mark: 'skull', anim: null },
      dizzy: { eyes: 'spiral', mouth: 'wavy', brow: 'none', mark: 'spiral', anim: 'shake' },
      singing: { eyes: 'happy', mouth: 'open', brow: 'raised', mark: 'note', anim: 'bounce' },
      wink: { eyes: 'wink', mouth: 'smirk', brow: 'raised', mark: null, anim: 'pop' },
    };

    /** Every expression name, for the self-check and the settings preview. */
    const EXPRESSION_NAMES = Object.keys(EXPRESSIONS);

    /**
     * Situation to face. The Host reports a situation from the agent's reasoning
     * stream; this is the only place the two vocabularies meet.
     */
    const SITUATION_FACE = {
      idle: 'idle',
      thinking: 'thinking',
      'dead-end': 'confused',
      error: 'panic',
      success: 'excited',
      testing: 'working',
      debugging: 'working',
      searching: 'thinking',
      reading: 'thinking',
      refactor: 'working',
      planning: 'thinking',
      blocked: 'sad',
      risky: 'surprised',
      costly: 'money',
      confused: 'confused',
      grinding: 'working',
    };

    /* ----------------------------------------------------------------- skins */

    /** The three companions. `ink` is the facial line colour. */
    const SKINS = {
      deepseek: {
        label: 'DeepSeek',
        body: '#8fd0ff',
        bodyDeep: '#4a9de0',
        ear: '#4a9de0',
        ink: '#10243d',
        blush: '#ff9d9d',
        accent: '#2b6fb8',
      },
      chatgpt: {
        label: 'ChatGPT',
        body: '#ffffff',
        bodyDeep: '#e4e4e4',
        ear: '#d8d8d8',
        ink: '#2f2f2f',
        blush: '#ffc9c9',
        accent: '#10a37f',
      },
      anthropic: {
        label: 'Anthropic',
        body: '#ffd8b0',
        bodyDeep: '#e8a55a',
        ear: '#e8a55a',
        ink: '#3a2410',
        blush: '#ff9d7a',
        accent: '#cc785c',
      },
    };

    const SKIN_ORDER = ['deepseek', 'chatgpt', 'anthropic'];

    /* ------------------------------------------------------------ svg parts */

    /**
     * Render one eye.
     * @param kind - eye shape name.
     * @param skin - palette.
     * @param side - `-1` for the left eye, `1` for the right.
     * @returns the eye's SVG children.
     */
    function renderEye(kind, skin, side) {
      const cx = side < 0 ? 23 : 37;
      const cy = 33;
      const key = `${kind}-${String(side)}`;
      const dot = (rx, ry) => h('ellipse', { key, cx, cy, rx, ry, fill: skin.ink });
      switch (kind) {
        case 'closed':
          return h('path', {
            key,
            d: `M${String(cx - 4)} ${String(cy)}q4 3 8 0`,
            fill: 'none',
            stroke: skin.ink,
            strokeWidth: 1.8,
            strokeLinecap: 'round',
          });
        case 'happy':
          return h('path', {
            key,
            d: `M${String(cx - 4)} ${String(cy + 1)}q4 -5 8 0`,
            fill: 'none',
            stroke: skin.ink,
            strokeWidth: 1.9,
            strokeLinecap: 'round',
          });
        case 'wide':
          return h('g', { key }, [
            h('circle', { key: `${key}a`, cx, cy, r: 4, fill: '#ffffff', stroke: skin.ink, strokeWidth: 1.2 }),
            h('circle', { key: `${key}b`, cx, cy, r: 2, fill: skin.ink }),
          ]);
        case 'sad':
          return h('g', { key }, [
            dot(2.6, 3),
            h('path', {
              key: `${key}b`,
              d: `M${String(cx - 4)} ${String(cy - 5)}q4 2 8 0`,
              fill: 'none',
              stroke: skin.ink,
              strokeWidth: 1.4,
            }),
          ]);
        case 'half':
          return h('g', { key }, [
            h('path', {
              key: `${key}a`,
              d: `M${String(cx - 4)} ${String(cy)}q4 4 8 0z`,
              fill: skin.ink,
            }),
          ]);
        case 'side':
          return h('g', { key }, [
            dot(2.4, 3.2),
            h('circle', { key: `${key}b`, cx: cx + side, cy: cy - 1.4, r: 0.9, fill: '#ffffff' }),
          ]);
        case 'sharp':
          return h('path', {
            key,
            d: `M${String(cx - 4)} ${String(cy - 2)}l8 3l-8 3z`,
            fill: skin.ink,
          });
        case 'teary':
          return h('g', { key }, [
            dot(2.8, 3.4),
            h('circle', { key: `${key}b`, cx, cy: cy + 5, r: 1.6, fill: '#7ec8ff', opacity: 0.9 }),
          ]);
        case 'star':
          return h('path', {
            key,
            d: `M${String(cx)} ${String(cy - 4.5)}l1.4 3l3.2 0.4l-2.3 2.2l0.6 3.2l-2.9-1.6l-2.9 1.6l0.6-3.2l-2.3-2.2l3.2-0.4z`,
            fill: '#ffd35c',
            stroke: '#c98a12',
            strokeWidth: 0.6,
          });
        case 'heart':
          return h('path', {
            key,
            d: `M${String(cx)} ${String(cy + 3)}c-4-3-6-5-4-7c1.4-1.4 3.2-0.4 4 1c0.8-1.4 2.6-2.4 4-1c2 2 0 4-4 7z`,
            fill: '#ff7a90',
          });
        case 'cross':
          return h('g', { key, stroke: skin.ink, strokeWidth: 1.8, strokeLinecap: 'round' }, [
            h('path', { key: `${key}a`, d: `M${String(cx - 3)} ${String(cy - 3)}l6 6` }),
            h('path', { key: `${key}b`, d: `M${String(cx + 3)} ${String(cy - 3)}l-6 6` }),
          ]);
        case 'spiral':
          return h('path', {
            key,
            d: `M${String(cx)} ${String(cy)}m0-3a3 3 0 1 1-3 3a1.6 1.6 0 1 0 1.6-1.6`,
            fill: 'none',
            stroke: skin.ink,
            strokeWidth: 1.2,
          });
        case 'wink':
          return side < 0
            ? h('path', {
                key,
                d: `M${String(cx - 4)} ${String(cy)}q4 3 8 0`,
                fill: 'none',
                stroke: skin.ink,
                strokeWidth: 1.8,
                strokeLinecap: 'round',
              })
            : dot(2.6, 3.2);
        case 'open':
        default:
          return h('g', { key }, [
            dot(2.6, 3.2),
            h('circle', { key: `${key}b`, cx: cx + 0.9, cy: cy - 1.3, r: 1, fill: '#ffffff' }),
          ]);
      }
    }

    /**
     * Render the mouth.
     * @param kind - mouth shape name.
     * @param skin - palette.
     * @returns the mouth's SVG element.
     */
    function renderMouth(kind, skin) {
      const common = { fill: 'none', stroke: skin.ink, strokeWidth: 1.6, strokeLinecap: 'round' };
      switch (kind) {
        case 'grin':
          return h('path', { d: 'M25 39q5 5 10 0q-5 2-10 0z', fill: skin.ink, opacity: 0.9 });
        case 'open':
          return h('ellipse', { cx: 30, cy: 41, rx: 3.4, ry: 3.8, fill: '#c8564f', stroke: skin.ink, strokeWidth: 1 });
        case 'o':
          return h('ellipse', { cx: 30, cy: 41, rx: 2.2, ry: 2.8, fill: '#c8564f', stroke: skin.ink, strokeWidth: 1 });
        case 'flat':
          return h('path', { d: 'M26 41h8', ...common });
        case 'frown':
          return h('path', { d: 'M26 42q4-4 8 0', ...common });
        case 'smirk':
          return h('path', { d: 'M26 41q4 0 8-3', ...common });
        case 'wavy':
          return h('path', { d: 'M25 41q2-3 4 0t4 0t2-3', ...common });
        case 'small':
          return h('path', { d: 'M28 41q2 2 4 0', ...common });
        case 'smile':
        default:
          return h('path', { d: 'M26 40q4 3 8 0', ...common });
      }
    }

    /**
     * Render the eyebrows.
     *
     * A `switch` like the other renderers, not an if-chain: the self-check
     * enumerates `case` labels to prove every expression names a part that is
     * actually handled, and an if-chain would silently escape that check.
     *
     * @param kind - brow shape name.
     * @param skin - palette.
     * @returns the brow group, or `null` when the face has none.
     */
    function renderBrow(kind, skin) {
      const stroke = { fill: 'none', stroke: skin.ink, strokeWidth: 1.4, strokeLinecap: 'round' };
      switch (kind) {
        case 'raised':
          return h('g', { key: 'brow' }, [
            h('path', { key: 'bl', d: 'M19 27q4-2 8 0', ...stroke }),
            h('path', { key: 'br', d: 'M33 27q4-2 8 0', ...stroke }),
          ]);
        case 'furrowed':
          return h('g', { key: 'brow' }, [
            h('path', { key: 'bl', d: 'M19 26l8 3', ...stroke }),
            h('path', { key: 'br', d: 'M33 29l8-3', ...stroke }),
          ]);
        case 'one':
          return h('path', { key: 'brow', d: 'M33 26q4-2 8 1', ...stroke });
        case 'sad':
          return h('g', { key: 'brow' }, [
            h('path', { key: 'bl', d: 'M19 28q4 2 8 0', ...stroke }),
            h('path', { key: 'br', d: 'M33 28q4 2 8 0', ...stroke }),
          ]);
        case 'none':
        default:
          return null;
      }
    }

    /**
     * Render the floating mark above the head.
     * @param kind - mark name.
     * @returns the mark's SVG element, or `null`.
     */
    function renderMark(kind) {
      switch (kind) {
        case 'sparkle':
          return h('path', { d: 'M50 14l1.5 3.5l3.5 1.5l-3.5 1.5l-1.5 3.5l-1.5-3.5l-3.5-1.5l3.5-1.5z', fill: '#ffe066' });
        case 'tear':
          return h('path', { d: 'M46 26q3 4 0 6q-3-2 0-6z', fill: '#7ec8ff' });
        case 'anger':
          return h('g', { stroke: '#e0555a', strokeWidth: 2, strokeLinecap: 'round' }, [
            h('path', { key: 'a', d: 'M46 16l4 4' }),
            h('path', { key: 'b', d: 'M50 16l-4 4' }),
          ]);
        case 'question':
          return h('text', { x: 50, y: 20, fontSize: 12, fontWeight: 700, fill: '#e8a55a', textAnchor: 'middle' }, '?');
        case 'exclaim':
          return h('text', { x: 50, y: 20, fontSize: 12, fontWeight: 700, fill: '#e0555a', textAnchor: 'middle' }, '!');
        case 'dots':
          return h('g', { fill: '#9aa4b2' }, [
            h('circle', { key: 'd1', cx: 44, cy: 16, r: 1.5 }),
            h('circle', { key: 'd2', cx: 48, cy: 16, r: 1.5 }),
            h('circle', { key: 'd3', cx: 52, cy: 16, r: 1.5 }),
          ]);
        case 'zzz':
          return h('text', { x: 50, y: 18, fontSize: 11, fontWeight: 700, fill: '#9aa4b2', textAnchor: 'middle' }, 'z Z');
        case 'sweat':
          return h('path', { d: 'M50 18q3 4 0 6q-3-2 0-6z', fill: '#7ec8ff', opacity: 0.85 });
        case 'heart':
          return h('path', { d: 'M50 20c-3-2.4-4.5-4-3-5.6c1-1 2.4-0.3 3 0.8c0.6-1.1 2-1.8 3-0.8c1.5 1.6 0 3.2-3 5.6z', fill: '#ff7a90' });
        case 'coin':
          return h('g', null, [
            h('circle', { key: 'c', cx: 50, cy: 17, r: 5, fill: '#ffd35c', stroke: '#c98a12', strokeWidth: 0.8 }),
            h('text', { key: 't', x: 50, y: 20.5, fontSize: 7, fontWeight: 700, fill: '#8a6314', textAnchor: 'middle' }, '¥'),
          ]);
        case 'note':
          return h('text', { x: 50, y: 20, fontSize: 12, fill: '#7f8c9b', textAnchor: 'middle' }, '♪');
        case 'skull':
          return h('text', { x: 50, y: 20, fontSize: 12, fill: '#7f8c9b', textAnchor: 'middle' }, '×');
        case 'spiral':
          return h('path', { d: 'M50 17m0-4a4 4 0 1 1-4 4a2 2 0 1 0 2-2', fill: 'none', stroke: '#9aa4b2', strokeWidth: 1.2 });
        default:
          return null;
      }
    }

    /**
     * Render the whole character.
     *
     * @param props - skin key, expression name and a size in pixels.
     * @returns the character SVG.
     */
    function Character(props) {
      const skin = SKINS[props.skin] ?? SKINS.deepseek;
      const face = EXPRESSIONS[props.expression] ?? EXPRESSIONS.idle;
      const size = props.size ?? 64;
      return h(
        'svg',
        {
          className: 'dbp-pet-svg' + (face.anim === null ? '' : ` dbp-anim-${face.anim}`),
          viewBox: '0 0 64 64',
          width: size,
          height: size,
          role: 'img',
          'aria-label': `${skin.label} ${props.expression ?? 'idle'}`,
        },
        [
          h('ellipse', { key: 'shadow', cx: 32, cy: 55, rx: 16, ry: 3.4, fill: '#000000', opacity: 0.14 }),
          h('path', { key: 'earL', d: 'M16 23c-3-6-1-10 3-10 3 0 5 3 6 6z', fill: skin.ear }),
          h('path', { key: 'earR', d: 'M46 23c3-6 1-10-3-10-3 0-5 3-6 6z', fill: skin.ear }),
          h('ellipse', { key: 'head', cx: 31, cy: 34, rx: 17, ry: 15, fill: skin.body }),
          h('ellipse', { key: 'headTop', cx: 31, cy: 30, rx: 17, ry: 11, fill: skin.body, opacity: 0.55 }),
          h('ellipse', {
            key: 'outline',
            cx: 31,
            cy: 34,
            rx: 17,
            ry: 15,
            fill: 'none',
            stroke: skin.bodyDeep,
            strokeWidth: 1,
            opacity: 0.7,
          }),
          renderBrow(face.brow, skin),
          renderEye(face.eyes, skin, -1),
          renderEye(face.eyes, skin, 1),
          h('circle', { key: 'blushL', cx: 19, cy: 39, r: 2.2, fill: skin.blush, opacity: 0.5 }),
          h('circle', { key: 'blushR', cx: 43, cy: 39, r: 2.2, fill: skin.blush, opacity: 0.5 }),
          renderMouth(face.mouth, skin),
          renderMark(face.mark),
        ].filter((node) => node !== null && node !== undefined),
      );
    }

    /* ---------------------------------------------------------------- bridge */

    /**
     * Subscribe to the Host bridge.
     *
     * SSE is preferred because it pushes on change; the periodic refresh is a
     * safety net for the countdown and for the moment right after the bridge
     * restarts, when the page global still points at the old port.
     *
     * @returns the latest snapshot and a connection status string.
     */
    function useBridge() {
      const [snapshot, setSnapshot] = React.useState(null);
      const [status, setStatus] = React.useState('connecting');

      React.useEffect(() => {
        const info = globalThis.__DSH_BALANCE_PET__;
        if (info === undefined || info === null || typeof info.port !== 'number') {
          // The page was loaded before the plugin mounted, or the bridge failed
          // to start. Reported rather than hidden, so the user is not left
          // wondering why the pet is blank.
          setStatus('no-bridge');
          return undefined;
        }
        const base = `http://127.0.0.1:${String(info.port)}`;
        const headers = { 'x-balance-pet-token': info.token };
        let source = null;
        let closed = false;

        const accept = (event) => {
          try {
            setSnapshot(JSON.parse(event.data));
            setStatus('live');
          } catch {
            // A malformed frame must not blank the pet.
          }
        };

        try {
          source = new EventSource(`${base}/events?token=${encodeURIComponent(info.token)}`);
          for (const name of ['snapshot', 'peak', 'speech', 'hello', 'thinking']) {
            source.addEventListener(name, accept);
          }
          source.onopen = () => setStatus('live');
          source.onerror = () => setStatus('reconnecting');
        } catch {
          setStatus('no-bridge');
        }

        // Announce this half so the settings page can show both halves are live.
        fetch(`${base}/hello`, {
          method: 'POST',
          headers: { ...headers, 'content-type': 'application/json' },
          body: JSON.stringify({ source: 'client' }),
        }).catch(() => {});

        const refresh = setInterval(() => {
          if (closed) return;
          fetch(`${base}/state`, { headers })
            .then((response) => (response.ok ? response.json() : null))
            .then((value) => {
              if (value !== null && !closed) setSnapshot(value);
            })
            .catch(() => {});
        }, 20_000);

        return () => {
          closed = true;
          clearInterval(refresh);
          if (source !== null) source.close();
        };
      }, []);

      return { snapshot, status };
    }

    /* ------------------------------------------------------------------- css */

    const CSS = [
      '.dbp-root{position:fixed;right:18px;bottom:18px;z-index:60;display:flex;flex-direction:column;',
      'align-items:flex-end;gap:8px;font-family:inherit;pointer-events:none;}',
      '.dbp-root>*{pointer-events:auto;}',
      '.dbp-bubble{max-width:260px;padding:8px 12px;border-radius:var(--dsw-radius-lg);',
      'background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);',
      'border:.5px solid var(--dsw-alias-border-l2);box-shadow:var(--dsw-shadow-lv2);',
      'font-size:12px;line-height:18px;animation:dbp-pop .18s ease-out;}',
      '.dbp-bubble-peak{border-color:var(--dsw-alias-state-warn-primary);',
      'background:var(--dsw-alias-state-warn-tertiary);}',
      '.dbp-row{display:flex;align-items:flex-end;gap:10px;}',
      '.dbp-pet{background:none;border:0;padding:0;cursor:pointer;line-height:0;',
      'filter:drop-shadow(0 4px 10px rgb(0 0 0 / 0.28));}',
      '.dbp-pet:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color);',
      'outline-offset:3px;border-radius:50%;}',
      '.dbp-readout{display:flex;flex-direction:column;align-items:flex-end;gap:2px;padding:6px 10px;',
      'border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-overlay);',
      'border:.5px solid var(--dsw-alias-border-l1);box-shadow:var(--dsw-shadow-lv1);}',
      '.dbp-amount{font-size:15px;font-weight:600;color:var(--dsw-alias-label-primary);',
      'font-variant-numeric:tabular-nums;}',
      '.dbp-sub{font-size:10px;color:var(--dsw-alias-label-tertiary);}',
      '.dbp-stage{display:inline-flex;align-items:center;gap:4px;padding:1px 7px;border-radius:999px;',
      'font-size:10px;line-height:16px;border:.5px solid transparent;}',
      '.dbp-stage-peak{background:var(--dsw-alias-state-warn-tertiary);color:var(--dsw-alias-state-warn-label);',
      'border-color:var(--dsw-alias-state-warn-primary);}',
      '.dbp-stage-off{background:var(--dsw-alias-state-success-tertiary);color:var(--dsw-alias-state-success-primary);',
      'border-color:var(--dsw-alias-state-success-secondary);}',
      '.dbp-panel{width:280px;max-height:60vh;overflow:auto;padding:12px;',
      'border-radius:var(--dsw-radius-xl);background:var(--dsw-alias-bg-layer-3);',
      'border:.5px solid var(--dsw-alias-border-l2);box-shadow:var(--dsw-shadow-lv3);',
      'color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px;}',
      '.dbp-panel h4{margin:0 0 6px;font-size:13px;font-weight:600;}',
      '.dbp-panelRow{display:flex;justify-content:space-between;gap:10px;padding:3px 0;}',
      '.dbp-dim{color:var(--dsw-alias-label-tertiary);}',
      '.dbp-divider{height:1px;background:var(--dsw-alias-border-l1);margin:8px 0;}',
      '.dbp-chips{display:flex;flex-wrap:wrap;gap:6px;}',
      '.dbp-chip{padding:3px 9px;border-radius:999px;cursor:pointer;font-size:11px;',
      'border:.5px solid var(--dsw-alias-border-l3);background:transparent;',
      'color:var(--dsw-alias-label-primary);}',
      '.dbp-chip-on{background:var(--dsw-alias-bg-module-platform);',
      'border-color:var(--dsw-alias-state-business-primary);}',
      '.dbp-chip:hover{background:var(--dsw-alias-interactive-bg-hover);}',
      '.dbp-faces{display:grid;grid-template-columns:repeat(6,1fr);gap:4px;}',
      '.dbp-face{display:flex;justify-content:center;cursor:pointer;border-radius:var(--dsw-radius-sm);',
      'border:.5px solid transparent;background:transparent;padding:0;line-height:0;}',
      '.dbp-face:hover{border-color:var(--dsw-alias-border-l3);}',
      '.dbp-section{padding:16px 0;border-top:.5px solid var(--dsw-alias-border-l1);',
      'display:flex;flex-direction:column;gap:8px;}',
      '.dbp-title{font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary);}',
      '.dbp-hint{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);}',
      '.dbp-card{border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg);',
      'padding:10px 12px;display:flex;flex-direction:column;gap:6px;}',
      '.dbp-btn{height:30px;padding:0 14px;border-radius:var(--dsw-radius-md);cursor:pointer;',
      'border:.5px solid var(--dsw-alias-border-l3);background:transparent;',
      'color:var(--dsw-alias-label-primary);font-size:13px;font-family:inherit;}',
      '.dbp-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);}',
      '.dbp-btn:disabled{opacity:.5;cursor:default;}',
      '.dbp-select{height:28px;border-radius:var(--dsw-radius-md);font-family:inherit;font-size:12px;',
      'background:var(--dsw-specific-selector);color:var(--dsw-alias-label-primary);',
      'border:.5px solid var(--dsw-alias-border-l3);padding:0 6px;max-width:100%;}',
      /* idle motion */
      '@media (prefers-reduced-motion: no-preference){',
      '.dbp-anim-breathe{animation:dbp-breathe 3.4s ease-in-out infinite;}',
      '.dbp-anim-bounce{animation:dbp-bounce .62s ease-in-out infinite;}',
      '.dbp-anim-shake{animation:dbp-shake .34s ease-in-out infinite;}',
      '.dbp-anim-pop{animation:dbp-pop 1.1s ease-in-out infinite;}',
      '.dbp-anim-float{animation:dbp-float 2.6s ease-in-out infinite;}',
      '.dbp-anim-droop{animation:dbp-droop 4s ease-in-out infinite;}',
      '.dbp-anim-tilt{animation:dbp-tilt 2.2s ease-in-out infinite;}',
      '.dbp-anim-type{animation:dbp-type .34s steps(2) infinite;}',
      '.dbp-anim-wave{animation:dbp-wave .9s ease-in-out infinite;}',
      '.dbp-anim-run{animation:dbp-run .42s linear infinite;}',
      '}',
      '@keyframes dbp-breathe{0%,100%{transform:scale(1)}50%{transform:scale(1.045)}}',
      '@keyframes dbp-pop{0%{transform:scale(.86)}60%{transform:scale(1.06)}100%{transform:scale(1)}}',
      '@keyframes dbp-bounce{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}',
      '@keyframes dbp-shake{0%,100%{transform:translateX(-1.6px)}50%{transform:translateX(1.6px)}}',
      '@keyframes dbp-float{0%,100%{transform:translateY(0) rotate(-1.5deg)}50%{transform:translateY(-3px) rotate(1.5deg)}}',
      '@keyframes dbp-droop{0%,100%{transform:rotate(-2deg) translateY(1px)}50%{transform:rotate(1deg)}}',
      '@keyframes dbp-tilt{0%,100%{transform:rotate(-6deg)}50%{transform:rotate(6deg)}}',
      '@keyframes dbp-type{0%{transform:translateY(0)}100%{transform:translateY(-1.4px)}}',
      '@keyframes dbp-wave{0%,100%{transform:rotate(-4deg)}50%{transform:rotate(7deg)}}',
      '@keyframes dbp-run{0%,100%{transform:translateY(0) rotate(-3deg)}50%{transform:translateY(-3px) rotate(-3deg)}}',
      '@media (prefers-reduced-motion: reduce){[class*="dbp-anim-"]{animation:none !important;}}',
    ].join('\n');

    /* ---------------------------------------------------------------- helpers */

    /** Never let a storage failure take the pet down. */
    function readStored(key, fallback) {
      try {
        const raw = window.localStorage.getItem(key);
        return raw === null ? fallback : raw;
      } catch {
        return fallback;
      }
    }

    /** @param key - storage key. @param value - value to persist. */
    function writeStored(key, value) {
      try {
        window.localStorage.setItem(key, value);
      } catch {
        // A private-mode failure must not break the control.
      }
    }

    /** Fall back to a plugin-owned <style> when the `styles` builtin is absent. */
    function styleSink() {
      if (typeof styles !== 'undefined' && styles !== null && typeof styles.insert === 'function') {
        return (css) => styles.insert(css);
      }
      return (css) => {
        const tag = document.createElement('style');
        tag.setAttribute('data-dsh-balance-pet', '');
        tag.textContent = css;
        (document.head ?? document.documentElement).appendChild(tag);
        return () => {
          if (tag.parentNode !== null) tag.parentNode.removeChild(tag);
        };
      };
    }

    /**
     * Build the collapsed readout lines from a snapshot.
     *
     * @param snapshot - the bridge snapshot, possibly null.
     * @returns display strings.
     */
    function describe(snapshot) {
      if (snapshot === null) {
        return { amount: '…', sub: '连接中', stage: '', peak: false, ready: false };
      }
      const primary = snapshot.balance?.primary ?? null;
      const amount = snapshot.balance?.ready === true && primary !== null ? primary.totalText : '—';
      let sub;
      if (snapshot.balance?.ready !== true) {
        sub = snapshot.balanceError === 'no-account-provider' ? '未接入账号服务' : '需登录后查看';
      } else if (snapshot.balance?.hasCredit === false) {
        sub = '余额已用尽';
      } else {
        sub = '充值 ' + String(primary.normalText) + ' · 赠金 ' + String(primary.bonusText);
      }
      return {
        amount,
        sub,
        stage: snapshot.texts?.stageName ?? '',
        peak: snapshot.peak?.active === true,
        ready: true,
      };
    }

    /* --------------------------------------------------------------- overlay */

    /**
     * The in-window pet: a floating character plus the always-visible balance
     * readout, expanding into a panel on click.
     *
     * @returns the overlay element tree.
     */
    function PetOverlay() {
      const { snapshot, status } = useBridge();
      const [open, setOpen] = React.useState(false);
      const [skin, setSkin] = React.useState(() => {
        const stored = readStored(STORAGE.skin, 'deepseek');
        return SKIN_ORDER.includes(stored) ? stored : 'deepseek';
      });
      const [forcedFace, setForcedFace] = React.useState(null);
      const [blinking, setBlinking] = React.useState(false);
      const [dismissedSpeechAt, setDismissedSpeechAt] = React.useState(null);

      // The face follows the agent's reasoning situation, which is the whole
      // point of the thinking integration; a manual preview overrides it.
      const situation = snapshot?.thinking?.situation ?? 'idle';
      const baseFace = SITUATION_FACE[situation] ?? 'idle';
      const expression = forcedFace ?? (blinking ? 'blink' : baseFace);

      React.useEffect(() => {
        const timer = setInterval(() => {
          setBlinking(true);
          setTimeout(() => setBlinking(false), 140);
        }, 4200);
        return () => clearInterval(timer);
      }, []);

      const speech = snapshot?.speech ?? null;
      const showSpeech =
        speech !== null && speech !== undefined && speech.at !== dismissedSpeechAt && !open;

      // The peak warning is a reminder, not a gate: the user explicitly chose
      // "warn, do not block", so nothing here prevents sending.
      const peakWarning =
        showSpeech && snapshot?.peak?.active === true && snapshot?.config?.warnOnPeak === true;

      const changeSkin = (next) => {
        setSkin(next);
        writeStored(STORAGE.skin, next);
      };

      const display = describe(snapshot);

      return h('div', { className: 'dbp-root' }, [
        showSpeech
          ? h(
              'div',
              {
                key: 'speech',
                className: 'dbp-bubble' + (peakWarning ? ' dbp-bubble-peak' : ''),
                onClick: () => setDismissedSpeechAt(speech.at),
                title: '点击关闭',
              },
              speech.text,
            )
          : null,
        h('div', { key: 'row', className: 'dbp-row' }, [
          h(
            'button',
            {
              key: 'pet',
              type: 'button',
              className: 'dbp-pet',
              onClick: () => setOpen((value) => !value),
              'aria-expanded': open,
              title: `${SKINS[skin].label} · ${status}`,
            },
            h(Character, { skin, expression, size: 68 }),
          ),
          h('div', { key: 'readout', className: 'dbp-readout' }, [
            h('div', { key: 'amount', className: 'dbp-amount' }, display.amount),
            display.stage !== ''
              ? h(
                  'span',
                  {
                    key: 'stage',
                    className: 'dbp-stage ' + (display.peak ? 'dbp-stage-peak' : 'dbp-stage-off'),
                  },
                  display.peak ? `×2 ${display.stage}` : display.stage,
                )
              : null,
            h('div', { key: 'sub', className: 'dbp-sub' }, display.sub),
          ]),
        ]),
        open
          ? h(
              'div',
              { key: 'panel', className: 'dbp-panel' },
              [
                h('h4', { key: 'h1' }, '计费时段'),
                h('div', { key: 'p1', className: 'dbp-panelRow' }, [
                  h('span', { key: 'l' }, '当前'),
                  h('span', { key: 'v' }, snapshot?.texts?.stageName ?? '—'),
                ]),
                h('div', { key: 'p2', className: 'dbp-panelRow' }, [
                  h('span', { key: 'l' }, '倍率'),
                  h('span', { key: 'v' }, snapshot?.peak?.multiplier === 2 ? '2× 高峰价' : '1× 低谷价'),
                ]),
                h(
                  'div',
                  { key: 'p3', className: 'dbp-dim' },
                  snapshot?.texts?.peakDetail ?? '等待数据…',
                ),
                snapshot?.peak?.windowLabels !== undefined
                  ? h(
                      'div',
                      { key: 'p4', className: 'dbp-dim' },
                      `本地高峰:${snapshot.peak.windowLabels.join('、')}(工作日,法定节假日除外)`,
                    )
                  : null,
                snapshot?.peak?.nextChangeAt !== null && snapshot?.peak?.nextChangeAt !== undefined
                  ? h(
                      'div',
                      { key: 'p5', className: 'dbp-dim' },
                      `${snapshot.peak.nextChangeIsPeak === true ? '即将进入高峰' : '即将进入低谷'}:` +
                        new Date(snapshot.peak.nextChangeAt).toLocaleString(),
                    )
                  : null,
                snapshot?.peak?.holidayData?.covers === false
                  ? h(
                      'div',
                      { key: 'p6', className: 'dbp-dim' },
                      `⚠ 节假日数据只到 ${String(snapshot.peak.holidayData.through)} 年,之后可能判错`,
                    )
                  : null,
                h('div', { key: 'd1', className: 'dbp-divider' }),
                h('h4', { key: 'h2' }, '余额'),
                snapshot?.balance?.wallets?.length > 0
                  ? snapshot.balance.wallets.map((wallet) =>
                      h('div', { key: `w-${wallet.currency}`, className: 'dbp-panelRow' }, [
                        h('span', { key: 'l' }, wallet.currency),
                        h('span', { key: 'v' }, wallet.totalText),
                      ]),
                    )
                  : h('div', { key: 'nowallet', className: 'dbp-dim' }, display.sub),
                h('div', { key: 'd2', className: 'dbp-divider' }),
                h('h4', { key: 'h3' }, '小人'),
                h(
                  'div',
                  { key: 'skins', className: 'dbp-chips' },
                  SKIN_ORDER.map((key) =>
                    h(
                      'button',
                      {
                        key,
                        type: 'button',
                        className: 'dbp-chip' + (skin === key ? ' dbp-chip-on' : ''),
                        onClick: () => changeSkin(key),
                      },
                      SKINS[key].label,
                    ),
                  ),
                ),
                h('div', { key: 'moodLabel', className: 'dbp-dim' }, `心情:${situation}`),
                h(
                  'div',
                  { key: 'faces', className: 'dbp-faces' },
                  EXPRESSION_NAMES.map((name) =>
                    h(
                      'button',
                      {
                        key: name,
                        type: 'button',
                        className: 'dbp-face',
                        title: name,
                        onClick: () => setForcedFace(forcedFace === name ? null : name),
                        style: forcedFace === name ? { borderColor: 'var(--dsw-alias-brand-primary)' } : undefined,
                      },
                      h(Character, { skin, expression: name, size: 30 }),
                    ),
                  ),
                ),
                h('div', { key: 'd3', className: 'dbp-divider' }),
                h(
                  'div',
                  { key: 'status', className: 'dbp-dim' },
                  `桥接:${status}${snapshot?.bridge?.clients?.desktop !== null && snapshot?.bridge?.clients?.desktop !== undefined ? ' · 桌面小人已连接' : ''}`,
                ),
                snapshot?.thinking?.excerpt !== undefined && snapshot?.thinking?.excerpt !== ''
                  ? h('div', { key: 'think', className: 'dbp-dim' }, `思考片段:${snapshot.thinking.excerpt}`)
                  : null,
              ].filter((node) => node !== null),
            )
          : null,
      ]);
    }

    /* -------------------------------------------------------------- settings */

    /**
     * The settings page: billing facts, pet options, and a real model switch.
     *
     * The model list comes from the Host's `session.modelCatalog` and the switch
     * goes through `session.selectModel` for the Session the Host half reported,
     * so this is the application's own routing rather than a parallel copy.
     *
     * @returns the settings section element tree.
     */
    function SettingsSection(props) {
      const { snapshot, status } = useBridge();
      const [catalog, setCatalog] = React.useState(null);
      const [busy, setBusy] = React.useState(false);
      const [message, setMessage] = React.useState('');
      const [error, setError] = React.useState('');

      React.useEffect(() => {
        const remote = props.remote ?? null;
        if (remote === null || remote.session === undefined) {
          setError('未接入 session 服务,无法列出模型');
          return undefined;
        }
        let cancelled = false;
        Promise.resolve()
          .then(() => remote.session.modelCatalog())
          .then((result) => {
            if (cancelled) return;
            if (result !== null && result !== undefined && result.ok === true) setCatalog(result.value);
            else setError('模型目录读取失败');
          })
          .catch((cause) => {
            if (!cancelled) setError(String(cause?.message ?? cause));
          });
        return () => {
          cancelled = true;
        };
      }, [props.remote]);

      const select = async (provider, model, effort) => {
        const remote = props.remote ?? null;
        const sessionId = snapshot?.activeSessionId ?? null;
        if (remote === null || remote.session === undefined) return;
        if (sessionId === null) {
          setMessage('还没有活动会话:先打开一个对话再切换');
          return;
        }
        setBusy(true);
        setMessage('');
        try {
          const result = await remote.session.selectModel({
            sessionId,
            provider,
            model,
            ...(effort === undefined ? {} : { reasoningEffort: effort }),
          });
          setMessage(
            result !== null && result !== undefined && result.ok === true
              ? `已切换到 ${model}`
              : '切换被拒绝',
          );
        } catch (cause) {
          setMessage(`切换失败:${String(cause?.message ?? cause)}`);
        } finally {
          setBusy(false);
        }
      };

      const balanceRows =
        snapshot?.balance?.ready === true && snapshot.balance.wallets.length > 0
          ? snapshot.balance.wallets.map((wallet) =>
              h('div', { key: wallet.currency, className: 'dbp-panelRow' }, [
                h('span', { key: 'l' }, `${wallet.currency} 合计`),
                h('span', { key: 'v' }, `${wallet.totalText}(充值 ${wallet.normalText} / 赠金 ${wallet.bonusText})`),
              ]),
            )
          : h('div', { key: 'none', className: 'dbp-dim' }, '余额不可用:需要以 DeepSeek 账号登录');

      return h('section', { className: 'dbp-section' }, [
        h('div', { key: 'title', className: 'dbp-title' }, '余额小人'),
        h(
          'p',
          { key: 'hint', className: 'dbp-hint' },
          '右下角常驻显示账号余额与峰谷计费时段。峰时(2 倍价)小人会提醒,但不会拦截发送。',
        ),

        h('div', { key: 'peakCard', className: 'dbp-card' }, [
          h('div', { key: 't', className: 'dbp-panelRow' }, [
            h('span', { key: 'l' }, '当前计费时段'),
            h(
              'span',
              { key: 'v', className: snapshot?.peak?.active === true ? 'dbp-stage dbp-stage-peak' : 'dbp-stage dbp-stage-off' },
              (snapshot?.peak?.multiplier === 2 ? '×2 ' : '×1 ') + String(snapshot?.texts?.stageName ?? '—'),
            ),
          ]),
          h('div', { key: 'd', className: 'dbp-dim' }, snapshot?.texts?.peakDetail ?? '等待桥接数据…'),
          h(
            'div',
            { key: 'w', className: 'dbp-dim' },
            `官方规则:UTC 01:00-04:00 与 06:00-10:00,周一至周五;本地为 ${
              snapshot?.texts?.windowLabels?.join('、') ?? '—'
            };低谷价是高峰价的一半。`,
          ),
          snapshot?.peak?.holidayData !== undefined
            ? h(
                'div',
                { key: 'h', className: 'dbp-dim' },
                `节假日数据:${String(snapshot.peak.holidayData.source)}(覆盖到 ${String(
                  snapshot.peak.holidayData.through,
                )} 年)`,
              )
            : null,
        ]),

        h('div', { key: 'balanceCard', className: 'dbp-card' }, [
          h('div', { key: 't', className: 'dbp-title' }, '余额'),
          ...(Array.isArray(balanceRows) ? balanceRows : [balanceRows]),
        ]),

        h('div', { key: 'modelCard', className: 'dbp-card' }, [
          h('div', { key: 't', className: 'dbp-title' }, '模型切换'),
          error !== ''
            ? h('div', { key: 'err', className: 'dbp-dim' }, error)
            : catalog === null
              ? h('div', { key: 'loading', className: 'dbp-dim' }, '正在读取模型目录…')
              : h(
                  'div',
                  { key: 'groups', className: 'dbp-chips' },
                  catalog.groups.flatMap((group) =>
                    group.models.map((model) =>
                      h(
                        'button',
                        {
                          key: `${group.id}/${model.id}`,
                          type: 'button',
                          className:
                            'dbp-chip' +
                            (catalog.default?.provider === group.id && catalog.default?.model === model.id
                              ? ' dbp-chip-on'
                              : ''),
                          disabled: busy,
                          onClick: () => void select(group.id, model.id, model.reasoning?.defaultEffort),
                        },
                        `${group.name} · ${model.name}`,
                      ),
                    ),
                  ),
                ),
          message !== '' ? h('div', { key: 'msg', className: 'dbp-dim' }, message) : null,
          h(
            'div',
            { key: 'note', className: 'dbp-dim' },
            '切换作用于 Host 报告的活动会话,与输入框上的模型控件是同一套路由。',
          ),
        ]),

        h('div', { key: 'petCard', className: 'dbp-card' }, [
          h('div', { key: 't', className: 'dbp-title' }, '小人状态'),
          h('div', { key: 's', className: 'dbp-panelRow' }, [
            h('span', { key: 'l' }, '桥接'),
            h('span', { key: 'v' }, status),
          ]),
          h('div', { key: 'm', className: 'dbp-panelRow' }, [
            h('span', { key: 'l' }, '当前心情'),
            h('span', { key: 'v' }, snapshot?.thinking?.situation ?? '—'),
          ]),
          h('div', { key: 'c', className: 'dbp-panelRow' }, [
            h('span', { key: 'l' }, '桌面小人'),
            h(
              'span',
              { key: 'v' },
              snapshot?.bridge?.clients?.desktop !== null && snapshot?.bridge?.clients?.desktop !== undefined
                ? '已连接'
                : '未启动',
            ),
          ]),
          h(
            'div',
            { key: 'faces', className: 'dbp-faces' },
            EXPRESSION_NAMES.map((name) =>
              h(
                'div',
                { key: name, className: 'dbp-face', title: name },
                h(Character, { skin: 'deepseek', expression: name, size: 34 }),
              ),
            ),
          ),
          h('p', { key: 'fh', className: 'dbp-hint' }, `共 ${String(EXPRESSION_NAMES.length)} 套表情。`),
        ]),
      ]);
    }

    /* ---------------------------------------------------------------- plugin */

    const FALLBACK_TEXT = {
      'nav': 'Balance Pet',
    };
    const ZH_TEXT = {
      'nav': '余额小人',
    };

    return {
      inject: ['slots'],
      apply(ctx) {
        const slots = ctx.get('slots');
        const locale = ctx.get('locale');
        const insert = styleSink();
        // Captured here rather than declared on the registration: the client
        // service surface is reached through the plugin's own context, which is
        // stable, instead of through an undocumented declaration shape.
        const remote = ctx.get('remote');
        let t = (key) => FALLBACK_TEXT[key] ?? key;

        if (locale !== undefined && locale !== null) {
          try {
            if (typeof locale.register === 'function') {
              locale.register(NS, 'en', FALLBACK_TEXT);
              locale.register(NS, 'zh', ZH_TEXT);
            }
            if (typeof locale.bind === 'function') {
              const bound = locale.bind(NS);
              if (typeof bound === 'function') t = bound;
            }
          } catch {
            // English fallback text stays in place.
          }
        }

        if (slots === undefined || slots === null || typeof slots.register !== 'function') {
          console.error('[balance-pet] slots service unavailable; nothing was mounted');
          return;
        }

        let disposeStyles = null;
        try {
          disposeStyles = insert(CSS);
        } catch (error) {
          console.error('[balance-pet] stylesheet injection failed', error);
        }

        try {
          slots.inject('shell.overlay', () =>
            slots.register({ name: 'shell.overlay', id: 'balance-pet', order: 50 }, PetOverlay),
          );
        } catch (error) {
          console.error('[balance-pet] overlay registration failed', error);
        }

        try {
          slots.inject('settings.section', () =>
            slots.register(
              { name: 'settings.section', id: 'balance-pet', order: 30, label: () => t('nav') },
              () => h(SettingsSection, { remote }),
            ),
          );
        } catch (error) {
          console.error('[balance-pet] settings registration failed', error);
        }

        ctx.effect(() => () => {
          if (typeof disposeStyles === 'function') disposeStyles();
        });
      },
    };
  },
});
