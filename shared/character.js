/**
 * The character, defined exactly once.
 *
 * WHY THIS MODULE EXISTS SEPARATELY
 * The pet appears in two places - inside the Harness window and in its own
 * desktop window - and it has 24 expressions across 3 companions. Drawing that
 * twice guarantees the two copies drift, and a face that differs between the two
 * surfaces is precisely the kind of thing nobody notices until it looks broken.
 *
 * So the drawing lives here as a pure SVG string builder. The Host half serves
 * this file itself (over the bridge) to the desktop window as a real ES module,
 * and the in-window pet uses the same expression names, skin keys and
 * situation mapping - a mismatch there fails the self-check rather than shipping.
 *
 * @module dsh-balance-pet/shared/character
 */

/**
 * The expression vocabulary: 24 faces.
 *
 * `mark` is the floating symbol beside the head; `anim` names a CSS animation
 * the surface is expected to provide (and to disable under reduced motion).
 */
export const EXPRESSIONS = Object.freeze({
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
});

/** Every expression name, in declaration order. */
export const EXPRESSION_NAMES = Object.freeze(Object.keys(EXPRESSIONS));

/** The three companions. `ink` is the facial line colour. */
export const SKINS = Object.freeze({
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
});

/** Skin keys, in display order. */
export const SKIN_ORDER = Object.freeze(Object.keys(SKINS));

/**
 * Situation to face. The Host reports a situation derived from the agent's
 * reasoning; this is where that vocabulary meets the expression vocabulary.
 */
export const SITUATION_FACE = Object.freeze({
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
});

/** Escape text destined for markup. @param value - raw text. @returns safe text. */
function esc(value) {
  return String(value).replace(/[&<>"']/gu, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

/**
 * Render one eye as SVG.
 * @param kind - eye shape.
 * @param skin - palette.
 * @param side - `-1` left, `1` right.
 * @returns SVG markup.
 */
function eyeSvg(kind, skin, side) {
  const cx = side < 0 ? 23 : 37;
  const cy = 33;
  switch (kind) {
    case 'closed':
      return `<path d="M${cx - 4} ${cy}q4 3 8 0" fill="none" stroke="${skin.ink}" stroke-width="1.8" stroke-linecap="round"/>`;
    case 'happy':
      return `<path d="M${cx - 4} ${cy + 1}q4 -5 8 0" fill="none" stroke="${skin.ink}" stroke-width="1.9" stroke-linecap="round"/>`;
    case 'wide':
      return `<circle cx="${cx}" cy="${cy}" r="4" fill="#fff" stroke="${skin.ink}" stroke-width="1.2"/><circle cx="${cx}" cy="${cy}" r="2" fill="${skin.ink}"/>`;
    case 'sad':
      return `<ellipse cx="${cx}" cy="${cy}" rx="2.6" ry="3" fill="${skin.ink}"/><path d="M${cx - 4} ${cy - 5}q4 2 8 0" fill="none" stroke="${skin.ink}" stroke-width="1.4"/>`;
    case 'half':
      return `<path d="M${cx - 4} ${cy}q4 4 8 0z" fill="${skin.ink}"/>`;
    case 'side':
      return `<ellipse cx="${cx}" cy="${cy}" rx="2.4" ry="3.2" fill="${skin.ink}"/><circle cx="${cx + side}" cy="${cy - 1.4}" r="0.9" fill="#fff"/>`;
    case 'sharp':
      return `<path d="M${cx - 4} ${cy - 2}l8 3l-8 3z" fill="${skin.ink}"/>`;
    case 'teary':
      return `<ellipse cx="${cx}" cy="${cy}" rx="2.8" ry="3.4" fill="${skin.ink}"/><circle cx="${cx}" cy="${cy + 5}" r="1.6" fill="#7ec8ff" opacity="0.9"/>`;
    case 'star':
      return `<path d="M${cx} ${cy - 4.5}l1.4 3l3.2 0.4l-2.3 2.2l0.6 3.2l-2.9-1.6l-2.9 1.6l0.6-3.2l-2.3-2.2l3.2-0.4z" fill="#ffd35c" stroke="#c98a12" stroke-width="0.6"/>`;
    case 'heart':
      return `<path d="M${cx} ${cy + 3}c-4-3-6-5-4-7c1.4-1.4 3.2-0.4 4 1c0.8-1.4 2.6-2.4 4-1c2 2 0 4-4 7z" fill="#ff7a90"/>`;
    case 'cross':
      return `<g stroke="${skin.ink}" stroke-width="1.8" stroke-linecap="round"><path d="M${cx - 3} ${cy - 3}l6 6"/><path d="M${cx + 3} ${cy - 3}l-6 6"/></g>`;
    case 'spiral':
      return `<path d="M${cx} ${cy}m0-3a3 3 0 1 1-3 3a1.6 1.6 0 1 0 1.6-1.6" fill="none" stroke="${skin.ink}" stroke-width="1.2"/>`;
    case 'wink':
      return side < 0
        ? `<path d="M${cx - 4} ${cy}q4 3 8 0" fill="none" stroke="${skin.ink}" stroke-width="1.8" stroke-linecap="round"/>`
        : `<ellipse cx="${cx}" cy="${cy}" rx="2.6" ry="3.2" fill="${skin.ink}"/>`;
    case 'open':
    default:
      return `<ellipse cx="${cx}" cy="${cy}" rx="2.6" ry="3.2" fill="${skin.ink}"/><circle cx="${cx + 0.9}" cy="${cy - 1.3}" r="1" fill="#fff"/>`;
  }
}

/**
 * Render the mouth as SVG.
 * @param kind - mouth shape.
 * @param skin - palette.
 * @returns SVG markup.
 */
function mouthSvg(kind, skin) {
  const stroke = `fill="none" stroke="${skin.ink}" stroke-width="1.6" stroke-linecap="round"`;
  switch (kind) {
    case 'grin':
      return `<path d="M25 39q5 5 10 0q-5 2-10 0z" fill="${skin.ink}" opacity="0.9"/>`;
    case 'open':
      return `<ellipse cx="30" cy="41" rx="3.4" ry="3.8" fill="#c8564f" stroke="${skin.ink}" stroke-width="1"/>`;
    case 'o':
      return `<ellipse cx="30" cy="41" rx="2.2" ry="2.8" fill="#c8564f" stroke="${skin.ink}" stroke-width="1"/>`;
    case 'flat':
      return `<path d="M26 41h8" ${stroke}/>`;
    case 'frown':
      return `<path d="M26 42q4-4 8 0" ${stroke}/>`;
    case 'smirk':
      return `<path d="M26 41q4 0 8-3" ${stroke}/>`;
    case 'wavy':
      return `<path d="M25 41q2-3 4 0t4 0t2-3" ${stroke}/>`;
    case 'small':
      return `<path d="M28 41q2 2 4 0" ${stroke}/>`;
    case 'smile':
    default:
      return `<path d="M26 40q4 3 8 0" ${stroke}/>`;
  }
}

/**
 * Render the brows as SVG.
 * @param kind - brow shape.
 * @param skin - palette.
 * @returns SVG markup, or an empty string.
 */
function browSvg(kind, skin) {
  const stroke = `fill="none" stroke="${skin.ink}" stroke-width="1.4" stroke-linecap="round"`;
  switch (kind) {
    case 'raised':
      return `<path d="M19 27q4-2 8 0" ${stroke}/><path d="M33 27q4-2 8 0" ${stroke}/>`;
    case 'furrowed':
      return `<path d="M19 26l8 3" ${stroke}/><path d="M33 29l8-3" ${stroke}/>`;
    case 'one':
      return `<path d="M33 26q4-2 8 1" ${stroke}/>`;
    case 'sad':
      return `<path d="M19 28q4 2 8 0" ${stroke}/><path d="M33 28q4 2 8 0" ${stroke}/>`;
    case 'none':
    default:
      return '';
  }
}

/**
 * Render the floating mark as SVG.
 * @param kind - mark name.
 * @returns SVG markup, or an empty string.
 */
function markSvg(kind) {
  switch (kind) {
    case 'sparkle':
      return '<path d="M50 14l1.5 3.5l3.5 1.5l-3.5 1.5l-1.5 3.5l-1.5-3.5l-3.5-1.5l3.5-1.5z" fill="#ffe066"/>';
    case 'tear':
      return '<path d="M46 26q3 4 0 6q-3-2 0-6z" fill="#7ec8ff"/>';
    case 'anger':
      return '<g stroke="#e0555a" stroke-width="2" stroke-linecap="round"><path d="M46 16l4 4"/><path d="M50 16l-4 4"/></g>';
    case 'question':
      return '<text x="50" y="20" font-size="12" font-weight="700" fill="#e8a55a" text-anchor="middle">?</text>';
    case 'exclaim':
      return '<text x="50" y="20" font-size="12" font-weight="700" fill="#e0555a" text-anchor="middle">!</text>';
    case 'dots':
      return '<g fill="#9aa4b2"><circle cx="44" cy="16" r="1.5"/><circle cx="48" cy="16" r="1.5"/><circle cx="52" cy="16" r="1.5"/></g>';
    case 'zzz':
      return '<text x="50" y="18" font-size="11" font-weight="700" fill="#9aa4b2" text-anchor="middle">z Z</text>';
    case 'sweat':
      return '<path d="M50 18q3 4 0 6q-3-2 0-6z" fill="#7ec8ff" opacity="0.85"/>';
    case 'heart':
      return '<path d="M50 20c-3-2.4-4.5-4-3-5.6c1-1 2.4-0.3 3 0.8c0.6-1.1 2-1.8 3-0.8c1.5 1.6 0 3.2-3 5.6z" fill="#ff7a90"/>';
    case 'coin':
      return '<circle cx="50" cy="17" r="5" fill="#ffd35c" stroke="#c98a12" stroke-width="0.8"/><text x="50" y="20.5" font-size="7" font-weight="700" fill="#8a6314" text-anchor="middle">¥</text>';
    case 'note':
      return '<text x="50" y="20" font-size="12" fill="#7f8c9b" text-anchor="middle">♪</text>';
    case 'skull':
      return '<text x="50" y="20" font-size="12" fill="#7f8c9b" text-anchor="middle">×</text>';
    case 'spiral':
      return '<path d="M50 17m0-4a4 4 0 1 1-4 4a2 2 0 1 0 2-2" fill="none" stroke="#9aa4b2" stroke-width="1.2"/>';
    default:
      return '';
  }
}

/**
 * Draw one companion in one expression.
 *
 * @param skinKey - a key of {@link SKINS}.
 * @param expressionName - a key of {@link EXPRESSIONS}.
 * @param size - rendered width and height in pixels.
 * @returns a self-contained `<svg>` element as markup.
 */
export function characterSvg(skinKey, expressionName, size) {
  const skin = SKINS[skinKey] ?? SKINS.deepseek;
  const face = EXPRESSIONS[expressionName] ?? EXPRESSIONS.idle;
  const animation = face.anim === null ? '' : ` dbp-anim-${face.anim}`;
  const label = esc(`${skin.label} ${expressionName}`);
  return [
    `<svg class="dbp-pet-svg${animation}" viewBox="0 0 64 64" width="${size}" height="${size}"`,
    ` role="img" aria-label="${label}" xmlns="http://www.w3.org/2000/svg">`,
    '<ellipse cx="32" cy="55" rx="16" ry="3.4" fill="#000" opacity="0.14"/>',
    `<path d="M16 23c-3-6-1-10 3-10 3 0 5 3 6 6z" fill="${skin.ear}"/>`,
    `<path d="M46 23c3-6 1-10-3-10-3 0-5 3-6 6z" fill="${skin.ear}"/>`,
    `<ellipse cx="31" cy="34" rx="17" ry="15" fill="${skin.body}"/>`,
    `<ellipse cx="31" cy="30" rx="17" ry="11" fill="${skin.body}" opacity="0.55"/>`,
    `<ellipse cx="31" cy="34" rx="17" ry="15" fill="none" stroke="${skin.bodyDeep}" stroke-width="1" opacity="0.7"/>`,
    browSvg(face.brow, skin),
    eyeSvg(face.eyes, skin, -1),
    eyeSvg(face.eyes, skin, 1),
    `<circle cx="19" cy="39" r="2.2" fill="${skin.blush}" opacity="0.5"/>`,
    `<circle cx="43" cy="39" r="2.2" fill="${skin.blush}" opacity="0.5"/>`,
    mouthSvg(face.mouth, skin),
    markSvg(face.mark),
    '</svg>',
  ].join('');
}
