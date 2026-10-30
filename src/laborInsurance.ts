// 労働保険の年度更新（概算・確定保険料申告書）に使う数字を集計する
//
// ⚠ 保険料率はこちらでは決められません。
//   労災保険率は事業の種類ごとに決まっていて（54業種）、雇用保険率も
//   事業の種類（一般／農林水産・清酒製造／建設）で違います。
//   率は設定として登録してもらい、未登録のときは計算しません。
//
// 集計の決まり
//   ・年度は4月1日から翌年3月31日までです。
//   ・賃金は「支払が確定した」もので数えます（締め日ベース）。
//     御社は当月末締め・翌月25日払いなので、2026年度は
//     2026年4月分〜2027年3月分の給与です（支払は2026年5月〜2027年4月）。
//   ・賞与は締め日が無いので、支給日が年度内のもので数えます。
//   ・労働保険の賃金には通勤手当も含みます（所得税で非課税でも含みます）。
//     どの項目を含めるかは「支給・控除項目一覧」の設定で決まります。
//   ・労災保険は役員を除く全労働者、雇用保険は被保険者だけが対象です。
//
// 申告書に書くときの端数
//   ・保険料算定基礎額（賃金総額）は1,000円未満を切り捨てます。
//   ・保険料はそのあと率をかけ、1円未満を切り捨てます。

export const LABOR_INSURANCE_FISCAL_START_MONTH = 4;

/** その年月（締め月）が属する年度 */
export function fiscalYearOfMonth(year: number, month: number): number {
  return month >= LABOR_INSURANCE_FISCAL_START_MONTH ? year : year - 1;
}

/** 年度の期間（表示用） */
export function fiscalYearRange(fiscalYear: number): { from: string; to: string } {
  return { from: `${fiscalYear}-04-01`, to: `${fiscalYear + 1}-03-31` };
}

export type LiPerson = {
  employeeId: string;
  name: string;
  /** 雇用保険の被保険者か */
  employmentInsured: boolean;
  /** 労災保険の対象外（役員など労働者でない方） */
  excludedFromRousai: boolean;
};

export type LiSlip = {
  employeeId: string;
  kind: 'salary' | 'bonus';
  label: string;
  fiscalYear: number;
  /** 労働保険の賃金に含める支給額の合計 */
  wage: number;
};

export type LiPersonTotal = {
  employeeId: string;
  name: string;
  employmentInsured: boolean;
  excludedFromRousai: boolean;
  salaryWage: number;
  bonusWage: number;
  wage: number;
  counts: { salary: number; bonus: number };
};

export type LiTotals = {
  fiscalYear: number;
  /** 労災保険の賃金総額（役員などを除く） */
  rousaiWage: number;
  /** 雇用保険の賃金総額（被保険者だけ） */
  koyouWage: number;
  people: LiPersonTotal[];
  counts: { rousai: number; koyou: number };
};

const yen = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : 0;
};

/** 1,000円未満を切り捨てる（保険料算定基礎額） */
export function floorToThousand(v: number): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n / 1000) * 1000;
}

/** その年度の賃金総額を出します */
export function buildLaborInsurance(people: LiPerson[], slips: LiSlip[], fiscalYear: number): LiTotals {
  const byId = new Map<string, LiPersonTotal>();
  (people || []).forEach((p) => {
    byId.set(p.employeeId, {
      employeeId: p.employeeId,
      name: p.name,
      employmentInsured: !!p.employmentInsured,
      excludedFromRousai: !!p.excludedFromRousai,
      salaryWage: 0,
      bonusWage: 0,
      wage: 0,
      counts: { salary: 0, bonus: 0 },
    });
  });

  (slips || []).filter((s) => s && s.fiscalYear === fiscalYear).forEach((s) => {
    const t = byId.get(s.employeeId);
    if (!t) return;   // 名簿にない方は数えません（退職後に消えた場合など）
    const w = yen(s.wage);
    t.wage += w;
    if (s.kind === 'bonus') { t.bonusWage += w; t.counts.bonus += 1; }
    else { t.salaryWage += w; t.counts.salary += 1; }
  });

  const people2 = [...byId.values()].filter((t) => t.wage !== 0 || t.counts.salary > 0 || t.counts.bonus > 0);
  let rousaiWage = 0;
  let koyouWage = 0;
  let rousaiCount = 0;
  let koyouCount = 0;
  people2.forEach((t) => {
    if (!t.excludedFromRousai) { rousaiWage += t.wage; rousaiCount += 1; }
    if (t.employmentInsured) { koyouWage += t.wage; koyouCount += 1; }
  });

  return {
    fiscalYear,
    rousaiWage,
    koyouWage,
    people: people2,
    counts: { rousai: rousaiCount, koyou: koyouCount },
  };
}

export type LiRates = {
  /** 労災保険率（1000分のいくつか） */
  rousai: number | null;
  /** 雇用保険率（1000分のいくつか・事業主と被保険者の合計） */
  koyou: number | null;
  /** 一般拠出金率（1000分のいくつか） */
  ippan: number | null;
};

export type LiPremium = {
  base: number;       // 保険料算定基礎額（1,000円未満切り捨て）
  rate: number | null;
  amount: number | null;   // 率が未登録なら null
};

/** 率をかけて保険料を出します。1円未満は切り捨てます */
export function premiumOf(wage: number, rate: number | null): LiPremium {
  const base = floorToThousand(wage);
  if (rate == null || !Number.isFinite(Number(rate)) || Number(rate) < 0) {
    return { base, rate: null, amount: null };
  }
  return { base, rate: Number(rate), amount: Math.floor((base * Number(rate)) / 1000) };
}

export type LiResult = {
  rousai: LiPremium;
  koyou: LiPremium;
  ippan: LiPremium;
  /** 労働保険料（労災＋雇用）。どちらかが未登録なら null */
  laborTotal: number | null;
  /** 申告書の合計（労働保険料＋一般拠出金） */
  grandTotal: number | null;
};

export function laborInsurancePremiums(totals: LiTotals, rates: LiRates): LiResult {
  const rousai = premiumOf(totals.rousaiWage, rates.rousai);
  const koyou = premiumOf(totals.koyouWage, rates.koyou);
  // 一般拠出金は労災保険と同じ賃金総額にかけます
  const ippan = premiumOf(totals.rousaiWage, rates.ippan);
  const laborTotal = rousai.amount != null && koyou.amount != null ? rousai.amount + koyou.amount : null;
  const grandTotal = laborTotal != null && ippan.amount != null ? laborTotal + ippan.amount : null;
  return { rousai, koyou, ippan, laborTotal, grandTotal };
}

export type LiIssue = { message: string };

/** 出す前に人が確かめたいこと。止めるためではありません */
export function laborInsuranceWarnings(totals: LiTotals, rates: LiRates, opts: { expectedSalaryCount?: number } = {}): LiIssue[] {
  const out: LiIssue[] = [];
  if (totals.people.length === 0) {
    out.push({ message: `${totals.fiscalYear}年度に賃金の記録がありません。` });
    return out;
  }
  if (rates.rousai == null) out.push({ message: '労災保険率が未登録です。保険料を出していません。事業の種類ごとに決まっているので、労働局の料率表でお確かめください。' });
  if (rates.koyou == null) out.push({ message: '雇用保険率が未登録です。保険料を出していません。' });
  if (rates.ippan == null) out.push({ message: '一般拠出金率が未登録です。' });
  if (totals.counts.koyou === 0) {
    out.push({ message: '雇用保険の被保険者が1人もいません。スタッフ詳細の雇用保険の加入状況をお確かめください。' });
  }
  const expected = opts.expectedSalaryCount ?? 12;
  const few = totals.people.filter((p) => p.counts.salary > 0 && p.counts.salary < expected);
  if (few.length > 0) {
    out.push({ message: `給与の件数が${expected}件に満たない方が${few.length}名います（${few.slice(0, 5).map((p) => p.name).join('、')}${few.length > 5 ? ' ほか' : ''}）。年の途中の入社・退職でなければ、明細の作り忘れがないかお確かめください。` });
  }
  const excluded = totals.people.filter((p) => p.excludedFromRousai);
  if (excluded.length > 0) {
    out.push({ message: `労災保険の対象外として外した方が${excluded.length}名います（${excluded.map((p) => p.name).join('、')}）。役員でも、労働者として働いている部分がある方（兼務役員）は対象になることがあります。` });
  }
  return out;
}
