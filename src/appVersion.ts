// 新しい版が出たことに気づくための仕組み。
//
// 【なぜ必要か】
//   ホーム画面に追加したアプリや、開きっぱなしのタブは、
//   新しい版を出しても再読み込みされるまで古いまま動き続けます。
//   「直したはずの動きが直っていない」の原因になります。
//
// 【やり方】
//   ビルドのたびに public/version.json へ版の目印を書いています
//   （scripts/write-version.mjs）。
//   アプリは開いたときにその目印を控え、ときどき読み直します。
//   控えたものと違っていれば、新しい版が出たということです。
//   自分の版を埋め込む必要がないので、ビルドの設定をいじらずに済みます。

/** version.json の中身から版の目印を取り出す。読めなければ null */
export function parseBuildId(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const v = (data as Record<string, unknown>).build;
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s === '' ? null : s;
}

/**
 * 再読み込みをおすすめするかどうか。
 * 最初に控えた目印と、いま読んだ目印が違えば新しい版です。
 * どちらかが分からないときは、おすすめしません（誤って出さないため）。
 */
export function shouldPromptReload(first: unknown, latest: unknown): boolean {
  if (typeof first !== 'string' || typeof latest !== 'string') return false;
  if (first === '' || latest === '') return false;
  return first !== latest;
}

/** 版の目印から、出した日時だけを取り出して読みやすくする（例：11/12 12:47） */
export function buildTimeLabel(buildId: unknown): string {
  if (typeof buildId !== 'string') return '';
  const iso = buildId.split('-').slice(0, 3).join('-');
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
