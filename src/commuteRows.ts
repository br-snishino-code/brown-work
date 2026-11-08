// 交通費精算の明細行の決まり。
//
// 【なぜ切り出したか】
//   保存のとき、利用日・乗駅・降駅の3つがそろっている行だけを保存し、
//   1つでも空の行は金額ごと捨てていました。ところが画面の「合計金額」は
//   捨てられる行も足して出していたため、
//     画面では ¥560 と出ているのに、保存すると 0円
//   になり、入力した内容も戻ってきませんでした（2026年11月に判明）。
//
//   画面に出す合計と、保存される合計を同じ計算にするため、
//   判定をここにまとめています。
//
// 【決まり】
//   ・何も入力していない行は、はじめから無いものとして扱います
//     （画面には最初から空の行が5つ並んでいるため）。
//   ・何かを入力した行は、利用日・乗駅・降駅の3つがそろって初めて保存します。
//   ・そろっていない行があるときは、保存も申請もせずに知らせます。
//     黙って捨てると、入力した内容が戻ってこないためです。

export type CommuteRow = Record<string, unknown>;

/** 保存に必要な3つの項目 */
export const COMMUTE_REQUIRED_FIELDS = [
  { key: 'date', label: '利用日' },
  { key: 'fromStation', label: '乗駅' },
  { key: 'toStation', label: '降駅' },
] as const;

// 「この行に何か入力したか」を見る項目。
// 算出方法（calcMethod）は空の行にも既定値が入っているため、見ません。
const CONTENT_FIELDS = [
  'date', 'workplace', 'transport', 'fromStation', 'toStation',
  'unitPrice', 'passFare', 'excessAmount', 'note',
] as const;

const filled = (v: unknown) => String(v ?? '').trim() !== '';

/** 行の小計。算出方法によって、どの金額欄を使うかが変わります */
export function commuteRowSubtotal(row: CommuteRow): number {
  const num = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  switch (row?.calcMethod) {
    case 'one_way': return num(row.unitPrice);
    case 'pass_fare': return num(row.passFare);
    case 'within_pass': return 0;           // 定期代の範囲内。追加の支給はありません
    case 'excess': return num(row.excessAmount);
    case 'round_trip':
    default: return num(row.unitPrice) * 2;
  }
}

/** 何も入力していない行か */
export function isBlankCommuteRow(row: CommuteRow): boolean {
  if (!row) return true;
  return !CONTENT_FIELDS.some((k) => filled(row[k]));
}

/** 足りない項目の名前（利用日・乗駅・降駅のうち空のもの） */
export function missingCommuteFields(row: CommuteRow): string[] {
  if (!row) return [];
  return COMMUTE_REQUIRED_FIELDS.filter((f) => !filled(row[f.key])).map((f) => f.label);
}

/** 保存できる行か（3つそろっている） */
export function isSavableCommuteRow(row: CommuteRow): boolean {
  return !!row && missingCommuteFields(row).length === 0;
}

/** 実際に保存される行だけを取り出す */
export function savableCommuteRows(rows: CommuteRow[] = []): CommuteRow[] {
  return (rows || []).filter(isSavableCommuteRow);
}

/**
 * 保存される合計金額。
 * 画面の「合計金額」もこの値を出します（保存した途端に減らないように）。
 */
export function commuteSavedTotal(rows: CommuteRow[] = []): number {
  return savableCommuteRows(rows).reduce((sum, r) => sum + commuteRowSubtotal(r), 0);
}

export type IncompleteCommuteRow = {
  /** 画面の何行目か（1から数えます） */
  number: number;
  /** 足りない項目の名前 */
  missing: string[];
  /** その行に入れた金額。0円でないときは、気づけるように画面へ出します */
  subtotal: number;
};

/**
 * 何かを入力したのに、利用日・乗駅・降駅のどれかが空の行。
 * 空の行は含みません。
 */
export function incompleteCommuteRows(rows: CommuteRow[] = []): IncompleteCommuteRow[] {
  const out: IncompleteCommuteRow[] = [];
  (rows || []).forEach((row, i) => {
    if (isBlankCommuteRow(row)) return;
    const missing = missingCommuteFields(row);
    if (missing.length === 0) return;
    out.push({ number: i + 1, missing, subtotal: commuteRowSubtotal(row) });
  });
  return out;
}

/** 足りない行を知らせる文章。例）「2行目（乗駅）、4行目（利用日・降駅）」 */
export function incompleteCommuteLabel(list: IncompleteCommuteRow[] = []): string {
  return (list || []).map((r) => `${r.number}行目（${r.missing.join('・')}）`).join('、');
}
