// 自動休憩の計算
//
// 【御社の決まり】（2026年11月4日、ジョブカンの設定画面で確認）
//   グループ・スタッフ種別 … 全て／全て（時間で管理）
//   自動休憩条件           … 6時間0分以上の拘束時間
//   自動休憩時間           … 1時間0分の休憩
//   優先的に休憩を引く時間 … 普通勤務優先
//   自動休憩と打刻による休憩の計算方法 … どちらか大きい方を採用
//
//   つまり「出勤から退勤までが6時間以上なら1時間引く。6時間未満なら引かない」です。
//
// 【これまでのBrown Workとの違い】
//   これまでは拘束時間に関わらず、いつでも60分を引いていました。
//   そのため4時間だけ働いた日も1時間引かれ、労働時間が1時間短く出ていました。
//   この決まりに合わせると、6時間未満の日は休憩0分になります。
//
// 【打刻による休憩について】
//   Brown Work には休憩の打刻がありません。
//   そのため「自動休憩と打刻による休憩の計算方法」の設定は効きません。
//   管理者が勤怠一覧で休憩を手入力したときは、その値をそのまま使います
//   （打刻ではなく「訂正」のため、どちらか大きい方ではなく手入力が優先です）。
//
// 【優先的に休憩を引く時間について】
//   「普通勤務優先」は、休憩を深夜帯ではなく普通の勤務時間から先に引く、という意味です。
//   Brown Work は深夜（22時〜翌5時）の時間を打刻の重なりだけで出していて、
//   そこから休憩を引いていません。結果として深夜手当が休憩で減ることはなく、
//   「普通勤務優先」と同じ扱いになります。
//   （休憩を何時に取ったかを記録していないため、深夜帯から引くことはできません）

/** 自動休憩の決まり */
export type AutoBreakRule = {
  /** この拘束時間（分）以上なら休憩を引く */
  thresholdMin: number;
  /** 引く休憩（分） */
  breakMin: number;
};

/** 御社の決まり：6時間以上の拘束で1時間の休憩 */
export const AUTO_BREAK: AutoBreakRule = {
  thresholdMin: 6 * 60,
  breakMin: 60,
};

const min0 = (v: unknown) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/**
 * 拘束時間から自動休憩の分数を出します。
 * 拘束時間 ＝ 出勤から退勤までの時間（休憩を引く前）。
 */
export function autoBreakMinutes(boundMinutes: unknown, rule: AutoBreakRule = AUTO_BREAK): number {
  const bound = min0(boundMinutes);
  const threshold = min0(rule?.thresholdMin);
  const take = min0(rule?.breakMin);
  if (bound < threshold) return 0;
  // 休憩で拘束時間を超えてマイナスにならないようにします
  return Math.min(take, bound);
}

/**
 * 所定の始業・終業から、所定労働時間（分）を出します。
 * 所定の拘束時間にも同じ決まりを当てます。
 * 例）9:00〜18:00 → 拘束540分 → 休憩60分 → 所定480分
 *     9:00〜14:00 → 拘束300分 → 休憩0分  → 所定300分
 */
export function scheduledWorkMinutes(
  startMin: unknown,
  endMin: unknown,
  rule: AutoBreakRule = AUTO_BREAK,
): number {
  const s = Number(startMin);
  const e = Number(endMin);
  if (!Number.isFinite(s) || !Number.isFinite(e)) return 0;
  const bound = Math.max(0, e - s);
  return Math.max(0, bound - autoBreakMinutes(bound, rule));
}

/** 画面に出すための説明（設定の中身を1行で） */
export function autoBreakLabel(rule: AutoBreakRule = AUTO_BREAK): string {
  const h = Math.floor(min0(rule.thresholdMin) / 60);
  const m = min0(rule.thresholdMin) % 60;
  const bh = Math.floor(min0(rule.breakMin) / 60);
  const bm = min0(rule.breakMin) % 60;
  const t = m === 0 ? `${h}時間` : `${h}時間${m}分`;
  const b = bm === 0 ? `${bh}時間` : (bh === 0 ? `${bm}分` : `${bh}時間${bm}分`);
  return `拘束時間が${t}以上の日に${b}の休憩を引きます`;
}
