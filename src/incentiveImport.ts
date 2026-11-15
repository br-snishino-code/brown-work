// インセンティブの取り込み。
//
// 【何をするか】
//   Excelに「スタッフコード・氏名・金額」を並べたものを読み取り、
//   その月の給与明細に「インセンティブ」として入れます。
//   金額の計算はExcel側で行い、Brown Work は入れるだけです。
//
// 【給与明細に入れるときの決まり】
//   ・項目名は「インセンティブ（◯月分）」で固定です。
//     何度取り込んでも、同じ項目が1行に書き換わります（二重に増えません）。
//   ・公開済みの明細は書き換えません。スタッフが受け取った明細が
//     あとから変わると手元の控えと食い違うためです。
//     交通費精算の反映（syncCommuteAmountInPayroll）と同じ扱いです。
//   ・金額が0または空の行は、その人のインセンティブの項目を取り除きます。
//
// 【スタッフの見つけ方】
//   スタッフコードで探し、見つからなければ氏名で探します。
//   氏名は表記ゆれで合わないことがあるため、コードでの一致をおすすめします。
//   同じ氏名が複数いる場合は、どちらか分からないため取り込みません。

/** 給与明細に入れる項目名の頭。これで始まる項目を書き換えます */
export const INCENTIVE_LABEL_PREFIX = 'インセンティブ';

/** 項目名（例：インセンティブ（11月分）） */
export function incentiveItemLabel(month: number): string {
  return `${INCENTIVE_LABEL_PREFIX}（${month}月分）`;
}

/** Excelの見出しに使える言葉。どれか1つが入っていればその列とみなします */
const HEADER_ALIASES = {
  code: ['スタッフコード', 'コード', '社員番号', 'スタッフNo', 'スタッフNO', 'staff_number', 'code'],
  name: ['氏名', '名前', 'スタッフ名', '社員名', 'name'],
  amount: ['金額', 'インセンティブ', '支給額', '合計', 'amount'],
} as const;

const norm = (v: unknown) =>
  String(v ?? '')
    .replace(/\s+/g, '')
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .toLowerCase();

/** 1行ぶんの読み取り結果 */
export type IncentiveRow = {
  /** Excelの行番号（1から数えます。見出しの行も含みます） */
  rowNumber: number;
  code: string;
  name: string;
  /** 読み取れた金額。読み取れなければ null */
  amount: number | null;
  /** 読み取れなかった理由。問題なければ '' */
  error: string;
};

export type ParsedIncentiveSheet = {
  /** 見出しが見つかった行番号（1から）。見つからなければ 0 */
  headerRow: number;
  rows: IncentiveRow[];
  /** シート全体の問題。あれば取り込めません */
  error: string;
};

const findHeader = (aoa: unknown[][]) => {
  // 先頭から20行までの中から、金額の列がある行を見出しとみなします
  const limit = Math.min(aoa.length, 20);
  for (let i = 0; i < limit; i++) {
    const cells = (aoa[i] || []).map(norm);
    const col = { code: -1, name: -1, amount: -1 };
    cells.forEach((c, j) => {
      if (c === '') return;
      (Object.keys(HEADER_ALIASES) as (keyof typeof HEADER_ALIASES)[]).forEach((k) => {
        if (col[k] === -1 && HEADER_ALIASES[k].some((a) => norm(a) === c)) col[k] = j;
      });
    });
    if (col.amount !== -1 && (col.code !== -1 || col.name !== -1)) return { index: i, col };
  }
  return null;
};

/** 金額を読み取ります。全角・カンマ・円つきでも読みます */
export function parseAmount(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v) : null;
  const s = norm(v).replace(/[,，円¥￥]/g, '');
  if (s === '') return null;
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n) : null;
}

/**
 * Excelのシート（配列の配列）を読み取ります。
 * 見出しの行を探し、その下の行を1件ずつ読みます。
 */
export function parseIncentiveSheet(aoa: unknown[][]): ParsedIncentiveSheet {
  const head = findHeader(aoa || []);
  if (!head) {
    return {
      headerRow: 0,
      rows: [],
      error: '見出しの行が見つかりません。「スタッフコード」「氏名」「金額」の見出しがある表をご用意ください',
    };
  }
  const { index, col } = head;
  const rows: IncentiveRow[] = [];
  for (let i = index + 1; i < aoa.length; i++) {
    const r = aoa[i] || [];
    const code = col.code === -1 ? '' : String(r[col.code] ?? '').trim();
    const name = col.name === -1 ? '' : String(r[col.name] ?? '').trim();
    const rawAmount = col.amount === -1 ? '' : r[col.amount];
    const blank = code === '' && name === '' && String(rawAmount ?? '').trim() === '';
    if (blank) continue;   // 空の行は飛ばします
    const amount = parseAmount(rawAmount);
    let error = '';
    if (code === '' && name === '') error = 'スタッフコードと氏名のどちらも入っていません';
    else if (amount === null) error = '金額が読み取れません';
    else if (amount < 0) error = '金額がマイナスです';
    rows.push({ rowNumber: i + 1, code, name, amount, error });
  }
  if (rows.length === 0) {
    return { headerRow: index + 1, rows, error: '取り込む行がありません' };
  }
  return { headerRow: index + 1, rows, error: '' };
}

export type EmployeeLite = { id: string; name: string; staffNumber?: string; resignationDate?: string | null };

export type MatchedIncentive = IncentiveRow & {
  employeeId: string | null;
  employeeName: string;
  /** どうやって見つけたか */
  matchedBy: 'code' | 'name' | null;
};

/**
 * Excelの行をスタッフに結びつけます。
 * スタッフコードを先に見て、無ければ氏名で探します。
 */
export function matchIncentiveRows(rows: IncentiveRow[], employees: EmployeeLite[]): MatchedIncentive[] {
  const byCode = new Map<string, EmployeeLite[]>();
  const byName = new Map<string, EmployeeLite[]>();
  (employees || []).forEach((e) => {
    const c = norm(e.staffNumber);
    if (c !== '') byCode.set(c, [...(byCode.get(c) || []), e]);
    const n = norm(e.name);
    if (n !== '') byName.set(n, [...(byName.get(n) || []), e]);
  });

  return (rows || []).map((row) => {
    if (row.error) return { ...row, employeeId: null, employeeName: '', matchedBy: null };
    const hitCode = row.code === '' ? [] : (byCode.get(norm(row.code)) || []);
    if (hitCode.length === 1) {
      return { ...row, employeeId: hitCode[0].id, employeeName: hitCode[0].name, matchedBy: 'code' };
    }
    if (hitCode.length > 1) {
      return { ...row, employeeId: null, employeeName: '', matchedBy: null, error: '同じスタッフコードのスタッフが複数います' };
    }
    const hitName = row.name === '' ? [] : (byName.get(norm(row.name)) || []);
    if (hitName.length === 1) {
      return { ...row, employeeId: hitName[0].id, employeeName: hitName[0].name, matchedBy: 'name' };
    }
    if (hitName.length > 1) {
      return { ...row, employeeId: null, employeeName: '', matchedBy: null, error: '同じ氏名のスタッフが複数います。スタッフコードを入れてください' };
    }
    return {
      ...row,
      employeeId: null,
      employeeName: '',
      matchedBy: null,
      error: row.code !== '' ? 'このスタッフコードのスタッフが見つかりません' : 'この氏名のスタッフが見つかりません',
    };
  });
}

export type PayItem = { label?: unknown; amount?: unknown };

/**
 * 支給項目の一覧に、インセンティブを入れ直します。
 * 既にあるインセンティブの行は取り除いてから入れるので、二重になりません。
 * 金額が0以下なら、行ごと取り除きます。
 */
export function applyIncentiveToItems(items: PayItem[] | null | undefined, amount: number, month: number): PayItem[] {
  const without = (items || []).filter(
    (it) => !String(it?.label ?? '').startsWith(INCENTIVE_LABEL_PREFIX)
  );
  if (!Number.isFinite(amount) || amount <= 0) return without;
  return [...without, { label: incentiveItemLabel(month), amount: Math.round(amount) }];
}

/** いま入っているインセンティブの金額（無ければ0） */
export function currentIncentiveAmount(items: PayItem[] | null | undefined): number {
  const found = (items || []).find((it) => String(it?.label ?? '').startsWith(INCENTIVE_LABEL_PREFIX));
  const n = Number(found?.amount);
  return Number.isFinite(n) ? n : 0;
}

/** 支給項目の合計 */
export function sumPayItems(items: PayItem[] | null | undefined): number {
  return (items || []).reduce((s, it) => s + (Number(it?.amount) || 0), 0);
}
