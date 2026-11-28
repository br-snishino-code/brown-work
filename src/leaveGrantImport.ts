// 有休の引き継ぎに関わる2つの取り込み。
//
// 【A. 有休の付与（繰越残日数）をExcelから一括登録する】
//   ジョブカン時代の残日数を、付与日ごとに登録します。
//   移行日より前の法定付与と取得は計算に入れないため、
//   ここに入れる日数は「付与日数」ではなく「その付与の残り日数」です。
//   付与日は「もとの付与日」を入れます。時効が付与日から2年のためです。
//
// 【B. 書庫の有休取得を、年5日の判定に反映する】
//   実装を確かめたところ、2つの計算で移行日の扱いが違いました。
//     残日数      … 移行日より前の取得は数えない
//     年5日の義務 … 移行日で絞らない
//   そのため、過去の取得を休暇申請として入れても、
//   残日数は引き継ぎ分と二重にならず、年5日だけ正しく数えられます。
//
//   休暇理由は入れません。休暇申請の理由は管理者も見られますが、
//   理由には健康に関わる内容が含まれるためです。
//   本物の理由は書庫（legacy_leave_reasons）に残り、
//   これまでどおり本人とマスター管理者だけが見られます。
//
//   時間単位の有休は入れません。年5日の取得義務には
//   時間単位年休を算入しないためです（労基法39条7項）。
//   書庫には残ります。

const norm = (v: unknown) =>
  String(v ?? '')
    .replace(/\s+/g, '')
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .toLowerCase();

const text = (v: unknown) => String(v ?? '').trim();

/** 実データに入れた過去の取得だと分かるようにする目印。消し直しにも使います */
export const LEGACY_LEAVE_REASON = '過去の記録（ジョブカン）';

// ============================================================
// A. 有休の付与の一括登録
// ============================================================

export const GRANT_IMPORT_COLUMNS = [
  { key: 'staffNumber', label: 'スタッフコード', required: true },
  { key: 'name', label: '氏名', required: false },
  { key: 'grantDate', label: '付与日', required: true },
  { key: 'days', label: '残日数', required: true },
  { key: 'note', label: 'メモ', required: false },
] as const;

const GRANT_ALIASES: Record<string, string[]> = {
  staffNumber: ['スタッフコード', 'コード', '社員番号', 'スタッフno'],
  name: ['氏名', '名前', 'スタッフ名', '従業員名', '社員名'],
  grantDate: ['付与日', '基準日', '付与年月日'],
  days: ['残日数', '日数', '残り日数', '繰越日数', '付与日数'],
  note: ['メモ', '備考'],
};

const pad2 = (n: number) => String(n).padStart(2, '0');

/** 日付を YYYY-MM-DD に。Excelの数値・Date・文字に対応 */
export function toGrantDate(v: unknown): string {
  if (v === null || v === undefined || v === '') return '';
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return '';
    return `${v.getFullYear()}-${pad2(v.getMonth() + 1)}-${pad2(v.getDate())}`;
  }
  if (typeof v === 'number') {
    if (!Number.isFinite(v) || v <= 0 || v > 80000) return '';
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
  }
  const s = String(v).trim().replace(/[年月]/g, '-').replace(/日$/, '');
  const m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (!m) return '';
  const y = Number(m[1]); const mo = Number(m[2]); const da = Number(m[3]);
  if (mo < 1 || mo > 12 || da < 1 || da > 31) return '';
  const d = new Date(Date.UTC(y, mo - 1, da));
  if (d.getUTCMonth() + 1 !== mo || d.getUTCDate() !== da) return '';
  return `${y}-${pad2(mo)}-${pad2(da)}`;
}

/** 日数。0.5刻みまで受け付けます */
export function toGrantDays(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const s = norm(v).replace(/[日,，]/g, '');
  if (s === '') return null;
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export type GrantRow = {
  rowNumber: number;
  staffNumber: string;
  name: string;
  grantDate: string;
  days: number | null;
  note: string;
  error: string;
};

export type ParsedGrantSheet = { headerRow: number; rows: GrantRow[]; error: string };

const findGrantHeader = (aoa: unknown[][]) => {
  const limit = Math.min(aoa.length, 20);
  for (let i = 0; i < limit; i++) {
    const cells = (aoa[i] || []).map(norm);
    const col: Record<string, number> = {};
    cells.forEach((c, j) => {
      if (c === '') return;
      Object.keys(GRANT_ALIASES).forEach((k) => {
        if (col[k] === undefined && GRANT_ALIASES[k].some((a) => norm(a) === c)) col[k] = j;
      });
    });
    if (col.grantDate !== undefined && col.days !== undefined
      && (col.staffNumber !== undefined || col.name !== undefined)) {
      return { index: i, col };
    }
  }
  return null;
};

/** 付与のExcel（配列の配列）を読み取ります */
export function parseGrantSheet(aoa: unknown[][]): ParsedGrantSheet {
  const head = findGrantHeader(aoa || []);
  if (!head) {
    return {
      headerRow: 0, rows: [],
      error: '見出しの行が見つかりません。「スタッフコード」「付与日」「残日数」の見出しがある表をご用意ください',
    };
  }
  const { index, col } = head;
  const get = (r: unknown[], k: string) => (col[k] === undefined ? '' : r[col[k]]);
  const rows: GrantRow[] = [];
  for (let i = index + 1; i < aoa.length; i++) {
    const r = aoa[i] || [];
    const staffNumber = text(get(r, 'staffNumber'));
    const name = text(get(r, 'name'));
    const rawDate = get(r, 'grantDate');
    const rawDays = get(r, 'days');
    if (staffNumber === '' && name === '' && text(rawDate) === '' && text(rawDays) === '') continue;

    const grantDate = toGrantDate(rawDate);
    const days = toGrantDays(rawDays);
    let error = '';
    if (staffNumber === '' && name === '') error = 'スタッフコードと氏名のどちらも入っていません';
    else if (text(rawDate) === '') error = '付与日を入れてください';
    else if (grantDate === '') error = `付与日が読み取れません（いまは「${text(rawDate)}」）`;
    else if (text(rawDays) === '') error = '残日数を入れてください';
    else if (days === null) error = `残日数が数として読み取れません（いまは「${text(rawDays)}」）`;
    else if (days <= 0) error = '残日数が0日以下です。0日の方は行ごと消してください';
    else if (days > 40) error = '残日数が40日を超えています（有休の保有上限は40日です）';
    else if (Math.round(days * 2) !== days * 2) error = '残日数は0.5日単位で入れてください';

    rows.push({ rowNumber: i + 1, staffNumber, name, grantDate, days, note: text(get(r, 'note')), error });
  }
  if (rows.length === 0) return { headerRow: index + 1, rows, error: '取り込む行がありません' };
  return { headerRow: index + 1, rows, error: '' };
}

export type GrantTargetStaff = { id: string; name?: string; staffNumber?: string };

export type MatchedGrant = GrantRow & {
  employeeId: string | null;
  employeeName: string;
  matchedBy: 'code' | 'name' | null;
  ok: boolean;
  /** すでに同じ付与日の登録があるか（上書きになります） */
  replaces: boolean;
};

const codeKeys = (v: string) => {
  const a = norm(v);
  if (a === '') return [];
  const keys = [a];
  const stripped = a.replace(/^0+/, '');
  if (stripped !== '' && stripped !== a) keys.push(stripped);
  return keys;
};

export type ExistingGrant = { employeeId: string; grantDate: string };

/** スタッフと突き合わせ、Excelの中の重なりと既存の登録も見ます */
export function matchGrants(
  rows: GrantRow[],
  staff: GrantTargetStaff[],
  existing: ExistingGrant[] = [],
): MatchedGrant[] {
  const byCode = new Map<string, GrantTargetStaff[]>();
  const byName = new Map<string, GrantTargetStaff[]>();
  (staff || []).forEach((e) => {
    codeKeys(String(e.staffNumber ?? '')).forEach((k) => byCode.set(k, [...(byCode.get(k) || []), e]));
    const n = norm(e.name);
    if (n !== '') byName.set(n, [...(byName.get(n) || []), e]);
  });
  const existingKeys = new Set((existing || []).map((g) => `${g.employeeId}|${g.grantDate}`));

  // Excelの中で同じ人・同じ付与日が重なっていないか
  const seen = new Map<string, number>();

  const matched = (rows || []).map((r) => {
    const base = {
      ...r, employeeId: null as string | null, employeeName: '',
      matchedBy: null as 'code' | 'name' | null, ok: false, replaces: false,
    };
    if (r.error) return base;

    let found: GrantTargetStaff | null = null;
    let by: 'code' | 'name' | null = null;
    for (const k of codeKeys(r.staffNumber)) {
      const hit = byCode.get(k) || [];
      if (hit.length === 1) { found = hit[0]; by = 'code'; break; }
      if (hit.length > 1) return { ...base, error: '同じスタッフコードのスタッフが複数います' };
    }
    if (!found) {
      const hit = byName.get(norm(r.name)) || [];
      if (hit.length === 1) { found = hit[0]; by = 'name'; }
      else if (hit.length > 1) return { ...base, error: '同じ氏名のスタッフが複数います。スタッフコードを入れてください' };
    }
    if (!found) {
      return {
        ...base,
        error: r.staffNumber !== ''
          ? `スタッフコード「${r.staffNumber}」の方がBrown Workに見つかりません`
          : `「${r.name}」という方がBrown Workに見つかりません`,
      };
    }

    const key = `${found.id}|${r.grantDate}`;
    seen.set(key, (seen.get(key) || 0) + 1);
    return {
      ...base,
      employeeId: found.id,
      employeeName: found.name || '',
      matchedBy: by,
      ok: true,
      replaces: existingKeys.has(key),
    };
  });

  // Excelの中で重なっていた行は、どちらも取り込みません
  return matched.map((m) => {
    if (!m.ok || !m.employeeId) return m;
    const key = `${m.employeeId}|${m.grantDate}`;
    if ((seen.get(key) || 0) > 1) {
      return { ...m, ok: false, error: '同じ方・同じ付与日の行がExcelの中で重なっています' };
    }
    return m;
  });
}

/** 画面に出すまとめ */
export function grantSummary(rows: MatchedGrant[]) {
  const ok = rows.filter((r) => r.ok);
  return {
    total: rows.length,
    ok: ok.length,
    ng: rows.length - ok.length,
    people: new Set(ok.map((r) => r.employeeId)).size,
    days: Math.round(ok.reduce((s, r) => s + (r.days || 0), 0) * 10) / 10,
    replaces: ok.filter((r) => r.replaces).length,
  };
}

// ============================================================
// B. 書庫の有休取得を、休暇申請として入れる形に直す
// ============================================================

export type ArchiveLeaveDay = {
  id?: string;
  employee_id: string;
  date: string;
  leave_type?: string | null;
  start_time?: string | null;
  end_time?: string | null;
};

export type LeaveToApply = {
  employeeId: string;
  date: string;
  days: number;
};

export type LeaveApplyPlan = {
  /** 休暇申請として入れるもの */
  targets: LeaveToApply[];
  /** 時間単位のため入れないもの */
  skippedHourly: number;
  /** 対象になった方の人数 */
  people: number;
  /** いちばん古い年と新しい年 */
  from: string;
  to: string;
};

/**
 * 書庫の有休取得から、休暇申請として入れる分を選びます。
 *
 * 時間単位の有休（開始時刻が入っているもの）は入れません。
 * 年5日の取得義務には時間単位年休を算入しないためです（労基法39条7項）。
 * 日数が分からないまま1日として入れると、取得日数を多く見せてしまいます。
 */
export function planLeaveApply(days: ArchiveLeaveDay[], fromYear = 0): LeaveApplyPlan {
  const targets: LeaveToApply[] = [];
  let skippedHourly = 0;
  (days || []).forEach((d) => {
    const date = text(d.date).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    if (fromYear && Number(date.slice(0, 4)) < fromYear) return;
    if (text(d.start_time) !== '') { skippedHourly += 1; return; }
    targets.push({ employeeId: d.employee_id, date, days: 1 });
  });
  const years = targets.map((t) => t.date.slice(0, 4)).sort();
  return {
    targets,
    skippedHourly,
    people: new Set(targets.map((t) => t.employeeId)).size,
    from: years[0] || '',
    to: years[years.length - 1] || '',
  };
}

/** 休暇申請の1行を組み立てます（承認済み・理由は入れません） */
export function leaveRequestRow(t: LeaveToApply) {
  return {
    employee_id: t.employeeId,
    type: '有休',
    half_day: false,
    start_date: t.date,
    end_date: t.date,
    days: t.days,
    reason: LEGACY_LEAVE_REASON,
    status: 'approved',
  };
}
