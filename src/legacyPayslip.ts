// ジョブカンの「支給・控除等一覧表」を読み取ります（過去の給与明細の書庫用）。
//
// 【ファイルの形は2通りあります】
//   どちらも1行1人のCSVで、対象年月の列はありません。
//   ジョブカンの出力設定で選ぶ項目によって、列の並びが2通りに変わります。
//
//   (A) 全項目版（おすすめ）… 支給→控除→合計→参考情報 の順
//       従業員名,スタッフコード,〈勤怠〉,基本給,…〈支給〉…,非課税通勤手当,
//       健康保険料,…〈控除〉…,子ども・子育て支援金,
//       支給合計,控除合計,差引支給額,〈銀行振込・事業主負担などの参考情報〉
//
//   (B) 一部版 … 支給→支給合計→控除→差引支給額→後から足した項目
//       従業員名,スタッフコード,〈勤怠〉,基本給,…,支給合計,
//       健康保険料,…,社会保険料合計,所得税,住民税,課税通勤手当,非課税通勤手当,
//       立替金,…,差引支給額,備考,その他,残業手当,…
//
//   (A) は「控除合計」の列があり、控除が支給合計より前に並びます。
//   そこを見て、どちらの並びかを判断します。
//
// 【(A) をおすすめする理由】（実物66名で検算して確かめました）
//   (B) では控除が足りない方が57名いました。
//     ・56名 … 「子ども・子育て支援金」の列が (B) に出てこないため
//     ・1名  … 「␣立替金」（先頭に空白）という列が (B) に出てこないため、30,000円が落ちる
//   (A) なら支給・控除・差引支給額のすべてが66名全員で一致します。
//
// 【「立替金」は空白の違いで支給と控除に分かれます】
//   ジョブカンでは同じ名前の項目を支給にも控除にも作れるため、
//   見分けが空白だけになっていることがあります。実物では、
//     ・「立替金」（空白なし）  → 支給
//     ・「立替金␣」（後ろに全角空白）、「␣立替金」（前に半角空白）、「立替金1」 → 控除
//   でした。そこで項目の名前を見比べるときは空白も含めて比べます。
//   空白を無視すると、控除の立替金を支給として足してしまいます。
//
// 【合計を正とします】
//   支給合計・控除合計・社会保険料合計・差引支給額は読み取った値をそのまま持ち、
//   内訳は内訳として別に持ちます。合わない分は「内訳に出ていない支給」として
//   画面に出し、金額をごまかしません。

/** 項目名を見比べる用。全角英数は半角にしますが、空白は残します（上の注を参照） */
const key = (v: unknown) =>
  String(v ?? '')
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .toLowerCase();

/** 人の照合用。空白も取り除いてゆるく比べます */
const norm = (v: unknown) => key(v).replace(/\s+/g, '');

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

/** 人の列 */
const PERSON_COLUMNS = ['従業員名', '氏名', 'スタッフ名', '姓', '名', 'スタッフコード', 'コード', '社員番号'];

/** 勤怠の列。支給でも控除でもありません */
const WORK_COLUMNS = [
  '総労働日数', '総労働時間', '遅刻早退時間', '有休日数', '有休時間',
  '所定労働時間（当月）', '所定労働日数（当月）', '所定内労働時間', '所定外労働時間',
  '残業時間', '残業時間（みなし除く）', '深夜時間', '法定休日労働時間', '欠勤日数',
];

/** 文字の列 */
const NOTE_COLUMNS = ['備考'];

/** 合計の列。内訳ではなく、そのまま持ちます */
const TOTAL_COLUMNS = {
  payTotal: ['支給合計', '総支給額', '支給額合計'],
  deductionTotal: ['控除合計', '控除額合計', '控除計'],
  insuranceTotal: ['社会保険料合計', '社会保険料計'],
  netPay: ['差引支給額', '差引支払額', '手取り'],
};

/** 支給の中でマイナスとして効く項目 */
const PAY_MINUS = ['遅刻早退控除', '欠勤控除', '不就労控除', '出勤調整(過払い回収)', '出勤調整（過払い回収）'];

/**
 * 支給合計より後ろに並んでいるが、支給の項目。
 * 一部版（並びB）だけで使います。
 *
 * 立替金は「スタッフが立て替えた分をお返しする」支給です（御社に確認済み）。
 * 名前の後ろや前に空白が付いた「立替金␣」「␣立替金」は別の項目で、
 * ジョブカンでは控除側に置かれています。空白まで含めて比べるため、
 * ここに書いた「立替金」はそれらに一致しません。
 */
const PAY_AFTER_TOTAL = ['課税通勤手当', '非課税通勤手当', '通勤手当', '立替金'];

/** 控除の項目（社会保険料合計の内訳も含む） */
const DEDUCTION_NAMES = [
  '健康保険料', '介護保険料', '厚生年金保険料', '雇用保険料', '子ども・子育て支援金',
  '所得税', '住民税', '家賃控除', '貸付金', '貸付金回収', '立替金1',
  'その他控除', 'その他控除2', 'その他控除２', '休業控除',
];

/**
 * 社会保険料合計の内訳（合計と二重に数えないよう、別扱いにします）。
 *
 * 子ども・子育て支援金も社会保険料合計に含まれています。
 * 実物66名で `社会保険料合計 ＝ 健保＋介護＋厚年＋雇用＋子ども・子育て支援金`
 * が全員で成り立つことを確かめました。
 */
const INSURANCE_PARTS = [
  '健康保険料', '介護保険料', '厚生年金保険料', '雇用保険料', '子ども・子育て支援金',
];

/** 控除のうち、戻し（マイナスの控除）として効く項目 */
const DEDUCTION_MINUS = ['貸付金回収'];

/**
 * 控除の並びに入っているが、取り込まない列。
 *
 * 2024年の定額減税の列です。実物では全員0でした。
 * 「2024減税後所得税」は所得税と重なり、「2024減税額」は所得税を減らす額なので、
 * そのまま足すと控除が狂います。0でない値が入っていたら画面でお知らせします。
 */
const SKIP_COLUMNS = ['2024減税額', '2024減税後所得税', '年末調整還付額', '年末調整精算用'];

/** 空白まで含めて、項目名が一覧のどれかに当たるか */
const inList = (name: string, list: string[]) => list.some((a) => key(a) === key(name));

/** 空白を無視して、項目名が一覧のどれかに当たるか（人や合計の列を探す用） */
const inListLoose = (name: string, list: string[]) => list.some((a) => norm(a) === norm(name));

export type PayslipItemKind = 'pay' | 'deduction' | 'insurancePart';

export type ColumnPlan = {
  name: string;
  index: number;
  kind: PayslipItemKind;
  /** マイナスとして効くか */
  minus: boolean;
};

/** ジョブカンの出力の並び。'full' は全項目版（控除合計あり）、'partial' は一部版 */
export type PayslipLayout = 'full' | 'partial';

export type SheetPlan = {
  /** 見出しの行。空白は取り除いていません（立替金の見分けに使うため） */
  header: string[];
  layout: PayslipLayout;
  /** 合計の列の位置。無ければ -1 */
  payTotalIndex: number;
  deductionTotalIndex: number;
  insuranceTotalIndex: number;
  netPayIndex: number;
  codeIndex: number;
  nameIndex: number;
  workDaysIndex: number;
  workMinutesIndex: number;
  overtimeMinutesIndex: number;
  nightMinutesIndex: number;
  paidLeaveDaysIndex: number;
  absenceDaysIndex: number;
  noteIndex: number;
  items: ColumnPlan[];
  /** 取り込まなかった列のうち、お知らせした方がよいもの */
  skipped: string[];
  error: string;
};

/** 先に書いた名前を優先して、その列の位置を返します。無ければ -1 */
const findCol = (header: string[], names: string[]) => {
  for (const want of names) {
    const i = header.findIndex((h) => norm(h) === norm(want));
    if (i >= 0) return i;
  }
  return -1;
};

/**
 * 見出しの行から、どの列が何かを決めます。
 *
 * まず並びが全項目版か一部版かを見分けます。
 * 全項目版は「控除合計」の列があり、控除が支給合計より前に並びます。
 * 全項目版なら位置だけで確実に分けられるので、名前の一覧には頼りません。
 */
export function planColumns(header: string[]): SheetPlan {
  // 見出しは trim しません。「立替金」と「立替金␣」を区別する必要があります
  const h = (header || []).map((v) => String(v ?? ''));
  const payTotalIndex = findCol(h, TOTAL_COLUMNS.payTotal);
  const deductionTotalIndex = findCol(h, TOTAL_COLUMNS.deductionTotal);
  const insuranceTotalIndex = findCol(h, TOTAL_COLUMNS.insuranceTotal);
  const netPayIndex = findCol(h, TOTAL_COLUMNS.netPay);
  const codeIndex = findCol(h, ['スタッフコード', 'コード', '社員番号']);
  const nameIndex = findCol(h, ['従業員名', '氏名', 'スタッフ名']);

  // 控除の始まり（社会保険料の内訳が最初に出てくるところ）
  const firstDeductionIndex = h.findIndex((n) => inList(n, INSURANCE_PARTS));
  const layout: PayslipLayout =
    deductionTotalIndex >= 0 && firstDeductionIndex >= 0
      && payTotalIndex >= 0 && firstDeductionIndex < payTotalIndex
      ? 'full'
      : 'partial';

  const plan: SheetPlan = {
    header: h,
    layout,
    payTotalIndex, deductionTotalIndex, insuranceTotalIndex, netPayIndex, codeIndex, nameIndex,
    workDaysIndex: findCol(h, ['総労働日数', '労働日数', '出勤日数']),
    workMinutesIndex: findCol(h, ['総労働時間', '労働時間']),
    overtimeMinutesIndex: findCol(h, ['残業時間（みなし除く）', '残業時間', '所定外労働時間']),
    nightMinutesIndex: findCol(h, ['深夜時間', '深夜労働時間']),
    paidLeaveDaysIndex: findCol(h, ['有休日数', '有給日数']),
    absenceDaysIndex: findCol(h, ['欠勤日数']),
    noteIndex: findCol(h, NOTE_COLUMNS),
    items: [],
    skipped: [],
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

  const totals = [payTotalIndex, deductionTotalIndex, insuranceTotalIndex, netPayIndex];

  h.forEach((name, index) => {
    if (text(name) === '') return;
    if (inListLoose(name, PERSON_COLUMNS)) return;
    if (inListLoose(name, WORK_COLUMNS)) return;
    if (inListLoose(name, NOTE_COLUMNS)) return;
    if (totals.includes(index)) return;

    // 全項目版では、差引支給額より後ろは参考情報です
    // （銀行振込・現金支給額・事業主負担・標準報酬月額・グループ名・事業所名など）。
    // 名前を並べて数えるのではなく、位置で一律に外します
    if (layout === 'full' && netPayIndex >= 0 && index > netPayIndex) return;

    if (inList(name, SKIP_COLUMNS)) {
      plan.skipped.push(text(name));
      return;
    }

    let kind: PayslipItemKind;
    if (inList(name, INSURANCE_PARTS)) kind = 'insurancePart';
    else if (layout === 'full') {
      // 全項目版は位置で分かります。支給 → 控除 → 合計 の順に並んでいます
      kind = index < firstDeductionIndex ? 'pay' : 'deduction';
    } else if (inList(name, PAY_AFTER_TOTAL)) kind = 'pay';
    else if (inList(name, DEDUCTION_NAMES)) kind = 'deduction';
    // 一部版では「〜手当」を支給として扱います。
    // 出力項目を足すと、支給合計より後ろに並ぶことがあるためです
    // （残業手当・深夜労働手当・休日労働手当・特別手当などが該当します）。
    else if (/手当\s*$/.test(name)) kind = 'pay';
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
  overtimeMinutes: number | null;
  nightMinutes: number | null;
  paidLeaveDays: number | null;
  absenceDays: number | null;
  note: string;
  /** 合計。読み取った値をそのまま持ちます */
  payTotal: number | null;
  /** 「控除合計」の列の値。一部版の出力には無いので null */
  deductionTotalRead: number | null;
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
  /**
   * 実際に引かれた額。
   * 「控除合計」の列があればその値、無ければ 社会保険料合計＋控除の内訳 で出します。
   */
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
  const deductionTotalRead = plan.deductionTotalIndex < 0 ? null : toYen(cell(row, plan.deductionTotalIndex));
  const insuranceTotal = plan.insuranceTotalIndex < 0 ? null : toYen(cell(row, plan.insuranceTotalIndex));
  const netPay = plan.netPayIndex < 0 ? null : toYen(cell(row, plan.netPayIndex));

  const payItems: PayslipItem[] = [];
  const deductionItems: PayslipItem[] = [];
  const insuranceParts: PayslipItem[] = [];
  plan.items.forEach((c) => {
    const amount = toYen(row[c.index]);
    if (amount === null || amount === 0) return;       // 0円の項目は出しません
    const item = { label: text(c.name), amount, minus: c.minus };
    if (c.kind === 'pay') payItems.push(item);
    else if (c.kind === 'insurancePart') insuranceParts.push(item);
    else deductionItems.push(item);
  });

  const sum = (list: PayslipItem[]) =>
    list.reduce((s, it) => s + (it.minus ? -it.amount : it.amount), 0);
  const payItemsSum = sum(payItems);
  const deductionItemsSum = sum(deductionItems);
  // 社会保険料は「合計」の列を使います。内訳（健保・厚年など）と足すと二重になります。
  // 「控除合計」の列があれば、それが一番確かなのでそちらを使います
  const deductionTotal = deductionTotalRead ?? ((insuranceTotal ?? 0) + deductionItemsSum);

  const empty = (payTotal ?? 0) === 0 && (netPay ?? 0) === 0
    && payItems.length === 0 && deductionItems.length === 0;

  return {
    rowNumber, staffCode, staffName,
    workDays: toDays(cell(row, plan.workDaysIndex)),
    workMinutes: toMinutes(cell(row, plan.workMinutesIndex)),
    overtimeMinutes: toMinutes(cell(row, plan.overtimeMinutesIndex)),
    nightMinutes: toMinutes(cell(row, plan.nightMinutesIndex)),
    paidLeaveDays: toDays(cell(row, plan.paidLeaveDaysIndex)),
    absenceDays: toDays(cell(row, plan.absenceDaysIndex)),
    note: text(cell(row, plan.noteIndex)),
    payTotal, deductionTotalRead, insuranceTotal, netPay,
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
    // 見出しは trim しません（「立替金」と「立替金␣」が別の項目のため）
    const p = planColumns((t[i] || []).map((c) => String(c ?? '')));
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
    /** 控除合計の列があり、内訳と合わない方（全項目版のときだけ出ます） */
    withDeductionItemsGap: paid.filter(
      (r) => r.deductionTotalRead !== null
        && r.deductionTotalRead !== (r.insuranceTotal ?? 0) + r.deductionItemsSum,
    ).length,
  };
}

/** 「2026年10月分」。支給日も分かれば添えます */
export function payslipMonthLabel(year: number, month: number): string {
  if (!year || !month) return '';
  return `${year}年${month}月分`;
}
