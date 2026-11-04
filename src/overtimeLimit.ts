// 36協定（時間外労働・休日労働に関する協定）の上限の判定
//
// 御社の協定（2026年度）
//   起算日        … 4月1日
//   1日の限度     … 3時間
//   1か月の限度   … 45時間
//   1年の限度     … 360時間
//   特別条項      … 1年650時間／1か月の合計60時間／年6回／割増25%
//
// 【数え方の決まり】
//   ・ここでいう時間外労働は「法定労働時間（1日8時間・週40時間）を超えた分」です。
//     残業手当のもとにしている「所定を超えた分」とは別です。所定が8時間より
//     短い方は、所定を超えても8時間までは法定時間外になりません。
//   ・法定休日に働いた時間は、時間外労働には入れません（休日労働として別に数えます）。
//   ・週は日曜から土曜までを既定にしています（設定で変えられます）。
//     週の40時間を超えた分からは、その週に日ごとで数えた分を引きます。
//     同じ時間を二重に数えないためです。
//
// 【法令の線】（協定の内容にかかわらず守る必要があるもの）
//   ・時間外労働が月45時間を超えられるのは年6回まで
//   ・時間外労働は年720時間以内
//   ・時間外労働＋休日労働は月100時間未満
//   ・時間外労働＋休日労働は2〜6か月のどの平均も80時間以内
//   限度時間（月45・年360）と年720時間は時間外労働だけで数え、休日労働は入れません。
//   月100時間未満と2〜6か月平均80時間は、時間外労働と休日労働の合計で数えます。
//   出典：東京都「労働時間・休日」（時間外労働の上限規制）

export const LEGAL = {
  /** 限度時間（月） */
  monthLimit: 45,
  /** 限度時間（年） */
  yearLimit: 360,
  /** 特別条項でも超えられない年の時間数 */
  specialYearMax: 720,
  /** 月45時間を超えられる回数 */
  specialCountMax: 6,
  /** 時間外＋休日労働の月の上限（これ未満） */
  monthTotalMax: 100,
  /** 時間外＋休日労働の複数月平均の上限 */
  averageMax: 80,
  /** 平均を見る月数 */
  averageMonths: [2, 3, 4, 5, 6],
};

export const WEEK_STARTS: Record<string, { label: string; day: number }> = {
  sunday: { label: '日曜', day: 0 },
  monday: { label: '月曜', day: 1 },
};

export type Agreement = {
  /** 起算月（1〜12）。4なら4月1日起算 */
  startMonth: number;
  /** 週の起算日 */
  weekStart: string;
  /** 1日の限度（時間）。未定なら null */
  dayLimit: number | null;
  /** 1か月の限度時間 */
  monthLimit: number;
  /** 1年の限度時間 */
  yearLimit: number;
  /** 特別条項があるか */
  special: boolean;
  /** 特別条項：1年の時間数（時間外のみ） */
  specialYear: number | null;
  /** 特別条項：1か月の合計時間数（時間外＋休日） */
  specialMonthTotal: number | null;
  /** 特別条項：限度時間を超えられる回数 */
  specialCount: number | null;
  /** 特別条項：限度時間を超えた分の割増率（%） */
  specialRate: number | null;
};

export const AGREEMENT_DEFAULTS: Agreement = {
  startMonth: 4,
  weekStart: 'sunday',
  dayLimit: 3,
  monthLimit: 45,
  yearLimit: 360,
  special: true,
  specialYear: 650,
  specialMonthTotal: 60,
  specialCount: 6,
  specialRate: 25,
};

const DAY_STANDARD_MIN = 8 * 60;
const WEEK_STANDARD_MIN = 40 * 60;

/** 1日ぶんの記録。日付は 'YYYY-MM-DD' */
export type DayRecord = {
  date: string;
  /** 休憩を引いた実働の分 */
  workedMin: number;
  /** その日が法定休日か */
  statutoryHoliday: boolean;
};

const toDate = (key: string) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
};

/** その日が属する週の始まりの日付キー */
export function weekKeyOf(dateKey: string, weekStart: string): string {
  const base = WEEK_STARTS[weekStart]?.day ?? 0;
  const d = toDate(dateKey);
  const diff = (d.getDay() - base + 7) % 7;
  d.setDate(d.getDate() - diff);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

export type DaySplit = {
  date: string;
  /** 法定休日に働いた分 */
  holidayMin: number;
  /** 日の8時間を超えた分 */
  overDayMin: number;
  /** 8時間までの分（週の40時間を見るのに使います） */
  withinDayMin: number;
};

/**
 * 1日ずつ、法定休日労働と「日の8時間超」に分けます。
 * 法定休日に働いた分は、日の8時間超には入れません
 *（休日労働として別に数えるためです）。
 */
export function splitDays(days: DayRecord[]): DaySplit[] {
  return (days || []).map((d) => {
    const worked = Math.max(0, Number(d.workedMin) || 0);
    if (d.statutoryHoliday) {
      return { date: d.date, holidayMin: worked, overDayMin: 0, withinDayMin: 0 };
    }
    return {
      date: d.date,
      holidayMin: 0,
      overDayMin: Math.max(0, worked - DAY_STANDARD_MIN),
      withinDayMin: Math.min(worked, DAY_STANDARD_MIN),
    };
  });
}

/**
 * 週の40時間を超えた分。日ごとで数えた分は引きます（二重に数えないため）。
 * 週が月をまたぐときは、超えた分をその週の各日に、
 * 8時間までの労働時間の比で割り振ります。どの月のぶんかを決めるためです。
 */
export function weeklyExtraByDate(days: DayRecord[], weekStart: string): Record<string, number> {
  const split = splitDays(days);
  const byWeek = new Map<string, DaySplit[]>();
  split.forEach((d) => {
    const k = weekKeyOf(d.date, weekStart);
    if (!byWeek.has(k)) byWeek.set(k, []);
    (byWeek.get(k) as DaySplit[]).push(d);
  });

  const out: Record<string, number> = {};
  byWeek.forEach((list) => {
    const within = list.reduce((s, d) => s + d.withinDayMin, 0);
    const extra = Math.max(0, within - WEEK_STANDARD_MIN);
    if (extra <= 0) return;
    // 8時間までの分がある日に、その比で割り振ります
    let left = extra;
    const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));
    sorted.forEach((d, i) => {
      if (within <= 0) return;
      const share = i === sorted.length - 1
        ? left
        : Math.round((extra * d.withinDayMin) / within);
      const give = Math.min(left, Math.max(0, share));
      if (give > 0) out[d.date] = (out[d.date] || 0) + give;
      left -= give;
    });
  });
  return out;
}

export type MonthTotal = {
  /** 'YYYY-MM' */
  month: string;
  /** 法定時間外（分） */
  overtimeMin: number;
  /** 法定休日労働（分） */
  holidayMin: number;
};

/** 1か月ごとの法定時間外と法定休日労働を出します */
export function monthlyTotals(days: DayRecord[], weekStart: string): MonthTotal[] {
  const split = splitDays(days);
  const weekly = weeklyExtraByDate(days, weekStart);
  const byMonth = new Map<string, MonthTotal>();
  split.forEach((d) => {
    const m = d.date.slice(0, 7);
    if (!byMonth.has(m)) byMonth.set(m, { month: m, overtimeMin: 0, holidayMin: 0 });
    const t = byMonth.get(m) as MonthTotal;
    t.overtimeMin += d.overDayMin + (weekly[d.date] || 0);
    t.holidayMin += d.holidayMin;
  });
  return [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
}

/** 年度の12か月ぶんの 'YYYY-MM' を、起算月から並べます */
export function fiscalMonthKeys(fiscalYear: number, startMonth: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < 12; i += 1) {
    const d = new Date(fiscalYear, (startMonth - 1) + i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

export type Issue = {
  /** error … 超えている ／ warn … 近づいている */
  level: 'error' | 'warn';
  message: string;
};

export type MonthRow = {
  month: string;
  overtimeHours: number;
  holidayHours: number;
  totalHours: number;
  /** その月までの年度累計（時間外のみ） */
  cumulativeHours: number;
  /** 限度時間（月）を超えた月か */
  overMonthLimit: boolean;
};

export type Result = {
  fiscalYear: number;
  months: MonthRow[];
  /** 年度の時間外の合計 */
  yearHours: number;
  /** 年度の休日労働の合計 */
  yearHolidayHours: number;
  /** 限度時間（月）を超えた回数 */
  overCount: number;
  /** 2〜6か月平均のうち、いちばん大きいもの */
  worstAverage: { months: number; endMonth: string; hours: number } | null;
  issues: Issue[];
};

const round1 = (min: number) => Math.round((min / 60) * 10) / 10;

/** 終わっている月の既定。今日の前月までとします */
function defaultThroughMonth(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * 1人ぶんの判定。
 *
 * totals … その方の月ごとの合計（年度の外の月が混ざっていても構いません）
 * 「近づいている」は、上限の9割に達したら出します。
 */
export function judgeOvertime(
  totals: MonthTotal[],
  agreement: Agreement,
  fiscalYear: number,
  /**
   * どの月まで終わっているか（'YYYY-MM'）。渡さないと今日の前月までとみなします。
   * まだ来ていない月を0として平均に入れると、平均が下がって超過を見逃すため、
   * 平均はここまでの月だけで見ます。
   */
  throughMonth?: string,
): Result {
  const a = { ...AGREEMENT_DEFAULTS, ...agreement };
  const keys = fiscalMonthKeys(fiscalYear, a.startMonth);
  const map = new Map(totals.map((t) => [t.month, t]));

  let cumulative = 0;
  const months: MonthRow[] = keys.map((k) => {
    const t = map.get(k) || { month: k, overtimeMin: 0, holidayMin: 0 };
    cumulative += t.overtimeMin;
    return {
      month: k,
      overtimeHours: round1(t.overtimeMin),
      holidayHours: round1(t.holidayMin),
      totalHours: round1(t.overtimeMin + t.holidayMin),
      cumulativeHours: round1(cumulative),
      overMonthLimit: round1(t.overtimeMin) > a.monthLimit,
    };
  });

  const yearHours = round1(keys.reduce((s, k) => s + (map.get(k)?.overtimeMin || 0), 0));
  const yearHolidayHours = round1(keys.reduce((s, k) => s + (map.get(k)?.holidayMin || 0), 0));
  const overCount = months.filter((m) => m.overMonthLimit).length;

  // 2〜6か月平均（時間外＋休日）のうち、いちばん大きいもの。
  //
  // まだ来ていない月は0で入っているので、そのまま平均に入れると平均が下がり、
  // 本当は超えているものを見逃します。終わった月までで見ます。
  // 年度をまたぐ平均もあり得ますが、ここでは年度の中だけを見ます。
  const lastClosed = throughMonth || defaultThroughMonth();
  const closedCount = months.filter((m) => m.month <= lastClosed).length;
  let worst: Result['worstAverage'] = null;
  LEGAL.averageMonths.forEach((n) => {
    for (let end = n - 1; end < closedCount; end += 1) {
      const slice = months.slice(end - n + 1, end + 1);
      const avg = slice.reduce((s, m) => s + m.totalHours, 0) / n;
      if (!worst || avg > worst.hours) {
        worst = { months: n, endMonth: slice[slice.length - 1].month, hours: Math.round(avg * 10) / 10 };
      }
    }
  });

  const issues: Issue[] = [];
  const near = (v: number, limit: number) => limit > 0 && v >= limit * 0.9 && v <= limit;
  const label = (k: string) => `${k.slice(0, 4)}年${Number(k.slice(5, 7))}月`;

  // ---- 月の限度時間 ----
  months.forEach((m) => {
    if (m.overMonthLimit) {
      if (!a.special) {
        issues.push({ level: 'error', message: `${label(m.month)}の時間外が${m.overtimeHours}時間で、限度時間の${a.monthLimit}時間を超えています。特別条項が無いため、協定違反です。` });
      }
    } else if (near(m.overtimeHours, a.monthLimit)) {
      issues.push({ level: 'warn', message: `${label(m.month)}の時間外が${m.overtimeHours}時間です。限度時間の${a.monthLimit}時間に近づいています。` });
    }
  });

  // ---- 限度時間を超えた回数 ----
  if (a.special) {
    const max = a.specialCount ?? LEGAL.specialCountMax;
    if (overCount > max) {
      issues.push({ level: 'error', message: `限度時間（月${a.monthLimit}時間）を超えた月が${overCount}回あります。特別条項で定めた${max}回を超えています。` });
    } else if (overCount === max) {
      issues.push({ level: 'warn', message: `限度時間を超えた月が${overCount}回です。特別条項で定めた${max}回に達しました。これ以上は超えられません。` });
    }
  }

  // ---- 年の時間数 ----
  const yearMax = a.special ? (a.specialYear ?? LEGAL.specialYearMax) : a.yearLimit;
  if (yearHours > yearMax) {
    issues.push({ level: 'error', message: `年度の時間外が${yearHours}時間で、${a.special ? '特別条項の' : ''}上限${yearMax}時間を超えています。` });
  } else if (near(yearHours, yearMax)) {
    issues.push({ level: 'warn', message: `年度の時間外が${yearHours}時間です。上限${yearMax}時間に近づいています。` });
  }
  if (a.special && yearHours > a.yearLimit && yearHours <= yearMax) {
    issues.push({ level: 'warn', message: `年度の時間外が${yearHours}時間で、限度時間の${a.yearLimit}時間を超えています。特別条項の範囲内ですが、上限は${yearMax}時間です。` });
  }

  // ---- 月の合計（時間外＋休日労働）----
  const monthTotalMax = a.special && a.specialMonthTotal != null ? a.specialMonthTotal : LEGAL.monthTotalMax;
  months.forEach((m) => {
    if (m.totalHours > monthTotalMax) {
      issues.push({ level: 'error', message: `${label(m.month)}の時間外と休日労働の合計が${m.totalHours}時間で、${monthTotalMax}時間を超えています。` });
    }
    // 法令の線（100時間未満）は協定にかかわらず守る必要があります
    if (m.totalHours >= LEGAL.monthTotalMax) {
      issues.push({ level: 'error', message: `${label(m.month)}の時間外と休日労働の合計が${m.totalHours}時間です。法令の上限（月${LEGAL.monthTotalMax}時間未満）を満たしていません。` });
    }
  });

  // ---- 2〜6か月平均 ----
  if (worst && (worst as { hours: number }).hours > LEGAL.averageMax) {
    const w = worst as { months: number; endMonth: string; hours: number };
    issues.push({ level: 'error', message: `${label(w.endMonth)}までの${w.months}か月平均が${w.hours}時間です。法令の上限（2〜6か月平均で${LEGAL.averageMax}時間以内）を超えています。` });
  }

  return { fiscalYear, months, yearHours, yearHolidayHours, overCount, worstAverage: worst, issues };
}
