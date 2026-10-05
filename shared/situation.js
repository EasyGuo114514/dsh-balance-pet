/**
 * Turn the agent's reasoning stream into a situation the pet can react to.
 *
 * WHY A LOCAL CLASSIFIER AND NOT A MODEL CALL
 * The reasoning stream emits continuously. Asking a model "what is happening?"
 * on every delta would cost real money, add latency the user can feel, and
 * consume the very balance this plugin exists to display. A keyword classifier
 * runs in microseconds, costs nothing, and is deterministic - which also makes
 * it testable, unlike a model's opinion.
 *
 * If nothing matches, the verdict is `thinking` rather than a guess: the pet
 * showing a neutral pondering face is honest, while a confidently wrong "you
 * took a wrong turn" face is not.
 *
 * @module dsh-balance-pet/shared/situation
 */

/**
 * Situation patterns, in no particular priority order - the score decides.
 *
 * `weight` is per match, so a phrase that is a strong signal (an explicit
 * failure word) can outweigh several weak ones.
 */
export const SITUATION_PATTERNS = Object.freeze([
  {
    situation: 'dead-end',
    weight: 3,
    patterns: [
      /走不通|行不通|死路|走错|不可行|无法(?:继续|实现|完成)|没用|白费/u,
      /dead[-\s]?end|doesn'?t work|not going to work|wrong (?:path|direction|approach)/iu,
    ],
  },
  {
    situation: 'error',
    weight: 3,
    patterns: [
      /报错|出错|异常|崩溃|失败|不通过|挂了|炸了/u,
      /\berror\b|\bexception\b|\bfailed\b|\bcrash(?:ed)?\b|\btraceback\b/iu,
    ],
  },
  {
    situation: 'success',
    weight: 3,
    patterns: [
      /成功|搞定了|通过了|修好了|跑通了|完成了|没问题了/u,
      /\bpass(?:ed|es)?\b|\bsucceed(?:ed)?\b|\bworks now\b|\bfixed\b|\ball green\b/iu,
    ],
  },
  {
    situation: 'testing',
    weight: 2,
    patterns: [/测试|验证|试一下|跑一遍|回归|断言/u, /\btest(?:s|ing)?\b|\bverify\b|\bassert/iu],
  },
  {
    situation: 'debugging',
    weight: 2,
    patterns: [/调试|排查|定位问题|修复|打了?个?断点|日志/u, /\bdebug|\btroubleshoot|\binvestigat/iu],
  },
  {
    situation: 'searching',
    weight: 2,
    patterns: [/搜索|查找|寻找|找一下|定位|检索/u, /\bsearch|\bgrep|\blook(?:ing)? for|\bfind\b/iu],
  },
  {
    situation: 'reading',
    weight: 1,
    patterns: [/读一下|看一下|查看|浏览|翻一下/u, /\bread(?:ing)?\b|\bopen(?:ing)? the file\b/iu],
  },
  {
    situation: 'refactor',
    weight: 2,
    patterns: [/重构|重写|简化|整理|抽取|解耦/u, /\brefactor|\brewrite|\bsimplif|\bextract\b/iu],
  },
  {
    situation: 'planning',
    weight: 2,
    patterns: [/计划|方案|思路|策略|先.+再|分几步/u, /\bplan\b|\bapproach\b|\bstrategy\b|\bstep by step\b/iu],
  },
  {
    situation: 'blocked',
    weight: 3,
    patterns: [/卡住|阻塞|等待|权限不足|被拒绝|没法|受限/u, /\bblocked\b|\bstuck\b|\bpermission denied\b|\bwaiting on\b/iu],
  },
  {
    situation: 'risky',
    weight: 3,
    patterns: [/危险|不可逆|删库|删掉|清空|覆盖|格式化/u, /\bdanger|\birreversible\b|\brm -rf\b|\boverwrite|\bwipe\b/iu],
  },
  {
    situation: 'costly',
    weight: 2,
    patterns: [/token|余额|计费|成本|太贵|花钱|峰时|低谷/u, /\btokens?\b|\bbalance\b|\bcost|\bexpen(?:sive|se)\b|\bbilling\b/iu],
  },
  {
    situation: 'confused',
    weight: 2,
    patterns: [/奇怪|不理解|疑惑|为什么|莫名其妙|不对劲/u, /\bconfus|\bweird\b|\bunclear\b|\bdoesn'?t make sense\b/iu],
  },
  {
    situation: 'grinding',
    weight: 1,
    patterns: [/继续|接着|批量|大量|很多个|逐个|一个一个/u, /\bkeep going\b|\bbatch\b|\bone by one\b|\blots of\b/iu],
  },
]);

/** Score a text would need to beat to be reported instead of `thinking`. */
const MIN_SCORE = 2;

/** The verdict when nothing matches. */
export const DEFAULT_SITUATION = 'thinking';

/**
 * Every situation this module can report.
 *
 * Exported so the expression set can be asserted complete against it: a
 * situation with no face would silently fall back and never be noticed.
 */
export const SITUATIONS = Object.freeze([
  DEFAULT_SITUATION,
  ...SITUATION_PATTERNS.map((entry) => entry.situation),
]);

/**
 * Classify one chunk of reasoning text.
 *
 * @param text - reasoning text, may be a fragment or the whole tail.
 * @returns the highest-scoring situation, or {@link DEFAULT_SITUATION}.
 */
export function classifySituation(text) {
  if (typeof text !== 'string' || text.trim() === '') return DEFAULT_SITUATION;
  let best = DEFAULT_SITUATION;
  let bestScore = MIN_SCORE - 1;
  for (const entry of SITUATION_PATTERNS) {
    let score = 0;
    for (const pattern of entry.patterns) {
      const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
      const matches = text.match(new RegExp(pattern.source, flags));
      if (matches !== null) score += matches.length * entry.weight;
    }
    if (score > bestScore) {
      bestScore = score;
      best = entry.situation;
    }
  }
  return best;
}
