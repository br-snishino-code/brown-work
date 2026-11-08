// 勤怠修正申請の内容を「修正前 → 修正後」の形に組み立てる。
//
// 【なぜ必要か】
//   これまで申請の中身は管理者の承認画面にしか出ていませんでした。
//   出した本人は「申請中」とだけ分かり、何時で出したのか・理由に何を書いたのかを
//   あとから確かめられませんでした。誤って出したときにも気づけません。
//   同じ組み立てを本人の画面でも使うため、ここに切り出しています。
//
// 【corrections 表の2つの列】
//   original  … 申請したときの勤怠記録。camelCase で、clockIn / clockOut は
//               ISO の日時文字列（例 '2026-11-05T00:00:00.000Z'）。打刻が無い日は null。
//   requested … 申請の中身。{ date, clockIn: 'HH:MM', clockOut: 'HH:MM', breakMinutes, reason }
//               時刻を空のまま出した項目は、その時刻を変えない意味になります。
//
// 【休憩について】
//   2026年11月から、休憩は本人に入力してもらわず打刻から自動で出しています
//   （src/breakTime.ts）。そのため新しい申請の requested には breakMinutes が入りません。
//   それより前に出された申請には分数が入っているため、入っているときだけ出します。

const pad2 = (n: number) => String(n).padStart(2, '0');

/** 時刻が無いことを表す印 */
export const NO_TIME = '--:--';

/**
 * ISO の日時、または 'HH:MM' を 'HH:MM' にします。
 * 読めない値・空の値は空文字を返します（画面では NO_TIME に置き換えてください）。
 * ISO の日時は、見ている人の時間帯で読みます（画面のほかの時刻表示と同じ扱い）。
 */
export function toHhmm(value: unknown): string {
  if (value == null) return '';
  const s = String(value).trim();
  if (s === '') return '';
  // 'HH:MM' / 'HH:MM:SS'（日付が付いていないもの）
  if (!s.includes('T') && !s.includes(' ') && !s.includes('/')) {
    const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(s);
    if (!m) return '';
    const h = Number(m[1]);
    const mi = Number(m[2]);
    if (h < 0 || h > 23 || mi < 0 || mi > 59) return '';
    return `${pad2(h)}:${pad2(mi)}`;
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '';
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export type CorrectionDiffLine = {
  /** 「出勤」「退勤」 */
  label: string;
  /** 修正前。打刻が無ければ NO_TIME */
  from: string;
  /** 修正後 */
  to: string;
  /** 前と後で違うかどうか（同じ時刻で出し直したときは false） */
  changed: boolean;
};

/**
 * 修正前→修正後の行を作ります。
 * 申請で空のままにした時刻（＝変えない項目）は行を作りません。
 */
export function correctionDiffLines(original: unknown, requested: unknown): CorrectionDiffLine[] {
  const org = (original || {}) as Record<string, unknown>;
  const req = (requested || {}) as Record<string, unknown>;
  const out: CorrectionDiffLine[] = [];
  const add = (label: string, fromRaw: unknown, toRaw: unknown) => {
    const to = toHhmm(toRaw);
    if (!to) return;
    const from = toHhmm(fromRaw);
    out.push({ label, from: from || NO_TIME, to, changed: from !== to });
  };
  add('出勤', org.clockIn, req.clockIn);
  add('退勤', org.clockOut, req.clockOut);
  return out;
}

/**
 * 休憩の分数。申請に分数が入っているときだけ返します。
 * 入っていなければ null（＝打刻から自動で出す申請）。
 */
export function correctionBreakMinutes(requested: unknown): number | null {
  const req = (requested || {}) as Record<string, unknown>;
  const v = req.breakMinutes;
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.floor(n));
}

/**
 * 1行にまとめた説明。「進行中の手続き」の見出しなど、幅が狭い場所で使います。
 * 例）'出勤 09:12 → 09:00／退勤 --:-- → 18:00'
 */
export function correctionSummary(original: unknown, requested: unknown): string {
  const lines = correctionDiffLines(original, requested);
  if (lines.length === 0) return '時刻の指定なし';
  return lines.map((l) => `${l.label} ${l.from} → ${l.to}`).join('／');
}

/** 申請の状態の呼び名。'cancelled' は本人が取り消したもの（95番） */
export const CORRECTION_STATUS_LABEL: Record<string, string> = {
  pending: '承認待ち',
  approved: '承認済み',
  rejected: '却下',
  cancelled: '取り消し済み',
};

export function correctionStatusLabel(status: unknown): string {
  const key = String(status || '');
  return CORRECTION_STATUS_LABEL[key] || key || '不明';
}

/** 本人が取り消せるのは、まだ処理されていない申請だけ */
export function canCancelCorrection(correction: unknown, employeeId: unknown): boolean {
  const c = (correction || {}) as Record<string, unknown>;
  if (!c.id) return false;
  if (c.status !== 'pending') return false;
  if (!employeeId) return false;
  return String(c.employeeId) === String(employeeId);
}

/**
 * 95番SQL（status に 'cancelled' を足す／本人の取り消しを許す）が
 * まだ流れていないときのエラーかどうか。
 * 流れていなければ、検査制約かトリガーのどちらかで止まります。
 */
export function isCancelNotReadyError(error: unknown): boolean {
  if (!error) return false;
  const e = error as { code?: string; message?: string };
  if (e.code === '23514') return true; // 検査制約（status の値が許されていない）
  const msg = String(e.message || '');
  if (msg.includes('corrections_status_check')) return true;
  if (msg.includes('承認・却下は管理者のみ行えます')) return true;
  return false;
}
