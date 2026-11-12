// 勤怠の打刻修正まわりの、ごく小さな決まりごと。
//
// 【出勤と退勤が同じ時刻のとき】
//   実働0分の記録ができてしまいます。日をまたぐ勤務でも、出勤と退勤が
//   分単位でぴったり同じになることは実務上ありません。ほとんどは
//   どちらかの打ち間違い（退勤の欄に出勤の時刻を入れてしまった等）です。
//   そのまま保存すると、その日の労働時間・残業・遅刻早退が
//   すべて0分で確定してしまうため、保存の前に止めます。
//
//   スタッフの勤怠修正申請、管理者の勤怠一覧、まとめて更新の
//   3か所で同じ判定を使います。

/** 'HH:MM' の2つが同じ時刻か。どちらかが空なら比べません */
export function isSameClockTime(clockIn: unknown, clockOut: unknown): boolean {
  const a = String(clockIn ?? '').trim();
  const b = String(clockOut ?? '').trim();
  if (a === '' || b === '') return false;
  return a === b;
}

export type SameTimeEdit = {
  /** edits のキー。日別一覧は 'スタッフID|日付'、月間ページは '日付' */
  key: string;
  /** 同じになっている時刻 */
  time: string;
};

/**
 * 編集中の行のうち、出勤と退勤が同じ時刻になっているもの。
 * edits の値は画面に入っている 'HH:MM' の文字列です。
 */
export function sameTimeEdits(edits: Record<string, any> | null | undefined): SameTimeEdit[] {
  return Object.entries(edits || {})
    .filter(([, e]) => e && isSameClockTime(e.clockIn, e.clockOut))
    .map(([key, e]) => ({ key, time: String(e.clockIn).trim() }));
}
