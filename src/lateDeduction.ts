// 遅刻早退控除の対象になる時間を出す
//
// 【御社の決まり】（2026年11月4日に確認）
//   打刻の区分ごとに、控除するかどうかの既定を決めています。
//
//     出勤が所定より遅いとき
//       打刻漏れ（所定の時刻に自動修正）… 時刻が所定に直るので、そもそも遅刻0分
//       イベント（会議・研修など）      … 控除しない
//       遅刻                            … 控除する
//
//     退勤が所定より早いとき
//       イベント・研修 … 控除しない
//       自己都合       … 控除する
//       その他         … 控除する
//
//     区分の記録がない日（管理者が勤怠を直接修正した日など）… 控除する
//
//   そのうえで、承認のときに1件ずつ上書きできます。
//   上書きは「引く」「引かない」「区分のとおり（上書きなし）」の3つです。
//
// 【大事な前提】
//   ここで出すのは「控除の対象になる時間」だけです。
//   遅刻・早退そのものの時間（事実）は変えません。
//   勤怠一覧には実際の遅刻・早退をそのまま出し、
//   控除から外した分は別に分かるようにします。
//
// 【端数】
//   不就労時間の15分単位の切り捨ては、これまでどおり日ごとに行います。
//   控除から外した分を引いたあとの時間を丸めます
//   （丸めてから外すと、外したはずの分が残ることがあります）。

/** 出勤の区分で、遅刻を控除しないもの */
export const LATE_EXEMPT_IN_STATUSES = ['event'] as const;

/** 退勤の区分で、早退を控除しないもの */
export const LATE_EXEMPT_OUT_STATUSES = ['early_event'] as const;

/**
 * 出勤の区分のうち、遅刻が付かないもの。
 * 打刻の時刻そのものが所定に直るため、遅刻は0分になります。
 * （この一覧は説明のために置いています。判定では使いません）
 */
export const NO_LATE_IN_STATUSES = ['early_confirmed', 'early_manual', 'forgot_corrected'] as const;

export type Override = boolean | null | undefined;

/** 控除するかどうかを決める材料 */
export type DayInput = {
  /** 遅刻の分数（所定始業より後に出勤した分） */
  lateMin?: number;
  /** 早退の分数（所定終業より前に退勤した分） */
  earlyLeaveMin?: number;
  /** 出勤の区分（clock_in_status） */
  clockInStatus?: string | null;
  /** 退勤の区分（clock_out_status） */
  clockOutStatus?: string | null;
  /** 出勤の上書き（true=引く／false=引かない／null=区分のとおり） */
  lateDeductionIn?: Override;
  /** 退勤の上書き（true=引く／false=引かない／null=区分のとおり） */
  lateDeductionOut?: Override;
};

/** 控除するかどうかの理由 */
export type Reason = 'none' | 'default' | 'statusExempt' | 'overrideDeduct' | 'overrideExempt';

export type DaySplit = {
  /** 遅刻のうち控除する分 */
  lateDeductMin: number;
  /** 遅刻のうち控除しない分 */
  lateExemptMin: number;
  /** 早退のうち控除する分 */
  earlyDeductMin: number;
  /** 早退のうち控除しない分 */
  earlyExemptMin: number;
  /** なぜそうなったか（画面に出すため） */
  lateReason: Reason;
  earlyReason: Reason;
};

const min0 = (v: unknown) => Math.max(0, Math.floor(Number(v) || 0));

/**
 * 片側（出勤または退勤）について、控除するかどうかを決めます。
 *
 * 上書きがあればそれに従い、無ければ区分の既定に従います。
 * 区分が無い日は控除します（御社の決まり）。
 */
export function decideSide(
  minutes: number,
  status: string | null | undefined,
  override: Override,
  exemptStatuses: readonly string[],
): { deductMin: number; exemptMin: number; reason: Reason } {
  const m = min0(minutes);
  if (m === 0) return { deductMin: 0, exemptMin: 0, reason: 'none' };
  // 上書きが入っていればそれが最優先
  if (override === true) return { deductMin: m, exemptMin: 0, reason: 'overrideDeduct' };
  if (override === false) return { deductMin: 0, exemptMin: m, reason: 'overrideExempt' };
  // 上書きが無いときは区分の既定
  if (status && exemptStatuses.includes(status)) {
    return { deductMin: 0, exemptMin: m, reason: 'statusExempt' };
  }
  return { deductMin: m, exemptMin: 0, reason: 'default' };
}

/** 1日分について、遅刻・早退を「控除する分」と「控除しない分」に分けます */
export function splitDay(day: DayInput): DaySplit {
  const late = decideSide(day.lateMin, day.clockInStatus, day.lateDeductionIn, LATE_EXEMPT_IN_STATUSES);
  const early = decideSide(day.earlyLeaveMin, day.clockOutStatus, day.lateDeductionOut, LATE_EXEMPT_OUT_STATUSES);
  return {
    lateDeductMin: late.deductMin,
    lateExemptMin: late.exemptMin,
    earlyDeductMin: early.deductMin,
    earlyExemptMin: early.exemptMin,
    lateReason: late.reason,
    earlyReason: early.reason,
  };
}

/** 不就労時間の端数処理。1時間未満の端数を15分単位で切り捨てます（日ごと） */
export const UNWORKED_ROUND_UNIT_MIN = 15;
export function roundUnworked(minutes: number): number {
  const m = min0(minutes);
  const hours = Math.floor(m / 60);
  const rest = m - hours * 60;
  return hours * 60 + Math.floor(rest / UNWORKED_ROUND_UNIT_MIN) * UNWORKED_ROUND_UNIT_MIN;
}

/**
 * 1日分の不就労時間（控除の対象）を出します。
 * 控除から外した分を引いたあとに、15分単位で切り捨てます。
 */
export function unworkedMinutesOfDay(day: DayInput): number {
  const s = splitDay(day);
  return roundUnworked(s.lateDeductMin + s.earlyDeductMin);
}

/** 1日分の「控除から外した時間」。丸めずに実時間で返します（画面の説明用） */
export function exemptMinutesOfDay(day: DayInput): number {
  const s = splitDay(day);
  return s.lateExemptMin + s.earlyExemptMin;
}

/** 上書きの既定値（承認画面の初期表示に使う）。true=引く／false=引かない */
export function defaultDeductFor(status: string | null | undefined, side: 'in' | 'out'): boolean {
  const exempt = side === 'in' ? LATE_EXEMPT_IN_STATUSES : LATE_EXEMPT_OUT_STATUSES;
  return !(status && (exempt as readonly string[]).includes(status));
}

// ---- 93番SQLをまだ流していない本番のための備え ----
//
// 上書きの2列（clock_in_late_deduction / clock_out_late_deduction）が無いと、
// PostgREST は PGRST204 を返して保存そのものが失敗します。
// 勤怠の修正ができなくなるのは困るので、そのときは2列を外して
// もう一度保存します（遅刻早退控除は打刻の区分どおりに動きます）。

/** 上書き用の列の名前 */
export const LATE_DEDUCTION_COLS = ['clock_in_late_deduction', 'clock_out_late_deduction'] as const;

/** その保存の失敗が「上書きの列が無いこと」によるものか */
export function isMissingLateDeductionColumn(error: unknown): boolean {
  if (!error) return false;
  const e = error as { code?: string; message?: string };
  const text = String(e.message || '');
  const named = LATE_DEDUCTION_COLS.some((c) => text.includes(c));
  if (named) return true;
  // 文言が変わっても拾えるように、PGRST204（列が見つからない）も見ます。
  // ほかの列が原因のときは、外してもう一度試しても同じ失敗になるだけです。
  return e.code === 'PGRST204' && /column/i.test(text);
}

/** 保存する内容から、上書きの2列を外します（元の内容は変えません） */
export function withoutLateDeductionCols<T extends Record<string, unknown>>(body: T): Partial<T> {
  const out: Record<string, unknown> = { ...body };
  LATE_DEDUCTION_COLS.forEach((c) => { delete out[c]; });
  return out as Partial<T>;
}
