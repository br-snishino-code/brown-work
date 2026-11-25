// ジョブカンの勤怠Excelを読み取ります（過去の記録の書庫に入れるため）。
//
// 【ファイルの形】
//   1シート＝1人。シート名はお名前です。
//   上半分が月のまとめ、13行目あたりから下が日ごとの明細です。
//
//     1行目  2026年10月                        ← 対象の月
//     3行目  スタッフ名 / スタッフコード / 所属グループ / スタッフ種別
//            ＋ 総合出勤日数 / 平日出勤日数 / 休日出勤日数 / 欠勤日数 / 遅刻回数 / 早退回数
//     4行目  その値
//     7行目  労働時間 / 残業時間 / 深夜時間 を 総合・平日・休日 の3組
//     8行目  その値
//    10行目  みなし残業時間 / みなし外残業時間
//    11行目  その値
//    13行目  日付 / 勤怠状況 / 休日区分 / 打刻場所 / 出勤実時刻 / 退勤実時刻 /
//            出勤時刻 / 退勤時刻 / 休憩時間 / 実労働時間 / 管理者備考1
//    14行目〜 日ごとの明細。最後に「合計」の行
//
// 【行や列の位置は決め打ちにしません】
//   見出しの言葉を探してから、その下・その列を読みます。
//   出力の設定によって列が増減しても読めるようにするためです。
//
// 【計算し直しません】
//   ジョブカンが出した数字をそのまま持ちます。
//   Brown Work の設定で計算し直すと当時の給与明細と食い違うためです。
//
// 【出勤実時刻と出勤時刻】
//   「実時刻」が実際に打刻した時刻、「時刻」が計算に使われた時刻です。
//   両方そのまま持ちます（丸めの有無が分かるようにするためです）。

const norm = (v: unknown) =>
  String(v ?? '')
    .replace(/\s+/g, '')
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .toLowerCase();

const text = (v: unknown) => String(v ?? '').trim();

/** 数にします。読めなければ null */
export function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = norm(v).replace(/[,，時間分回日]/g, '');
  if (s === '') return null;
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** 'HH:MM' の形だけ受け取ります。そうでなければ ''（24時以降もそのまま通します） */
export function toTime(v: unknown): string {
  if (v instanceof Date) {
    const h = v.getHours(); const m = v.getMinutes();
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  const s = text(v);
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return '';
  const mi = Number(m[2]);
  if (mi > 59) return '';
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

/** 1行の中から、見出しの言葉がある列の位置を返します。無ければ -1 */
const colOf = (row: unknown[], label: string) =>
  (row || []).findIndex((c) => norm(c) === norm(label));

/** 見出しの言葉を含む行を上から探します。無ければ -1 */
const rowOf = (aoa: unknown[][], labels: string[], from = 0) => {
  for (let i = from; i < aoa.length; i++) {
    const cells = (aoa[i] || []).map(norm);
    if (labels.every((l) => cells.includes(norm(l)))) return i;
  }
  return -1;
};

export type LegacyDay = {
  /** YYYY-MM-DD */
  date: string;
  /** 曜日（月・火…）。読めなければ '' */
  weekday: string;
  /** 勤怠状況（有給・欠勤など。無ければ ''） */
  status: string;
  /** 休日区分（祝日など） */
  holidayKind: string;
  /** 実際に打刻した時刻 */
  clockInActual: string;
  clockOutActual: string;
  /** 計算に使われた時刻 */
  clockIn: string;
  clockOut: string;
  /** 休憩時間（時間） */
  breakHours: number | null;
  /** 実労働時間（時間） */
  workHours: number | null;
  note: string;
};

export type LegacyMonth = {
  /** シート名（お名前） */
  sheetName: string;
  /** 対象の年月 */
  year: number;
  month: number;
  staffName: string;
  staffNumber: string;
  groupPath: string;
  staffType: string;
  /** 出勤日数など */
  workDays: number | null;
  weekdayDays: number | null;
  holidayDays: number | null;
  absentDays: number | null;
  lateCount: number | null;
  earlyCount: number | null;
  /** 労働時間（総合・平日・休日） */
  workHours: number | null;
  overtimeHours: number | null;
  nightHours: number | null;
  weekdayWorkHours: number | null;
  weekdayOvertimeHours: number | null;
  weekdayNightHours: number | null;
  holidayWorkHours: number | null;
  holidayOvertimeHours: number | null;
  holidayNightHours: number | null;
  /** みなし残業 */
  deemedOvertimeHours: number | null;
  overDeemedHours: number | null;
  /**
   * 消化した休暇。見出しをそのまま名前にして入れます。
   * 例：{ '有休(全休)': 1 }
   * この欄は休暇を取った方のシートにだけ現れ、取っていない方には列ごとありません。
   * 将来「半休」「特別休暇」などが増えても、見出しごと拾うので直さずに済みます。
   */
  leaveUsed: Record<string, number>;
  days: LegacyDay[];
  /** 読み取れなかった理由。問題なければ '' */
  error: string;
};

const WEEK = ['日', '月', '火', '水', '木', '金', '土'];

/** '10/01(木)' と対象の年から YYYY-MM-DD と曜日を作ります */
export function parseDayCell(cell: unknown, year: number): { date: string; weekday: string } {
  const s = text(cell);
  const m = s.match(/^(\d{1,2})[/月](\d{1,2})日?(?:\(([^)]+)\))?/);
  if (!m) return { date: '', weekday: '' };
  const mo = Number(m[1]); const da = Number(m[2]);
  if (mo < 1 || mo > 12 || da < 1 || da > 31) return { date: '', weekday: '' };
  const d = new Date(Date.UTC(year, mo - 1, da));
  if (d.getUTCMonth() + 1 !== mo || d.getUTCDate() !== da) return { date: '', weekday: '' };
  const weekday = m[3] && WEEK.includes(m[3]) ? m[3] : WEEK[d.getUTCDay()];
  return {
    date: `${year}-${String(mo).padStart(2, '0')}-${String(da).padStart(2, '0')}`,
    weekday,
  };
}

/** 1シート（1人の1か月）を読み取ります */
export function parseLegacySheet(sheetName: string, aoa: unknown[][]): LegacyMonth {
  const blank: LegacyMonth = {
    sheetName, year: 0, month: 0,
    staffName: '', staffNumber: '', groupPath: '', staffType: '',
    workDays: null, weekdayDays: null, holidayDays: null,
    absentDays: null, lateCount: null, earlyCount: null,
    workHours: null, overtimeHours: null, nightHours: null,
    weekdayWorkHours: null, weekdayOvertimeHours: null, weekdayNightHours: null,
    holidayWorkHours: null, holidayOvertimeHours: null, holidayNightHours: null,
    deemedOvertimeHours: null, overDeemedHours: null,
    leaveUsed: {},
    days: [], error: '',
  };

  // ---- 対象の年月 ----
  let year = 0; let month = 0;
  for (let i = 0; i < Math.min(aoa.length, 6) && year === 0; i++) {
    for (const c of aoa[i] || []) {
      const m = text(c).match(/(\d{4})年(\d{1,2})月/);
      if (m) { year = Number(m[1]); month = Number(m[2]); break; }
    }
  }
  if (year === 0) return { ...blank, error: '対象の年月（例：2026年10月）が見つかりません' };

  // ---- 日ごとの見出し ----
  const dayHeaderRow = rowOf(aoa, ['日付', '出勤実時刻']);
  if (dayHeaderRow < 0) {
    return { ...blank, year, month, error: '日ごとの見出し（日付・出勤実時刻）が見つかりません' };
  }
  const h = aoa[dayHeaderRow];
  const C = {
    date: colOf(h, '日付'),
    status: colOf(h, '勤怠状況'),
    holidayKind: colOf(h, '休日区分'),
    inActual: colOf(h, '出勤実時刻'),
    outActual: colOf(h, '退勤実時刻'),
    in: colOf(h, '出勤時刻'),
    out: colOf(h, '退勤時刻'),
    breakH: colOf(h, '休憩時間'),
    workH: colOf(h, '実労働時間'),
    note: colOf(h, '管理者備考1'),
  };
  const at = (r: unknown[], j: number) => (j < 0 ? '' : r[j]);

  const days: LegacyDay[] = [];
  for (let i = dayHeaderRow + 1; i < aoa.length; i++) {
    const r = aoa[i] || [];
    const first = text(r[C.date]);
    if (norm(first) === '合計') break;     // 最後の合計行で終わり
    if (first === '') continue;
    const { date, weekday } = parseDayCell(first, year);
    if (!date) continue;
    days.push({
      date, weekday,
      status: text(at(r, C.status)),
      holidayKind: text(at(r, C.holidayKind)),
      clockInActual: toTime(at(r, C.inActual)),
      clockOutActual: toTime(at(r, C.outActual)),
      clockIn: toTime(at(r, C.in)),
      clockOut: toTime(at(r, C.out)),
      breakHours: toNum(at(r, C.breakH)),
      workHours: toNum(at(r, C.workH)),
      note: text(at(r, C.note)),
    });
  }

  // ---- スタッフ情報 ----
  const infoRow = rowOf(aoa, ['スタッフ名']);
  const info = { staffName: '', staffNumber: '', groupPath: '', staffType: '' };
  if (infoRow >= 0 && aoa[infoRow + 1]) {
    const hh = aoa[infoRow]; const vv = aoa[infoRow + 1];
    const g = (label: string) => { const j = colOf(hh, label); return j < 0 ? '' : text(vv[j]); };
    info.staffName = g('スタッフ名');
    info.staffNumber = g('スタッフコード');
    info.groupPath = g('所属グループ');
    info.staffType = g('スタッフ種別');
  }

  // ---- 基本項目（出勤日数など）。スタッフ情報と同じ行に並んでいます ----
  const basic = { workDays: null, weekdayDays: null, holidayDays: null, absentDays: null, lateCount: null, earlyCount: null } as Record<string, number | null>;
  if (infoRow >= 0 && aoa[infoRow + 1]) {
    const hh = aoa[infoRow]; const vv = aoa[infoRow + 1];
    // 見出しは「総合\n出勤日数」のように改行が入っているため、改行を取ってから探します
    const find = (...cands: string[]) => {
      const j = (hh || []).findIndex((c) => cands.some((k) => norm(c) === norm(k)));
      return j < 0 ? null : toNum(vv[j]);
    };
    basic.workDays = find('総合出勤日数', '出勤日数');
    basic.weekdayDays = find('平日出勤日数');
    basic.holidayDays = find('休日出勤日数');
    basic.absentDays = find('欠勤日数');
    basic.lateCount = find('遅刻回数');
    basic.earlyCount = find('早退回数');
  }

  // ---- 労働時間（労働時間・残業時間・深夜時間 が3組ならぶ行）----
  const hours: number[] = [];
  const hoursRow = rowOf(aoa, ['労働時間', '残業時間', '深夜時間']);
  if (hoursRow >= 0 && aoa[hoursRow + 1]) {
    const hh = aoa[hoursRow]; const vv = aoa[hoursRow + 1];
    (hh || []).forEach((c, j) => {
      const n = norm(c);
      if (n === norm('労働時間') || n === norm('残業時間') || n === norm('深夜時間')) {
        hours.push(toNum(vv[j]) as number);
      }
    });
  }
  const H = (i: number) => (hours.length > i && hours[i] !== null && hours[i] !== undefined ? hours[i] : null);

  // ---- 消化した休暇 ----
  // 「消化した休暇」の見出しがある列から右を、労働時間と同じ行で読みます。
  // 休暇を取っていない方のシートにはこの列がありません（空のままになります）。
  const leaveUsed: Record<string, number> = {};
  const leaveHeadRow = rowOf(aoa, ['消化した休暇']);
  if (leaveHeadRow >= 0 && hoursRow >= 0 && aoa[hoursRow + 1]) {
    const leaveCol = colOf(aoa[leaveHeadRow], '消化した休暇');
    const hh = aoa[hoursRow]; const vv = aoa[hoursRow + 1];
    for (let j = leaveCol; j >= 0 && j < hh.length; j++) {
      const label = text(hh[j]);
      if (label === '') continue;
      const n = toNum(vv[j]);
      if (n !== null) leaveUsed[label] = n;
    }
  }

  // ---- みなし残業 ----
  let deemed: number | null = null; let overDeemed: number | null = null;
  const deemedRow = rowOf(aoa, ['みなし残業時間']);
  if (deemedRow >= 0 && aoa[deemedRow + 1]) {
    const hh = aoa[deemedRow]; const vv = aoa[deemedRow + 1];
    const j1 = colOf(hh, 'みなし残業時間');
    const j2 = colOf(hh, 'みなし外残業時間');
    deemed = j1 < 0 ? null : toNum(vv[j1]);
    overDeemed = j2 < 0 ? null : toNum(vv[j2]);
  }

  return {
    sheetName, year, month,
    ...info,
    workDays: basic.workDays, weekdayDays: basic.weekdayDays, holidayDays: basic.holidayDays,
    absentDays: basic.absentDays, lateCount: basic.lateCount, earlyCount: basic.earlyCount,
    workHours: H(0), overtimeHours: H(1), nightHours: H(2),
    weekdayWorkHours: H(3), weekdayOvertimeHours: H(4), weekdayNightHours: H(5),
    holidayWorkHours: H(6), holidayOvertimeHours: H(7), holidayNightHours: H(8),
    deemedOvertimeHours: deemed, overDeemedHours: overDeemed,
    leaveUsed,
    days,
    error: days.length === 0 ? '日ごとの行が1つも読み取れません' : '',
  };
}

/** ブック全体（シートごと）を読み取ります */
export function parseLegacyWorkbook(sheets: { name: string; aoa: unknown[][] }[]): LegacyMonth[] {
  return (sheets || []).map((s) => parseLegacySheet(s.name, s.aoa));
}

// ---- スタッフとの突き合わせ ----

export type LegacyTargetStaff = { id: string; name?: string; staffNumber?: string };

export type MatchedLegacyMonth = LegacyMonth & {
  employeeId: string | null;
  employeeName: string;
  /** どうやって見つけたか */
  matchedBy: 'code' | 'name' | null;
  /** 取り込めるか */
  ok: boolean;
};

/**
 * スタッフコードで探し、見つからなければシート名・スタッフ名で探します。
 * ジョブカンのコードは "00029" のように0詰めのことがあるため、
 * 数としても見比べます（Brown Work 側が "29" でも一致させるためです）。
 */
const codeKeys = (v: string) => {
  const a = norm(v);
  if (a === '') return [];
  const keys = [a];
  const stripped = a.replace(/^0+/, '');
  if (stripped !== '' && stripped !== a) keys.push(stripped);
  return keys;
};

export function matchLegacyMonths(
  months: LegacyMonth[],
  staff: LegacyTargetStaff[],
): MatchedLegacyMonth[] {
  const byCode = new Map<string, LegacyTargetStaff[]>();
  const byName = new Map<string, LegacyTargetStaff[]>();
  (staff || []).forEach((e) => {
    codeKeys(String(e.staffNumber ?? '')).forEach((k) => {
      byCode.set(k, [...(byCode.get(k) || []), e]);
    });
    const n = norm(e.name);
    if (n !== '') byName.set(n, [...(byName.get(n) || []), e]);
  });

  return (months || []).map((m) => {
    const base = { ...m, employeeId: null as string | null, employeeName: '', matchedBy: null as 'code' | 'name' | null, ok: false };
    if (m.error) return base;

    for (const k of codeKeys(m.staffNumber)) {
      const hit = byCode.get(k) || [];
      if (hit.length === 1) {
        return { ...base, employeeId: hit[0].id, employeeName: hit[0].name || '', matchedBy: 'code', ok: true };
      }
      if (hit.length > 1) {
        return { ...base, error: '同じスタッフコードのスタッフが複数います' };
      }
    }

    for (const cand of [m.staffName, m.sheetName]) {
      const hit = byName.get(norm(cand)) || [];
      if (hit.length === 1) {
        return { ...base, employeeId: hit[0].id, employeeName: hit[0].name || '', matchedBy: 'name', ok: true };
      }
      if (hit.length > 1) {
        return { ...base, error: '同じ氏名のスタッフが複数います。スタッフコードを登録してください' };
      }
    }

    return {
      ...base,
      error: m.staffNumber !== ''
        ? `スタッフコード「${m.staffNumber}」の方がBrown Workに見つかりません`
        : `「${m.staffName || m.sheetName}」という方がBrown Workに見つかりません`,
    };
  });
}

/** 画面に出す件数のまとめ */
export function legacySummary(months: MatchedLegacyMonth[]) {
  const ok = months.filter((m) => m.ok);
  return {
    sheets: months.length,
    ok: ok.length,
    ng: months.length - ok.length,
    days: ok.reduce((s, m) => s + m.days.length, 0),
    /** 打刻のあった日（出退勤のどちらかが入っている日） */
    worked: ok.reduce((s, m) => s + m.days.filter((d) => d.clockInActual || d.clockOutActual).length, 0),
  };
}

/** 月のまとめを「2026年10月」のように出します */
export function monthLabel(m: { year: number; month: number }): string {
  if (!m.year || !m.month) return '';
  return `${m.year}年${m.month}月`;
}

// ============================================================
// 有休の取得履歴（ジョブカンのCSV）
// ============================================================
//
// 【ファイルの形】
//   1行1件の素直なCSVです。文字コードはUTF-8（BOMつき）。
//     スタッフコード,姓,名,休暇タイプ,休暇日,開始時間(時間指定の場合),終了時間(時間指定の場合),休暇理由
//     "00002","今井","孝旺","有休","2020/09/07","","",""
//
//   ・休暇日は YYYY/MM/DD
//   ・開始時間・終了時間が入っているのは時間休のときだけです
//   ・休暇理由は引用符の中に改行が入ることがあります
//
// 【休暇理由の扱い】
//   理由には「体調不良」「健康診断受診のため」など、健康に関わる内容が
//   含まれます。本人とマスター管理者だけが見られるよう、
//   理由だけ別の表（legacy_leave_reasons）に入れます。
//   画面で隠すだけでは、API経由で読めてしまうためです。

/** 引用符つきCSVを読みます（引用符の中の改行・カンマ・二重引用符に対応） */
export function parseCsv(input: string): string[][] {
  const s = String(input ?? '').replace(/^﻿/, '');   // BOMを外す
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') { cell += '"'; i++; }   // "" は " 1つ
        else quoted = false;
      } else cell += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ',') { row.push(cell); cell = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; continue; }
    cell += c;
  }
  if (cell !== '' || row.length > 0) { row.push(cell); rows.push(row); }
  // 全部空の行は落とします
  return rows.filter((r) => r.some((v) => String(v).trim() !== ''));
}

export type LegacyLeave = {
  rowNumber: number;
  staffNumber: string;
  staffName: string;
  leaveType: string;
  /** YYYY-MM-DD */
  date: string;
  /** 時間休のときだけ入ります */
  startTime: string;
  endTime: string;
  reason: string;
  error: string;
};

const LEAVE_ALIASES: Record<string, string[]> = {
  staffNumber: ['スタッフコード', 'コード', '社員番号'],
  sei: ['姓'],
  mei: ['名'],
  leaveType: ['休暇タイプ', '休暇種別', '種別'],
  date: ['休暇日', '日付', '取得日'],
  startTime: ['開始時間(時間指定の場合)', '開始時間'],
  endTime: ['終了時間(時間指定の場合)', '終了時間'],
  reason: ['休暇理由', '理由'],
};

/** YYYY/MM/DD・YYYY-MM-DD を YYYY-MM-DD にします */
export function toLeaveDate(v: unknown): string {
  const s = String(v ?? '').trim();
  const m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (!m) return '';
  const y = Number(m[1]); const mo = Number(m[2]); const da = Number(m[3]);
  if (mo < 1 || mo > 12 || da < 1 || da > 31) return '';
  const d = new Date(Date.UTC(y, mo - 1, da));
  if (d.getUTCMonth() + 1 !== mo || d.getUTCDate() !== da) return '';
  return `${y}-${String(mo).padStart(2, '0')}-${String(da).padStart(2, '0')}`;
}

export type ParsedLeaveCsv = { rows: LegacyLeave[]; error: string };

/** 有休取得履歴のCSVを読み取ります */
export function parseLeaveCsv(input: string): ParsedLeaveCsv {
  const table = parseCsv(input);
  if (table.length === 0) return { rows: [], error: 'ファイルが空です' };

  // 見出しの行を探します
  let headIndex = -1;
  let col: Record<string, number> = {};
  for (let i = 0; i < Math.min(table.length, 10); i++) {
    const cells = table[i].map(norm);
    const found: Record<string, number> = {};
    cells.forEach((c, j) => {
      if (c === '') return;
      Object.keys(LEAVE_ALIASES).forEach((k) => {
        if (found[k] === undefined && LEAVE_ALIASES[k].some((a) => norm(a) === c)) found[k] = j;
      });
    });
    if (found.date !== undefined && (found.staffNumber !== undefined || found.sei !== undefined)) {
      headIndex = i; col = found; break;
    }
  }
  if (headIndex < 0) {
    return { rows: [], error: '見出しの行が見つかりません。「スタッフコード」「休暇日」のある表をお選びください' };
  }

  const g = (r: string[], k: string) => (col[k] === undefined ? '' : String(r[col[k]] ?? '').trim());
  const rows: LegacyLeave[] = [];
  for (let i = headIndex + 1; i < table.length; i++) {
    const r = table[i];
    const staffNumber = g(r, 'staffNumber');
    const staffName = [g(r, 'sei'), g(r, 'mei')].filter(Boolean).join(' ');
    const rawDate = g(r, 'date');
    if (staffNumber === '' && staffName === '' && rawDate === '') continue;
    const date = toLeaveDate(rawDate);
    let error = '';
    if (staffNumber === '' && staffName === '') error = 'スタッフコードと氏名のどちらも入っていません';
    else if (rawDate === '') error = '休暇日が入っていません';
    else if (date === '') error = `休暇日が読み取れません（いまは「${rawDate}」）`;
    rows.push({
      rowNumber: i + 1,
      staffNumber, staffName,
      leaveType: g(r, 'leaveType'),
      date,
      startTime: toTime(g(r, 'startTime')),
      endTime: toTime(g(r, 'endTime')),
      reason: g(r, 'reason'),
      error,
    });
  }
  if (rows.length === 0) return { rows, error: '取り込む行がありません' };
  return { rows, error: '' };
}

export type MatchedLeave = LegacyLeave & {
  employeeId: string | null;
  employeeName: string;
  matchedBy: 'code' | 'name' | null;
  ok: boolean;
};

/** スタッフコード（0詰めの違いも見ます）、無ければ氏名で突き合わせます */
export function matchLeaveRows(rows: LegacyLeave[], staff: LegacyTargetStaff[]): MatchedLeave[] {
  const byCode = new Map<string, LegacyTargetStaff[]>();
  const byName = new Map<string, LegacyTargetStaff[]>();
  (staff || []).forEach((e) => {
    codeKeys(String(e.staffNumber ?? '')).forEach((k) => byCode.set(k, [...(byCode.get(k) || []), e]));
    const n = norm(e.name);
    if (n !== '') byName.set(n, [...(byName.get(n) || []), e]);
  });

  return (rows || []).map((r) => {
    const base = { ...r, employeeId: null as string | null, employeeName: '', matchedBy: null as 'code' | 'name' | null, ok: false };
    if (r.error) return base;
    for (const k of codeKeys(r.staffNumber)) {
      const hit = byCode.get(k) || [];
      if (hit.length === 1) return { ...base, employeeId: hit[0].id, employeeName: hit[0].name || '', matchedBy: 'code', ok: true };
      if (hit.length > 1) return { ...base, error: '同じスタッフコードのスタッフが複数います' };
    }
    const hit = byName.get(norm(r.staffName)) || [];
    if (hit.length === 1) return { ...base, employeeId: hit[0].id, employeeName: hit[0].name || '', matchedBy: 'name', ok: true };
    if (hit.length > 1) return { ...base, error: '同じ氏名のスタッフが複数います' };
    return {
      ...base,
      error: r.staffNumber !== ''
        ? `スタッフコード「${r.staffNumber}」の方がBrown Workに見つかりません`
        : `「${r.staffName}」という方がBrown Workに見つかりません`,
    };
  });
}

/** 取り込めなかった方を、人ごとにまとめます（1人で何十件も出ると読みにくいため） */
export function leaveMissingStaff(rows: MatchedLeave[]): { who: string; count: number }[] {
  const map = new Map<string, number>();
  (rows || []).filter((r) => !r.ok).forEach((r) => {
    const who = `${r.staffName || '（氏名なし）'}${r.staffNumber ? `（${r.staffNumber}）` : ''}`;
    map.set(who, (map.get(who) || 0) + 1);
  });
  return [...map.entries()].map(([who, count]) => ({ who, count })).sort((a, b) => b.count - a.count);
}

/** 画面に出すまとめ */
export function leaveSummary(rows: MatchedLeave[]) {
  const ok = rows.filter((r) => r.ok);
  const years = ok.map((r) => r.date.slice(0, 4)).filter(Boolean).sort();
  return {
    total: rows.length,
    ok: ok.length,
    ng: rows.length - ok.length,
    people: new Set(ok.map((r) => r.employeeId)).size,
    withReason: ok.filter((r) => r.reason !== '').length,
    hourly: ok.filter((r) => r.startTime !== '').length,
    from: years[0] || '',
    to: years[years.length - 1] || '',
  };
}
