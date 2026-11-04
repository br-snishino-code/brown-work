// 給与明細の「見せ方」だけを整えるところ
//
// 【交通費精算を通勤手当にまとめます】
//   御社の決まり（2026年11月4日に確認）
//     ・交通費精算の中身は、すべて通勤のための費用である
//     ・明細には「通勤手当」として1行にまとめて出す
//     ・非課税の限度額を超える方は現状いない
//
//   まとめるのは「画面と印刷の見た目」だけです。
//   保存してある明細の中身（支給項目の並び）は分けたまま変えません。
//   そのため、源泉徴収票・雇用保険の賃金総額・所得税の計算は
//   これまでどおり「通勤手当」と「交通費精算」を分けて扱います。
//   管理者が給与を作る画面でも、2つの行は分かれたままです。
//
//   ⚠ 通勤手当の非課税には限度額があります（通勤の手段と距離で変わります）。
//     いまのシステムは限度額を見ていません。限度を超える方が出たときは、
//     その方の明細を手で直してください。

export const COMMUTE_ALLOWANCE_LABEL = '通勤手当';
export const COMMUTE_CLAIM_LABEL = '交通費精算';

export type Item = { label?: string | null; amount?: number | string | null; [k: string]: unknown };

/**
 * 項目名の末尾の丸かっこを落とします。
 * 「交通費精算（10月分）」のように月が入る項目を、ひとつとして扱うためです。
 * （App.tsx の paymentItemKey と同じ決まりです）
 */
export function itemKey(label: unknown): string {
  return String(label || '').replace(/（[^（）]*）\s*$/, '').trim();
}

const num = (v: unknown) => Number(v) || 0;

/**
 * 交通費精算の行を、通勤手当の行にまとめます。
 *
 *   ・通勤手当の行があれば、そこに足して、交通費精算の行を外します
 *   ・通勤手当の行が無ければ、最初の交通費精算の行を通勤手当に書き換えます
 *     （行の位置は変えません）
 *   ・交通費精算の行が無ければ、何もしません
 *
 * 元の配列は変えません。合計額も変わりません。
 */
export function mergeCommuteItems<T extends Item>(items: readonly T[] | null | undefined): T[] {
  const list = Array.isArray(items) ? items : [];
  const claimIdx: number[] = [];
  let allowanceIdx = -1;
  list.forEach((it, i) => {
    const key = itemKey(it?.label);
    if (key === COMMUTE_CLAIM_LABEL) claimIdx.push(i);
    else if (key === COMMUTE_ALLOWANCE_LABEL && allowanceIdx < 0) allowanceIdx = i;
  });
  if (claimIdx.length === 0) return list.slice();

  const claimTotal = claimIdx.reduce((s, i) => s + num(list[i]?.amount), 0);
  const drop = new Set(claimIdx);
  const out: T[] = [];
  list.forEach((it, i) => {
    if (allowanceIdx >= 0) {
      // 通勤手当の行に足して、交通費精算の行は出しません
      if (i === allowanceIdx) { out.push({ ...it, amount: num(it.amount) + claimTotal }); return; }
      if (drop.has(i)) return;
      out.push(it);
      return;
    }
    // 通勤手当の行が無いときは、最初の交通費精算の行を通勤手当にします
    if (i === claimIdx[0]) { out.push({ ...it, label: COMMUTE_ALLOWANCE_LABEL, amount: claimTotal }); return; }
    if (drop.has(i)) return;
    out.push(it);
  });
  return out;
}
