// 源泉徴収票（給与所得の源泉徴収票）に載せる数字を集計する
//
// ⚠ 年末調整の計算はしていません。
//   「給与所得控除後の金額」「所得控除の額の合計額」は年末調整をした場合だけ
//   記入する欄です。Brown Work は年末調整の計算を持っていないため、
//   これらは空欄にし、摘要に「年調未済」と入れます。
//   年末調整を別で行う場合は、その結果をこの集計とあわせてお使いください。
//
// 集計の決まり
//   ・源泉徴収票は「支払った年」でまとめます。対象月ではありません。
//     御社は当月末締め・翌月25日払いなので、2025年12月分の給与は
//     2026年1月25日払い＝2026年の源泉徴収票に入ります。
//   ・支払金額は、所得税の課税対象になる支給額の合計です。
//     通勤手当など非課税の項目は含めません（項目ごとの設定で決まります）。
//   ・社会保険料等の金額は、健康保険料・介護保険料・厚生年金保険料・
//     雇用保険料の控除額の合計です。
//   ・源泉徴収税額は、所得税の控除額の合計です。住民税は入りません。

/** 社会保険料等の金額に足す控除項目 */
export const WITHHOLDING_SOCIAL_LABELS = [
  '健康保険料', '介護保険料', '厚生年金保険料', '雇用保険料',
];
/** 源泉徴収税額になる控除項目 */
export const WITHHOLDING_TAX_LABEL = '所得税';

export type WhItem = { label: string; amount: number };
export type WhPayment = WhItem & { taxable: boolean };

export type WhSlip = {
  kind: 'salary' | 'bonus';
  label: string;          // 内訳に出す呼び名（「2026年1月25日払い（2025年12月分）」など）
  paymentYear: number;    // 支払った年
  payments: WhPayment[];
  deductions: WhItem[];
};

export type WhBreakdownRow = {
  kind: 'salary' | 'bonus';
  label: string;
  taxablePayment: number;
  nonTaxablePayment: number;
  socialInsurance: number;
  incomeTax: number;
};

export type WhResult = {
  year: number;
  /** 支払金額（課税対象の支給額の合計） */
  paymentTotal: number;
  /** 非課税の支給額の合計（通勤手当など。支払金額には入りません） */
  nonTaxableTotal: number;
  salaryTotal: number;
  bonusTotal: number;
  /** 社会保険料等の金額 */
  socialInsurance: number;
  socialParts: Record<string, number>;
  /** 源泉徴収税額 */
  incomeTax: number;
  counts: { salary: number; bonus: number };
  rows: WhBreakdownRow[];
};

const yen = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : 0;
};

/** 項目名から「（12月分）」のような補足を外して見比べる */
export function withholdingItemKey(label: string): string {
  return String(label || '').replace(/（[^（）]*）\s*$/, '').trim();
}

/** その年に支払ったぶんだけを集計します */
export function buildWithholding(slips: WhSlip[], year: number): WhResult {
  const socialParts: Record<string, number> = {};
  WITHHOLDING_SOCIAL_LABELS.forEach((k) => { socialParts[k] = 0; });

  const result: WhResult = {
    year,
    paymentTotal: 0,
    nonTaxableTotal: 0,
    salaryTotal: 0,
    bonusTotal: 0,
    socialInsurance: 0,
    socialParts,
    incomeTax: 0,
    counts: { salary: 0, bonus: 0 },
    rows: [],
  };

  (slips || []).filter((s) => s && s.paymentYear === year).forEach((s) => {
    let taxablePayment = 0;
    let nonTaxablePayment = 0;
    (s.payments || []).forEach((it) => {
      const a = yen(it.amount);
      if (it.taxable) taxablePayment += a; else nonTaxablePayment += a;
    });

    let social = 0;
    let tax = 0;
    (s.deductions || []).forEach((it) => {
      const key = withholdingItemKey(it.label);
      const a = yen(it.amount);
      if (WITHHOLDING_SOCIAL_LABELS.indexOf(key) >= 0) {
        social += a;
        socialParts[key] = (socialParts[key] || 0) + a;
      } else if (key === WITHHOLDING_TAX_LABEL) {
        tax += a;
      }
    });

    result.paymentTotal += taxablePayment;
    result.nonTaxableTotal += nonTaxablePayment;
    result.socialInsurance += social;
    result.incomeTax += tax;
    if (s.kind === 'bonus') {
      result.bonusTotal += taxablePayment;
      result.counts.bonus += 1;
    } else {
      result.salaryTotal += taxablePayment;
      result.counts.salary += 1;
    }
    result.rows.push({
      kind: s.kind,
      label: s.label,
      taxablePayment,
      nonTaxablePayment,
      socialInsurance: social,
      incomeTax: tax,
    });
  });

  return result;
}

export type WhIssue = { message: string };

/**
 * 出す前に気をつけたいこと。
 * 止めるためではなく、人が確かめるために出します。
 */
export function withholdingWarnings(r: WhResult, opts: { expectedSalaryCount?: number } = {}): WhIssue[] {
  const out: WhIssue[] = [];
  if (r.counts.salary === 0 && r.counts.bonus === 0) {
    out.push({ message: `${r.year}年に支払った明細がありません。` });
    return out;
  }
  const expected = opts.expectedSalaryCount ?? 12;
  if (r.counts.salary > 0 && r.counts.salary < expected) {
    out.push({ message: `${r.year}年に支払った給与明細が${r.counts.salary}件です（通常は${expected}件）。年の途中の入社・退職でなければ、作り忘れがないかお確かめください。` });
  }
  if (r.paymentTotal > 0 && r.incomeTax === 0) {
    out.push({ message: '源泉徴収税額が0円です。所得税の控除が入っているかお確かめください。' });
  }
  if (r.paymentTotal > 0 && r.socialInsurance === 0) {
    out.push({ message: '社会保険料等の金額が0円です。社会保険に加入している方であれば、控除が入っているかお確かめください。' });
  }
  if (r.nonTaxableTotal > 0) {
    out.push({ message: `非課税として支払金額から外した額が${r.nonTaxableTotal.toLocaleString()}円あります（通勤手当など）。通勤手当の非課税には限度額があるため、限度を超える方は支払金額に入れる必要があります。` });
  }
  return out;
}
