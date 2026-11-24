// スタッフの一括登録。
//
// 【何をするか】
//   Excelに1行1人で並べたスタッフを読み取り、まとめてアカウントを作ります。
//   作ったあと、スタッフコード・グループ・種別・賃金も続けて登録します。
//
// 【入れない項目】
//   住所・電話・生年月日・口座・マイナンバーは入れていません。
//   これらはスタッフご本人が初回ログインのときに入力する項目で、
//   Excelに並べると取り扱いに気を遣う情報が手元に増えるためです。
//
// 【仮パスワード】
//   空欄のときはこちらで作ります。英大文字・英小文字・数字を必ず含む
//   12文字です。紛らわしい文字（0とO、1とlとI）は使いません。
//   作ったパスワードは登録後の一覧に出るので、そこから配ってください。
//
// 【同じ人を二重に作らないために】
//   ログインIDとスタッフコードは、Excelの中どうしと、すでに登録済みの方の
//   両方と突き合わせます。どちらかが重なっている行は取り込みません。

/** 画面とひな形で使う列の並び */
export const STAFF_IMPORT_COLUMNS = [
  { key: 'sei', label: '姓', required: true },
  { key: 'mei', label: '名', required: true },
  { key: 'seiKana', label: '姓カナ', required: false },
  { key: 'meiKana', label: '名カナ', required: false },
  { key: 'email', label: 'ログインID（メールアドレス）', required: true },
  { key: 'password', label: '仮パスワード（空欄なら自動）', required: false },
  { key: 'hireDate', label: '入職日', required: true },
  { key: 'role', label: '権限', required: false },
  { key: 'staffNumber', label: 'スタッフコード', required: false },
  { key: 'mainGroup', label: 'メイングループ', required: false },
  { key: 'staffType', label: 'スタッフ種別', required: false },
  { key: 'wageType', label: '給与形態', required: false },
  { key: 'hourlyWage', label: '時給', required: false },
  { key: 'dailyWage', label: '日給（平日）', required: false },
  { key: 'dailyWageHoliday', label: '日給（土日祝）', required: false },
  { key: 'monthlySalary', label: '月給', required: false },
  { key: 'commuteAllowance', label: '交通費（月額）', required: false },
  { key: 'deemedOvertimeHours', label: 'みなし残業時間（月あたり）', required: false },
] as const;

export type StaffImportKey = (typeof STAFF_IMPORT_COLUMNS)[number]['key'];

/** 見出しに使える言葉。ひな形の言葉のほか、短い書き方も受け付けます */
const HEADER_ALIASES: Record<StaffImportKey, string[]> = {
  sei: ['姓', '氏', 'せい'],
  mei: ['名', 'めい'],
  seiKana: ['姓カナ', 'セイ', '姓かな', 'フリガナ（姓）'],
  meiKana: ['名カナ', 'メイ', '名かな', 'フリガナ（名）'],
  email: ['ログインID（メールアドレス）', 'ログインID', 'メールアドレス', 'メール', 'email', 'mail'],
  password: ['仮パスワード（空欄なら自動）', '仮パスワード', 'パスワード', 'password'],
  hireDate: ['入職日', '入社日', '雇入れ日'],
  role: ['権限', '役割', 'role'],
  staffNumber: ['スタッフコード', 'コード', '社員番号', 'スタッフNo'],
  mainGroup: ['メイングループ', 'グループ', '所属', '所属グループ'],
  staffType: ['スタッフ種別', '種別', '雇用形態'],
  wageType: ['給与形態', '賃金形態'],
  hourlyWage: ['時給', '時給額'],
  dailyWage: ['日給（平日）', '日給', '日給額'],
  dailyWageHoliday: ['日給（土日祝）', '日給土日祝'],
  monthlySalary: ['月給', '月給額', '基本給'],
  commuteAllowance: ['交通費（月額）', '交通費', '通勤手当'],
  deemedOvertimeHours: ['みなし残業時間（月あたり）', 'みなし残業時間', 'みなし残業'],
};

const norm = (v: unknown) =>
  String(v ?? '')
    .replace(/\s+/g, '')
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .toLowerCase();

/** 権限の書き方と、保存する値の対応 */
const ROLE_ALIASES: Record<string, string> = {
  'スタッフ': 'employee', '一般': 'employee', '従業員': 'employee', 'employee': 'employee',
  '管理者': 'admin', 'admin': 'admin',
  'マスター管理者': 'master_admin', 'マスター': 'master_admin', 'master_admin': 'master_admin',
};

/** 給与形態の書き方と、保存する値の対応 */
const WAGE_ALIASES: Record<string, string> = {
  '時給': 'hourly', 'hourly': 'hourly',
  '日給': 'daily', 'daily': 'daily',
  '月給': 'monthly', 'monthly': 'monthly',
};

export const ROLE_LABELS: Record<string, string> = {
  employee: 'スタッフ', admin: '管理者', master_admin: 'マスター管理者',
};

// ---- 仮パスワード ----

// 紛らわしい文字を抜いた文字種。0とO、1とlとI は入れていません
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOWER = 'abcdefghijkmnopqrstuvwxyz';
const DIGIT = '23456789';

/**
 * 仮パスワードを作ります。英大文字・英小文字・数字を必ず1つずつ含む12文字です。
 * rand は 0以上1未満の数を返すもの（試験のときに差し替えます）。
 */
export function makeTempPassword(rand: () => number = Math.random): string {
  const pick = (chars: string) => chars[Math.floor(rand() * chars.length)];
  const head = [pick(UPPER), pick(LOWER), pick(DIGIT)];
  const pool = UPPER + LOWER + DIGIT;
  const rest = Array.from({ length: 9 }, () => pick(pool));
  const all = [...head, ...rest];
  // 並びを混ぜます（先頭が必ず大文字…とならないように）
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  return all.join('');
}

/**
 * パスワードの決まりを満たしているか。満たしていれば null。
 * App.tsx の passwordProblem と同じ決まりです（8文字以上・数字・英大文字・英小文字）。
 */
export function passwordProblemForImport(value: unknown): string | null {
  const v = String(value ?? '');
  if (v.length < 8) return 'パスワードは8文字以上にしてください';
  if (!/[0-9]/.test(v)) return 'パスワードに数字を1つ以上入れてください';
  if (!/[A-Z]/.test(v)) return 'パスワードに英大文字（A〜Z）を1つ以上入れてください';
  if (!/[a-z]/.test(v)) return 'パスワードに英小文字（a〜z）を1つ以上入れてください';
  return null;
}

// ---- 値の読み取り ----

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * 日付を YYYY-MM-DD にします。読めなければ ''。
 * Excelの日付（1900年起算の数値）、Dateオブジェクト、2026-04-01、2026/4/1 に対応します。
 */
export function toDateKey(v: unknown): string {
  if (v === null || v === undefined || v === '') return '';
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return '';
    return `${v.getFullYear()}-${pad2(v.getMonth() + 1)}-${pad2(v.getDate())}`;
  }
  if (typeof v === 'number') {
    // Excelの日付。1900年の閏年の扱いに合わせて 1899-12-30 を起点にします
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

/** 金額・時間を数にします。カンマ・円・全角に対応。読めなければ null */
export function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = norm(v).replace(/[,，円¥￥時間]/g, '');
  if (s === '') return null;
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// ---- シートの読み取り ----

export type StaffImportRow = {
  /** Excelの行番号（1から。見出しの行も数えます） */
  rowNumber: number;
  raw: Record<string, string>;
  sei: string; mei: string; seiKana: string; meiKana: string;
  email: string; password: string; hireDate: string; role: string;
  staffNumber: string; mainGroup: string; staffType: string;
  wageType: string;
  hourlyWage: number | null; dailyWage: number | null; dailyWageHoliday: number | null;
  monthlySalary: number | null; commuteAllowance: number | null; deemedOvertimeHours: number | null;
  /** 仮パスワードをこちらで作ったか */
  passwordGenerated: boolean;
  /** 取り込めない理由。問題なければ '' */
  error: string;
};

export type ParsedStaffSheet = {
  headerRow: number;
  rows: StaffImportRow[];
  error: string;
};

const findHeader = (aoa: unknown[][]) => {
  const limit = Math.min(aoa.length, 20);
  for (let i = 0; i < limit; i++) {
    const cells = (aoa[i] || []).map(norm);
    const col: Partial<Record<StaffImportKey, number>> = {};
    cells.forEach((c, j) => {
      if (c === '') return;
      (Object.keys(HEADER_ALIASES) as StaffImportKey[]).forEach((k) => {
        if (col[k] === undefined && HEADER_ALIASES[k].some((a) => norm(a) === c)) col[k] = j;
      });
    });
    // 姓・名・ログインIDの3つがそろっていれば見出しの行とみなします
    if (col.sei !== undefined && col.mei !== undefined && col.email !== undefined) {
      return { index: i, col };
    }
  }
  return null;
};

/** Excelのシート（配列の配列）を読み取ります */
export function parseStaffSheet(
  aoa: unknown[][],
  makePassword: () => string = () => makeTempPassword(),
): ParsedStaffSheet {
  const head = findHeader(aoa || []);
  if (!head) {
    return {
      headerRow: 0,
      rows: [],
      error: '見出しの行が見つかりません。「姓」「名」「ログインID（メールアドレス）」の見出しがある表をご用意ください',
    };
  }
  const { index, col } = head;
  const cell = (r: unknown[], k: StaffImportKey) => {
    const j = col[k];
    return j === undefined ? '' : String(r[j] ?? '').trim();
  };
  const rawCell = (r: unknown[], k: StaffImportKey): unknown => {
    const j = col[k];
    return j === undefined ? '' : r[j];
  };

  const rows: StaffImportRow[] = [];
  for (let i = index + 1; i < aoa.length; i++) {
    const r = aoa[i] || [];
    const raw: Record<string, string> = {};
    STAFF_IMPORT_COLUMNS.forEach((c) => { raw[c.key] = cell(r, c.key); });

    // すべて空の行は飛ばします
    if (Object.values(raw).every((v) => v === '')) continue;

    const hireDate = toDateKey(rawCell(r, 'hireDate'));
    const roleRaw = raw.role;
    const role = roleRaw === '' ? 'employee' : (ROLE_ALIASES[norm(roleRaw)] || '');
    const wageRaw = raw.wageType;
    const wageType = wageRaw === '' ? '' : (WAGE_ALIASES[norm(wageRaw)] || '');

    let password = raw.password;
    let passwordGenerated = false;
    if (password === '') { password = makePassword(); passwordGenerated = true; }

    const row: StaffImportRow = {
      rowNumber: i + 1,
      raw,
      sei: raw.sei, mei: raw.mei, seiKana: raw.seiKana, meiKana: raw.meiKana,
      email: raw.email, password, hireDate, role,
      staffNumber: raw.staffNumber, mainGroup: raw.mainGroup, staffType: raw.staffType,
      wageType,
      hourlyWage: toNumber(rawCell(r, 'hourlyWage')),
      dailyWage: toNumber(rawCell(r, 'dailyWage')),
      dailyWageHoliday: toNumber(rawCell(r, 'dailyWageHoliday')),
      monthlySalary: toNumber(rawCell(r, 'monthlySalary')),
      commuteAllowance: toNumber(rawCell(r, 'commuteAllowance')),
      deemedOvertimeHours: toNumber(rawCell(r, 'deemedOvertimeHours')),
      passwordGenerated,
      error: '',
    };

    // 行ごとの確かめ。見つかった最初の1つだけ出します
    if (row.sei === '' || row.mei === '') row.error = '姓と名を入れてください';
    else if (row.email === '') row.error = 'ログインID（メールアドレス）を入れてください';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) row.error = 'メールアドレスの形ではありません';
    else if (raw.hireDate === '') row.error = '入職日を入れてください';
    else if (hireDate === '') row.error = '入職日が読み取れません（例：2026-04-01）';
    else if (role === '') row.error = `権限は「スタッフ」「管理者」「マスター管理者」のどれかにしてください（いまは「${roleRaw}」）`;
    else if (wageRaw !== '' && wageType === '') row.error = `給与形態は「時給」「日給」「月給」のどれかにしてください（いまは「${wageRaw}」）`;
    else {
      const problem = passwordProblemForImport(row.password);
      if (problem) row.error = problem;
    }
    if (!row.error) {
      // 金額の欄に数でないものが入っていないか
      const numberChecks: [StaffImportKey, string][] = [
        ['hourlyWage', '時給'], ['dailyWage', '日給（平日）'], ['dailyWageHoliday', '日給（土日祝）'],
        ['monthlySalary', '月給'], ['commuteAllowance', '交通費（月額）'],
        ['deemedOvertimeHours', 'みなし残業時間（月あたり）'],
      ];
      for (const [key, label] of numberChecks) {
        if (raw[key] !== '' && (row as unknown as Record<string, unknown>)[key] === null) {
          row.error = `${label}が数として読み取れません（いまは「${raw[key]}」）`;
          break;
        }
        const val = (row as unknown as Record<string, number | null>)[key];
        if (val !== null && val !== undefined && val < 0) {
          row.error = `${label}がマイナスです`;
          break;
        }
      }
    }
    rows.push(row);
  }

  if (rows.length === 0) return { headerRow: index + 1, rows, error: '取り込む行がありません' };
  return { headerRow: index + 1, rows, error: '' };
}

// ---- すでに登録済みの方との突き合わせ ----

export type ExistingStaff = { id: string; name?: string; email?: string; staffNumber?: string };

export type CheckedStaffRow = StaffImportRow & {
  /** 画面に出す氏名 */
  fullName: string;
  /** 取り込めるか */
  ok: boolean;
  /** 気をつけていただきたいこと（取り込みは止めません） */
  warning: string;
};

export type StaffCheckOptions = {
  existing?: ExistingStaff[];
  knownGroups?: string[];
  staffTypes?: string[];
};

/**
 * Excelの中どうし、およびすでに登録済みの方と突き合わせます。
 * 重なっている行は取り込みません（同じ人が二重にできてしまうため）。
 */
export function checkStaffRows(rows: StaffImportRow[], opts: StaffCheckOptions = {}): CheckedStaffRow[] {
  const existing = opts.existing || [];
  const knownGroups = opts.knownGroups || [];
  const staffTypes = opts.staffTypes || [];

  const existingEmail = new Set(existing.map((e) => norm(e.email)).filter((v) => v !== ''));
  const existingCode = new Set(existing.map((e) => norm(e.staffNumber)).filter((v) => v !== ''));

  // Excelの中で何回出てくるか
  const emailCount = new Map<string, number>();
  const codeCount = new Map<string, number>();
  (rows || []).forEach((r) => {
    const e = norm(r.email);
    if (e !== '') emailCount.set(e, (emailCount.get(e) || 0) + 1);
    const c = norm(r.staffNumber);
    if (c !== '') codeCount.set(c, (codeCount.get(c) || 0) + 1);
  });

  return (rows || []).map((r) => {
    const fullName = [r.sei, r.mei].filter(Boolean).join(' ');
    let error = r.error;
    const warnings: string[] = [];

    if (!error) {
      const e = norm(r.email);
      const c = norm(r.staffNumber);
      if (existingEmail.has(e)) error = 'このログインIDのスタッフはすでに登録されています';
      else if ((emailCount.get(e) || 0) > 1) error = 'このログインIDがExcelの中で重なっています';
      else if (c !== '' && existingCode.has(c)) error = 'このスタッフコードはすでに別の方が使っています';
      else if (c !== '' && (codeCount.get(c) || 0) > 1) error = 'このスタッフコードがExcelの中で重なっています';
    }

    if (!error) {
      if (r.mainGroup !== '' && knownGroups.length > 0 && !knownGroups.some((g) => norm(g) === norm(r.mainGroup))) {
        warnings.push(`「${r.mainGroup}」は登録済みのグループにありません`);
      }
      if (r.staffType !== '' && staffTypes.length > 0 && !staffTypes.some((t) => norm(t) === norm(r.staffType))) {
        warnings.push(`「${r.staffType}」は選べるスタッフ種別にありません`);
      }
      if (r.wageType === 'hourly' && r.hourlyWage === null) warnings.push('時給が空です');
      if (r.wageType === 'daily' && r.dailyWage === null) warnings.push('日給（平日）が空です');
      if (r.wageType === 'monthly' && r.monthlySalary === null) warnings.push('月給が空です');
    }

    return { ...r, fullName, ok: !error, error, warning: warnings.join('／') };
  });
}

/** 登録したあとに続けて入れる項目だけを取り出します（空のものは入れません） */
export function staffProfilePatch(row: CheckedStaffRow): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (row.staffNumber !== '') patch.staffNumber = row.staffNumber;
  if (row.mainGroup !== '') patch.mainGroup = row.mainGroup;
  if (row.staffType !== '') patch.staffType = row.staffType;
  if (row.wageType !== '') patch.wageType = row.wageType;
  if (row.hourlyWage !== null) patch.hourlyWage = row.hourlyWage;
  if (row.dailyWage !== null) patch.dailyWage = row.dailyWage;
  if (row.dailyWageHoliday !== null) patch.dailyWageHoliday = row.dailyWageHoliday;
  if (row.monthlySalary !== null) patch.monthlySalary = row.monthlySalary;
  if (row.commuteAllowance !== null) patch.commuteAllowance = row.commuteAllowance;
  if (row.deemedOvertimeHours !== null) patch.deemedOvertimeHours = row.deemedOvertimeHours;
  return patch;
}

/** 画面に出す件数のまとめ */
export function staffImportSummary(rows: CheckedStaffRow[]): { ok: number; ng: number; warned: number } {
  const ok = rows.filter((r) => r.ok).length;
  return {
    ok,
    ng: rows.length - ok,
    warned: rows.filter((r) => r.ok && r.warning !== '').length,
  };
}
