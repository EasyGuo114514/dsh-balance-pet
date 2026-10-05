/**
 * Balance parsing, validation and formatting.
 *
 * WHERE THE NUMBERS COME FROM
 * DSH's account remote returns DeepSeek Platform's `get_user_summary` projection:
 * two wallet lists, each entry a `{ currency, balance }` pair where `balance` is
 * a DECIMAL STRING, not a number:
 *
 *   { status: 'ready', value: [...normal_wallets], bonusWallets: [...bonus_wallets] }
 *
 * THE STRING IS THE SOURCE OF TRUTH. Platform emits values like `0E-16` and
 * `5.0000000000000000`, and floats silently lose those. Every function here
 * therefore validates the original text and keeps it for display, using a Number
 * only for comparisons and for the two-decimal rendering.
 *
 * `0E-16` is a real case, not a hypothetical: it is how Platform reports an
 * emptied wallet, so treating it as malformed would show an error on a perfectly
 * valid zero balance.
 *
 * @module dsh-balance-pet/shared/budget
 */

/**
 * Platform's own numeric grammar, mirrored from the Host's validator: an
 * optional sign, an integer part or a fraction part (either may be omitted), and
 * an optional decimal exponent. `NaN`, `Infinity` and bare text are excluded.
 */
export const DECIMAL_PATTERN = /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/iu;

/** Currency symbols used by the two wallet lists. */
const SYMBOLS = Object.freeze({ CNY: '¥', USD: '$' });

/**
 * Whether raw text is a valid Platform amount.
 *
 * @param raw - candidate text.
 * @returns `true` when it matches the decimal grammar.
 */
export function isValidAmount(raw) {
  return typeof raw === 'string' && DECIMAL_PATTERN.test(raw.trim());
}

/**
 * Convert a Platform amount to a number for comparison only.
 *
 * Callers must not use the result for display: it has already lost the original
 * precision that {@link formatBalance} preserves.
 *
 * @param raw - Platform amount text.
 * @returns the numeric value, or `null` when the text is not a valid amount.
 */
export function toAmount(raw) {
  if (!isValidAmount(raw)) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/**
 * Insert thousands separators into an already-fixed decimal string.
 *
 * @param fixed - a plain decimal string such as `12345.60`.
 * @returns the grouped string, e.g. `12,345.60`.
 */
function groupThousands(fixed) {
  const negative = fixed.startsWith('-');
  const body = negative ? fixed.slice(1) : fixed;
  const [whole, fraction] = body.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/gu, ',');
  const joined = fraction === undefined ? grouped : `${grouped}.${fraction}`;
  return negative ? `-${joined}` : joined;
}

/**
 * Render an amount the way DeepSeek Platform's own Web client does.
 *
 * Platform's rule is two decimals, with anything smaller than one cent shown as
 * a sub-cent marker rather than rounded away to `0.00` - a wallet holding a
 * fraction of a cent must not read as empty.
 *
 * @param raw - Platform amount text.
 * @param options - `symbol` prefixes the amount; `group` adds separators;
 *   `placeholder` is returned for unparseable input.
 * @returns the formatted amount.
 */
export function formatBalance(raw, options) {
  const settings = options === undefined || options === null ? {} : options;
  const symbol = settings.symbol ?? '';
  const placeholder = settings.placeholder ?? '—';
  const value = toAmount(raw);
  if (value === null) return placeholder;
  if (value === 0) return `${symbol}0.00`;
  const magnitude = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  // Sub-cent but nonzero: say so instead of collapsing to 0.00.
  if (magnitude < 0.01) return `${sign}${symbol}<0.01`;
  const fixed = magnitude.toFixed(2);
  return `${sign}${symbol}${settings.group === true ? groupThousands(fixed) : fixed}`;
}

/**
 * The symbol for a currency code, falling back to the code plus a space.
 *
 * @param currency - ISO code such as `CNY`.
 * @returns the display symbol.
 */
export function currencySymbol(currency) {
  return SYMBOLS[currency] ?? `${currency} `;
}

/**
 * Fold one wallet list into a currency-keyed accumulator.
 *
 * @param target - map being built.
 * @param list - wallet entries.
 * @param field - which bucket the list feeds.
 */
function accumulate(target, list, field) {
  for (const wallet of list) {
    if (wallet === null || typeof wallet !== 'object') continue;
    const currency = typeof wallet.currency === 'string' ? wallet.currency : 'CNY';
    const balance = typeof wallet.balance === 'string' ? wallet.balance : String(wallet.balance);
    if (!isValidAmount(balance)) continue;
    const entry = target.get(currency) ?? { currency, normal: [], bonus: [] };
    entry[field].push(balance);
    target.set(currency, entry);
  }
}

/**
 * Sum a list of Platform amount strings exactly, without floating-point drift.
 *
 * The values are decimals with an optional exponent, so they are scaled to a
 * common integer exponent, added as BigInt, then rendered back. This is what
 * makes "充值余额 + 赠金余额" trustworthy at sub-cent precision.
 *
 * @param amounts - valid Platform amount strings.
 * @returns summed text, or `null` when the list is empty.
 */
export function sumAmounts(amounts) {
  if (amounts.length === 0) return null;
  let scale = 0;
  const parts = [];
  for (const raw of amounts) {
    const match = /^(-?)(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/iu.exec(raw.trim());
    if (match === null) return null;
    const [, sign, whole = '', fraction = '', exponentText] = match;
    // Effective decimal exponent of this value's last digit.
    const exponent = exponentText === undefined ? 0 : Number(exponentText);
    const digits = `${whole === '' ? '0' : whole}${fraction}`;
    const own = exponent - fraction.length;
    scale = Math.min(scale, own);
    parts.push({ negative: sign === '-', digits, own });
  }
  let total = 0n;
  for (const part of parts) {
    const shifted = BigInt(part.digits) * 10n ** BigInt(part.own - scale);
    total += part.negative ? -shifted : shifted;
  }
  const negative = total < 0n;
  const text = (negative ? -total : total).toString();
  const padded = text.padStart(-scale + 1, '0');
  const whole = scale === 0 ? padded : padded.slice(0, scale);
  const fraction = scale === 0 ? '' : padded.slice(scale);
  const normalizedWhole = whole === '' ? '0' : whole;
  const body = fraction === '' ? normalizedWhole : `${normalizedWhole}.${fraction}`;
  return negative ? `-${body}` : body;
}

/**
 * Build the balance snapshot every consumer renders from.
 *
 * Bonus credit is kept separate from topped-up credit because DeepSeek spends
 * the granted balance first and the two are not interchangeable to the user -
 * but a combined total is what answers "how much can I still spend", so both are
 * provided rather than making each surface add them up itself.
 *
 * @param outcome - the account remote's balance outcome, or `undefined`.
 * @returns a serializable snapshot; `ready: false` carries the reason.
 */
export function summarizeBalance(outcome) {
  const status = outcome === undefined || outcome === null ? 'absent' : outcome.status;
  if (status !== 'ready') {
    return {
      ready: false,
      status: typeof status === 'string' ? status : 'absent',
      wallets: [],
      primary: null,
      hasCredit: false,
    };
  }
  const grouped = new Map();
  accumulate(grouped, Array.isArray(outcome.value) ? outcome.value : [], 'normal');
  accumulate(grouped, Array.isArray(outcome.bonusWallets) ? outcome.bonusWallets : [], 'bonus');

  const wallets = [];
  for (const entry of grouped.values()) {
    const symbol = currencySymbol(entry.currency);
    const normalTotal = sumAmounts(entry.normal);
    const bonusTotal = sumAmounts(entry.bonus);
    const combined = sumAmounts([...entry.normal, ...entry.bonus]);
    wallets.push({
      currency: entry.currency,
      symbol,
      normal: normalTotal,
      bonus: bonusTotal,
      total: combined,
      normalText: formatBalance(normalTotal ?? '0', { symbol }),
      bonusText: formatBalance(bonusTotal ?? '0', { symbol }),
      totalText: formatBalance(combined ?? '0', { symbol }),
    });
  }
  // A stable order keeps the badge from flickering between polls when the
  // Platform response happens to list currencies differently.
  wallets.sort((left, right) => left.currency.localeCompare(right.currency));

  const primary = wallets.find((wallet) => wallet.currency === 'CNY') ?? wallets[0] ?? null;
  const hasCredit = wallets.some((wallet) => {
    const value = toAmount(wallet.total ?? '0');
    return value !== null && value > 0;
  });

  return {
    ready: true,
    status: 'ready',
    wallets,
    primary,
    hasCredit,
  };
}

/**
 * Describe a millisecond span as a short Chinese duration.
 *
 * @param milliseconds - span to describe; negative clamps to zero.
 * @returns text such as `2 小时 5 分` or `43 秒`.
 */
export function formatDuration(milliseconds) {
  const total = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return minutes === 0 ? `${String(hours)} 小时` : `${String(hours)} 小时 ${String(minutes)} 分`;
  if (minutes > 0) return `${String(minutes)} 分 ${String(seconds)} 秒`;
  return `${String(seconds)} 秒`;
}
