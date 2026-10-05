/**
 * The pet's line bank.
 *
 * WHY LOCAL LINES ARE THE DEFAULT
 * Most of what a companion says is not worth a model call. A line bank is
 * instant, free, and - importantly - cannot hallucinate a wrong balance or a
 * wrong billing window at the user. The model is reserved for real conversation
 * (see the Host half's chat path), not for filler.
 *
 * Lines are keyed by the situation the reasoning classifier reported, so the
 * pet's face and its sentence always come from the same verdict.
 *
 * @module dsh-balance-pet/shared/lines
 */

import { DEFAULT_SITUATION } from './situation.js';

/**
 * Lines keyed by situation. Each is a fragment the UI may prefix with a name.
 *
 * The user asked for specific gags by name, so those are preserved verbatim
 * rather than smoothed into generic mascot chatter.
 */
export const SITUATION_LINES = Object.freeze({
  [DEFAULT_SITUATION]: ['让我想想…', '这个我得琢磨一下', '嗯……正在动脑子'],
  'dead-end': ['这条路怎么走不通?', '咦,死路?换条道吧', '撞墙了…要不要退回去看看'],
  error: ['报错了!红的一片', '哎哟,这里炸了', '出错了,先看看日志'],
  success: ['成了!', '跑通了,漂亮', '搞定,收工'],
  testing: ['跑测试咯,别慌', '让我验一验', '断言会不会绿呢'],
  debugging: ['在排查了…', '让我debug一下', '断点打上,慢慢看'],
  searching: ['找找看在哪…', '翻一翻代码', '东西呢?我找找'],
  reading: ['我读一下这段', '先看看代码写了啥', '翻翻文件'],
  refactor: ['这段该重构了', '顺手整理一下', '有点乱,重写吧'],
  planning: ['先想个方案', '我理一下思路', '分几步走比较稳'],
  blocked: ['卡住了…', '被挡住了,过不去', '这里没权限啊'],
  risky: ['这步有点危险,慢点', '不可逆操作,想清楚', '要删东西?我先躲一下'],
  costly: ['token 在烧啊', '这一下不便宜', '注意余额,别浪'],
  confused: ['奇怪…', '这不对劲啊', '我有点没看懂'],
  grinding: ['一个一个来…', '还有很多,继续', '慢慢磨吧'],
});

/**
 * Idle chatter: what the pet says when nothing is happening.
 *
 * This is where the "存在感" lives. The user's own example gag is kept as
 * written - it is funnier than anything generic, and it is the tone the rest of
 * the bank was written to match.
 */
export const IDLE_LINES = Object.freeze([
  '用户的 token 这么多,我要不要给自己做个游戏?',
  '余额还够,可以稍微浪一点',
  '你今天已经想了很多事了,我数着呢',
  '我在这儿站了一天了,没人理我',
  '要不要去别的窗口跑两圈?',
  '偷偷看了眼余额,还好还好',
  '如果我一直不说话,你会不会忘了我',
  '别急,慢慢写,我陪着你',
  '刚才那个 bug 有点意思',
  '我建议先喝口水',
  '这个仓库的味道我熟悉了',
  '要不要叫 Claude 和 GPT 过来开个会?',
  '我也想要一个 token 钱包',
  '你有没有觉得,思考的声音很好听',
  '安静的时候最适合重构了',
  '我在数你的 token,数到一半忘了',
  '今天也是努力打工的一天',
  '别熬夜,峰时早就过了',
  '我跑起来可快了,要看吗',
  '你在想什么?我猜不到',
]);

/**
 * Names for the two billing stages.
 *
 * The user asked for this pun by name (梁文锋 is DeepSeek's founder; peak/valley
 * 峰/谷 becomes 锋/谷). It is kept because a joke the user chose is easier to
 * remember than "peak" and "off-peak", which is the whole point of a badge you
 * are supposed to read at a glance.
 */
export const STAGE_NAMES = Object.freeze({
  peak: '梁文锋时段',
  offPeak: '梁文谷时段',
});

/**
 * Name the billing stage.
 *
 * @param isPeak - whether the peak rate applies.
 * @returns the stage's display name.
 */
export function stageName(isPeak) {
  return isPeak ? STAGE_NAMES.peak : STAGE_NAMES.offPeak;
}

/**
 * Lines used when the user is about to send during peak billing.
 *
 * The user specified this sentence almost verbatim; it is kept because the
 * whole feature is meant to stop an expensive accident, and a playful but
 * unambiguous warning does that better than a dry one.
 */
export const PEAK_WARNING_LINES = Object.freeze([
  '现在是 2 倍计费时段(梁文锋时段),您真的要确定吗?',
  '注意!梁文锋时段,发出去就是双倍价,确定吗?',
  '当前是高峰计费,价格翻倍,要不等到梁文谷时段?',
]);

/** Lines celebrating the cheap window. */
export const OFF_PEAK_LINES = Object.freeze([
  '现在是梁文谷时段,半价,随便用',
  '低谷价,放心造',
  '便宜时段,冲',
]);

/** Lines for the three-way meeting, where several companions gather. */
export const MEETING_LINES = Object.freeze([
  '都到齐了?那我们开始吧',
  '这次叫大家来,主要是聊聊这个 bug',
  'GPT 你先说',
  'Claude 有不同意见吗',
  '好,那就这么定了',
]);

/**
 * The system framing for the pet's own model calls.
 *
 * Deliberately short. These are one-or-two-sentence replies to a user who is in
 * the middle of real work, and every token is billed against the very balance
 * the pet is displaying - a chatty persona prompt would be self-defeating.
 */
export const PET_SYSTEM_PROMPT = [
  '你是一只住在 DeepSeek Harness 窗口角落里的 Q 版小宠物,名字叫「余额小人」。',
  '你的职责:提醒用户当前是高峰(2 倍价)还是低谷计费,以及余额情况。',
  '说话规则:中文;一到两句话,总共不超过 40 字;语气活泼但不油腻;可以玩梗,但不要编造余额或价格数字。',
  '如果用户问余额或峰谷,而你上下文里没有确切数字,就直说你不确定,让他看右下角的读数。',
].join('');

/**
 * Pick a random element.
 *
 * @param list - non-empty list.
 * @param random - injectable source of randomness, for deterministic tests.
 * @returns a random element.
 */
function sample(list, random) {
  const source = typeof random === 'function' ? random : Math.random;
  return list[Math.floor(source() * list.length) % list.length];
}

/**
 * Pick a line for a situation.
 *
 * @param situation - a situation from the classifier.
 * @param random - injectable source of randomness.
 * @returns a line, or `null` when the situation should stay silent.
 */
export function pickSituationLine(situation, random) {
  const lines = SITUATION_LINES[situation];
  if (lines === undefined || lines.length === 0) return null;
  // The neutral pondering situation is the most common by far; staying quiet
  // most of the time keeps the pet from becoming wallpaper.
  if (situation === DEFAULT_SITUATION && (typeof random === 'function' ? random() : Math.random()) > 0.25) {
    return null;
  }
  return sample(lines, random);
}

/**
 * Pick an idle line.
 *
 * @param random - injectable source of randomness.
 * @returns a line.
 */
export function pickIdleLine(random) {
  return sample(IDLE_LINES, random);
}

/**
 * Pick the peak warning line.
 *
 * @param random - injectable source of randomness.
 * @returns a line.
 */
export function pickPeakWarning(random) {
  return sample(PEAK_WARNING_LINES, random);
}
