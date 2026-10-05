/**
 * dsh-balance-pet self-check.
 *
 * Runs on plain Node with no DOM, no Electron and no Harness: every module under
 * test is a pure function, which is exactly why the shared layer was split out.
 *
 * The point of these assertions is the boundary behaviour. Peak billing is a
 * half-open window against a UTC clock AND a Chinese-holiday calendar, so an
 * off-by-one at 04:00 or a missed holiday costs the user real money - and a
 * "looks right when I ran it" check would not catch either.
 *
 * Usage: node test/check.mjs
 */

import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  PEAK_MULTIPLIER,
  classify,
  describeReason,
  inPeakWindow,
  isPeak,
  localWindowLabels,
  nextTransition,
  peakStateAt,
} from '../shared/peak.js';
import {
  currencySymbol,
  formatBalance,
  formatDuration,
  isValidAmount,
  summarizeBalance,
  sumAmounts,
  toAmount,
} from '../shared/budget.js';
import {
  HOLIDAY_DATA_THROUGH,
  chinaDateKey,
  holidayDataCovers,
  holidayNameAt,
  makeupWorkdayNameAt,
} from '../shared/holidays.js';
import { DEFAULT_SITUATION, SITUATIONS, classifySituation } from '../shared/situation.js';
import {
  IDLE_LINES,
  PEAK_WARNING_LINES,
  SITUATION_LINES,
  pickIdleLine,
  pickPeakWarning,
  pickSituationLine,
  stageName,
} from '../shared/lines.js';
import {
  EXPRESSIONS,
  EXPRESSION_NAMES,
  SITUATION_FACE,
  SKINS,
  SKIN_ORDER,
  characterSvg,
} from '../shared/character.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The client half's source.
 *
 * Read once, up here: several assertion groups below inspect it statically, and
 * a later `const` would leave them in the temporal dead zone.
 */
const CLIENT_SOURCE = readFileSync(join(ROOT, 'client.js'), 'utf8');

/* ------------------------------------------------------------------ harness */

let passed = 0;
const failures = [];

/**
 * Run one named assertion group.
 * @param name - what the group proves.
 * @param body - the assertions.
 */
function check(name, body) {
  try {
    body();
    passed += 1;
  } catch (error) {
    failures.push({ name, error });
  }
}

/** Build a UTC instant. @returns {Date} the instant. */
function utc(year, month, day, hour, minute = 0) {
  return new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0));
}

/* ------------------------------------------------------- peak: the calendar */

check('peak: weekday inside 01:00-04:00 UTC is peak', () => {
  const state = peakStateAt(utc(2026, 10, 8, 2));
  assert.equal(state.peak, true);
  assert.equal(state.reason, 'peak-window');
  assert.equal(state.multiplier, PEAK_MULTIPLIER);
});

check('peak: weekday inside 06:00-10:00 UTC is peak', () => {
  assert.equal(peakStateAt(utc(2026, 10, 8, 7)).peak, true);
});

check('peak: window start is inclusive, window end is exclusive', () => {
  // 01:00 starts peak, 04:00 has already left it, 06:00 starts, 10:00 exits.
  assert.equal(isPeak(utc(2026, 10, 8, 1, 0)), true);
  assert.equal(isPeak(utc(2026, 10, 8, 3, 59)), true);
  assert.equal(isPeak(utc(2026, 10, 8, 4, 0)), false);
  assert.equal(isPeak(utc(2026, 10, 8, 6, 0)), true);
  assert.equal(isPeak(utc(2026, 10, 8, 9, 59)), true);
  assert.equal(isPeak(utc(2026, 10, 8, 10, 0)), false);
});

check('peak: the gap between the two windows is off-peak', () => {
  const state = peakStateAt(utc(2026, 10, 8, 5));
  assert.equal(state.peak, false);
  assert.equal(state.reason, 'off-hours');
  assert.equal(state.multiplier, 1);
});

check('peak: hours outside both windows are off-peak', () => {
  for (const hour of [0, 4, 5, 10, 12, 18, 23]) {
    assert.equal(isPeak(utc(2026, 10, 8, hour)), false, `hour ${String(hour)} should be off-peak`);
  }
});

check('peak: Chinese public holidays are off-peak even inside a window', () => {
  // 2026-10-05 is a Monday inside National Day week: weekday AND in-window,
  // yet the holiday exclusion must still win.
  const state = peakStateAt(utc(2026, 10, 5, 2));
  assert.equal(state.reason, 'holiday');
  assert.equal(state.holiday, '国庆节');
  assert.equal(state.peak, false);
  assert.equal(state.inWindow, true, 'the clock alone would have said peak');
});

check('peak: Spring Festival days are off-peak', () => {
  const state = peakStateAt(utc(2026, 2, 17, 2));
  assert.equal(state.peak, false);
  assert.equal(state.reason, 'holiday');
});

check('peak: weekends are off-peak all day', () => {
  for (const hour of [0, 2, 7, 15, 23]) {
    assert.equal(isPeak(utc(2026, 10, 11, hour)), false, `Sunday hour ${String(hour)}`);
  }
  assert.equal(peakStateAt(utc(2026, 10, 11, 2)).reason, 'weekend');
});

check('peak: a makeup workday on a weekend stays off-peak by default', () => {
  // 2026-10-10 is a Saturday that the State Council turned into a workday.
  // The official rule says "Monday through Friday", so the literal reading is
  // off-peak - this is the documented default, not an oversight.
  assert.equal(makeupWorkdayNameAt(utc(2026, 10, 10, 2)), '国庆节后补班');
  const literal = peakStateAt(utc(2026, 10, 10, 2));
  assert.equal(literal.peak, false);
  // Not "weekend": the user is working that day, and saying otherwise is a
  // visible lie. It gets a dedicated reason so the wording can explain it.
  assert.equal(literal.reason, 'makeup-workday');
  assert.equal(literal.makeupWorkday, '国庆节后补班');
});

check('peak: the opt-in reading promotes a makeup workday to a weekday', () => {
  const promoted = peakStateAt(utc(2026, 10, 10, 2), { treatMakeupWorkdaysAsWeekday: true });
  assert.equal(promoted.peak, true);
  assert.equal(promoted.reason, 'peak-window');
});

check('peak: user holiday overrides can cancel a built-in holiday', () => {
  // A user outside mainland China can drop the exclusion entirely.
  const raw = isPeak(utc(2026, 10, 5, 2));
  const overridden = isPeak(utc(2026, 10, 5, 2), { holidays: { '2026-10-05': null } });
  assert.equal(raw, false);
  assert.equal(overridden, true);
});

check('peak: user holiday overrides can add a holiday', () => {
  const added = isPeak(utc(2026, 10, 8, 2), { holidays: { '2026-10-08': '公司年会' } });
  assert.equal(added, false);
  assert.equal(holidayNameAt(utc(2026, 10, 8, 2), { '2026-10-08': '公司年会' }), '公司年会');
});

/* ------------------------------------------------------ peak: the transitions */

check('peak: next transition leaves a peak window at its end', () => {
  const next = nextTransition(utc(2026, 10, 8, 2), undefined);
  assert.equal(next.toISOString(), utc(2026, 10, 8, 4).toISOString());
});

check('peak: next transition enters the second window', () => {
  const next = nextTransition(utc(2026, 10, 8, 5), undefined);
  assert.equal(next.toISOString(), utc(2026, 10, 8, 6).toISOString());
});

check('peak: next transition from mid-window is exact to the hour', () => {
  const next = nextTransition(utc(2026, 10, 8, 2, 37), undefined);
  assert.equal(next.toISOString(), utc(2026, 10, 8, 4).toISOString());
});

check('peak: next transition after the last window rolls to the next day', () => {
  const next = nextTransition(utc(2026, 10, 8, 11), undefined);
  assert.equal(next.toISOString(), utc(2026, 10, 9, 1).toISOString());
});

check('peak: the snapshot reports the transition and its direction', () => {
  const state = peakStateAt(utc(2026, 10, 8, 2));
  assert.equal(state.nextChangeAt, utc(2026, 10, 8, 4).toISOString());
  assert.equal(state.nextChangeIsPeak, false);
  const offPeak = peakStateAt(utc(2026, 10, 8, 5));
  assert.equal(offPeak.nextChangeAt, utc(2026, 10, 8, 6).toISOString());
  assert.equal(offPeak.nextChangeIsPeak, true);
});

check('peak: a snapshot is JSON-serializable (it crosses the bridge)', () => {
  const state = peakStateAt(utc(2026, 10, 8, 2));
  const round = JSON.parse(JSON.stringify(state));
  assert.deepEqual(round, state);
});

/* --------------------------------------------------- peak: timezone + wording */

check('peak: inPeakWindow ignores the day, classify does not', () => {
  // Saturday 02:00 UTC is inside the window but is still off-peak.
  assert.equal(inPeakWindow(utc(2026, 10, 10, 2)), true);
  assert.equal(classify(utc(2026, 10, 10, 2), undefined).peak, false);
});

check('peak: windows render in UTC+8 as 09:00-12:00 and 14:00-18:00', () => {
  assert.deepEqual(localWindowLabels(480), ['09:00-12:00', '14:00-18:00']);
  assert.deepEqual(localWindowLabels(0), ['01:00-04:00', '06:00-10:00']);
});

check('peak: window labels wrap correctly across midnight', () => {
  // UTC-8: 01:00 UTC is 17:00 the previous day; the label must not go negative.
  assert.deepEqual(localWindowLabels(-480), ['17:00-20:00', '22:00-02:00']);
});

check('peak: every reason gets a sentence, and peak names the multiplier', () => {
  const cases = [
    [utc(2026, 10, 8, 2), '2 倍'],
    [utc(2026, 10, 8, 5), '低谷'],
    [utc(2026, 10, 11, 2), '周末'],
    [utc(2026, 10, 5, 2), '国庆节'],
    [utc(2026, 10, 10, 2), '补班'],
  ];
  for (const [instant, needle] of cases) {
    const text = describeReason(peakStateAt(instant), 480);
    assert.ok(text.includes(needle), `expected "${needle}" in "${text}"`);
  }
});

/* -------------------------------------------------------- holidays: calendar */

check('holidays: Chinese civil dates are computed at UTC+8, not UTC', () => {
  // 16:00 UTC is already the next day in China - the boundary that decides
  // whether a holiday exclusion is still active.
  assert.equal(chinaDateKey(utc(2026, 10, 4, 15, 59)), '2026-10-04');
  assert.equal(chinaDateKey(utc(2026, 10, 4, 16, 0)), '2026-10-05');
});

check('holidays: the table covers the configured year and flags the future', () => {
  assert.equal(HOLIDAY_DATA_THROUGH, 2026);
  assert.equal(holidayDataCovers(utc(2026, 6, 1, 0)), true);
  assert.equal(holidayDataCovers(utc(2027, 1, 5, 0)), false);
});

check('holidays: an ordinary weekday is not a holiday', () => {
  assert.equal(holidayNameAt(utc(2026, 10, 8, 2)), null);
});

/* ------------------------------------------------------------- budget: parse */

check('budget: Platform decimals are valid, including the awkward ones', () => {
  for (const raw of ['0E-16', '5.0000000000000000', '.5', '-1.5e3', '0.1', '100', '-0.25']) {
    assert.equal(isValidAmount(raw), true, `${raw} should be valid`);
  }
});

check('budget: malformed and non-string amounts are rejected', () => {
  for (const raw of ['', 'abc', 'NaN', 'Infinity', '1,000', '1.2.3', '0x10', 12, null, undefined, {}]) {
    assert.equal(isValidAmount(raw), false, `${String(raw)} should be invalid`);
  }
});

check('budget: an emptied wallet reads as zero, not as an error', () => {
  assert.equal(toAmount('0E-16'), 0);
  assert.equal(formatBalance('0E-16', { symbol: '¥' }), '¥0.00');
});

check('budget: a sub-cent wallet is not rounded away to nothing', () => {
  assert.equal(formatBalance('0.005', { symbol: '¥' }), '¥<0.01');
  assert.equal(formatBalance('0.004', { symbol: '¥' }), '¥<0.01');
});

check('budget: two decimals, with optional grouping', () => {
  assert.equal(formatBalance('5.0000000000000000', { symbol: '¥' }), '¥5.00');
  assert.equal(formatBalance('1234.5', { symbol: '¥', group: true }), '¥1,234.50');
  assert.equal(formatBalance('1234567.891', { symbol: '¥', group: true }), '¥1,234,567.89');
  assert.equal(formatBalance('-12.345', { symbol: '¥' }), '-¥12.35');
});

check('budget: unparseable input yields the placeholder, never NaN', () => {
  assert.equal(formatBalance(null), '—');
  assert.equal(formatBalance('abc', { placeholder: 'n/a' }), 'n/a');
});

check('budget: currency symbols resolve with a safe fallback', () => {
  assert.equal(currencySymbol('CNY'), '¥');
  assert.equal(currencySymbol('USD'), '$');
  assert.equal(currencySymbol('EUR'), 'EUR ');
});

/* --------------------------------------------------------------- budget: sum */

check('budget: addition is exact where floats are not', () => {
  // 0.1 + 0.2 !== 0.3 in binary floating point; money must not inherit that.
  assert.equal(sumAmounts(['0.1', '0.2']), '0.3');
  assert.equal(sumAmounts(['0.001', '0.002']), '0.003');
});

check('budget: exponent-form amounts sum without losing precision', () => {
  assert.equal(sumAmounts(['0E-16', '5.0000000000000000']), '5.0000000000000000');
});

check('budget: empty and malformed inputs are handled explicitly', () => {
  assert.equal(sumAmounts([]), null);
  assert.equal(sumAmounts(['abc']), null);
});

check('budget: mixed magnitudes align on a common scale', () => {
  assert.equal(sumAmounts(['100', '0.5']), '100.5');
  assert.equal(sumAmounts(['1e3', '1']), '1001');
});

/* ------------------------------------------------------- budget: the snapshot */

check('budget: topped-up and granted credit are reported separately and together', () => {
  const summary = summarizeBalance({
    status: 'ready',
    value: [{ currency: 'CNY', balance: '12.5' }],
    bonusWallets: [{ currency: 'CNY', balance: '3.25' }],
  });
  assert.equal(summary.ready, true);
  assert.equal(summary.wallets.length, 1);
  assert.equal(summary.primary.normalText, '¥12.50');
  assert.equal(summary.primary.bonusText, '¥3.25');
  assert.equal(summary.primary.totalText, '¥15.75');
  assert.equal(summary.hasCredit, true);
});

check('budget: an all-zero account reports no credit', () => {
  const summary = summarizeBalance({
    status: 'ready',
    value: [{ currency: 'CNY', balance: '0E-16' }],
    bonusWallets: [],
  });
  assert.equal(summary.hasCredit, false);
  assert.equal(summary.primary.totalText, '¥0.00');
});

check('budget: multi-currency accounts stay separate and ordered', () => {
  const summary = summarizeBalance({
    status: 'ready',
    value: [
      { currency: 'USD', balance: '7' },
      { currency: 'CNY', balance: '7' },
    ],
    bonusWallets: [],
  });
  assert.deepEqual(summary.wallets.map((wallet) => wallet.currency), ['CNY', 'USD']);
  // CNY is preferred as the primary so the badge does not flip between polls.
  assert.equal(summary.primary.currency, 'CNY');
});

check('budget: a non-ready outcome is reported, never faked as zero', () => {
  for (const outcome of [undefined, null, { status: 'failed' }, { status: 'absent' }]) {
    const summary = summarizeBalance(outcome);
    assert.equal(summary.ready, false);
    assert.equal(summary.primary, null);
    assert.equal(summary.hasCredit, false);
  }
});

check('budget: malformed wallet entries are skipped, not fatal', () => {
  const summary = summarizeBalance({
    status: 'ready',
    value: [{ currency: 'CNY', balance: 'oops' }, null, { currency: 'CNY', balance: '2' }],
    bonusWallets: [],
  });
  assert.equal(summary.ready, true);
  assert.equal(summary.primary.totalText, '¥2.00');
});

check('budget: durations read naturally in Chinese', () => {
  assert.equal(formatDuration(3600 * 1000), '1 小时');
  assert.equal(formatDuration(125 * 1000), '2 分 5 秒');
  assert.equal(formatDuration(43 * 1000), '43 秒');
  assert.equal(formatDuration(-5), '0 秒');
});

/* ------------------------------------------------------------- the manifest */

check('manifest: declares the bundle patch and the client half', () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  assert.equal(manifest.name, '@local/dsh-balance-pet');
  assert.equal(manifest.type, 'module');
  assert.equal(manifest.private, true);
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml');
  assert.equal(manifest.dsh.client.platform, 'web');
  assert.equal(manifest.exports['.'], './index.js');
  assert.equal(manifest.exports['./client'], './client.js');
});

check('manifest: every declared file exists', () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  for (const entry of manifest.files) {
    if (entry.includes('*')) continue;
    statSync(join(ROOT, entry));
  }
  for (const target of [manifest.icon, manifest.dsh.bundle.patch]) {
    statSync(join(ROOT, target));
  }
});

check('manifest: the icon stays inside the platform size limit', () => {
  const size = statSync(join(ROOT, 'icon.svg')).size;
  assert.ok(size > 0 && size <= 256 * 1024, `icon is ${String(size)} bytes`);
});

check('manifest: locale files carry the documented meta fields', () => {
  for (const language of ['zh', 'en']) {
    const locale = JSON.parse(readFileSync(join(ROOT, 'locale', `${language}.json`), 'utf8'));
    assert.equal(typeof locale.meta.title, 'string');
    assert.ok(locale.meta.title.length > 0);
    assert.equal(typeof locale.meta.description, 'string');
    assert.ok(locale.meta.description.length > 0);
  }
});

check('bundle patch: inserts exactly one row naming this package', () => {
  const patch = readFileSync(join(ROOT, 'cordis.patch.yml'), 'utf8');
  assert.ok(patch.includes('- insert:'), 'patch must use the insert dialect');
  assert.ok(patch.includes('id: balance-pet'));
  assert.ok(patch.includes("name: '@local/dsh-balance-pet'"));
});

/* --------------------------------------------------- situation: the classifier */

check('situation: a dead end is recognised from a real phrasing', () => {
  assert.equal(classifySituation('这条路走不通,得换个方案'), 'dead-end');
  assert.equal(classifySituation('the current approach is a dead end'), 'dead-end');
});

check('situation: errors, blocking and success are distinguished', () => {
  assert.equal(classifySituation('这里报错了,抛了 exception'), 'error');
  assert.equal(classifySituation('权限不足,被拒绝了'), 'blocked');
  assert.equal(classifySituation('测试跑通了'), 'success');
});

check('situation: billing talk is recognised, so the pet can comment on cost', () => {
  assert.equal(classifySituation('token 快烧完了,余额不够'), 'costly');
});

check('situation: empty or neutral reasoning does not invent a situation', () => {
  assert.equal(classifySituation(''), DEFAULT_SITUATION);
  assert.equal(classifySituation('   '), DEFAULT_SITUATION);
  assert.equal(classifySituation('嗯,先看一眼'), DEFAULT_SITUATION);
  assert.equal(classifySituation(undefined), DEFAULT_SITUATION);
});

check('situation: the situation list is unique and includes the default', () => {
  assert.equal(new Set(SITUATIONS).size, SITUATIONS.length);
  assert.ok(SITUATIONS.includes(DEFAULT_SITUATION));
  assert.ok(SITUATIONS.length >= 15);
});

/* ------------------------------------------------------------- lines: the copy */

check('lines: the two stages carry the requested names', () => {
  assert.equal(stageName(true), '梁文锋时段');
  assert.equal(stageName(false), '梁文谷时段');
});

check('lines: every situation has something to say', () => {
  for (const situation of SITUATIONS) {
    const lines = SITUATION_LINES[situation];
    assert.ok(Array.isArray(lines) && lines.length > 0, `${situation} has no line bank`);
  }
});

check('lines: no line is empty and none leaks a template placeholder', () => {
  const all = [...IDLE_LINES, ...PEAK_WARNING_LINES, ...Object.values(SITUATION_LINES).flat()];
  for (const line of all) {
    assert.equal(typeof line, 'string');
    assert.ok(line.trim().length > 0, 'an empty line would render as an empty bubble');
    assert.ok(!line.includes('undefined'), `"${line}" carries an unresolved value`);
    assert.ok(!/\$\{/u.test(line), `"${line}" still contains a template expression`);
  }
});

check('lines: the peak warning states the doubling unambiguously', () => {
  // This sentence exists to prevent an expensive accident, so it must name both
  // the multiplier and the stage.
  assert.ok(PEAK_WARNING_LINES[0].includes('2 倍'));
  assert.ok(PEAK_WARNING_LINES[0].includes('梁文锋时段'));
});

check('lines: selection is deterministic under an injected random source', () => {
  assert.equal(pickIdleLine(() => 0), IDLE_LINES[0]);
  assert.equal(pickPeakWarning(() => 0), PEAK_WARNING_LINES[0]);
  assert.equal(pickSituationLine('error', () => 0), SITUATION_LINES.error[0]);
});

check('lines: the neutral face stays quiet most of the time', () => {
  // Otherwise the pet talks on every idle tick and becomes wallpaper.
  assert.equal(pickSituationLine(DEFAULT_SITUATION, () => 0.9), null);
  assert.notEqual(pickSituationLine(DEFAULT_SITUATION, () => 0.05), null);
});

check('lines: a situation with no bank stays silent rather than throwing', () => {
  assert.equal(pickSituationLine('no-such-situation', () => 0), null);
});

/* ------------------------------------------- the shared character definition */

check('character: the shared module defines the same vocabulary as the pet', () => {
  assert.ok(EXPRESSION_NAMES.length >= 18, `only ${String(EXPRESSION_NAMES.length)} expressions`);
  assert.equal(new Set(EXPRESSION_NAMES).size, EXPRESSION_NAMES.length);
  assert.deepEqual(SKIN_ORDER, ['deepseek', 'chatgpt', 'anthropic']);
  for (const key of SKIN_ORDER) {
    for (const field of ['label', 'body', 'bodyDeep', 'ear', 'ink', 'blush', 'accent']) {
      assert.equal(typeof SKINS[key][field], 'string', `${key}.${field} is missing`);
    }
  }
});

check('character: it draws every skin in every expression', () => {
  // 3 x 24 = 72 combinations; a missing branch would throw or emit "undefined"
  // markup and only show up when that exact face was first needed.
  let drawn = 0;
  for (const skin of SKIN_ORDER) {
    for (const expression of EXPRESSION_NAMES) {
      const svg = characterSvg(skin, expression, 64);
      assert.ok(svg.startsWith('<svg '), `${skin}/${expression} did not produce an svg element`);
      assert.ok(svg.endsWith('</svg>'), `${skin}/${expression} is not closed`);
      assert.ok(!svg.includes('undefined'), `${skin}/${expression} carries an undefined value`);
      assert.ok(!svg.includes('NaN'), `${skin}/${expression} carries NaN`);
      drawn += 1;
    }
  }
  assert.equal(drawn, SKIN_ORDER.length * EXPRESSION_NAMES.length);
});

check('character: an unknown name falls back instead of emitting broken markup', () => {
  const svg = characterSvg('nope', 'nope', 32);
  assert.ok(svg.startsWith('<svg '));
  assert.ok(!svg.includes('undefined'));
});

check('character: the situation mapping covers every situation', () => {
  for (const situation of SITUATIONS) {
    const face = SITUATION_FACE[situation];
    assert.ok(face !== undefined, `situation "${situation}" has no face`);
    assert.ok(EXPRESSIONS[face] !== undefined, `situation "${situation}" points at missing "${face}"`);
  }
});

check('character: the two drawings cannot drift apart', () => {
  // This is the guard for a deliberate duplication: the in-window pet builds
  // its SVG with React, the desktop pet builds it as a string, and they must
  // offer exactly the same faces and skins. Comparing the parsed vocabularies
  // is what turns "they look the same today" into something that stays true.
  const clientExpressions = parseExpressions();
  assert.deepEqual(
    Object.keys(clientExpressions).sort(),
    [...EXPRESSION_NAMES].sort(),
    'client.js and shared/character.js disagree about the expression set',
  );

  const skinBlock = CLIENT_SOURCE.slice(
    CLIENT_SOURCE.indexOf('const SKINS = {'),
    CLIENT_SOURCE.indexOf('const SKIN_ORDER'),
  );
  const clientSkins = [...skinBlock.matchAll(/^\s{6}([a-z]+):\s*\{/gmu)].map((match) => match[1]);
  assert.deepEqual(clientSkins.sort(), [...SKIN_ORDER].sort(), 'the skin sets differ');

  const mappingBlock = CLIENT_SOURCE.slice(
    CLIENT_SOURCE.indexOf('const SITUATION_FACE = {'),
    CLIENT_SOURCE.indexOf('\n    };', CLIENT_SOURCE.indexOf('const SITUATION_FACE = {')),
  );
  for (const [situation, face] of Object.entries(SITUATION_FACE)) {
    // Keys are written unquoted when they are plain identifiers and quoted when
    // they are not (`'dead-end'`), so both spellings have to be accepted.
    const escaped = situation.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    const pattern = new RegExp(`(?:'${escaped}'|\\b${escaped}\\b)\\s*:\\s*'${face}'`, 'u');
    assert.ok(
      pattern.test(mappingBlock),
      `client.js does not map ${situation} to ${face} like shared/character.js does`,
    );
  }
});

/* ------------------------------------------- client half: static consistency */

/**
 * Collect the `case 'x':` labels inside one renderer function.
 * @param name - the function's name.
 * @returns the labels it handles.
 */
function rendererCases(name) {
  const start = CLIENT_SOURCE.indexOf(`function ${name}(`);
  assert.ok(start > 0, `${name} was not found in client.js`);
  const end = CLIENT_SOURCE.indexOf('\n    }', start);
  const body = CLIENT_SOURCE.slice(start, end);
  return [...body.matchAll(/case '([a-z]+)':/gu)].map((match) => match[1]);
}

/** Parse the EXPRESSIONS literal out of client.js. @returns its entries. */
function parseExpressions() {
  const start = CLIENT_SOURCE.indexOf('const EXPRESSIONS = {');
  assert.ok(start > 0);
  const end = CLIENT_SOURCE.indexOf('\n    };', start);
  const body = CLIENT_SOURCE.slice(start, end);
  const entries = {};
  for (const match of body.matchAll(
    /^\s{6}([A-Za-z]+):\s*\{\s*eyes:\s*'([a-z]+)',\s*mouth:\s*'([a-z]+)',\s*brow:\s*'([a-z]+)',\s*mark:\s*(null|'([a-z]+)')/gmu,
  )) {
    entries[match[1]] = { eyes: match[2], mouth: match[3], brow: match[4], mark: match[6] ?? null };
  }
  return entries;
}

check('client: it declares a rich expression set', () => {
  const expressions = parseExpressions();
  assert.ok(
    Object.keys(expressions).length >= 18,
    `only ${String(Object.keys(expressions).length)} expressions were parsed`,
  );
});

check('client: every expression uses parts the renderers actually handle', () => {
  // A typo here falls through to the default branch and silently renders the
  // wrong face, which is invisible until someone notices one expression is off.
  const eyes = new Set(rendererCases('renderEye'));
  const mouths = new Set(rendererCases('renderMouth'));
  const brows = new Set(rendererCases('renderBrow'));
  const marks = new Set(rendererCases('renderMark'));
  const expressions = parseExpressions();
  for (const [name, face] of Object.entries(expressions)) {
    assert.ok(eyes.has(face.eyes) || face.eyes === 'open', `${name}: unhandled eyes "${face.eyes}"`);
    assert.ok(mouths.has(face.mouth) || face.mouth === 'smile', `${name}: unhandled mouth "${face.mouth}"`);
    assert.ok(brows.has(face.brow) || face.brow === 'none', `${name}: unhandled brow "${face.brow}"`);
    if (face.mark !== null) {
      assert.ok(marks.has(face.mark), `${name}: unhandled mark "${face.mark}"`);
    }
  }
});

check('client: every situation the Host can report maps to a real face', () => {
  // The two vocabularies meet in SITUATION_FACE; a missing key would leave the
  // pet expressionless exactly when it has something to react to.
  const start = CLIENT_SOURCE.indexOf('const SITUATION_FACE = {');
  const end = CLIENT_SOURCE.indexOf('\n    };', start);
  const body = CLIENT_SOURCE.slice(start, end);
  const mapping = {};
  for (const match of body.matchAll(/^\s+'?([A-Za-z-]+)'?:\s*'([a-z]+)'/gmu)) {
    mapping[match[1]] = match[2];
  }
  const expressions = parseExpressions();
  for (const situation of SITUATIONS) {
    const face = mapping[situation];
    assert.ok(face !== undefined, `situation "${situation}" has no face`);
    assert.ok(expressions[face] !== undefined, `situation "${situation}" points at missing face "${face}"`);
  }
});

check('client: all three companions are defined with a full palette', () => {
  for (const key of ['deepseek', 'chatgpt', 'anthropic']) {
    assert.ok(CLIENT_SOURCE.includes(`${key}: {`), `${key} is missing`);
  }
  for (const field of ['body:', 'bodyDeep:', 'ear:', 'ink:', 'blush:', 'accent:', 'label:']) {
    const count = (CLIENT_SOURCE.match(new RegExp(`\\s${field.replace(':', '')}:`, 'gu')) ?? []).length;
    assert.ok(count >= 3, `palette field ${field} appears ${String(count)} times, expected 3+`);
  }
});

check('client: it never imports a Harness Client package', () => {
  // Explicitly forbidden: those packages change without notice and a throw
  // blanks the slot entry.
  const requires = [...CLIENT_SOURCE.matchAll(/require\(([^)]*)\)/gu)].map((match) => match[1]);
  for (const specifier of requires) {
    assert.ok(
      !specifier.includes('@deepseek-ai'),
      `client.js must not require ${specifier}; React is the only allowed import`,
    );
  }
});

check('client: it writes no DOM outside its own elements', () => {
  // The rules forbid appending to document.body or replacing the app root.
  assert.ok(!CLIENT_SOURCE.includes('document.body'), 'client.js touches document.body');
  assert.ok(!/appendChild\(document\.body/u.test(CLIENT_SOURCE));
});

check('client: chrome styling stays on semantic tokens', () => {
  // Artwork may use literal colours; UI chrome may not, or a host restyle or a
  // third-party theme breaks the panel.
  const cssBlock = CLIENT_SOURCE.slice(
    CLIENT_SOURCE.indexOf('const CSS = ['),
    CLIENT_SOURCE.indexOf("].join('\\n');"),
  );
  const literals = [...cssBlock.matchAll(/(?:background|color|border-color):\s*(#[0-9a-f]{3,8})/giu)].map(
    (match) => match[1],
  );
  assert.deepEqual(literals, [], `chrome must not hardcode colours: ${literals.join(', ')}`);
});

check('client: it registers exactly the two intended slots', () => {
  assert.ok(CLIENT_SOURCE.includes("slots.inject('shell.overlay'"));
  assert.ok(CLIENT_SOURCE.includes("slots.inject('settings.section'"));
  const injects = [...CLIENT_SOURCE.matchAll(/slots\.inject\('([^']+)'/gu)].map((match) => match[1]);
  assert.deepEqual(injects.sort(), ['settings.section', 'shell.overlay']);
});

check('client: the module id matches the package manifest', () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  assert.ok(CLIENT_SOURCE.includes(`id: '${manifest.name}'`), 'the loader key must equal the package name');
});

check('client: the bridge global it reads is the one the Host writes', () => {
  const host = readFileSync(join(ROOT, 'index.js'), 'utf8');
  const written = /const BRIDGE_GLOBAL = '([^']+)'/u.exec(host);
  assert.ok(written !== null, 'index.js no longer declares BRIDGE_GLOBAL');
  assert.ok(
    CLIENT_SOURCE.includes(`globalThis.${written[1]}`),
    `client.js does not read ${written[1]}`,
  );
});

check('client: no animation ignores the reduced-motion preference', () => {
  assert.ok(CLIENT_SOURCE.includes('@media (prefers-reduced-motion: reduce)'));
});

/* ------------------------------------------------------------------ report */

const total = passed + failures.length;
if (failures.length === 0) {
  console.log(`dsh-balance-pet self-check: ${String(passed)}/${String(total)} passed`);
  process.exit(0);
}
console.error(`dsh-balance-pet self-check: ${String(passed)}/${String(total)} passed, ${String(failures.length)} FAILED\n`);
for (const { name, error } of failures) {
  console.error(`FAIL  ${name}`);
  console.error(`      ${error.message.split('\n').join('\n      ')}\n`);
}
process.exit(1);
