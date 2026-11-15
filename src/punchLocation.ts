// 打刻したときの位置情報。
//
// 【どこに入っているか】
//   attendance_records.clock_in_location / clock_out_location（jsonb）
//   形は { "lat": 34.01234, "lng": 135.56789 }。
//   小数第5位までに丸めて保存しています（およそ1mの細かさ）。
//
// 【取れていないことがあります】
//   端末で位置情報を許可していない、取得に8秒かかった、といった場合は
//   null で保存されます。打刻そのものは記録されます。
//   許可されていない状態が5回続くと、管理者の画面にアラートが出ます
//   （computeConsecutiveMissingLocation）。
//
// 【画面に出すときの決まり】
//   地図はGoogleマップの検索URLで開きます。アプリから外のサイトへ出るため、
//   新しいタブで開き、rel="noreferrer" を付けます。

export type PunchLocation = { lat?: unknown; lng?: unknown } | null | undefined;

const toCoord = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** 緯度・経度の両方がそろっているか */
export function hasPunchLocation(loc: PunchLocation): boolean {
  if (!loc || typeof loc !== 'object') return false;
  const lat = toCoord((loc as Record<string, unknown>).lat);
  const lng = toCoord((loc as Record<string, unknown>).lng);
  if (lat === null || lng === null) return false;
  // ありえない値（取得に失敗して0が入った等）は無いものとして扱います
  if (lat < -90 || lat > 90) return false;
  if (lng < -180 || lng > 180) return false;
  if (lat === 0 && lng === 0) return false;
  return true;
}

/** Googleマップで開くためのURL。位置情報が無ければ null */
export function punchMapUrl(loc: PunchLocation): string | null {
  if (!hasPunchLocation(loc)) return null;
  const l = loc as Record<string, unknown>;
  return `https://www.google.com/maps?q=${toCoord(l.lat)},${toCoord(l.lng)}`;
}

/** 画面に出す緯度・経度の文字。位置情報が無ければ空文字 */
export function punchLocationLabel(loc: PunchLocation): string {
  if (!hasPunchLocation(loc)) return '';
  const l = loc as Record<string, unknown>;
  return `${toCoord(l.lat)}, ${toCoord(l.lng)}`;
}
