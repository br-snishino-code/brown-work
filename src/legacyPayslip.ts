// ジョブカンの「支給・控除等一覧表」を読み取ります（過去の給与明細の書庫用）。
//
// 【ファイルの形】
//   1行1人のCSV。列は支給・控除の項目名です。対象年月の列はありません。
//     従業員名,スタッフコード,総労働日数,総労働時間,…,基本給,…,支給合計,
//     健康保険料,…,社会保険料合計,所得税,住民税,課税通勤手当,非課税通勤手当,
//     立替金,…,差引支給額,備考,その他
//
// 【合計を正とします】
//   実物を66名分検算したところ、内訳を全部足しても支給合計に届かない方が
//   いました（時間外手当などの列が出力に含まれていない月があるためです）。
//   控除側にも、備考にしか書かれていない立替金がありました。
//   そこで、支給合計・社会保険料合計・差引支給額は読み取った値をそのまま持ち、
//   内訳は内訳として別に持ちます。合わない分は「内訳に出ていない支給」として
//   画面に出し、金額をごまかしません。
//
// 【列が増えても読めます】
//   項目は見出しの名前で見分けます。知らない名前は、
//   「支給合計」より前にあれば支給、後ろにあれば控除とみなします
//   （通勤手当だけは支給合計より後ろに並ぶため、名前で支給と判断します）。

const norm = (v: unknown) =>
  String(v ?? '')
    .replace(/\s+/g, '')
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .toLowerCase();

const text = (v: unknown) => String(v ?? '').trim();

/** 金額を数にします。読めなければ null */
export function toYen(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v) : null;
  const s = norm(v).replace(/[,，円¥￥]/g, '');
  if (s === '') return null;
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n) : null;
}

/**
 * '189:54' を分に直します。読めなければ null。
 * 出力の設定によっては '189:54:00' と秒まで付くことがあるため、
 * どちらでも読めるようにしています。
 */
export function toMinutes(v: unknown): number | null {
  const s = text(v);
  const m = s.match(/^(\d+):([0-5]\d)(?::([0-5]\d))?$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** 小数の日数。読めなければ null */
export function toDays(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
}

// ---- 列の見分け ----

/** 人や勤怠の列。支給でも控除でもありません */
const INFO_COLUMNS = [
  '従業員名', '氏名', '姓', '名', 'スタッフコード', 'コード', '社員番号',
  '総労働日数', '総労働時間', '遅刻早退時間', '有休日数', '有休時間',
  '備考', 'その他',
];

/** 合計の列。内訳ではなく、そのまま持ちます */
const TOTAL_COLUMNS = {
  payTotal: ['支給合計', '総支給額', '支給額合計'],
  insuranceTotal: ['社会保険料合計', '社会保険料計'],
  netPay: ['差引支給額', '差引支払額', '手取り'],
};

/** 支給の中でマイナスとして効く項目 */
const PAY_MINUS = ['遅刻早退控除', '欠勤控除', '不就労控除'];

/**
 * 支給合計より後ろに並んでいるが、支給の項目。
 *
 * 立替金は「スタッフが立て替えた分をお返しする」支給です（御社に確認済み）。
 * 名前から控除と取り違えやすいので、ここに明記しています。
 * 会社が先に出した分を給与から回収する「給与先出分」は、
 * この列ではなく備考にだけ書かれており、どの列にも出てきません。
 */
const PAY_AFTER_TOTAL = ['課税通勤手当', '非課税通勤手当', '通勤手当', '立替金', '立替金1'];

/** 控除の項目（社会保険料合計の内訳も含む） */
const DEDUCTION_NAMES = [
  '健康保険料', '介護保険料', '厚生年金保険料', '雇用保険料',
  '所得税', '住民税', '家賃控除', '貸付金', '貸付金回収',
];

/** 社会保険料合計の内訳（合計と二重に数えないよう、別扱いにします） */
const INSURANCE_PARTS = ['健康保険料', '介護保険料', '厚生年金保険料', '雇用保険料'];

/** 控除のうち、戻し（マイナスの控除）として効く項目 */
const DEDUCTION_MINUS = ['貸付金回収'];

const inList = (name: string, list: string[]) => list.some((a) => norm(a) === norm(name));

export type PayslipItemKind = 'pay' | 'deduction' | 'insurancePart';

export type ColumnPlan = {
  name: string;
  index: number;
  kind: PayslipItemKind;
  /** マイナスとして効くか */
  minus: boolean;
};

export type SheetPlan = {
  header: string[];
  /** 合計の列の位置。無ければ -1 */
  payTotalIndex: number;
  insuranceTotalIndex: number;
  netPayIndex: number;
  codeIndex: number;
  nameIndex: number;
  workDaysIndex: number;
  workMinutesIndex: number;
  paidLeaveDaysIndex: number;
  noteIndex: number;
  items: ColumnPlan[];
  error: string;
};

const findCol = (header: string[], names: string[]) =>
  header.findIndex((h) => inList(h, names));

/**
 * 見出しの行から、どの列が何かを決めます。
 * 知らない名前も、位置と名前から支給か控除かを決めます。
 */
export function planColumns(header: string[]): SheetPlan {
  const h = (header || []).map(text);
  const payTotalIndex = findCol(h, TOTAL_COLUMNS.payTotal);
  const insuranceTotalIndex = findCol(h, TOTAL_COLUMNS.insuranceTotal);
  const netPayIndex = findCol(h, TOTAL_COLUMNS.netPay);
  const codeIndex = findCol(h, ['スタッフコード', 'コード', '社員番号']);
  const nameIndex = findCol(h, ['従業員名', '氏名', 'スタッフ名']);

  const plan: SheetPlan = {
    header: h,
    payTotalIndex, insuranceTotalIndex, netPayIndex, codeIndex, nameIndex,
    workDaysIndex: findCol(h, ['総労働日数', '労働日数', '出勤日数']),
    workMinutesIndex: findCol(h, ['総労働時間', '労働時間']),
    paidLeaveDaysIndex: findCol(h, ['有休日数', '有給日数']),
    noteIndex: findCol(h, ['備考']),
    items: [],
    error: '',
  };

  if (payTotalIndex < 0) {
    plan.error = '「支給合計」の列が見つかりません。支給・控除等一覧表をお選びください';
    return plan;
  }
  if (codeIndex < 0 && nameIndex < 0) {
    plan.error = '「スタッフコード」も「従業員名」も見つかりません';
    return plan;
  }

  h.forEach((name, index) => {
    if (name === '') return;
    if (inList(name, INFO_COLUMNS)) return;
    if (index === payTotalIndex || index === insuranceTotalIndex || index === netPayIndex) return;

    let kind: PayslipItemKind;
    if (inList(name, INSURANCE_PARTS)) kind = 'insurancePart';
    else if (inList(name, PAY_AFTER_TOTAL)) kind = 'pay';
    else if (inList(name, DEDUCTION_NAMES)) kind = 'deduction';
    // 「〜手当」は支給として扱います。
    // 出力項目を足すと、支給合計より後ろに並ぶことがあるためです
    // （残業手当・深夜労働手当・休日労働手当・特別手当などが該当します）。
    else if (/手当$/.test(name)) kind = 'pay';
    else if (index < payTotalIndex) kind = 'pay';          // それ以外は位置で決めます
    else kind = 'deduction';

    const minus = inList(name, PAY_MINUS) || inList(name, DEDUCTION_MINUS);
    plan.items.push({ name, index, kind, minus });
  });

  return plan;
}

// ---- 1人分 ----

export type PayslipItem = { label: string; amount: number; minus: boolean };

export type LegacyPayslip = {
  rowNumber: number;
  staffCode: string;
  staffName: string;
  /** 勤怠（参考） */
  workDays: number | null;
  workMinutes: number | null;
  paidLeaveDays: number | null;
  note: string;
  /** 合計。読み取った値をそのまま持ちます */
  payTotal: number | null;
  insuranceTotal: number | null;
  netPay: number | null;
  /** 内訳 */
  payItems: PayslipItem[];
  deductionItems: PayslipItem[];
  insuranceParts: PayslipItem[];
  /** 内訳を足した額 */
  payItemsSum: number;
  /** 控除の内訳（所得税・住民税・立替金など）を足した額。社会保険料合計は含みません */
  deductionItemsSum: number;
  /** 実際に引かれた額。社会保険料合計＋控除の内訳 */
  deductionTotal: number;
  /**
   * 支給合計 − 支給の内訳の合計。
   * 0 でなければ、出力に含まれていない支給（時間外手当など）があります。
   */
  payGap: number;
  /** 差引支給額 − （支給合計 − 控除の内訳） */
  deductionGap: number;
  /** 社会保険料合計 − 内訳。実物では健康保険料の約2.33%の差が出ます */
  insuranceGap: number;
  /** 1円も動いていない行（在籍のみで支給なし） */
  empty: boolean;
  error: string;
};

const cell = (row: unknown[], i: number) => (i < 0 ? '' : row[i]);

/** 1行を読み取ります */
export function parsePayslipRow(row: unknown[], plan: SheetPlan, rowNumber: number): LegacyPayslip {
  const staffCode = text(cell(row, plan.codeIndex));
  const staffName = text(cell(row, plan.nameIndex));
  const payTotal = toYen(cell(row, plan.payTotalIndex));
  const insuranceTotal = plan.insuranceTotalIndex < 0 ? null : toYen(cell(row, plan.insuranceTotalIndex));
  const netPay = plan.netPayIndex < 0 ? null : toYen(cell(row, plan.netPayIndex));

  const payItems: PayslipItem[] = [];
  const deductionItems: PayslipItem[] = [];
  const insuranceParts: PayslipItem[] = [];
  plan.items.forEach((c) => {
    const amount = toYen(row[c.index]);
    if (amount === null || amount === 0) return;       // 0円の項目は出しません
    const item = { label: c.name, amount, minus: c.minus };
    if (c.kind === 'pay') payItems.push(item);
    else if (c.kind === 'insurancePart') insuranceParts.push(item);
    else deductionItems.push(item);
  });

  const sum = (list: PayslipItem[]) =>
    list.reduce((s, it) => s + (it.minus ? -it.amount : it.amount), 0);
  const payItemsSum = sum(payItems);
  const deductionItemsSum = sum(deductionItems);
  // 社会保険料は「合計」の列を使います。内訳（健保・厚年など）と足すと二重になります
  const deductionTotal = (insuranceTotal ?? 0) + deductionItemsSum;

  const empty = (payTotal ?? 0) === 0 && (netPay ?? 0) === 0
    && payItems.length === 0 && deductionItems.length === 0;

  return {
    rowNumber, staffCode, staffName,
    workDays: toDays(cell(row, plan.workDaysIndex)),
    workMinutes: toMinutes(cell(row, plan.workMinutesIndex)),
    paidLeaveDays: toDays(cell(row, plan.paidLeaveDaysIndex)),
    note: text(cell(row, plan.noteIndex)),
    payTotal, insuranceTotal, netPay,
    payItems, deductionItems, insuranceParts,
    payItemsSum, deductionItemsSum, deductionTotal,
    payGap: payTotal === null ? 0 : payTotal - payItemsSum,
    deductionGap: (netPay === null || payTotal === null)
      ? 0
      : netPay - (payTotal - deductionTotal),
    insuranceGap: insuranceTotal === null ? 0 : insuranceTotal - sum(insuranceParts),
    empty,
    error: payTotal === null && netPay === null ? '金額が読み取れません' : '',
  };
}

export type ParsedPayslipSheet = {
  plan: SheetPlan;
  rows: LegacyPayslip[];
  error: string;
};

/** CSVの表（配列の配列）を読み取ります */
export function parsePayslipTable(table: unknown[][]): ParsedPayslipSheet {
  const t = (table || []).filter((r) => (r || []).some((c) => text(c) !== ''));
  if (t.length === 0) {
    return { plan: planColumns([]), rows: [], error: 'ファイルが空です' };
  }
  // 見出しの行を探します（先頭10行まで）
  let plan = planColumns([]);
  let headIndex = -1;
  for (let i = 0; i < Math.min(t.length, 10); i++) {
    const p = planColumns((t[i] || []).map(text));
    if (!p.error) { plan = p; headIndex = i; break; }
  }
  if (headIndex < 0) {
    return {
      plan,
      rows: [],
      error: '見出しの行が見つかりません。「スタッフコード」と「支給合計」のある表をお選びください',
    };
  }

  const rows: LegacyPayslip[] = [];
  for (let i = headIndex + 1; i < t.length; i++) {
    const r = parsePayslipRow(t[i], plan, i + 1);
    if (r.staffCode === '' && r.staffName === '') continue;
    rows.push(r);
  }
  if (rows.length === 0) return { plan, rows, error: '取り込む行がありません' };
  return { plan, rows, error: '' };
}

// ---- スタッフとの突き合わせ ----

export type PayslipTargetStaff = { id: string; name?: string; staffNumber?: string };

export type MatchedPayslip = LegacyPayslip & {
  employeeId: string | null;
  employeeName: string;
  matchedBy: 'code' | 'name' | null;
  ok: boolean;
};

const codeKeys = (v: string) => {
  const a = norm(v);
  if (a === '') return [];
  const keys = [a];
  const stripped = a.replace(/^0+/, '');
  if (stripped !== '' && stripped !== a) keys.push(stripped);
  return keys;
};

/** スタッフコード（0詰めの違いも見ます）、無ければ氏名で突き合わせます */
export function matchPayslips(rows: LegacyPayslip[], staff: PayslipTargetStaff[]): MatchedPayslip[] {
  const byCode = new Map<string, PayslipTargetStaff[]>();
  const byName = new Map<string, PayslipTargetStaff[]>();
  (staff || []).forEach((e) => {
    codeKeys(String(e.staffNumber ?? '')).forEach((k) => byCode.set(k, [...(byCode.get(k) || []), e]));
    const n = norm(e.name);
    if (n !== '') byName.set(n, [...(byName.get(n) || []), e]);
  });

  return (rows || []).map((r) => {
    const base = { ...r, employeeId: null as string | null, employeeName: '', matchedBy: null as 'code' | 'name' | null, ok: false };
    if (r.error) return base;
    for (const k of codeKeys(r.staffCode)) {
      const hit = byCode.get(k) || [];
      if (hit.length === 1) return { ...base, employeeId: hit[0].id, employeeName: hit[0].name || '', matchedBy: 'code', ok: true };
      if (hit.length > 1) return { ...base, error: '同じスタッフコードのスタッフが複数います' };
    }
    const hit = byName.get(norm(r.staffName)) || [];
    if (hit.length === 1) return { ...base, employeeId: hit[0].id, employeeName: hit[0].name || '', matchedBy: 'name', ok: true };
    if (hit.length > 1) return { ...base, error: '同じ氏名のスタッフが複数います' };
    return {
      ...base,
      error: r.staffCode !== ''
        ? `スタッフコード「${r.staffCode}」の方がBrown Workに見つかりません`
        : `「${r.staffName}」という方がBrown Workに見つかりません`,
    };
  });
}

/** 取り込めなかった方を人ごとにまとめます */
export function payslipMissingStaff(rows: MatchedPayslip[]): { who: string; }[] {
  const seen = new Set<string>();
  const out: { who: string }[] = [];
  (rows || []).filter((r) => !r.ok).forEach((r) => {
    const who = `${r.staffName || '（氏名なし）'}${r.staffCode ? `（${r.staffCode}）` : ''}`;
    if (seen.has(who)) return;
    seen.add(who);
    out.push({ who });
  });
  return out;
}

/** 画面に出すまとめ */
export function payslipSummary(rows: MatchedPayslip[]) {
  const ok = rows.filter((r) => r.ok);
  const paid = ok.filter((r) => !r.empty);
  return {
    total: rows.length,
    ok: ok.length,
    ng: rows.length - ok.length,
    /** 支給のあった方 */
    paid: paid.length,
    /** 支給が0円だった方（在籍のみ） */
    empty: ok.length - paid.length,
    payTotal: paid.reduce((s, r) => s + (r.payTotal || 0), 0),
    netPay: paid.reduce((s, r) => s + (r.netPay || 0), 0),
    /** 内訳に出ていない支給がある方 */
    withPayGap: paid.filter((r) => r.payGap !== 0).length,
    /** 内訳に出ていない控除がある方 */
    withDeductionGap: paid.filter((r) => r.deductionGap !== 0).length,
  };
}

/** 「2026年10月分」。支給日も分かれば添えます */
export function payslipMonthLabel(year: number, month: number): string {
  if (!year || !month) return '';
  return `${year}年${month}月分`;
}
