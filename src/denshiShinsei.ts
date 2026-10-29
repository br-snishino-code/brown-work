// 電子申請・電子媒体用のCSVを作る
//
// 根拠にした仕様書：
//   ・日本年金機構「届書作成プログラム 磁気媒体届書作成仕様書」
//       令和8年10月（第17.0版）／年金事務所提出
//       ファイル名 SHFD0006.CSV
//   ・厚生労働省「雇用保険関係手続 電子申請・電子媒体用 届書作成仕様書」
//       令和5年11月（第14.00版）
//       ファイル名 10101-shutoku.csv ／ 10191-soshitsu.csv
//
// この中身はすべて仕様書に書いてあるとおりに作っています。
// 推測で決めた箇所はありません。分からない項目は空欄のまま出し、
// 画面側で「未入力」として知らせます。
//
// 文字コードはシフトJIS、改行はCRLF、項目の区切りは半角カンマです。
// 項目の中に半角カンマは置けません（仕様書に囲み文字の決まりがないため）。

// ============================================================
// 都道府県コード（日本年金機構 参考資料３）
//   国のJISコードとは違います。京都府は「54」です。
// ============================================================
export const PREF_CODES: { code: string; name: string }[] = [
  { code: '01', name: '北海道' }, { code: '02', name: '青森県' }, { code: '03', name: '岩手県' },
  { code: '04', name: '宮城県' }, { code: '05', name: '秋田県' }, { code: '06', name: '山形県' },
  { code: '07', name: '福島県' }, { code: '08', name: '茨城県' }, { code: '09', name: '栃木県' },
  { code: '10', name: '群馬県' }, { code: '11', name: '埼玉県' }, { code: '12', name: '千葉県' },
  { code: '21', name: '東京都' }, { code: '31', name: '神奈川県' }, { code: '32', name: '新潟県' },
  { code: '33', name: '富山県' }, { code: '34', name: '石川県' }, { code: '35', name: '福井県' },
  { code: '36', name: '山梨県' }, { code: '37', name: '長野県' }, { code: '38', name: '岐阜県' },
  { code: '39', name: '静岡県' }, { code: '41', name: '大阪府' }, { code: '42', name: '兵庫県' },
  { code: '51', name: '愛知県' }, { code: '52', name: '三重県' }, { code: '53', name: '滋賀県' },
  { code: '54', name: '京都府' }, { code: '55', name: '奈良県' }, { code: '56', name: '和歌山県' },
  { code: '57', name: '鳥取県' }, { code: '58', name: '島根県' }, { code: '59', name: '岡山県' },
  { code: '60', name: '広島県' }, { code: '61', name: '山口県' }, { code: '71', name: '徳島県' },
  { code: '72', name: '香川県' }, { code: '73', name: '愛媛県' }, { code: '74', name: '高知県' },
  { code: '75', name: '福岡県' }, { code: '76', name: '佐賀県' }, { code: '77', name: '長崎県' },
  { code: '78', name: '熊本県' }, { code: '79', name: '大分県' }, { code: '80', name: '宮崎県' },
  { code: '81', name: '鹿児島県' }, { code: '82', name: '沖縄県' },
];

// ============================================================
// 元号
// ============================================================
export const GENGO_LIST = [
  { name: '令和', code: 9, from: '2019-05-01' },
  { name: '平成', code: 7, from: '1989-01-08' },
  { name: '昭和', code: 5, from: '1926-12-25' },
  { name: '大正', code: 3, from: '1912-07-30' },
  { name: '明治', code: 1, from: '1868-01-25' },
];

export type Wareki = {
  name: string;   // '令和'
  code: number;   // 9
  year: number;   // 1 以上
  month: number;
  day: number;
  yy: string;     // '01'
  mm: string;
  dd: string;
  yymmdd: string; // '010501'
};

const pad2 = (n: number) => String(n).padStart(2, '0');

/** '2019-05-01' のような日付を和暦にする。読めないときは null */
export function toWareki(iso: string): Wareki | null {
  const s = String(iso || '').slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const g = GENGO_LIST.find((x) => s >= x.from);
  if (!g) return null;
  const year = y - Number(g.from.slice(0, 4)) + 1;
  if (year < 1 || year > 99) return null;
  return {
    name: g.name, code: g.code, year, month: mo, day: d,
    yy: pad2(year), mm: pad2(mo), dd: pad2(d),
    yymmdd: pad2(year) + pad2(mo) + pad2(d),
  };
}

// ============================================================
// 半角カナへの変換
//   仕様書は氏名のカナを半角カタカナで求めます。
//   Brown Work のふりがなはひらがなで保存されているので、ここで変換します。
// ============================================================
const KANA_SRC = 'ァアィイゥウェエォオカガキギクグケゲコゴサザシジスズセゼソゾタダチヂッツヅテデトド'
  + 'ナニヌネノハバパヒビピフブプヘベペホボポマミムメモャヤュユョヨラリルレロヮワヰヱヲンヴヵヶ';
const KANA_DST = [
  'ｧ', 'ｱ', 'ｨ', 'ｲ', 'ｩ', 'ｳ', 'ｪ', 'ｴ', 'ｫ', 'ｵ',
  'ｶ', 'ｶﾞ', 'ｷ', 'ｷﾞ', 'ｸ', 'ｸﾞ', 'ｹ', 'ｹﾞ', 'ｺ', 'ｺﾞ',
  'ｻ', 'ｻﾞ', 'ｼ', 'ｼﾞ', 'ｽ', 'ｽﾞ', 'ｾ', 'ｾﾞ', 'ｿ', 'ｿﾞ',
  'ﾀ', 'ﾀﾞ', 'ﾁ', 'ﾁﾞ', 'ｯ', 'ﾂ', 'ﾂﾞ', 'ﾃ', 'ﾃﾞ', 'ﾄ', 'ﾄﾞ',
  'ﾅ', 'ﾆ', 'ﾇ', 'ﾈ', 'ﾉ',
  'ﾊ', 'ﾊﾞ', 'ﾊﾟ', 'ﾋ', 'ﾋﾞ', 'ﾋﾟ', 'ﾌ', 'ﾌﾞ', 'ﾌﾟ', 'ﾍ', 'ﾍﾞ', 'ﾍﾟ', 'ﾎ', 'ﾎﾞ', 'ﾎﾟ',
  'ﾏ', 'ﾐ', 'ﾑ', 'ﾒ', 'ﾓ',
  'ｬ', 'ﾔ', 'ｭ', 'ﾕ', 'ｮ', 'ﾖ',
  'ﾗ', 'ﾘ', 'ﾙ', 'ﾚ', 'ﾛ', 'ﾜ', 'ﾜ', 'ｲ', 'ｴ', 'ｦ', 'ﾝ', 'ｳﾞ', 'ｶ', 'ｹ',
];

/** ひらがな・全角カタカナ・全角英数を半角カナ（仕様書で使える文字）に直す */
export function toHalfKana(src: string): string {
  let out = '';
  for (const ch of String(src || '')) {
    const c = ch.codePointAt(0) as number;
    // ひらがな → カタカナ
    let k = ch;
    if (c >= 0x3041 && c <= 0x3096) k = String.fromCodePoint(c + 0x60);
    const i = KANA_SRC.indexOf(k);
    if (i >= 0) { out += KANA_DST[i]; continue; }
    if (k === 'ー' || k === '－' || k === '―' || k === 'ｰ') { out += 'ｰ'; continue; }
    if (ch === '　' || ch === ' ') { out += ' '; continue; }
    // 全角英数 → 半角
    if (c >= 0xff01 && c <= 0xff5e) { out += String.fromCharCode(c - 0xfee0); continue; }
    out += ch;
  }
  return out;
}

/** 氏名の姓名の間を半角スペース1文字にそろえる */
export function normalizeKanaName(src: string): string {
  return toHalfKana(src).replace(/[\s　]+/g, ' ').trim();
}

/** 氏名の姓名の間を全角スペース1文字にそろえる */
export function normalizeKanjiName(src: string): string {
  return String(src || '').replace(/[\s　]+/g, '　').trim();
}

// ============================================================
// シフトJISで使える文字かどうか
//
//   仕様書 表３．４－２（1バイト文字）、表３．４－３（2バイト文字）
//   のとおりの範囲です。
//   CP932 で表せても、この範囲の外なら使えません。
//   （例：「髙」は CP932 では FBFC ですが、JIS第一・第二水準の外なので使えません）
// ============================================================

// 項目の中で使える1バイト文字
//   半角カンマは項目の区切り、[ ] は識別符号、CR LF は改行、EOF は末尾専用なので、
//   項目の中では使えません。
const ONE_BYTE_OK = (b: number) =>
  b === 0x20                      // スペース
  || b === 0x2d                   // ハイフン
  || (b >= 0x30 && b <= 0x39)     // 数字
  || (b >= 0x41 && b <= 0x5a)     // 英字（大）
  || (b >= 0x61 && b <= 0x7a)     // 英字（小）
  || (b >= 0xa6 && b <= 0xdf);    // 半角カナ（ｦ〜ﾟ）

// 2バイト文字の使える範囲（仕様書 表３．４－３ の「使用可能コード範囲」）
const TWO_BYTE_RANGES: [number, number][] = [
  [0x8140, 0x8140], // 間隔
  [0x8141, 0x8164], // 記述記号
  [0x8165, 0x817a], // 括弧記号
  [0x817b, 0x818a], // 学術記号
  [0x818b, 0x8193], // 単位記号
  [0x8194, 0x819e], // 一般記号
  [0x819f, 0x81ac], // 一般記号
  [0x81b8, 0x81bf], [0x81c8, 0x81ce], [0x81da, 0x81e8],
  [0x81f0, 0x81f1], [0x81f2, 0x81f7], [0x81fc, 0x81fc],
  [0x824f, 0x8258], // 数字
  [0x8260, 0x8279], // ローマ字（大）
  [0x8281, 0x829a], // ローマ字（小）
  [0x829f, 0x82f1], // 平仮名
  [0x8340, 0x8396], // 片仮名
  [0x839f, 0x83b6], [0x83bf, 0x83d6], // ギリシア文字
  [0x8440, 0x8460], [0x8470, 0x8491], // ロシア文字
  [0x889f, 0x9872], // 漢字（第一水準〜）
  [0x989f, 0xeaa4], // 漢字（〜第二水準）
];

export type SjisCodec = {
  /** 1文字をシフトJISのバイトにする。表せないときは null */
  bytesOf(ch: string): number[] | null;
  /** 使えない文字を集める */
  check(s: string): { ok: boolean; bad: string[] };
  /** 文字列をシフトJISのバイト列にする */
  encode(s: string): Uint8Array;
};

/**
 * シフトJISの変換器を作る。
 * cptable は xlsx/dist/cpexcel.full.mjs を読み込んだもの。
 * 画面側では、使うときだけ動的に読み込みます（表が大きいため）。
 */
export function makeSjisCodec(cptable: any): SjisCodec {
  const utils = cptable?.utils || cptable?.default?.utils || cptable;
  const raw = (s: string): number[] => {
    const r = utils.encode(932, s);
    const out: number[] = [];
    for (let i = 0; i < r.length; i++) out.push(typeof r === 'string' ? r.charCodeAt(i) : r[i]);
    return out;
  };

  const bytesOf = (ch: string): number[] | null => {
    const b = raw(ch);
    if (b.length === 1) return ONE_BYTE_OK(b[0]) ? b : null;
    if (b.length === 2) {
      const lead = b[0], trail = b[1];
      if (lead === 0 || trail === 0) return null;              // 表せない文字
      if (trail < 0x40 || trail > 0xfc || trail === 0x7f) return null;
      const code = (lead << 8) | trail;
      for (const [lo, hi] of TWO_BYTE_RANGES) if (code >= lo && code <= hi) return b;
      return null;
    }
    return null;
  };

  const check = (s: string) => {
    const bad: string[] = [];
    for (const ch of String(s || '')) {
      if (bytesOf(ch) === null && bad.indexOf(ch) < 0) bad.push(ch);
    }
    return { ok: bad.length === 0, bad };
  };

  const encode = (s: string): Uint8Array => {
    const out: number[] = [];
    for (const ch of String(s || '')) {
      if (ch === '\r') { out.push(0x0d); continue; }
      if (ch === '\n') { out.push(0x0a); continue; }
      if (ch === ',') { out.push(0x2c); continue; }
      if (ch === '[') { out.push(0x5b); continue; }
      if (ch === ']') { out.push(0x5d); continue; }
      const b = bytesOf(ch);
      if (b) { for (const x of b) out.push(x); continue; }
      // 表せない文字は落とさず、見つけやすいように「?」にする
      out.push(0x3f);
    }
    return Uint8Array.from(out);
  };

  return { bytesOf, check, encode };
}

// ============================================================
// 項目の決まり
// ============================================================
export type FieldKind =
  | 'num'     // 数字だけ
  | 'kana'    // 半角カナ・英数
  | 'kanji'   // 漢字（全角）
  | 'mixed'   // 漢字でも半角でもよい（文字数の上限が変わる）
  | 'free';   // 全角・半角を区別せず数える

export type FieldSpec = {
  no: number;
  label: string;
  kind: FieldKind;
  min: number;          // 0 なら省略できる
  max: number;
  maxHalf?: number;     // mixed のとき、半角だけで書く場合の上限
};

/** 全角（2バイト）文字が混ざっているか */
export function hasWide(s: string): boolean {
  for (const ch of String(s || '')) {
    const c = ch.codePointAt(0) as number;
    if (c > 0x7f && !(c >= 0xff61 && c <= 0xff9f)) return true;
  }
  return false;
}

export function charCount(s: string): number {
  return Array.from(String(s || '')).length;
}

export type FieldIssue = { no: number; label: string; message: string };

/** 1レコード分の値を決まりと照らす */
export function checkFields(values: string[], specs: FieldSpec[], codec?: SjisCodec): FieldIssue[] {
  const issues: FieldIssue[] = [];
  specs.forEach((spec, i) => {
    const v = String(values[i] ?? '');
    const n = charCount(v);
    if (v.indexOf(',') >= 0) {
      issues.push({ no: spec.no, label: spec.label, message: '半角カンマは使えません' });
    }
    if (n === 0) {
      if (spec.min > 0) issues.push({ no: spec.no, label: spec.label, message: '入力が要ります' });
      return;
    }
    if (spec.kind === 'num' && !/^[0-9]+$/.test(v)) {
      issues.push({ no: spec.no, label: spec.label, message: '数字だけで入れてください' });
    }
    if (spec.kind === 'kanji' && !hasWide(v) === false) {
      // 漢字項目に半角だけが入っていても仕様上は許される場合があるため、ここでは見ない
    }
    let max = spec.max;
    if (spec.kind === 'mixed' && spec.maxHalf != null && !hasWide(v)) max = spec.maxHalf;
    if (n > max) {
      issues.push({ no: spec.no, label: spec.label, message: `${max}文字までです（いまは${n}文字）` });
    }
    if (spec.min > 0 && n < spec.min) {
      issues.push({ no: spec.no, label: spec.label, message: `${spec.min}文字以上で入れてください` });
    }
    if (codec) {
      const r = codec.check(v);
      if (!r.ok) {
        issues.push({
          no: spec.no, label: spec.label,
          message: `この届出で使えない文字があります（${r.bad.join('')}）。別の字かカナに直してください`,
        });
      }
    }
  });
  return issues;
}

// ============================================================
// 事業所の情報（画面から登録してもらうもの）
// ============================================================
export type OfficeInfo = {
  prefCode: string;        // 都道府県コード（2）
  cityCode: string;        // 郡市区符号（2）
  officeSymbol: string;    // 事業所記号（1〜4）
  officeNumber: string;    // 事業所番号（1〜5）
  postalParent: string;    // 郵便番号 親番号（3）
  postalChild: string;     // 郵便番号 子番号（4）
  addressKanji: string;    // 事業所所在地
  nameKanji: string;       // 事業所名称
  ownerKanji: string;      // 事業主氏名
  ownerAddress: string;    // 事業主住所（離職証明書に入れる）
  tel1: string;            // 局番1（市外局番）
  tel2: string;            // 局番2
  tel3: string;            // 局番3
  eiOffice: string;        // 雇用保険適用事業所番号 安定所番号（4）
  eiSerial: string;        // 雇用保険適用事業所番号 一連番号（1〜6）
  eiCheck: string;         // 雇用保険適用事業所番号 CD（1）
  hwName: string;          // あて先（提出先の公共職業安定所名）
  mediaSeq: number;        // 媒体通番（1〜999）
};

export const OFFICE_INFO_DEFAULTS: OfficeInfo = {
  prefCode: '', cityCode: '', officeSymbol: '', officeNumber: '',
  postalParent: '', postalChild: '',
  addressKanji: '', nameKanji: '', ownerKanji: '', ownerAddress: '',
  tel1: '', tel2: '', tel3: '',
  eiOffice: '', eiSerial: '', eiCheck: '',
  hwName: '', mediaSeq: 1,
};

export const OFFICE_FIELD_LABELS: Record<keyof OfficeInfo, string> = {
  prefCode: '都道府県コード', cityCode: '郡市区符号', officeSymbol: '事業所記号',
  officeNumber: '事業所番号', postalParent: '郵便番号（上3桁）', postalChild: '郵便番号（下4桁）',
  addressKanji: '事業所所在地', nameKanji: '事業所名称', ownerKanji: '事業主氏名',
  ownerAddress: '事業主住所',
  tel1: '電話番号（市外局番）', tel2: '電話番号（市内局番）', tel3: '電話番号（加入者番号）',
  eiOffice: '雇用保険適用事業所番号（上4桁）', eiSerial: '雇用保険適用事業所番号（中6桁）',
  eiCheck: '雇用保険適用事業所番号（末1桁）', hwName: 'あて先（公共職業安定所）',
  mediaSeq: '媒体通番',
};

/** 社会保険（年金事務所）のCSVに要る項目がそろっているか */
export const OFFICE_REQUIRED_NENKIN: (keyof OfficeInfo)[] = [
  'prefCode', 'cityCode', 'officeSymbol', 'officeNumber',
  'postalParent', 'postalChild', 'addressKanji', 'nameKanji', 'ownerKanji',
  'tel1', 'tel2', 'tel3',
];

/** 雇用保険（ハローワーク）のCSVに要る項目 */
export const OFFICE_REQUIRED_HW: (keyof OfficeInfo)[] = [
  'cityCode', 'officeSymbol', 'officeNumber',
  'postalParent', 'postalChild', 'addressKanji', 'nameKanji', 'ownerKanji',
  'tel1', 'tel2', 'tel3', 'eiOffice', 'eiSerial', 'eiCheck', 'hwName',
];

export function missingOfficeFields(office: OfficeInfo, keys: (keyof OfficeInfo)[]): string[] {
  return keys
    .filter((k) => !String((office as any)?.[k] ?? '').trim())
    .map((k) => OFFICE_FIELD_LABELS[k]);
}

// ============================================================
// 共通のつなぎ
// ============================================================
const CRLF = '\r\n';
const join = (v: (string | number | null | undefined)[]) =>
  v.map((x) => (x == null ? '' : String(x))).join(',');

export const KANRI_MARK = '[kanri]';
export const DATA_MARK = '[data]';

// ============================================================
// 社会保険（年金事務所提出）
// ============================================================

/** 媒体管理レコード（仕様書 ４．１．１） */
export function buildNenkinKanri(office: OfficeInfo, createdAt: Date): string {
  const y = createdAt.getFullYear();
  const ymd = `${y}${pad2(createdAt.getMonth() + 1)}${pad2(createdAt.getDate())}`;
  const seq = String(Math.min(999, Math.max(1, Number(office.mediaSeq) || 1))).padStart(3, '0');
  return join([office.prefCode, office.cityCode, office.officeSymbol, seq, ymd, '22223']);
}

/** 事業所数情報（仕様書 ４．３．１）。1事業所だけを入れます */
export function buildNenkinOfficeCount(): string {
  return join(['', '001']);
}

/** 事業所情報（仕様書 ４．３．２．１） */
export function buildNenkinOffice(office: OfficeInfo): string {
  return join([
    office.prefCode, office.cityCode, office.officeSymbol, office.officeNumber,
    office.postalParent, office.postalChild,
    office.addressKanji, office.nameKanji, normalizeKanjiName(office.ownerKanji),
    office.tel1, office.tel2, office.tel3,
  ]);
}

export const NENKIN_OFFICE_SPECS: FieldSpec[] = [
  { no: 1, label: '都道府県コード', kind: 'num', min: 2, max: 2 },
  { no: 2, label: '郡市区符号', kind: 'num', min: 2, max: 2 },
  { no: 3, label: '事業所記号', kind: 'kana', min: 1, max: 4 },
  { no: 4, label: '事業所番号', kind: 'num', min: 1, max: 5 },
  { no: 5, label: '郵便番号（親番号）', kind: 'num', min: 3, max: 3 },
  { no: 6, label: '郵便番号（子番号）', kind: 'num', min: 4, max: 4 },
  { no: 7, label: '事業所所在地', kind: 'mixed', min: 1, max: 37, maxHalf: 75 },
  { no: 8, label: '事業所名称', kind: 'mixed', min: 1, max: 25, maxHalf: 50 },
  { no: 9, label: '事業主氏名', kind: 'mixed', min: 1, max: 12, maxHalf: 25 },
  { no: 10, label: '電話番号（局番1）', kind: 'num', min: 2, max: 5 },
  { no: 11, label: '電話番号（局番2）', kind: 'num', min: 1, max: 4 },
  { no: 12, label: '電話番号（局番3）', kind: 'num', min: 4, max: 5 },
];

/** 資格取得届（年金事務所提出）に渡す中身 */
export type NenkinShutokuInput = {
  kanaName: string;          // 氏名（カナ）
  kanjiName: string;         // 氏名（漢字）
  birthDate: string;         // 生年月日 'YYYY-MM-DD'
  gender: string;            // '男' | '女'
  acquireKind: string;       // 取得区分（1=健保・厚年）
  myNumber: string;          // 個人番号（12桁）。無ければ基礎年金番号を入れる
  pensionNumber: string;     // 基礎年金番号（10桁）
  acquiredDate: string;      // 資格取得年月日 'YYYY-MM-DD'
  hasDependent: boolean;     // 被扶養者の有無
  cashAmount: number;        // 報酬月額（通貨によるもの）
  goodsAmount: number;       // 報酬月額（現物によるもの）
  note1?: boolean;           // 70歳以上被用者該当
  note2?: boolean;           // 二以上事業所勤務
  note3?: boolean;           // 特定適用事業所の短時間労働者
  note4?: boolean;           // 退職後の継続再雇用
  note5?: boolean;           // 特定減額特例対象者（令和8年10月から）
  note?: string;             // 備考欄
  postalParent?: string;
  postalChild?: string;
  addressKana?: string;
  addressKanji?: string;
  over70Only?: boolean;      // 70歳以上被用者届のみ提出
  certificateNeeded?: string; // 資格確認書発行要否
};

export const NENKIN_SHUTOKU_FORM_CODE = '2200700';

export const NENKIN_SHUTOKU_SPECS: FieldSpec[] = [
  { no: 1, label: '様式コード', kind: 'num', min: 7, max: 7 },
  { no: 2, label: '都道府県コード', kind: 'num', min: 2, max: 2 },
  { no: 3, label: '郡市区符号', kind: 'num', min: 2, max: 2 },
  { no: 4, label: '事業所記号', kind: 'kana', min: 1, max: 4 },
  { no: 5, label: '事業所番号', kind: 'num', min: 1, max: 5 },
  { no: 6, label: '被保険者整理番号', kind: 'num', min: 0, max: 6 },
  { no: 7, label: '被保険者氏名（カナ）', kind: 'kana', min: 1, max: 25 },
  { no: 8, label: '被保険者氏名（漢字）', kind: 'kanji', min: 0, max: 12 },
  { no: 9, label: '元号（生年月日）', kind: 'num', min: 1, max: 1 },
  { no: 10, label: '生年月日', kind: 'num', min: 6, max: 6 },
  { no: 11, label: '種別（性別）', kind: 'num', min: 1, max: 1 },
  { no: 12, label: '取得区分', kind: 'num', min: 1, max: 1 },
  { no: 13, label: '個人番号', kind: 'num', min: 0, max: 12 },
  { no: 14, label: '住民票住所を記載できない理由', kind: 'num', min: 0, max: 1 },
  { no: 15, label: '備考欄（個人番号情報）', kind: 'mixed', min: 0, max: 37, maxHalf: 75 },
  { no: 16, label: '課所符号', kind: 'num', min: 0, max: 4 },
  { no: 17, label: '一連番号', kind: 'num', min: 0, max: 6 },
  { no: 18, label: '元号（資格取得年月日）', kind: 'num', min: 0, max: 1 },
  { no: 19, label: '資格取得年月日', kind: 'num', min: 0, max: 6 },
  { no: 20, label: '被扶養者の有無', kind: 'num', min: 1, max: 1 },
  { no: 21, label: '報酬月額（通貨によるものの額）', kind: 'num', min: 1, max: 7 },
  { no: 22, label: '報酬月額（現物によるものの額）', kind: 'num', min: 1, max: 7 },
  { no: 23, label: '報酬月額（合計）', kind: 'num', min: 1, max: 7 },
  { no: 24, label: '備考欄項目1（70歳以上被用者該当）', kind: 'num', min: 0, max: 1 },
  { no: 25, label: '備考欄項目2（二以上事業所勤務）', kind: 'num', min: 0, max: 1 },
  { no: 26, label: '備考欄項目3（短時間労働者）', kind: 'num', min: 0, max: 1 },
  { no: 27, label: '備考欄項目4（退職後の継続再雇用）', kind: 'num', min: 0, max: 1 },
  { no: 28, label: '備考欄項目5（特定減額特例対象者）', kind: 'num', min: 0, max: 1 },
  { no: 29, label: '備考欄', kind: 'mixed', min: 0, max: 37, maxHalf: 75 },
  { no: 30, label: '郵便番号（親番号）', kind: 'num', min: 0, max: 3 },
  { no: 31, label: '郵便番号（子番号）', kind: 'num', min: 0, max: 4 },
  { no: 32, label: '被保険者住所（カナ）', kind: 'kana', min: 0, max: 75 },
  { no: 33, label: '被保険者住所（漢字）', kind: 'kanji', min: 0, max: 37 },
  { no: 34, label: '70歳以上被用者届のみ提出', kind: 'num', min: 0, max: 1 },
  { no: 35, label: '資格確認書発行要否', kind: 'num', min: 0, max: 1 },
];

const genderCode = (g: string) => (String(g).indexOf('女') >= 0 ? '2' : String(g).indexOf('男') >= 0 ? '1' : '');
const flag = (b: boolean | undefined) => (b ? '1' : '');
const digits = (s: string) => String(s || '').replace(/[^0-9]/g, '');

/** 資格取得届・70歳以上被用者該当届 データレコード（年金事務所提出・35項目） */
export function buildNenkinShutokuFields(office: OfficeInfo, p: NenkinShutokuInput): string[] {
  const birth = toWareki(p.birthDate);
  const acq = toWareki(p.acquiredDate);
  const pn = digits(p.pensionNumber);
  const cash = Math.max(0, Math.round(Number(p.cashAmount) || 0));
  const goods = Math.max(0, Math.round(Number(p.goodsAmount) || 0));
  return [
    NENKIN_SHUTOKU_FORM_CODE,
    office.prefCode, office.cityCode, office.officeSymbol, office.officeNumber,
    '',                                      // 被保険者整理番号（新規は省略）
    normalizeKanaName(p.kanaName),
    normalizeKanjiName(p.kanjiName),
    birth ? String(birth.code) : '',
    birth ? birth.yymmdd : '',
    genderCode(p.gender),
    String(p.acquireKind || '1'),
    digits(p.myNumber),
    '',                                      // 住民票住所を記載できない理由
    '',                                      // 備考欄（個人番号情報）
    digits(p.myNumber) ? '' : pn.slice(0, 4),
    digits(p.myNumber) ? '' : pn.slice(4, 10),
    acq ? String(acq.code) : '',
    acq ? acq.yymmdd : '',
    p.hasDependent ? '1' : '0',
    String(cash), String(goods), String(cash + goods),
    flag(p.note1), flag(p.note2), flag(p.note3), flag(p.note4), flag(p.note5),
    String(p.note || ''),
    String(p.postalParent || ''), String(p.postalChild || ''),
    normalizeKanaName(p.addressKana || ''),
    String(p.addressKanji || ''),
    flag(p.over70Only),
    String(p.certificateNeeded || ''),
  ];
}

export function buildNenkinShutoku(office: OfficeInfo, p: NenkinShutokuInput): string {
  return join(buildNenkinShutokuFields(office, p));
}

/** 資格喪失届に渡す中身 */
export type NenkinSoshitsuInput = {
  insuredNumber: string;     // 被保険者整理番号
  kanaName: string;
  kanjiName: string;
  birthDate: string;
  myNumber: string;
  pensionNumber: string;
  lostDate: string;          // 資格喪失年月日（退職日の翌日など）
  reason: string;            // 喪失原因（4=退職等 5=死亡 など）
  leaveDate: string;         // 退職日・死亡日
  note1?: boolean;           // 二以上事業所勤務
  note2?: boolean;           // 退職後の継続再雇用
  note?: string;
  returned?: number;         // 資格確認書 添付（回収できた枚数）
  notReturned?: number;      // 資格確認書 返不能
  over70NotApplicable?: boolean;
  notApplicableDate?: string;
  over70Only?: boolean;
};

export const NENKIN_SOSHITSU_FORM_CODE = '2201700';

export const NENKIN_SOSHITSU_SPECS: FieldSpec[] = [
  { no: 1, label: '様式コード', kind: 'num', min: 7, max: 7 },
  { no: 2, label: '都道府県コード', kind: 'num', min: 2, max: 2 },
  { no: 3, label: '郡市区符号', kind: 'num', min: 2, max: 2 },
  { no: 4, label: '事業所記号', kind: 'kana', min: 1, max: 4 },
  { no: 5, label: '事業所番号', kind: 'num', min: 1, max: 5 },
  { no: 6, label: '被保険者整理番号', kind: 'num', min: 0, max: 6 },
  { no: 7, label: '被保険者氏名（カナ）', kind: 'kana', min: 1, max: 25 },
  { no: 8, label: '被保険者氏名（漢字）', kind: 'kanji', min: 0, max: 12 },
  { no: 9, label: '元号（生年月日）', kind: 'num', min: 1, max: 1 },
  { no: 10, label: '生年月日', kind: 'num', min: 6, max: 6 },
  { no: 11, label: '個人番号', kind: 'num', min: 0, max: 12 },
  { no: 12, label: '課所符号', kind: 'num', min: 0, max: 4 },
  { no: 13, label: '一連番号', kind: 'num', min: 0, max: 6 },
  { no: 14, label: '元号（資格喪失年月日）', kind: 'num', min: 0, max: 1 },
  { no: 15, label: '資格喪失年月日', kind: 'num', min: 0, max: 6 },
  { no: 16, label: '喪失（不該当）原因', kind: 'num', min: 1, max: 2 },
  { no: 17, label: '元号（退職日・死亡日）', kind: 'num', min: 0, max: 1 },
  { no: 18, label: '退職日・死亡日', kind: 'num', min: 0, max: 6 },
  { no: 19, label: '備考欄項目1（二以上事業所勤務）', kind: 'num', min: 0, max: 1 },
  { no: 20, label: '備考欄項目2（退職後の継続再雇用）', kind: 'num', min: 0, max: 1 },
  { no: 21, label: '備考欄', kind: 'mixed', min: 0, max: 37, maxHalf: 75 },
  { no: 22, label: '資格確認書回収（添付）', kind: 'num', min: 0, max: 2 },
  { no: 23, label: '資格確認書回収（返不能）', kind: 'num', min: 0, max: 2 },
  { no: 24, label: '70歳不該当', kind: 'num', min: 0, max: 1 },
  { no: 25, label: '元号（不該当年月日）', kind: 'num', min: 0, max: 1 },
  { no: 26, label: '不該当年月日', kind: 'num', min: 0, max: 6 },
  { no: 27, label: '70歳以上被用者届のみ提出', kind: 'num', min: 0, max: 1 },
];

/** 喪失原因（仕様書 ４．６．１ 項番16） */
export const NENKIN_SOSHITSU_REASONS = [
  { code: '4', label: '退職等' },
  { code: '5', label: '死亡' },
  { code: '7', label: '75歳到達（健康保険のみ喪失）' },
  { code: '9', label: '障害認定（健康保険のみ喪失）' },
  { code: '11', label: '社会保障協定' },
  { code: '12', label: '特定減額特例対象者の任意喪失' },
];

/** 資格喪失届・70歳以上被用者不該当届 データレコード（年金事務所提出・27項目） */
export function buildNenkinSoshitsuFields(office: OfficeInfo, p: NenkinSoshitsuInput): string[] {
  const birth = toWareki(p.birthDate);
  const lost = toWareki(p.lostDate);
  const leave = toWareki(p.leaveDate);
  const na = toWareki(p.notApplicableDate || '');
  const pn = digits(p.pensionNumber);
  const my = digits(p.myNumber);
  // 退職日・死亡日は、喪失原因が「退職等」「死亡」のときだけ設定する
  const withLeave = p.reason === '4' || p.reason === '5';
  return [
    NENKIN_SOSHITSU_FORM_CODE,
    office.prefCode, office.cityCode, office.officeSymbol, office.officeNumber,
    digits(p.insuredNumber),
    normalizeKanaName(p.kanaName),
    normalizeKanjiName(p.kanjiName),
    birth ? String(birth.code) : '',
    birth ? birth.yymmdd : '',
    my,
    my ? '' : pn.slice(0, 4),
    my ? '' : pn.slice(4, 10),
    lost ? String(lost.code) : '',
    lost ? lost.yymmdd : '',
    String(p.reason || ''),
    withLeave && leave ? String(leave.code) : '',
    withLeave && leave ? leave.yymmdd : '',
    flag(p.note1), flag(p.note2),
    String(p.note || ''),
    p.returned ? String(p.returned) : '',
    p.notReturned ? String(p.notReturned) : '',
    flag(p.over70NotApplicable),
    na ? String(na.code) : '',
    na ? na.yymmdd : '',
    flag(p.over70Only),
  ];
}

export function buildNenkinSoshitsu(office: OfficeInfo, p: NenkinSoshitsuInput): string {
  return join(buildNenkinSoshitsuFields(office, p));
}

/** 年金事務所提出のCSV全体（SHFD0006.CSV） */
export function buildNenkinCsv(office: OfficeInfo, dataLines: string[], createdAt: Date): string {
  return [
    buildNenkinKanri(office, createdAt),
    KANRI_MARK,
    buildNenkinOfficeCount(),
    buildNenkinOffice(office),
    DATA_MARK,
    ...dataLines,
  ].join(CRLF) + CRLF;
}

export const NENKIN_FILE_NAME = 'SHFD0006.CSV';

// ============================================================
// 雇用保険（ハローワーク提出）
//   社会保険と違い、各かたまりの前に「項目行」（見出し）が入ります。
// ============================================================

export const HW_KANRI_HEADER =
  '郡市区符号,事業所記号,ＦＤ通番,作成年月日,代表届書コード,連記式項目バージョン,XML返戻希望の有無';
export const HW_COUNT_HEADER = '社会保険労務士氏名,事業所情報数';
export const HW_OFFICE_HEADER =
  '郡市区符号,事業所記号,事業所番号,親番号（郵便番号）,子番号（郵便番号）,事業所所在地,事業所名称,'
  + '事業主氏名,電話番号,雇用保険適用事業所番号（安定所番号）,雇用保険適用事業所番号（一連番号）,'
  + '雇用保険適用事業所番号（CD）';

export const HW_SHUTOKU_HEADER = [
  '帳票種別', '安定所番号', '個人番号', '被保険者番号4桁', '被保険者番号6桁', '被保険者番号CD',
  '取得区分', '被保険者氏名', '被保険者氏名フリガナ（カタカナ）', '変更後の氏名',
  '変更後の氏名フリガナ（カタカナ）', '性別', '生年月日（元号）', '生年月日（年）', '生年月日（月）',
  '生年月日（日）', '事業所番号（安定所番号）', '事業所番号（一連番号）', '事業所番号（CD）',
  '資格取得年月日（元号）', '資格取得年月日（年）', '資格取得年月日（月）', '資格取得年月日（日）',
  '被保険者となったことの原因', '賃金（支払の態様）', '賃金（賃金月額）', '雇用形態', '職種',
  '就職経路', '取得時被保険者種類', '番号複数取得チェック不要', '１週間の所定労働時間（時間）',
  // 項番35「契約期間開始（元号）」について：
  //   仕様書の図４.１.１－１だけが半角の括弧「(元号)」になっていますが、
  //   資格取得届そのものの節（図４.１.５－１）と、ほかの6か所はすべて全角の「（元号）」です。
  //   半角の括弧は、仕様書の「使用可能文字一覧（1バイト文字）」にも載っていません。
  //   数の多いほう、かつ使える文字である全角に合わせています。
  '１週間の所定労働時間（分）', '契約期間の定め', '契約期間開始（元号）', '契約期間開始（年）',
  '契約期間開始（月）', '契約期間開始（日）', '契約期間終了（元号）', '契約期間終了（年）',
  '契約期間終了（月）', '契約期間終了（日）', '契約更新条項の有無', '事業所名',
  '被保険者氏名（ローマ字）', '国籍・地域', '国籍地域コード', '在留資格', '在留資格コード',
  '在留期間（年）', '在留期間（月）', '在留期間（日）', '資格外活動許可の有無', '在留カード番号',
  '派遣・請負就労区分', '備考', 'あて先', '備考欄（備考）', '確認通知年月日（元号）',
  '確認通知年月日（年）', '確認通知年月日（月）', '確認通知年月日（日）', '申請者用自由入力欄',
].join(',');

export const HW_SOSHITSU_HEADER = [
  '帳票種別', '安定所番号', '個人番号', '被保険者番号4桁', '被保険者番号6桁', '被保険者番号CD',
  '事業所番号（安定所番号）', '事業所番号（一連番号）', '事業所番号（CD）', '資格取得年月日（元号）',
  '資格取得年月日（年）', '資格取得年月日（月）', '資格取得年月日（日）', '離職等年月日（元号）',
  '離職等年月日（年）', '離職等年月日（月）', '離職等年月日（日）', '喪失原因', '離職票交付希望',
  '喪失時被保険者種類', '新氏名フリガナ（カタカナ）', '新氏名', '補充採用予定の有無',
  '被保険者氏名フリガナ（カタカナ）', '被保険者氏名', '性別', '生年月日（元号）', '生年月日（年）',
  '生年月日（月）', '生年月日（日）', '被保険者の住所又は居所', '事業所名称', '氏名変更年月日（元号）',
  '氏名変更年月日（年）', '氏名変更年月日（月）', '氏名変更年月日（日）',
  '被保険者でなくなったことの原因', '１週間の所定労働時間（時間）', '１週間の所定労働時間（分）',
  'あて先', '被保険者氏名（ローマ字）', '国籍・地域', '国籍地域コード', '在留資格', '在留資格コード',
  '在留期間（年）', '在留期間（月）', '在留期間（日）', '在留カード番号', '派遣・請負就労区分',
  '備考欄（審査者）', '確認通知年月日（元号）', '確認通知年月日（年）', '確認通知年月日（月）',
  '確認通知年月日（日）', '申請者用自由入力欄',
].join(',');

export const HW_FORM_SHUTOKU = '10101';
export const HW_FORM_SOSHITSU = '10191';
/** 連記式項目バージョン（仕様書 ４.１.１ 項番6） */
export const HW_VERSION_SHUTOKU = '07';
export const HW_VERSION_SOSHITSU = '05';
export const HW_FILE_SHUTOKU = '10101-shutoku.csv';
export const HW_FILE_SOSHITSU = '10191-soshitsu.csv';

/** ＦＤ管理レコード（仕様書 ４.１.１） */
export function buildHwKanri(office: OfficeInfo, version: string, createdAt: Date, xmlReturn = '無'): string {
  const y = createdAt.getFullYear();
  const ymd = `${y}${pad2(createdAt.getMonth() + 1)}${pad2(createdAt.getDate())}`;
  const seq = String(Math.min(999, Math.max(1, Number(office.mediaSeq) || 1))).padStart(3, '0');
  return join([office.cityCode, office.officeSymbol, seq, ymd, '22223', version, xmlReturn]);
}

export function buildHwOfficeCount(): string {
  return join(['', '001']);
}

/** 事業所情報（仕様書 ４.１.３．２）。電話番号はハイフンでつなぎます */
export function buildHwOffice(office: OfficeInfo): string {
  const tel = [office.tel1, office.tel2, office.tel3].filter(Boolean).join('-');
  return join([
    office.cityCode, office.officeSymbol, office.officeNumber,
    office.postalParent, office.postalChild,
    office.addressKanji, office.nameKanji, normalizeKanjiName(office.ownerKanji),
    tel, office.eiOffice, office.eiSerial, office.eiCheck,
  ]);
}

/** 賃金の支払の態様（仕様書 ４.１.５ 項番25） */
export const HW_WAGE_FORMS = [
  { code: '1', label: '月給（日給月給を含む）' },
  { code: '2', label: '週給' },
  { code: '3', label: '日給' },
  { code: '4', label: '時間給' },
  { code: '5', label: 'その他' },
];

/** 被保険者となったことの原因（項番24） */
export const HW_ACQUIRE_REASONS = [
  { code: '1', label: '新規雇用（新規学卒）' },
  { code: '2', label: '新規雇用（その他）' },
  { code: '3', label: '日雇からの切替' },
  { code: '4', label: 'その他' },
  { code: '8', label: '出向元への復帰（65歳以上）' },
];

/** 雇用形態（項番27） */
export const HW_EMPLOYMENT_TYPES = [
  { code: '1', label: '日雇' }, { code: '2', label: '派遣' }, { code: '3', label: 'パートタイム' },
  { code: '4', label: '有期契約労働者' }, { code: '5', label: '季節的雇用' },
  { code: '6', label: '船員' }, { code: '7', label: 'その他' },
];

/** 職種（項番28） */
export const HW_JOB_CATEGORIES = [
  { code: '01', label: '管理的職業' }, { code: '02', label: '専門的・技術的職業' },
  { code: '03', label: '事務的職業' }, { code: '04', label: '販売の職業' },
  { code: '05', label: 'サービスの職業' }, { code: '06', label: '保安の職業' },
  { code: '07', label: '農林漁業の職業' }, { code: '08', label: '生産工程の職業' },
  { code: '09', label: '輸送・機械運転の職業' }, { code: '10', label: '建設・採掘の職業' },
  { code: '11', label: '運搬・清掃・包装等の職業' },
];

/** 就職経路（項番29） */
export const HW_JOB_ROUTES = [
  { code: '1', label: '安定所紹介' }, { code: '2', label: '自己就職' },
  { code: '3', label: '民間紹介' }, { code: '4', label: '把握していない' },
];

/** 喪失原因（仕様書 ４.１.６ 項番18） */
export const HW_LOSS_REASONS = [
  { code: '1', label: '離職以外の理由' },
  { code: '2', label: '3以外の離職' },
  { code: '3', label: '事業主の都合による離職' },
];

export type HwShutokuInput = {
  myNumber: string;
  insuranceNumber: string;   // 雇用保険被保険者番号（11桁）
  acquireKind: string;       // 1=新規 2=再取得
  kanjiName: string;
  kanaName: string;
  gender: string;
  birthDate: string;
  acquiredDate: string;
  reason: string;            // 被保険者となったことの原因
  wageForm: string;          // 賃金の支払の態様
  wageMonthly: number;       // 賃金月額（千円単位・1〜9999）
  employmentType: string;
  jobCategory: string;
  jobRoute: string;
  weeklyHours: number;       // 1週間の所定労働時間（時）
  weeklyMinutes: number;     // 同（分）
  hasContractPeriod: boolean;
  contractStart: string;
  contractEnd: string;
  contractRenewal: string;   // '有' | '無' | ''
  officeName: string;        // 事業所名
  note?: string;             // 備考（原因が「その他」のとき）
  hwName: string;            // あて先
};

export const HW_SHUTOKU_SPECS: FieldSpec[] = [
  { no: 1, label: '帳票種別', kind: 'num', min: 5, max: 5 },
  { no: 2, label: '安定所番号', kind: 'num', min: 0, max: 0 },
  { no: 3, label: '個人番号', kind: 'num', min: 0, max: 12 },
  { no: 4, label: '被保険者番号4桁', kind: 'num', min: 0, max: 4 },
  { no: 5, label: '被保険者番号6桁', kind: 'num', min: 0, max: 6 },
  { no: 6, label: '被保険者番号CD', kind: 'num', min: 0, max: 1 },
  { no: 7, label: '取得区分', kind: 'num', min: 1, max: 1 },
  { no: 8, label: '被保険者氏名', kind: 'kanji', min: 1, max: 12 },
  { no: 9, label: '被保険者氏名フリガナ（カタカナ）', kind: 'kana', min: 1, max: 20 },
  { no: 10, label: '変更後の氏名', kind: 'kanji', min: 0, max: 12 },
  { no: 11, label: '変更後の氏名フリガナ', kind: 'kana', min: 0, max: 20 },
  { no: 12, label: '性別', kind: 'num', min: 1, max: 1 },
  { no: 13, label: '生年月日（元号）', kind: 'kanji', min: 2, max: 2 },
  { no: 14, label: '生年月日（年）', kind: 'num', min: 1, max: 2 },
  { no: 15, label: '生年月日（月）', kind: 'num', min: 1, max: 2 },
  { no: 16, label: '生年月日（日）', kind: 'num', min: 1, max: 2 },
  { no: 17, label: '事業所番号（安定所番号）', kind: 'num', min: 4, max: 4 },
  { no: 18, label: '事業所番号（一連番号）', kind: 'num', min: 1, max: 6 },
  { no: 19, label: '事業所番号（CD）', kind: 'num', min: 1, max: 1 },
  { no: 20, label: '資格取得年月日（元号）', kind: 'kanji', min: 2, max: 2 },
  { no: 21, label: '資格取得年月日（年）', kind: 'num', min: 1, max: 2 },
  { no: 22, label: '資格取得年月日（月）', kind: 'num', min: 1, max: 2 },
  { no: 23, label: '資格取得年月日（日）', kind: 'num', min: 1, max: 2 },
  { no: 24, label: '被保険者となったことの原因', kind: 'num', min: 1, max: 1 },
  { no: 25, label: '賃金（支払の態様）', kind: 'num', min: 1, max: 1 },
  { no: 26, label: '賃金（賃金月額）', kind: 'num', min: 1, max: 4 },
  { no: 27, label: '雇用形態', kind: 'num', min: 1, max: 1 },
  { no: 28, label: '職種', kind: 'num', min: 2, max: 2 },
  { no: 29, label: '就職経路', kind: 'num', min: 1, max: 1 },
  { no: 30, label: '取得時被保険者種類', kind: 'num', min: 0, max: 0 },
  { no: 31, label: '番号複数取得チェック不要', kind: 'num', min: 0, max: 0 },
  { no: 32, label: '１週間の所定労働時間（時間）', kind: 'num', min: 2, max: 2 },
  { no: 33, label: '１週間の所定労働時間（分）', kind: 'num', min: 2, max: 2 },
  { no: 34, label: '契約期間の定め', kind: 'kanji', min: 1, max: 1 },
  { no: 35, label: '契約期間開始（元号）', kind: 'kanji', min: 0, max: 2 },
  { no: 36, label: '契約期間開始（年）', kind: 'num', min: 0, max: 2 },
  { no: 37, label: '契約期間開始（月）', kind: 'num', min: 0, max: 2 },
  { no: 38, label: '契約期間開始（日）', kind: 'num', min: 0, max: 2 },
  { no: 39, label: '契約期間終了（元号）', kind: 'kanji', min: 0, max: 2 },
  { no: 40, label: '契約期間終了（年）', kind: 'num', min: 0, max: 2 },
  { no: 41, label: '契約期間終了（月）', kind: 'num', min: 0, max: 2 },
  { no: 42, label: '契約期間終了（日）', kind: 'num', min: 0, max: 2 },
  { no: 43, label: '契約更新条項の有無', kind: 'kanji', min: 0, max: 1 },
  { no: 44, label: '事業所名', kind: 'free', min: 1, max: 34 },
  { no: 45, label: '被保険者氏名（ローマ字）', kind: 'kana', min: 0, max: 40 },
  { no: 46, label: '国籍・地域', kind: 'free', min: 0, max: 20 },
  { no: 47, label: '国籍地域コード', kind: 'num', min: 0, max: 3 },
  { no: 48, label: '在留資格', kind: 'free', min: 0, max: 20 },
  { no: 49, label: '在留資格コード', kind: 'num', min: 0, max: 2 },
  { no: 50, label: '在留期間（年）', kind: 'num', min: 0, max: 4 },
  { no: 51, label: '在留期間（月）', kind: 'num', min: 0, max: 2 },
  { no: 52, label: '在留期間（日）', kind: 'num', min: 0, max: 2 },
  { no: 53, label: '資格外活動許可の有無', kind: 'num', min: 0, max: 3 },
  { no: 54, label: '在留カード番号', kind: 'kana', min: 0, max: 12 },
  { no: 55, label: '派遣・請負就労区分', kind: 'num', min: 0, max: 3 },
  { no: 56, label: '備考', kind: 'free', min: 0, max: 80 },
  { no: 57, label: 'あて先', kind: 'kanji', min: 1, max: 10 },
  { no: 58, label: '備考欄（備考）', kind: 'free', min: 0, max: 0 },
  { no: 59, label: '確認通知年月日（元号）', kind: 'free', min: 0, max: 0 },
  { no: 60, label: '確認通知年月日（年）', kind: 'free', min: 0, max: 0 },
  { no: 61, label: '確認通知年月日（月）', kind: 'free', min: 0, max: 0 },
  { no: 62, label: '確認通知年月日（日）', kind: 'free', min: 0, max: 0 },
  { no: 63, label: '申請者用自由入力欄', kind: 'kana', min: 0, max: 20 },
];

/** 雇用保険被保険者番号「0101-001234-1」を4桁・6桁・1桁に分ける */
export function splitInsuranceNumber(src: string): { four: string; six: string; cd: string } {
  const d = digits(src);
  if (d.length !== 11) return { four: '', six: '', cd: '' };
  return { four: d.slice(0, 4), six: d.slice(4, 10), cd: d.slice(10, 11) };
}

/** データレコード（資格取得届・63項目） */
export function buildHwShutokuFields(office: OfficeInfo, p: HwShutokuInput): string[] {
  const birth = toWareki(p.birthDate);
  const acq = toWareki(p.acquiredDate);
  const cs = p.hasContractPeriod ? toWareki(p.contractStart) : null;
  const ce = p.hasContractPeriod ? toWareki(p.contractEnd) : null;
  const n = splitInsuranceNumber(p.insuranceNumber);
  const newKind = String(p.acquireKind || '1') === '1';
  const wage = Math.min(9999, Math.max(0, Math.round(Number(p.wageMonthly) || 0)));
  return [
    HW_FORM_SHUTOKU,
    '',                                   // 安定所番号（設定なし）
    digits(p.myNumber),
    newKind ? '' : n.four,
    newKind ? '' : n.six,
    newKind ? '' : n.cd,
    String(p.acquireKind || '1'),
    normalizeKanjiName(p.kanjiName),
    normalizeKanaName(p.kanaName),
    '', '',                               // 変更後の氏名・フリガナ
    genderCode(p.gender),
    birth ? birth.name : '', birth ? birth.yy : '', birth ? birth.mm : '', birth ? birth.dd : '',
    office.eiOffice, office.eiSerial, office.eiCheck,
    acq ? acq.name : '', acq ? acq.yy : '', acq ? acq.mm : '', acq ? acq.dd : '',
    String(p.reason || ''),
    String(p.wageForm || ''),
    wage ? String(wage).padStart(4, '0') : '',   // 仕様書の作成例にならい4桁にそろえる
    String(p.employmentType || ''),
    String(p.jobCategory || ''),
    String(p.jobRoute || ''),
    '', '',                               // 取得時被保険者種類・番号複数取得チェック不要（設定なし）
    pad2(Math.max(0, Number(p.weeklyHours) || 0)),
    pad2(Math.max(0, Number(p.weeklyMinutes) || 0)),
    p.hasContractPeriod ? '有' : '無',
    cs ? cs.name : '', cs ? cs.yy : '', cs ? cs.mm : '', cs ? cs.dd : '',
    ce ? ce.name : '', ce ? ce.yy : '', ce ? ce.mm : '', ce ? ce.dd : '',
    p.hasContractPeriod ? String(p.contractRenewal || '') : '',
    String(p.officeName || ''),
    '', '', '', '', '', '', '', '', '', '', '',   // 外国人に関する11項目（項番45〜55）
    String(p.note || ''),
    String(p.hwName || ''),
    '', '', '', '', '',                   // 項番58〜62（設定なし）
    '',                                   // 申請者用自由入力欄
  ];
}

export function buildHwShutoku(office: OfficeInfo, p: HwShutokuInput): string {
  return join(buildHwShutokuFields(office, p));
}

export type HwSoshitsuInput = {
  myNumber: string;
  insuranceNumber: string;
  acquiredDate: string;      // 資格取得年月日
  leaveDate: string;         // 離職等年月日
  reason: string;            // 喪失原因
  kanaName: string;
  kanjiName: string;
  gender: string;
  birthDate: string;
  address: string;           // 被保険者の住所又は居所
  officeName: string;        // 事業所名称
  leaveReasonText?: string;  // 被保険者でなくなったことの原因
  weeklyHours: number;
  weeklyMinutes: number;
  hwName: string;
};

export const HW_SOSHITSU_SPECS: FieldSpec[] = [
  { no: 1, label: '帳票種別', kind: 'num', min: 5, max: 5 },
  { no: 2, label: '安定所番号', kind: 'num', min: 0, max: 0 },
  { no: 3, label: '個人番号', kind: 'num', min: 0, max: 12 },
  { no: 4, label: '被保険者番号4桁', kind: 'num', min: 4, max: 4 },
  { no: 5, label: '被保険者番号6桁', kind: 'num', min: 1, max: 6 },
  { no: 6, label: '被保険者番号CD', kind: 'num', min: 1, max: 1 },
  { no: 7, label: '事業所番号（安定所番号）', kind: 'num', min: 4, max: 4 },
  { no: 8, label: '事業所番号（一連番号）', kind: 'num', min: 1, max: 6 },
  { no: 9, label: '事業所番号（CD）', kind: 'num', min: 1, max: 1 },
  { no: 10, label: '資格取得年月日（元号）', kind: 'kanji', min: 2, max: 2 },
  { no: 11, label: '資格取得年月日（年）', kind: 'num', min: 1, max: 2 },
  { no: 12, label: '資格取得年月日（月）', kind: 'num', min: 1, max: 2 },
  { no: 13, label: '資格取得年月日（日）', kind: 'num', min: 1, max: 2 },
  { no: 14, label: '離職等年月日（元号）', kind: 'kanji', min: 2, max: 2 },
  { no: 15, label: '離職等年月日（年）', kind: 'num', min: 1, max: 2 },
  { no: 16, label: '離職等年月日（月）', kind: 'num', min: 1, max: 2 },
  { no: 17, label: '離職等年月日（日）', kind: 'num', min: 1, max: 2 },
  { no: 18, label: '喪失原因', kind: 'num', min: 1, max: 1 },
  { no: 19, label: '離職票交付希望', kind: 'num', min: 1, max: 1 },
  { no: 20, label: '喪失時被保険者種類', kind: 'num', min: 0, max: 0 },
  { no: 21, label: '新氏名フリガナ（カタカナ）', kind: 'kana', min: 0, max: 20 },
  { no: 22, label: '新氏名', kind: 'kanji', min: 0, max: 12 },
  { no: 23, label: '補充採用予定の有無', kind: 'kanji', min: 1, max: 1 },
  { no: 24, label: '被保険者氏名フリガナ（カタカナ）', kind: 'kana', min: 1, max: 20 },
  { no: 25, label: '被保険者氏名', kind: 'kanji', min: 1, max: 12 },
  { no: 26, label: '性別', kind: 'num', min: 1, max: 1 },
  { no: 27, label: '生年月日（元号）', kind: 'kanji', min: 2, max: 2 },
  { no: 28, label: '生年月日（年）', kind: 'num', min: 1, max: 2 },
  { no: 29, label: '生年月日（月）', kind: 'num', min: 1, max: 2 },
  { no: 30, label: '生年月日（日）', kind: 'num', min: 1, max: 2 },
  { no: 31, label: '被保険者の住所又は居所', kind: 'free', min: 0, max: 40 },
  { no: 32, label: '事業所名称', kind: 'free', min: 1, max: 34 },
  { no: 33, label: '氏名変更年月日（元号）', kind: 'kanji', min: 0, max: 2 },
  { no: 34, label: '氏名変更年月日（年）', kind: 'num', min: 0, max: 2 },
  { no: 35, label: '氏名変更年月日（月）', kind: 'num', min: 0, max: 2 },
  { no: 36, label: '氏名変更年月日（日）', kind: 'num', min: 0, max: 2 },
  { no: 37, label: '被保険者でなくなったことの原因', kind: 'free', min: 0, max: 78 },
  { no: 38, label: '１週間の所定労働時間（時間）', kind: 'num', min: 2, max: 2 },
  { no: 39, label: '１週間の所定労働時間（分）', kind: 'num', min: 2, max: 2 },
  { no: 40, label: 'あて先', kind: 'kanji', min: 1, max: 10 },
  { no: 41, label: '被保険者氏名（ローマ字）', kind: 'kana', min: 0, max: 40 },
  { no: 42, label: '国籍・地域', kind: 'free', min: 0, max: 20 },
  { no: 43, label: '国籍地域コード', kind: 'num', min: 0, max: 3 },
  { no: 44, label: '在留資格', kind: 'free', min: 0, max: 20 },
  { no: 45, label: '在留資格コード', kind: 'num', min: 0, max: 2 },
  { no: 46, label: '在留期間（年）', kind: 'num', min: 0, max: 4 },
  { no: 47, label: '在留期間（月）', kind: 'num', min: 0, max: 2 },
  { no: 48, label: '在留期間（日）', kind: 'num', min: 0, max: 2 },
  { no: 49, label: '在留カード番号', kind: 'kana', min: 0, max: 12 },
  { no: 50, label: '派遣・請負就労区分', kind: 'num', min: 0, max: 3 },
  { no: 51, label: '備考欄（審査者）', kind: 'free', min: 0, max: 0 },
  { no: 52, label: '確認通知年月日（元号）', kind: 'free', min: 0, max: 0 },
  { no: 53, label: '確認通知年月日（年）', kind: 'free', min: 0, max: 0 },
  { no: 54, label: '確認通知年月日（月）', kind: 'free', min: 0, max: 0 },
  { no: 55, label: '確認通知年月日（日）', kind: 'free', min: 0, max: 0 },
  { no: 56, label: '申請者用自由入力欄', kind: 'kana', min: 0, max: 20 },
];

/** データレコード（資格喪失届・離職票交付なし・56項目） */
export function buildHwSoshitsuFields(office: OfficeInfo, p: HwSoshitsuInput): string[] {
  const acq = toWareki(p.acquiredDate);
  const lv = toWareki(p.leaveDate);
  const birth = toWareki(p.birthDate);
  const n = splitInsuranceNumber(p.insuranceNumber);
  return [
    HW_FORM_SOSHITSU,
    '',
    digits(p.myNumber),
    n.four, n.six, n.cd,
    office.eiOffice, office.eiSerial, office.eiCheck,
    acq ? acq.name : '', acq ? acq.yy : '', acq ? acq.mm : '', acq ? acq.dd : '',
    lv ? lv.name : '', lv ? lv.yy : '', lv ? lv.mm : '', lv ? lv.dd : '',
    String(p.reason || ''),
    '2',                                  // 離職票交付希望は「無」固定（仕様書 項番19）
    '',                                   // 喪失時被保険者種類（設定なし）
    '', '',                               // 新氏名フリガナ・新氏名
    '無',                                 // 補充採用予定の有無
    normalizeKanaName(p.kanaName),
    normalizeKanjiName(p.kanjiName),
    genderCode(p.gender),
    birth ? birth.name : '', birth ? birth.yy : '', birth ? birth.mm : '', birth ? birth.dd : '',
    String(p.address || ''),
    String(p.officeName || ''),
    '', '', '', '',                       // 氏名変更年月日
    String(p.leaveReasonText || ''),
    pad2(Math.max(0, Number(p.weeklyHours) || 0)),
    pad2(Math.max(0, Number(p.weeklyMinutes) || 0)),
    String(p.hwName || ''),
    '', '', '', '', '', '', '', '', '', '',   // 外国人に関する10項目（項番41〜50）
    '', '', '', '', '',                   // 項番51〜55（設定なし）
    '',                                   // 申請者用自由入力欄
  ];
}

export function buildHwSoshitsu(office: OfficeInfo, p: HwSoshitsuInput): string {
  return join(buildHwSoshitsuFields(office, p));
}

/** ハローワーク提出のCSV全体 */
export function buildHwCsv(
  office: OfficeInfo, kind: 'shutoku' | 'soshitsu' | 'rishoku', dataLines: string[], createdAt: Date,
): string {
  const version = kind === 'shutoku' ? HW_VERSION_SHUTOKU
    : kind === 'rishoku' ? HW_VERSION_RISHOKU : HW_VERSION_SOSHITSU;
  const header = kind === 'shutoku' ? HW_SHUTOKU_HEADER
    : kind === 'rishoku' ? HW_RISHOKU_HEADER : HW_SOSHITSU_HEADER;
  return [
    HW_KANRI_HEADER,
    buildHwKanri(office, version, createdAt),
    KANRI_MARK,
    HW_COUNT_HEADER,
    buildHwOfficeCount(),
    HW_OFFICE_HEADER,
    buildHwOffice(office),
    DATA_MARK,
    header,
    ...dataLines,
  ].join(CRLF) + CRLF;
}

// ============================================================
// 件数・容量の上限（仕様書 表３．３－１）
// ============================================================
export const NENKIN_MAX_ROWS_MEDIA = 99999;   // CD/DVD
export const NENKIN_MAX_ROWS_ESHINSEI = 20000; // 電子申請
export const NENKIN_MAX_BYTES_ESHINSEI = Math.floor(4.5 * 1024 * 1024);

export function csvSizeWarning(bytes: number, rows: number): string {
  if (rows > NENKIN_MAX_ROWS_ESHINSEI) {
    return `電子申請は1ファイル${NENKIN_MAX_ROWS_ESHINSEI.toLocaleString()}件までです（いま${rows.toLocaleString()}件）`;
  }
  if (bytes > NENKIN_MAX_BYTES_ESHINSEI) {
    return '電子申請は1ファイル4.5MBまでです。人数を分けて出してください';
  }
  return '';
}

// ============================================================
// 雇用保険被保険者資格喪失届（離職票交付あり）＋ 離職証明書
//   仕様書 ４.１.７（524項目）
//
//   交付なしの56項目に対して、離職証明書の項目が足され、
//   賃金支払の欄が25ブロック繰り返します。
//   項番1〜55は交付なしと同じ並びで、離職票交付希望だけが「1」（有）になります。
// ============================================================

export const HW_FORM_RISHOKU = '10191';
/** 連記式項目バージョン（仕様書 ４.１.１ 項番6） */
export const HW_VERSION_RISHOKU = '01';
export const HW_FILE_RISHOKU = '10191-rishoku.csv';
/** 賃金支払の繰り返し数（仕様書 ４.１.７。続紙を含めて25） */
export const HW_WAGE_ROWS = 25;
export const HW_RISHOKU_HEADER = [
  "帳票種別", "安定所番号", "個人番号", "被保険者番号4桁",
  "被保険者番号6桁", "被保険者番号CD", "事業所番号（安定所番号）", "事業所番号（一連番号）",
  "事業所番号（CD）", "資格取得年月日（元号）", "資格取得年月日（年）", "資格取得年月日（月）",
  "資格取得年月日（日）", "離職等年月日（元号）", "離職等年月日（年）", "離職等年月日（月）",
  "離職等年月日（日）", "喪失原因", "離職票交付希望", "喪失時被保険者種類",
  "新氏名フリガナ（カタカナ）", "新氏名", "補充採用予定の有無", "被保険者氏名フリガナ（カタカナ）",
  "被保険者氏名", "性別", "生年月日（元号）", "生年月日（年）",
  "生年月日（月）", "生年月日（日）", "被保険者の住所又は居所", "事業所名称",
  "氏名変更年月日（元号）", "氏名変更年月日（年）", "氏名変更年月日（月）", "氏名変更年月日（日）",
  "被保険者でなくなったことの原因", "１週間の所定労働時間（時間）", "１週間の所定労働時間（分）", "あて先",
  "被保険者氏名（ローマ字）", "国籍・地域", "国籍地域コード", "在留資格",
  "在留資格コード", "在留期間（年）", "在留期間（月）", "在留期間（日）",
  "在留カード番号", "派遣・請負就労区分", "備考欄（審査者）", "確認通知年月日（元号）",
  "確認通知年月日（年）", "確認通知年月日（月）", "確認通知年月日（日）", "被保険者番号4桁（離職証明書）",
  "被保険者番号6桁（離職証明書）", "被保険者番号CD（離職証明書）", "事業所番号（安定所番号）（離職証明書）", "事業所番号（一連番号）（離職証明書）",
  "事業所番号（CD）（離職証明書）", "離職者氏名フリガナ（カタカナ）", "離職者氏名", "離職年月日（元号）",
  "離職年月日（年）", "離職年月日（月）", "離職年月日（日）", "事業所名称（離職証明書）",
  "事業所所在地（離職証明書）", "事業所電話番号（市外局番）", "事業所電話番号（市内局番）", "事業所電話番号（加入者番号）",
  "離職者郵便番号（配達局番号）", "離職者郵便番号（町域番号）", "離職者の住所又は居所", "離職者電話番号（市外局番）",
  "離職者電話番号（市内局番）", "離職者電話番号（加入者番号）", "事業主住所", "事業主氏名（上段）",
  "事業主氏名（下段）", "離職日の翌日（月）", "離職日の翌日（日）", "被保険者期間算定対象期間開始（月）01",
  "被保険者期間算定対象期間開始（日）01", "賃金支払基礎日数01", "賃金支払対象期間開始（月）01", "賃金支払対象期間開始（日）01",
  "賃金支払対象期間基礎日数01", "賃金額Ａ01", "賃金額Ｂ01", "賃金額計01",
  "賃金支払備考01", "被保険者期間算定対象期間開始（月）02", "被保険者期間算定対象期間開始（日）02", "被保険者期間算定対象期間終了（月）02",
  "被保険者期間算定対象期間終了（日）02", "短期雇用特例被保険者（月）02", "賃金支払基礎日数02", "賃金支払対象期間開始（月）02",
  "賃金支払対象期間開始（日）02", "賃金支払対象期間終了（月）02", "賃金支払対象期間終了（日）02", "賃金支払対象期間基礎日数02",
  "賃金額Ａ02", "賃金額Ｂ02", "賃金額計02", "賃金支払備考02",
  "被保険者期間算定対象期間開始（月）03", "被保険者期間算定対象期間開始（日）03", "被保険者期間算定対象期間終了（月）03", "被保険者期間算定対象期間終了（日）03",
  "短期雇用特例被保険者（月）03", "賃金支払基礎日数03", "賃金支払対象期間開始（月）03", "賃金支払対象期間開始（日）03",
  "賃金支払対象期間終了（月）03", "賃金支払対象期間終了（日）03", "賃金支払対象期間基礎日数03", "賃金額Ａ03",
  "賃金額Ｂ03", "賃金額計03", "賃金支払備考03", "被保険者期間算定対象期間開始（月）04",
  "被保険者期間算定対象期間開始（日）04", "被保険者期間算定対象期間終了（月）04", "被保険者期間算定対象期間終了（日）04", "短期雇用特例被保険者（月）04",
  "賃金支払基礎日数04", "賃金支払対象期間開始（月）04", "賃金支払対象期間開始（日）04", "賃金支払対象期間終了（月）04",
  "賃金支払対象期間終了（日）04", "賃金支払対象期間基礎日数04", "賃金額Ａ04", "賃金額Ｂ04",
  "賃金額計04", "賃金支払備考04", "被保険者期間算定対象期間開始（月）05", "被保険者期間算定対象期間開始（日）05",
  "被保険者期間算定対象期間終了（月）05", "被保険者期間算定対象期間終了（日）05", "短期雇用特例被保険者（月）05", "賃金支払基礎日数05",
  "賃金支払対象期間開始（月）05", "賃金支払対象期間開始（日）05", "賃金支払対象期間終了（月）05", "賃金支払対象期間終了（日）05",
  "賃金支払対象期間基礎日数05", "賃金額Ａ05", "賃金額Ｂ05", "賃金額計05",
  "賃金支払備考05", "被保険者期間算定対象期間開始（月）06", "被保険者期間算定対象期間開始（日）06", "被保険者期間算定対象期間終了（月）06",
  "被保険者期間算定対象期間終了（日）06", "短期雇用特例被保険者（月）06", "賃金支払基礎日数06", "賃金支払対象期間開始（月）06",
  "賃金支払対象期間開始（日）06", "賃金支払対象期間終了（月）06", "賃金支払対象期間終了（日）06", "賃金支払対象期間基礎日数06",
  "賃金額Ａ06", "賃金額Ｂ06", "賃金額計06", "賃金支払備考06",
  "被保険者期間算定対象期間開始（月）07", "被保険者期間算定対象期間開始（日）07", "被保険者期間算定対象期間終了（月）07", "被保険者期間算定対象期間終了（日）07",
  "短期雇用特例被保険者（月）07", "賃金支払基礎日数07", "賃金支払対象期間開始（月）07", "賃金支払対象期間開始（日）07",
  "賃金支払対象期間終了（月）07", "賃金支払対象期間終了（日）07", "賃金支払対象期間基礎日数07", "賃金額Ａ07",
  "賃金額Ｂ07", "賃金額計07", "賃金支払備考07", "被保険者期間算定対象期間開始（月）08",
  "被保険者期間算定対象期間開始（日）08", "被保険者期間算定対象期間終了（月）08", "被保険者期間算定対象期間終了（日）08", "短期雇用特例被保険者（月）08",
  "賃金支払基礎日数08", "賃金支払対象期間開始（月）08", "賃金支払対象期間開始（日）08", "賃金支払対象期間終了（月）08",
  "賃金支払対象期間終了（日）08", "賃金支払対象期間基礎日数08", "賃金額Ａ08", "賃金額Ｂ08",
  "賃金額計08", "賃金支払備考08", "被保険者期間算定対象期間開始（月）09", "被保険者期間算定対象期間開始（日）09",
  "被保険者期間算定対象期間終了（月）09", "被保険者期間算定対象期間終了（日）09", "短期雇用特例被保険者（月）09", "賃金支払基礎日数09",
  "賃金支払対象期間開始（月）09", "賃金支払対象期間開始（日）09", "賃金支払対象期間終了（月）09", "賃金支払対象期間終了（日）09",
  "賃金支払対象期間基礎日数09", "賃金額Ａ09", "賃金額Ｂ09", "賃金額計09",
  "賃金支払備考09", "被保険者期間算定対象期間開始（月）10", "被保険者期間算定対象期間開始（日）10", "被保険者期間算定対象期間終了（月）10",
  "被保険者期間算定対象期間終了（日）10", "短期雇用特例被保険者（月）10", "賃金支払基礎日数10", "賃金支払対象期間開始（月）10",
  "賃金支払対象期間開始（日）10", "賃金支払対象期間終了（月）10", "賃金支払対象期間終了（日）10", "賃金支払対象期間基礎日数10",
  "賃金額Ａ10", "賃金額Ｂ10", "賃金額計10", "賃金支払備考10",
  "被保険者期間算定対象期間開始（月）11", "被保険者期間算定対象期間開始（日）11", "被保険者期間算定対象期間終了（月）11", "被保険者期間算定対象期間終了（日）11",
  "短期雇用特例被保険者（月）11", "賃金支払基礎日数11", "賃金支払対象期間開始（月）11", "賃金支払対象期間開始（日）11",
  "賃金支払対象期間終了（月）11", "賃金支払対象期間終了（日）11", "賃金支払対象期間基礎日数11", "賃金額Ａ11",
  "賃金額Ｂ11", "賃金額計11", "賃金支払備考11", "被保険者期間算定対象期間開始（月）12",
  "被保険者期間算定対象期間開始（日）12", "被保険者期間算定対象期間終了（月）12", "被保険者期間算定対象期間終了（日）12", "短期雇用特例被保険者（月）12",
  "賃金支払基礎日数12", "賃金支払対象期間開始（月）12", "賃金支払対象期間開始（日）12", "賃金支払対象期間終了（月）12",
  "賃金支払対象期間終了（日）12", "賃金支払対象期間基礎日数12", "賃金額Ａ12", "賃金額Ｂ12",
  "賃金額計12", "賃金支払備考12", "被保険者期間算定対象期間開始（月）13", "被保険者期間算定対象期間開始（日）13",
  "被保険者期間算定対象期間終了（月）13", "被保険者期間算定対象期間終了（日）13", "短期雇用特例被保険者（月）13", "賃金支払基礎日数13",
  "賃金支払対象期間開始（月）13", "賃金支払対象期間開始（日）13", "賃金支払対象期間終了（月）13", "賃金支払対象期間終了（日）13",
  "賃金支払対象期間基礎日数13", "賃金額Ａ13", "賃金額Ｂ13", "賃金額計13",
  "賃金支払備考13", "被保険者期間算定対象期間開始（月）14", "被保険者期間算定対象期間開始（日）14", "被保険者期間算定対象期間終了（月）14",
  "被保険者期間算定対象期間終了（日）14", "短期雇用特例被保険者（月）14", "賃金支払基礎日数14", "賃金支払対象期間開始（月）14",
  "賃金支払対象期間開始（日）14", "賃金支払対象期間終了（月）14", "賃金支払対象期間終了（日）14", "賃金支払対象期間基礎日数14",
  "賃金額Ａ14", "賃金額Ｂ14", "賃金額計14", "賃金支払備考14",
  "被保険者期間算定対象期間開始（月）15", "被保険者期間算定対象期間開始（日）15", "被保険者期間算定対象期間終了（月）15", "被保険者期間算定対象期間終了（日）15",
  "短期雇用特例被保険者（月）15", "賃金支払基礎日数15", "賃金支払対象期間開始（月）15", "賃金支払対象期間開始（日）15",
  "賃金支払対象期間終了（月）15", "賃金支払対象期間終了（日）15", "賃金支払対象期間基礎日数15", "賃金額Ａ15",
  "賃金額Ｂ15", "賃金額計15", "賃金支払備考15", "被保険者期間算定対象期間開始（月）16",
  "被保険者期間算定対象期間開始（日）16", "被保険者期間算定対象期間終了（月）16", "被保険者期間算定対象期間終了（日）16", "短期雇用特例被保険者（月）16",
  "賃金支払基礎日数16", "賃金支払対象期間開始（月）16", "賃金支払対象期間開始（日）16", "賃金支払対象期間終了（月）16",
  "賃金支払対象期間終了（日）16", "賃金支払対象期間基礎日数16", "賃金額Ａ16", "賃金額Ｂ16",
  "賃金額計16", "賃金支払備考16", "被保険者期間算定対象期間開始（月）17", "被保険者期間算定対象期間開始（日）17",
  "被保険者期間算定対象期間終了（月）17", "被保険者期間算定対象期間終了（日）17", "短期雇用特例被保険者（月）17", "賃金支払基礎日数17",
  "賃金支払対象期間開始（月）17", "賃金支払対象期間開始（日）17", "賃金支払対象期間終了（月）17", "賃金支払対象期間終了（日）17",
  "賃金支払対象期間基礎日数17", "賃金額Ａ17", "賃金額Ｂ17", "賃金額計17",
  "賃金支払備考17", "被保険者期間算定対象期間開始（月）18", "被保険者期間算定対象期間開始（日）18", "被保険者期間算定対象期間終了（月）18",
  "被保険者期間算定対象期間終了（日）18", "短期雇用特例被保険者（月）18", "賃金支払基礎日数18", "賃金支払対象期間開始（月）18",
  "賃金支払対象期間開始（日）18", "賃金支払対象期間終了（月）18", "賃金支払対象期間終了（日）18", "賃金支払対象期間基礎日数18",
  "賃金額Ａ18", "賃金額Ｂ18", "賃金額計18", "賃金支払備考18",
  "被保険者期間算定対象期間開始（月）19", "被保険者期間算定対象期間開始（日）19", "被保険者期間算定対象期間終了（月）19", "被保険者期間算定対象期間終了（日）19",
  "短期雇用特例被保険者（月）19", "賃金支払基礎日数19", "賃金支払対象期間開始（月）19", "賃金支払対象期間開始（日）19",
  "賃金支払対象期間終了（月）19", "賃金支払対象期間終了（日）19", "賃金支払対象期間基礎日数19", "賃金額Ａ19",
  "賃金額Ｂ19", "賃金額計19", "賃金支払備考19", "被保険者期間算定対象期間開始（月）20",
  "被保険者期間算定対象期間開始（日）20", "被保険者期間算定対象期間終了（月）20", "被保険者期間算定対象期間終了（日）20", "短期雇用特例被保険者（月）20",
  "賃金支払基礎日数20", "賃金支払対象期間開始（月）20", "賃金支払対象期間開始（日）20", "賃金支払対象期間終了（月）20",
  "賃金支払対象期間終了（日）20", "賃金支払対象期間基礎日数20", "賃金額Ａ20", "賃金額Ｂ20",
  "賃金額計20", "賃金支払備考20", "被保険者期間算定対象期間開始（月）21", "被保険者期間算定対象期間開始（日）21",
  "被保険者期間算定対象期間終了（月）21", "被保険者期間算定対象期間終了（日）21", "短期雇用特例被保険者（月）21", "賃金支払基礎日数21",
  "賃金支払対象期間開始（月）21", "賃金支払対象期間開始（日）21", "賃金支払対象期間終了（月）21", "賃金支払対象期間終了（日）21",
  "賃金支払対象期間基礎日数21", "賃金額Ａ21", "賃金額Ｂ21", "賃金額計21",
  "賃金支払備考21", "被保険者期間算定対象期間開始（月）22", "被保険者期間算定対象期間開始（日）22", "被保険者期間算定対象期間終了（月）22",
  "被保険者期間算定対象期間終了（日）22", "短期雇用特例被保険者（月）22", "賃金支払基礎日数22", "賃金支払対象期間開始（月）22",
  "賃金支払対象期間開始（日）22", "賃金支払対象期間終了（月）22", "賃金支払対象期間終了（日）22", "賃金支払対象期間基礎日数22",
  "賃金額Ａ22", "賃金額Ｂ22", "賃金額計22", "賃金支払備考22",
  "被保険者期間算定対象期間開始（月）23", "被保険者期間算定対象期間開始（日）23", "被保険者期間算定対象期間終了（月）23", "被保険者期間算定対象期間終了（日）23",
  "短期雇用特例被保険者（月）23", "賃金支払基礎日数23", "賃金支払対象期間開始（月）23", "賃金支払対象期間開始（日）23",
  "賃金支払対象期間終了（月）23", "賃金支払対象期間終了（日）23", "賃金支払対象期間基礎日数23", "賃金額Ａ23",
  "賃金額Ｂ23", "賃金額計23", "賃金支払備考23", "被保険者期間算定対象期間開始（月）24",
  "被保険者期間算定対象期間開始（日）24", "被保険者期間算定対象期間終了（月）24", "被保険者期間算定対象期間終了（日）24", "短期雇用特例被保険者（月）24",
  "賃金支払基礎日数24", "賃金支払対象期間開始（月）24", "賃金支払対象期間開始（日）24", "賃金支払対象期間終了（月）24",
  "賃金支払対象期間終了（日）24", "賃金支払対象期間基礎日数24", "賃金額Ａ24", "賃金額Ｂ24",
  "賃金額計24", "賃金支払備考24", "被保険者期間算定対象期間開始（月）25", "被保険者期間算定対象期間開始（日）25",
  "被保険者期間算定対象期間終了（月）25", "被保険者期間算定対象期間終了（日）25", "短期雇用特例被保険者（月）25", "賃金支払基礎日数25",
  "賃金支払対象期間開始（月）25", "賃金支払対象期間開始（日）25", "賃金支払対象期間終了（月）25", "賃金支払対象期間終了（日）25",
  "賃金支払対象期間基礎日数25", "賃金額Ａ25", "賃金額Ｂ25", "賃金額計25",
  "賃金支払備考25", "賃金に関する特記事項", "賃金に関する特記事項（続紙用）", "離職者署名（記載内容相違）",
  "作成年月日（元号）", "作成年月日（年）", "作成年月日（月）", "作成年月日（日）",
  "提出代行者・事務代理者の表示", "社会保険労務士氏名", "社会保険労務士電話番号（市外局番）", "社会保険労務士電話番号（市内局番）",
  "社会保険労務士電話番号（加入者番号）", "社労士付記欄", "社労士付記欄（続紙）", "選択１－１",
  "選択１－２", "選択２", "選択３－１", "選択３－２",
  "選択３－３", "選択３－４", "選択４－１", "選択４－２",
  "選択４－３－１", "選択４－３－２", "選択５－１－１", "選択５－１－２",
  "選択５－１－３", "選択５－１－４", "選択５－１－５", "選択５－１－６",
  "選択５－１－７", "選択５－２", "選択６", "選択２（定年年齢）",
  "選択２（定年後の継続雇用）", "選択２（継続雇用の事由）", "選択２（具体的理由）", "選択３－１（１回の契約期間）",
  "選択３－１（通算契約期間）", "選択３－１（契約更新回数）", "選択３－１（上限短縮による離職）", "選択３－１（規定上限による離職）",
  "選択３－１（雇用期限による離職）", "選択３－１（通算契約期間の上限による離職）", "選択３－１（上限の定めの有無）", "選択３－２（労働者種別）",
  "選択３－２－１（１回の契約期間）", "選択３－２－１（通算契約期間）", "選択３－２－１（契約更新回数）", "選択３－２－１（確約合意の有無）",
  "選択３－２－１（明示の有無）", "選択３－２－１（雇止め通知の有無）", "選択３－２－１（不更新条項の追加の有無）", "選択３－２－１（労働者からの申出）",
  "選択３－２－２（１回の契約期間）", "選択３－２－２（通算契約期間）", "選択３－２－２（契約更新回数）", "選択３－２－２（確約合意の有無）",
  "選択３－２－２（明示の有無）", "選択３－２－２（労働者からの申出）", "選択３－２－２（派遣就業指示の選択）", "選択４－３－２（具体的理由）",
  "選択５－１－５（教育訓練の有無）", "選択５－１－６（所在地）", "選択５－１－７（具体的理由）", "選択６（具体的理由）",
  "具体的事情記載欄", "異議の有無", "離職者署名", "申請者用自由入力欄",
].join(',');

export const HW_RISHOKU_SPECS: FieldSpec[] = [
  { no: 1, label: "帳票種別", kind: 'num', min: 5, max: 5 },
  { no: 2, label: "安定所番号", kind: 'free', min: 0, max: 0 },
  { no: 3, label: "個人番号", kind: 'num', min: 0, max: 12 },
  { no: 4, label: "被保険者番号4桁", kind: 'num', min: 4, max: 4 },
  { no: 5, label: "被保険者番号6桁", kind: 'num', min: 1, max: 6 },
  { no: 6, label: "被保険者番号CD", kind: 'num', min: 1, max: 1 },
  { no: 7, label: "事業所番号（安定所番号）", kind: 'num', min: 4, max: 4 },
  { no: 8, label: "事業所番号（一連番号）", kind: 'num', min: 1, max: 6 },
  { no: 9, label: "事業所番号（CD）", kind: 'num', min: 1, max: 1 },
  { no: 10, label: "資格取得年月日（元号）", kind: 'kanji', min: 2, max: 2 },
  { no: 11, label: "資格取得年月日（年）", kind: 'num', min: 1, max: 2 },
  { no: 12, label: "資格取得年月日（月）", kind: 'num', min: 1, max: 2 },
  { no: 13, label: "資格取得年月日（日）", kind: 'num', min: 1, max: 2 },
  { no: 14, label: "離職等年月日（元号）", kind: 'kanji', min: 2, max: 2 },
  { no: 15, label: "離職等年月日（年）", kind: 'num', min: 1, max: 2 },
  { no: 16, label: "離職等年月日（月）", kind: 'num', min: 1, max: 2 },
  { no: 17, label: "離職等年月日（日）", kind: 'num', min: 1, max: 2 },
  { no: 18, label: "喪失原因", kind: 'num', min: 1, max: 1 },
  { no: 19, label: "離職票交付希望", kind: 'num', min: 1, max: 1 },
  { no: 20, label: "喪失時被保険者種類", kind: 'free', min: 0, max: 0 },
  { no: 21, label: "新氏名フリガナ（カタカナ）", kind: 'kana', min: 0, max: 20 },
  { no: 22, label: "新氏名", kind: 'kanji', min: 0, max: 12 },
  { no: 23, label: "補充採用予定の有無", kind: 'kanji', min: 1, max: 1 },
  { no: 24, label: "被保険者氏名フリガナ（カタカナ）", kind: 'kana', min: 1, max: 20 },
  { no: 25, label: "被保険者氏名", kind: 'kanji', min: 1, max: 12 },
  { no: 26, label: "性別", kind: 'num', min: 1, max: 1 },
  { no: 27, label: "生年月日（元号）", kind: 'kanji', min: 2, max: 2 },
  { no: 28, label: "生年月日（年）", kind: 'num', min: 1, max: 2 },
  { no: 29, label: "生年月日（月）", kind: 'num', min: 1, max: 2 },
  { no: 30, label: "生年月日（日）", kind: 'num', min: 1, max: 2 },
  { no: 31, label: "被保険者の住所又は居所", kind: 'kanji', min: 0, max: 64 },
  { no: 32, label: "事業所名称", kind: 'kanji', min: 1, max: 34 },
  { no: 33, label: "氏名変更年月日（元号）", kind: 'kanji', min: 0, max: 2 },
  { no: 34, label: "氏名変更年月日（年）", kind: 'num', min: 0, max: 2 },
  { no: 35, label: "氏名変更年月日（月）", kind: 'num', min: 0, max: 2 },
  { no: 36, label: "氏名変更年月日（日）", kind: 'num', min: 0, max: 2 },
  { no: 37, label: "被保険者でなくなったことの原因", kind: 'kanji', min: 0, max: 78 },
  { no: 38, label: "１週間の所定労働時間（時間）", kind: 'num', min: 2, max: 2 },
  { no: 39, label: "１週間の所定労働時間（分）", kind: 'num', min: 2, max: 2 },
  { no: 40, label: "あて先", kind: 'kanji', min: 1, max: 10 },
  { no: 41, label: "被保険者氏名（ローマ字）", kind: 'num', min: 0, max: 40 },
  { no: 42, label: "国籍・地域", kind: 'kanji', min: 0, max: 20 },
  { no: 43, label: "国籍地域コード", kind: 'num', min: 0, max: 3 },
  { no: 44, label: "在留資格", kind: 'kanji', min: 0, max: 20 },
  { no: 45, label: "在留資格コード", kind: 'num', min: 0, max: 2 },
  { no: 46, label: "在留期間（年）", kind: 'num', min: 0, max: 4 },
  { no: 47, label: "在留期間（月）", kind: 'num', min: 0, max: 2 },
  { no: 48, label: "在留期間（日）", kind: 'num', min: 0, max: 2 },
  { no: 49, label: "在留カード番号", kind: 'num', min: 0, max: 12 },
  { no: 50, label: "派遣・請負就労区分", kind: 'num', min: 0, max: 3 },
  { no: 51, label: "備考欄（審査者）", kind: 'free', min: 0, max: 0 },
  { no: 52, label: "確認通知年月日（元号）", kind: 'free', min: 0, max: 0 },
  { no: 53, label: "確認通知年月日（年）", kind: 'free', min: 0, max: 0 },
  { no: 54, label: "確認通知年月日（月）", kind: 'free', min: 0, max: 0 },
  { no: 55, label: "確認通知年月日（日）", kind: 'free', min: 0, max: 0 },
  { no: 56, label: "被保険者番号4桁（離職証明書）", kind: 'num', min: 4, max: 4 },
  { no: 57, label: "被保険者番号6桁（離職証明書）", kind: 'num', min: 1, max: 6 },
  { no: 58, label: "被保険者番号CD（離職証明書）", kind: 'num', min: 1, max: 1 },
  { no: 59, label: "事業所番号（安定所番号）（離職証明書）", kind: 'num', min: 4, max: 4 },
  { no: 60, label: "事業所番号（一連番号）（離職証明書）", kind: 'num', min: 1, max: 6 },
  { no: 61, label: "事業所番号（CD）（離職証明書）", kind: 'num', min: 1, max: 1 },
  { no: 62, label: "離職者氏名フリガナ（カタカナ）", kind: 'kana', min: 1, max: 30 },
  { no: 63, label: "離職者氏名", kind: 'kanji', min: 1, max: 30 },
  { no: 64, label: "離職年月日（元号）", kind: 'kanji', min: 2, max: 2 },
  { no: 65, label: "離職年月日（年）", kind: 'num', min: 1, max: 2 },
  { no: 66, label: "離職年月日（月）", kind: 'num', min: 1, max: 2 },
  { no: 67, label: "離職年月日（日）", kind: 'num', min: 1, max: 2 },
  { no: 68, label: "事業所名称（離職証明書）", kind: 'kanji', min: 1, max: 40 },
  { no: 69, label: "事業所所在地（離職証明書）", kind: 'kanji', min: 1, max: 40 },
  { no: 70, label: "事業所電話番号（市外局番）", kind: 'num', min: 2, max: 5 },
  { no: 71, label: "事業所電話番号（市内局番）", kind: 'num', min: 1, max: 5 },
  { no: 72, label: "事業所電話番号（加入者番号）", kind: 'num', min: 4, max: 5 },
  { no: 73, label: "離職者郵便番号（配達局番号）", kind: 'num', min: 3, max: 3 },
  { no: 74, label: "離職者郵便番号（町域番号）", kind: 'num', min: 4, max: 4 },
  { no: 75, label: "離職者の住所又は居所", kind: 'kanji', min: 1, max: 40 },
  { no: 76, label: "離職者電話番号（市外局番）", kind: 'num', min: 2, max: 5 },
  { no: 77, label: "離職者電話番号（市内局番）", kind: 'num', min: 1, max: 5 },
  { no: 78, label: "離職者電話番号（加入者番号）", kind: 'num', min: 4, max: 5 },
  { no: 79, label: "事業主住所", kind: 'kanji', min: 0, max: 40 },
  { no: 80, label: "事業主氏名（上段）", kind: 'kanji', min: 0, max: 27 },
  { no: 81, label: "事業主氏名（下段）", kind: 'kanji', min: 0, max: 27 },
  { no: 82, label: "離職日の翌日（月）", kind: 'num', min: 0, max: 2 },
  { no: 83, label: "離職日の翌日（日）", kind: 'num', min: 0, max: 2 },
  { no: 84, label: "被保険者期間算定対象期間開始（月）01", kind: 'num', min: 0, max: 2 },
  { no: 85, label: "被保険者期間算定対象期間開始（日）01", kind: 'num', min: 0, max: 2 },
  { no: 86, label: "賃金支払基礎日数01", kind: 'num', min: 0, max: 2 },
  { no: 87, label: "賃金支払対象期間開始（月）01", kind: 'num', min: 0, max: 2 },
  { no: 88, label: "賃金支払対象期間開始（日）01", kind: 'num', min: 0, max: 2 },
  { no: 89, label: "賃金支払対象期間基礎日数01", kind: 'num', min: 0, max: 2 },
  { no: 90, label: "賃金額Ａ01", kind: 'kanji', min: 0, max: 7 },
  { no: 91, label: "賃金額Ｂ01", kind: 'kanji', min: 0, max: 7 },
  { no: 92, label: "賃金額計01", kind: 'kanji', min: 0, max: 8 },
  { no: 93, label: "賃金支払備考01", kind: 'kanji', min: 0, max: 16 },
  { no: 94, label: "被保険者期間算定対象期間開始（月）02", kind: 'num', min: 0, max: 2 },
  { no: 95, label: "被保険者期間算定対象期間開始（日）02", kind: 'num', min: 0, max: 2 },
  { no: 96, label: "被保険者期間算定対象期間終了（月）02", kind: 'num', min: 0, max: 2 },
  { no: 97, label: "被保険者期間算定対象期間終了（日）02", kind: 'num', min: 0, max: 2 },
  { no: 98, label: "短期雇用特例被保険者（月）02", kind: 'num', min: 0, max: 2 },
  { no: 99, label: "賃金支払基礎日数02", kind: 'num', min: 0, max: 2 },
  { no: 100, label: "賃金支払対象期間開始（月）02", kind: 'num', min: 0, max: 2 },
  { no: 101, label: "賃金支払対象期間開始（日）02", kind: 'num', min: 0, max: 2 },
  { no: 102, label: "賃金支払対象期間終了（月）02", kind: 'num', min: 0, max: 2 },
  { no: 103, label: "賃金支払対象期間終了（日）02", kind: 'num', min: 0, max: 2 },
  { no: 104, label: "賃金支払対象期間基礎日数02", kind: 'num', min: 0, max: 2 },
  { no: 105, label: "賃金額Ａ02", kind: 'kanji', min: 0, max: 7 },
  { no: 106, label: "賃金額Ｂ02", kind: 'kanji', min: 0, max: 7 },
  { no: 107, label: "賃金額計02", kind: 'kanji', min: 0, max: 8 },
  { no: 108, label: "賃金支払備考02", kind: 'kanji', min: 0, max: 16 },
  { no: 109, label: "被保険者期間算定対象期間開始（月）03", kind: 'num', min: 0, max: 2 },
  { no: 110, label: "被保険者期間算定対象期間開始（日）03", kind: 'num', min: 0, max: 2 },
  { no: 111, label: "被保険者期間算定対象期間終了（月）03", kind: 'num', min: 0, max: 2 },
  { no: 112, label: "被保険者期間算定対象期間終了（日）03", kind: 'num', min: 0, max: 2 },
  { no: 113, label: "短期雇用特例被保険者（月）03", kind: 'num', min: 0, max: 2 },
  { no: 114, label: "賃金支払基礎日数03", kind: 'num', min: 0, max: 2 },
  { no: 115, label: "賃金支払対象期間開始（月）03", kind: 'num', min: 0, max: 2 },
  { no: 116, label: "賃金支払対象期間開始（日）03", kind: 'num', min: 0, max: 2 },
  { no: 117, label: "賃金支払対象期間終了（月）03", kind: 'num', min: 0, max: 2 },
  { no: 118, label: "賃金支払対象期間終了（日）03", kind: 'num', min: 0, max: 2 },
  { no: 119, label: "賃金支払対象期間基礎日数03", kind: 'num', min: 0, max: 2 },
  { no: 120, label: "賃金額Ａ03", kind: 'kanji', min: 0, max: 7 },
  { no: 121, label: "賃金額Ｂ03", kind: 'kanji', min: 0, max: 7 },
  { no: 122, label: "賃金額計03", kind: 'kanji', min: 0, max: 8 },
  { no: 123, label: "賃金支払備考03", kind: 'kanji', min: 0, max: 16 },
  { no: 124, label: "被保険者期間算定対象期間開始（月）04", kind: 'num', min: 0, max: 2 },
  { no: 125, label: "被保険者期間算定対象期間開始（日）04", kind: 'num', min: 0, max: 2 },
  { no: 126, label: "被保険者期間算定対象期間終了（月）04", kind: 'num', min: 0, max: 2 },
  { no: 127, label: "被保険者期間算定対象期間終了（日）04", kind: 'num', min: 0, max: 2 },
  { no: 128, label: "短期雇用特例被保険者（月）04", kind: 'num', min: 0, max: 2 },
  { no: 129, label: "賃金支払基礎日数04", kind: 'num', min: 0, max: 2 },
  { no: 130, label: "賃金支払対象期間開始（月）04", kind: 'num', min: 0, max: 2 },
  { no: 131, label: "賃金支払対象期間開始（日）04", kind: 'num', min: 0, max: 2 },
  { no: 132, label: "賃金支払対象期間終了（月）04", kind: 'num', min: 0, max: 2 },
  { no: 133, label: "賃金支払対象期間終了（日）04", kind: 'num', min: 0, max: 2 },
  { no: 134, label: "賃金支払対象期間基礎日数04", kind: 'num', min: 0, max: 2 },
  { no: 135, label: "賃金額Ａ04", kind: 'kanji', min: 0, max: 7 },
  { no: 136, label: "賃金額Ｂ04", kind: 'kanji', min: 0, max: 7 },
  { no: 137, label: "賃金額計04", kind: 'kanji', min: 0, max: 8 },
  { no: 138, label: "賃金支払備考04", kind: 'kanji', min: 0, max: 16 },
  { no: 139, label: "被保険者期間算定対象期間開始（月）05", kind: 'num', min: 0, max: 2 },
  { no: 140, label: "被保険者期間算定対象期間開始（日）05", kind: 'num', min: 0, max: 2 },
  { no: 141, label: "被保険者期間算定対象期間終了（月）05", kind: 'num', min: 0, max: 2 },
  { no: 142, label: "被保険者期間算定対象期間終了（日）05", kind: 'num', min: 0, max: 2 },
  { no: 143, label: "短期雇用特例被保険者（月）05", kind: 'num', min: 0, max: 2 },
  { no: 144, label: "賃金支払基礎日数05", kind: 'num', min: 0, max: 2 },
  { no: 145, label: "賃金支払対象期間開始（月）05", kind: 'num', min: 0, max: 2 },
  { no: 146, label: "賃金支払対象期間開始（日）05", kind: 'num', min: 0, max: 2 },
  { no: 147, label: "賃金支払対象期間終了（月）05", kind: 'num', min: 0, max: 2 },
  { no: 148, label: "賃金支払対象期間終了（日）05", kind: 'num', min: 0, max: 2 },
  { no: 149, label: "賃金支払対象期間基礎日数05", kind: 'num', min: 0, max: 2 },
  { no: 150, label: "賃金額Ａ05", kind: 'kanji', min: 0, max: 7 },
  { no: 151, label: "賃金額Ｂ05", kind: 'kanji', min: 0, max: 7 },
  { no: 152, label: "賃金額計05", kind: 'kanji', min: 0, max: 8 },
  { no: 153, label: "賃金支払備考05", kind: 'kanji', min: 0, max: 16 },
  { no: 154, label: "被保険者期間算定対象期間開始（月）06", kind: 'num', min: 0, max: 2 },
  { no: 155, label: "被保険者期間算定対象期間開始（日）06", kind: 'num', min: 0, max: 2 },
  { no: 156, label: "被保険者期間算定対象期間終了（月）06", kind: 'num', min: 0, max: 2 },
  { no: 157, label: "被保険者期間算定対象期間終了（日）06", kind: 'num', min: 0, max: 2 },
  { no: 158, label: "短期雇用特例被保険者（月）06", kind: 'num', min: 0, max: 2 },
  { no: 159, label: "賃金支払基礎日数06", kind: 'num', min: 0, max: 2 },
  { no: 160, label: "賃金支払対象期間開始（月）06", kind: 'num', min: 0, max: 2 },
  { no: 161, label: "賃金支払対象期間開始（日）06", kind: 'num', min: 0, max: 2 },
  { no: 162, label: "賃金支払対象期間終了（月）06", kind: 'num', min: 0, max: 2 },
  { no: 163, label: "賃金支払対象期間終了（日）06", kind: 'num', min: 0, max: 2 },
  { no: 164, label: "賃金支払対象期間基礎日数06", kind: 'num', min: 0, max: 2 },
  { no: 165, label: "賃金額Ａ06", kind: 'kanji', min: 0, max: 7 },
  { no: 166, label: "賃金額Ｂ06", kind: 'kanji', min: 0, max: 7 },
  { no: 167, label: "賃金額計06", kind: 'kanji', min: 0, max: 8 },
  { no: 168, label: "賃金支払備考06", kind: 'kanji', min: 0, max: 16 },
  { no: 169, label: "被保険者期間算定対象期間開始（月）07", kind: 'num', min: 0, max: 2 },
  { no: 170, label: "被保険者期間算定対象期間開始（日）07", kind: 'num', min: 0, max: 2 },
  { no: 171, label: "被保険者期間算定対象期間終了（月）07", kind: 'num', min: 0, max: 2 },
  { no: 172, label: "被保険者期間算定対象期間終了（日）07", kind: 'num', min: 0, max: 2 },
  { no: 173, label: "短期雇用特例被保険者（月）07", kind: 'num', min: 0, max: 2 },
  { no: 174, label: "賃金支払基礎日数07", kind: 'num', min: 0, max: 2 },
  { no: 175, label: "賃金支払対象期間開始（月）07", kind: 'num', min: 0, max: 2 },
  { no: 176, label: "賃金支払対象期間開始（日）07", kind: 'num', min: 0, max: 2 },
  { no: 177, label: "賃金支払対象期間終了（月）07", kind: 'num', min: 0, max: 2 },
  { no: 178, label: "賃金支払対象期間終了（日）07", kind: 'num', min: 0, max: 2 },
  { no: 179, label: "賃金支払対象期間基礎日数07", kind: 'num', min: 0, max: 2 },
  { no: 180, label: "賃金額Ａ07", kind: 'kanji', min: 0, max: 7 },
  { no: 181, label: "賃金額Ｂ07", kind: 'kanji', min: 0, max: 7 },
  { no: 182, label: "賃金額計07", kind: 'kanji', min: 0, max: 8 },
  { no: 183, label: "賃金支払備考07", kind: 'kanji', min: 0, max: 16 },
  { no: 184, label: "被保険者期間算定対象期間開始（月）08", kind: 'num', min: 0, max: 2 },
  { no: 185, label: "被保険者期間算定対象期間開始（日）08", kind: 'num', min: 0, max: 2 },
  { no: 186, label: "被保険者期間算定対象期間終了（月）08", kind: 'num', min: 0, max: 2 },
  { no: 187, label: "被保険者期間算定対象期間終了（日）08", kind: 'num', min: 0, max: 2 },
  { no: 188, label: "短期雇用特例被保険者（月）08", kind: 'num', min: 0, max: 2 },
  { no: 189, label: "賃金支払基礎日数08", kind: 'num', min: 0, max: 2 },
  { no: 190, label: "賃金支払対象期間開始（月）08", kind: 'num', min: 0, max: 2 },
  { no: 191, label: "賃金支払対象期間開始（日）08", kind: 'num', min: 0, max: 2 },
  { no: 192, label: "賃金支払対象期間終了（月）08", kind: 'num', min: 0, max: 2 },
  { no: 193, label: "賃金支払対象期間終了（日）08", kind: 'num', min: 0, max: 2 },
  { no: 194, label: "賃金支払対象期間基礎日数08", kind: 'num', min: 0, max: 2 },
  { no: 195, label: "賃金額Ａ08", kind: 'kanji', min: 0, max: 7 },
  { no: 196, label: "賃金額Ｂ08", kind: 'kanji', min: 0, max: 7 },
  { no: 197, label: "賃金額計08", kind: 'kanji', min: 0, max: 8 },
  { no: 198, label: "賃金支払備考08", kind: 'kanji', min: 0, max: 16 },
  { no: 199, label: "被保険者期間算定対象期間開始（月）09", kind: 'num', min: 0, max: 2 },
  { no: 200, label: "被保険者期間算定対象期間開始（日）09", kind: 'num', min: 0, max: 2 },
  { no: 201, label: "被保険者期間算定対象期間終了（月）09", kind: 'num', min: 0, max: 2 },
  { no: 202, label: "被保険者期間算定対象期間終了（日）09", kind: 'num', min: 0, max: 2 },
  { no: 203, label: "短期雇用特例被保険者（月）09", kind: 'num', min: 0, max: 2 },
  { no: 204, label: "賃金支払基礎日数09", kind: 'num', min: 0, max: 2 },
  { no: 205, label: "賃金支払対象期間開始（月）09", kind: 'num', min: 0, max: 2 },
  { no: 206, label: "賃金支払対象期間開始（日）09", kind: 'num', min: 0, max: 2 },
  { no: 207, label: "賃金支払対象期間終了（月）09", kind: 'num', min: 0, max: 2 },
  { no: 208, label: "賃金支払対象期間終了（日）09", kind: 'num', min: 0, max: 2 },
  { no: 209, label: "賃金支払対象期間基礎日数09", kind: 'num', min: 0, max: 2 },
  { no: 210, label: "賃金額Ａ09", kind: 'kanji', min: 0, max: 7 },
  { no: 211, label: "賃金額Ｂ09", kind: 'kanji', min: 0, max: 7 },
  { no: 212, label: "賃金額計09", kind: 'kanji', min: 0, max: 8 },
  { no: 213, label: "賃金支払備考09", kind: 'kanji', min: 0, max: 16 },
  { no: 214, label: "被保険者期間算定対象期間開始（月）10", kind: 'num', min: 0, max: 2 },
  { no: 215, label: "被保険者期間算定対象期間開始（日）10", kind: 'num', min: 0, max: 2 },
  { no: 216, label: "被保険者期間算定対象期間終了（月）10", kind: 'num', min: 0, max: 2 },
  { no: 217, label: "被保険者期間算定対象期間終了（日）10", kind: 'num', min: 0, max: 2 },
  { no: 218, label: "短期雇用特例被保険者（月）10", kind: 'num', min: 0, max: 2 },
  { no: 219, label: "賃金支払基礎日数10", kind: 'num', min: 0, max: 2 },
  { no: 220, label: "賃金支払対象期間開始（月）10", kind: 'num', min: 0, max: 2 },
  { no: 221, label: "賃金支払対象期間開始（日）10", kind: 'num', min: 0, max: 2 },
  { no: 222, label: "賃金支払対象期間終了（月）10", kind: 'num', min: 0, max: 2 },
  { no: 223, label: "賃金支払対象期間終了（日）10", kind: 'num', min: 0, max: 2 },
  { no: 224, label: "賃金支払対象期間基礎日数10", kind: 'num', min: 0, max: 2 },
  { no: 225, label: "賃金額Ａ10", kind: 'kanji', min: 0, max: 7 },
  { no: 226, label: "賃金額Ｂ10", kind: 'kanji', min: 0, max: 7 },
  { no: 227, label: "賃金額計10", kind: 'kanji', min: 0, max: 8 },
  { no: 228, label: "賃金支払備考10", kind: 'kanji', min: 0, max: 16 },
  { no: 229, label: "被保険者期間算定対象期間開始（月）11", kind: 'num', min: 0, max: 2 },
  { no: 230, label: "被保険者期間算定対象期間開始（日）11", kind: 'num', min: 0, max: 2 },
  { no: 231, label: "被保険者期間算定対象期間終了（月）11", kind: 'num', min: 0, max: 2 },
  { no: 232, label: "被保険者期間算定対象期間終了（日）11", kind: 'num', min: 0, max: 2 },
  { no: 233, label: "短期雇用特例被保険者（月）11", kind: 'num', min: 0, max: 2 },
  { no: 234, label: "賃金支払基礎日数11", kind: 'num', min: 0, max: 2 },
  { no: 235, label: "賃金支払対象期間開始（月）11", kind: 'num', min: 0, max: 2 },
  { no: 236, label: "賃金支払対象期間開始（日）11", kind: 'num', min: 0, max: 2 },
  { no: 237, label: "賃金支払対象期間終了（月）11", kind: 'num', min: 0, max: 2 },
  { no: 238, label: "賃金支払対象期間終了（日）11", kind: 'num', min: 0, max: 2 },
  { no: 239, label: "賃金支払対象期間基礎日数11", kind: 'num', min: 0, max: 2 },
  { no: 240, label: "賃金額Ａ11", kind: 'kanji', min: 0, max: 7 },
  { no: 241, label: "賃金額Ｂ11", kind: 'kanji', min: 0, max: 7 },
  { no: 242, label: "賃金額計11", kind: 'kanji', min: 0, max: 8 },
  { no: 243, label: "賃金支払備考11", kind: 'kanji', min: 0, max: 16 },
  { no: 244, label: "被保険者期間算定対象期間開始（月）12", kind: 'num', min: 0, max: 2 },
  { no: 245, label: "被保険者期間算定対象期間開始（日）12", kind: 'num', min: 0, max: 2 },
  { no: 246, label: "被保険者期間算定対象期間終了（月）12", kind: 'num', min: 0, max: 2 },
  { no: 247, label: "被保険者期間算定対象期間終了（日）12", kind: 'num', min: 0, max: 2 },
  { no: 248, label: "短期雇用特例被保険者（月）12", kind: 'num', min: 0, max: 2 },
  { no: 249, label: "賃金支払基礎日数12", kind: 'num', min: 0, max: 2 },
  { no: 250, label: "賃金支払対象期間開始（月）12", kind: 'num', min: 0, max: 2 },
  { no: 251, label: "賃金支払対象期間開始（日）12", kind: 'num', min: 0, max: 2 },
  { no: 252, label: "賃金支払対象期間終了（月）12", kind: 'num', min: 0, max: 2 },
  { no: 253, label: "賃金支払対象期間終了（日）12", kind: 'num', min: 0, max: 2 },
  { no: 254, label: "賃金支払対象期間基礎日数12", kind: 'num', min: 0, max: 2 },
  { no: 255, label: "賃金額Ａ12", kind: 'kanji', min: 0, max: 7 },
  { no: 256, label: "賃金額Ｂ12", kind: 'kanji', min: 0, max: 7 },
  { no: 257, label: "賃金額計12", kind: 'kanji', min: 0, max: 8 },
  { no: 258, label: "賃金支払備考12", kind: 'kanji', min: 0, max: 16 },
  { no: 259, label: "被保険者期間算定対象期間開始（月）13", kind: 'num', min: 0, max: 2 },
  { no: 260, label: "被保険者期間算定対象期間開始（日）13", kind: 'num', min: 0, max: 2 },
  { no: 261, label: "被保険者期間算定対象期間終了（月）13", kind: 'num', min: 0, max: 2 },
  { no: 262, label: "被保険者期間算定対象期間終了（日）13", kind: 'num', min: 0, max: 2 },
  { no: 263, label: "短期雇用特例被保険者（月）13", kind: 'num', min: 0, max: 2 },
  { no: 264, label: "賃金支払基礎日数13", kind: 'num', min: 0, max: 2 },
  { no: 265, label: "賃金支払対象期間開始（月）13", kind: 'num', min: 0, max: 2 },
  { no: 266, label: "賃金支払対象期間開始（日）13", kind: 'num', min: 0, max: 2 },
  { no: 267, label: "賃金支払対象期間終了（月）13", kind: 'num', min: 0, max: 2 },
  { no: 268, label: "賃金支払対象期間終了（日）13", kind: 'num', min: 0, max: 2 },
  { no: 269, label: "賃金支払対象期間基礎日数13", kind: 'num', min: 0, max: 2 },
  { no: 270, label: "賃金額Ａ13", kind: 'kanji', min: 0, max: 7 },
  { no: 271, label: "賃金額Ｂ13", kind: 'kanji', min: 0, max: 7 },
  { no: 272, label: "賃金額計13", kind: 'kanji', min: 0, max: 8 },
  { no: 273, label: "賃金支払備考13", kind: 'kanji', min: 0, max: 16 },
  { no: 274, label: "被保険者期間算定対象期間開始（月）14", kind: 'num', min: 0, max: 2 },
  { no: 275, label: "被保険者期間算定対象期間開始（日）14", kind: 'num', min: 0, max: 2 },
  { no: 276, label: "被保険者期間算定対象期間終了（月）14", kind: 'num', min: 0, max: 2 },
  { no: 277, label: "被保険者期間算定対象期間終了（日）14", kind: 'num', min: 0, max: 2 },
  { no: 278, label: "短期雇用特例被保険者（月）14", kind: 'num', min: 0, max: 2 },
  { no: 279, label: "賃金支払基礎日数14", kind: 'num', min: 0, max: 2 },
  { no: 280, label: "賃金支払対象期間開始（月）14", kind: 'num', min: 0, max: 2 },
  { no: 281, label: "賃金支払対象期間開始（日）14", kind: 'num', min: 0, max: 2 },
  { no: 282, label: "賃金支払対象期間終了（月）14", kind: 'num', min: 0, max: 2 },
  { no: 283, label: "賃金支払対象期間終了（日）14", kind: 'num', min: 0, max: 2 },
  { no: 284, label: "賃金支払対象期間基礎日数14", kind: 'num', min: 0, max: 2 },
  { no: 285, label: "賃金額Ａ14", kind: 'kanji', min: 0, max: 7 },
  { no: 286, label: "賃金額Ｂ14", kind: 'kanji', min: 0, max: 7 },
  { no: 287, label: "賃金額計14", kind: 'kanji', min: 0, max: 8 },
  { no: 288, label: "賃金支払備考14", kind: 'kanji', min: 0, max: 16 },
  { no: 289, label: "被保険者期間算定対象期間開始（月）15", kind: 'num', min: 0, max: 2 },
  { no: 290, label: "被保険者期間算定対象期間開始（日）15", kind: 'num', min: 0, max: 2 },
  { no: 291, label: "被保険者期間算定対象期間終了（月）15", kind: 'num', min: 0, max: 2 },
  { no: 292, label: "被保険者期間算定対象期間終了（日）15", kind: 'num', min: 0, max: 2 },
  { no: 293, label: "短期雇用特例被保険者（月）15", kind: 'num', min: 0, max: 2 },
  { no: 294, label: "賃金支払基礎日数15", kind: 'num', min: 0, max: 2 },
  { no: 295, label: "賃金支払対象期間開始（月）15", kind: 'num', min: 0, max: 2 },
  { no: 296, label: "賃金支払対象期間開始（日）15", kind: 'num', min: 0, max: 2 },
  { no: 297, label: "賃金支払対象期間終了（月）15", kind: 'num', min: 0, max: 2 },
  { no: 298, label: "賃金支払対象期間終了（日）15", kind: 'num', min: 0, max: 2 },
  { no: 299, label: "賃金支払対象期間基礎日数15", kind: 'num', min: 0, max: 2 },
  { no: 300, label: "賃金額Ａ15", kind: 'kanji', min: 0, max: 7 },
  { no: 301, label: "賃金額Ｂ15", kind: 'kanji', min: 0, max: 7 },
  { no: 302, label: "賃金額計15", kind: 'kanji', min: 0, max: 8 },
  { no: 303, label: "賃金支払備考15", kind: 'kanji', min: 0, max: 16 },
  { no: 304, label: "被保険者期間算定対象期間開始（月）16", kind: 'num', min: 0, max: 2 },
  { no: 305, label: "被保険者期間算定対象期間開始（日）16", kind: 'num', min: 0, max: 2 },
  { no: 306, label: "被保険者期間算定対象期間終了（月）16", kind: 'num', min: 0, max: 2 },
  { no: 307, label: "被保険者期間算定対象期間終了（日）16", kind: 'num', min: 0, max: 2 },
  { no: 308, label: "短期雇用特例被保険者（月）16", kind: 'num', min: 0, max: 2 },
  { no: 309, label: "賃金支払基礎日数16", kind: 'num', min: 0, max: 2 },
  { no: 310, label: "賃金支払対象期間開始（月）16", kind: 'num', min: 0, max: 2 },
  { no: 311, label: "賃金支払対象期間開始（日）16", kind: 'num', min: 0, max: 2 },
  { no: 312, label: "賃金支払対象期間終了（月）16", kind: 'num', min: 0, max: 2 },
  { no: 313, label: "賃金支払対象期間終了（日）16", kind: 'num', min: 0, max: 2 },
  { no: 314, label: "賃金支払対象期間基礎日数16", kind: 'num', min: 0, max: 2 },
  { no: 315, label: "賃金額Ａ16", kind: 'kanji', min: 0, max: 7 },
  { no: 316, label: "賃金額Ｂ16", kind: 'kanji', min: 0, max: 7 },
  { no: 317, label: "賃金額計16", kind: 'kanji', min: 0, max: 8 },
  { no: 318, label: "賃金支払備考16", kind: 'kanji', min: 0, max: 16 },
  { no: 319, label: "被保険者期間算定対象期間開始（月）17", kind: 'num', min: 0, max: 2 },
  { no: 320, label: "被保険者期間算定対象期間開始（日）17", kind: 'num', min: 0, max: 2 },
  { no: 321, label: "被保険者期間算定対象期間終了（月）17", kind: 'num', min: 0, max: 2 },
  { no: 322, label: "被保険者期間算定対象期間終了（日）17", kind: 'num', min: 0, max: 2 },
  { no: 323, label: "短期雇用特例被保険者（月）17", kind: 'num', min: 0, max: 2 },
  { no: 324, label: "賃金支払基礎日数17", kind: 'num', min: 0, max: 2 },
  { no: 325, label: "賃金支払対象期間開始（月）17", kind: 'num', min: 0, max: 2 },
  { no: 326, label: "賃金支払対象期間開始（日）17", kind: 'num', min: 0, max: 2 },
  { no: 327, label: "賃金支払対象期間終了（月）17", kind: 'num', min: 0, max: 2 },
  { no: 328, label: "賃金支払対象期間終了（日）17", kind: 'num', min: 0, max: 2 },
  { no: 329, label: "賃金支払対象期間基礎日数17", kind: 'num', min: 0, max: 2 },
  { no: 330, label: "賃金額Ａ17", kind: 'kanji', min: 0, max: 7 },
  { no: 331, label: "賃金額Ｂ17", kind: 'kanji', min: 0, max: 7 },
  { no: 332, label: "賃金額計17", kind: 'kanji', min: 0, max: 8 },
  { no: 333, label: "賃金支払備考17", kind: 'kanji', min: 0, max: 16 },
  { no: 334, label: "被保険者期間算定対象期間開始（月）18", kind: 'num', min: 0, max: 2 },
  { no: 335, label: "被保険者期間算定対象期間開始（日）18", kind: 'num', min: 0, max: 2 },
  { no: 336, label: "被保険者期間算定対象期間終了（月）18", kind: 'num', min: 0, max: 2 },
  { no: 337, label: "被保険者期間算定対象期間終了（日）18", kind: 'num', min: 0, max: 2 },
  { no: 338, label: "短期雇用特例被保険者（月）18", kind: 'num', min: 0, max: 2 },
  { no: 339, label: "賃金支払基礎日数18", kind: 'num', min: 0, max: 2 },
  { no: 340, label: "賃金支払対象期間開始（月）18", kind: 'num', min: 0, max: 2 },
  { no: 341, label: "賃金支払対象期間開始（日）18", kind: 'num', min: 0, max: 2 },
  { no: 342, label: "賃金支払対象期間終了（月）18", kind: 'num', min: 0, max: 2 },
  { no: 343, label: "賃金支払対象期間終了（日）18", kind: 'num', min: 0, max: 2 },
  { no: 344, label: "賃金支払対象期間基礎日数18", kind: 'num', min: 0, max: 2 },
  { no: 345, label: "賃金額Ａ18", kind: 'kanji', min: 0, max: 7 },
  { no: 346, label: "賃金額Ｂ18", kind: 'kanji', min: 0, max: 7 },
  { no: 347, label: "賃金額計18", kind: 'kanji', min: 0, max: 8 },
  { no: 348, label: "賃金支払備考18", kind: 'kanji', min: 0, max: 16 },
  { no: 349, label: "被保険者期間算定対象期間開始（月）19", kind: 'num', min: 0, max: 2 },
  { no: 350, label: "被保険者期間算定対象期間開始（日）19", kind: 'num', min: 0, max: 2 },
  { no: 351, label: "被保険者期間算定対象期間終了（月）19", kind: 'num', min: 0, max: 2 },
  { no: 352, label: "被保険者期間算定対象期間終了（日）19", kind: 'num', min: 0, max: 2 },
  { no: 353, label: "短期雇用特例被保険者（月）19", kind: 'num', min: 0, max: 2 },
  { no: 354, label: "賃金支払基礎日数19", kind: 'num', min: 0, max: 2 },
  { no: 355, label: "賃金支払対象期間開始（月）19", kind: 'num', min: 0, max: 2 },
  { no: 356, label: "賃金支払対象期間開始（日）19", kind: 'num', min: 0, max: 2 },
  { no: 357, label: "賃金支払対象期間終了（月）19", kind: 'num', min: 0, max: 2 },
  { no: 358, label: "賃金支払対象期間終了（日）19", kind: 'num', min: 0, max: 2 },
  { no: 359, label: "賃金支払対象期間基礎日数19", kind: 'num', min: 0, max: 2 },
  { no: 360, label: "賃金額Ａ19", kind: 'kanji', min: 0, max: 7 },
  { no: 361, label: "賃金額Ｂ19", kind: 'kanji', min: 0, max: 7 },
  { no: 362, label: "賃金額計19", kind: 'kanji', min: 0, max: 8 },
  { no: 363, label: "賃金支払備考19", kind: 'kanji', min: 0, max: 16 },
  { no: 364, label: "被保険者期間算定対象期間開始（月）20", kind: 'num', min: 0, max: 2 },
  { no: 365, label: "被保険者期間算定対象期間開始（日）20", kind: 'num', min: 0, max: 2 },
  { no: 366, label: "被保険者期間算定対象期間終了（月）20", kind: 'num', min: 0, max: 2 },
  { no: 367, label: "被保険者期間算定対象期間終了（日）20", kind: 'num', min: 0, max: 2 },
  { no: 368, label: "短期雇用特例被保険者（月）20", kind: 'num', min: 0, max: 2 },
  { no: 369, label: "賃金支払基礎日数20", kind: 'num', min: 0, max: 2 },
  { no: 370, label: "賃金支払対象期間開始（月）20", kind: 'num', min: 0, max: 2 },
  { no: 371, label: "賃金支払対象期間開始（日）20", kind: 'num', min: 0, max: 2 },
  { no: 372, label: "賃金支払対象期間終了（月）20", kind: 'num', min: 0, max: 2 },
  { no: 373, label: "賃金支払対象期間終了（日）20", kind: 'num', min: 0, max: 2 },
  { no: 374, label: "賃金支払対象期間基礎日数20", kind: 'num', min: 0, max: 2 },
  { no: 375, label: "賃金額Ａ20", kind: 'kanji', min: 0, max: 7 },
  { no: 376, label: "賃金額Ｂ20", kind: 'kanji', min: 0, max: 7 },
  { no: 377, label: "賃金額計20", kind: 'kanji', min: 0, max: 8 },
  { no: 378, label: "賃金支払備考20", kind: 'kanji', min: 0, max: 16 },
  { no: 379, label: "被保険者期間算定対象期間開始（月）21", kind: 'num', min: 0, max: 2 },
  { no: 380, label: "被保険者期間算定対象期間開始（日）21", kind: 'num', min: 0, max: 2 },
  { no: 381, label: "被保険者期間算定対象期間終了（月）21", kind: 'num', min: 0, max: 2 },
  { no: 382, label: "被保険者期間算定対象期間終了（日）21", kind: 'num', min: 0, max: 2 },
  { no: 383, label: "短期雇用特例被保険者（月）21", kind: 'num', min: 0, max: 2 },
  { no: 384, label: "賃金支払基礎日数21", kind: 'num', min: 0, max: 2 },
  { no: 385, label: "賃金支払対象期間開始（月）21", kind: 'num', min: 0, max: 2 },
  { no: 386, label: "賃金支払対象期間開始（日）21", kind: 'num', min: 0, max: 2 },
  { no: 387, label: "賃金支払対象期間終了（月）21", kind: 'num', min: 0, max: 2 },
  { no: 388, label: "賃金支払対象期間終了（日）21", kind: 'num', min: 0, max: 2 },
  { no: 389, label: "賃金支払対象期間基礎日数21", kind: 'num', min: 0, max: 2 },
  { no: 390, label: "賃金額Ａ21", kind: 'kanji', min: 0, max: 7 },
  { no: 391, label: "賃金額Ｂ21", kind: 'kanji', min: 0, max: 7 },
  { no: 392, label: "賃金額計21", kind: 'kanji', min: 0, max: 8 },
  { no: 393, label: "賃金支払備考21", kind: 'kanji', min: 0, max: 16 },
  { no: 394, label: "被保険者期間算定対象期間開始（月）22", kind: 'num', min: 0, max: 2 },
  { no: 395, label: "被保険者期間算定対象期間開始（日）22", kind: 'num', min: 0, max: 2 },
  { no: 396, label: "被保険者期間算定対象期間終了（月）22", kind: 'num', min: 0, max: 2 },
  { no: 397, label: "被保険者期間算定対象期間終了（日）22", kind: 'num', min: 0, max: 2 },
  { no: 398, label: "短期雇用特例被保険者（月）22", kind: 'num', min: 0, max: 2 },
  { no: 399, label: "賃金支払基礎日数22", kind: 'num', min: 0, max: 2 },
  { no: 400, label: "賃金支払対象期間開始（月）22", kind: 'num', min: 0, max: 2 },
  { no: 401, label: "賃金支払対象期間開始（日）22", kind: 'num', min: 0, max: 2 },
  { no: 402, label: "賃金支払対象期間終了（月）22", kind: 'num', min: 0, max: 2 },
  { no: 403, label: "賃金支払対象期間終了（日）22", kind: 'num', min: 0, max: 2 },
  { no: 404, label: "賃金支払対象期間基礎日数22", kind: 'num', min: 0, max: 2 },
  { no: 405, label: "賃金額Ａ22", kind: 'kanji', min: 0, max: 7 },
  { no: 406, label: "賃金額Ｂ22", kind: 'kanji', min: 0, max: 7 },
  { no: 407, label: "賃金額計22", kind: 'kanji', min: 0, max: 8 },
  { no: 408, label: "賃金支払備考22", kind: 'kanji', min: 0, max: 16 },
  { no: 409, label: "被保険者期間算定対象期間開始（月）23", kind: 'num', min: 0, max: 2 },
  { no: 410, label: "被保険者期間算定対象期間開始（日）23", kind: 'num', min: 0, max: 2 },
  { no: 411, label: "被保険者期間算定対象期間終了（月）23", kind: 'num', min: 0, max: 2 },
  { no: 412, label: "被保険者期間算定対象期間終了（日）23", kind: 'num', min: 0, max: 2 },
  { no: 413, label: "短期雇用特例被保険者（月）23", kind: 'num', min: 0, max: 2 },
  { no: 414, label: "賃金支払基礎日数23", kind: 'num', min: 0, max: 2 },
  { no: 415, label: "賃金支払対象期間開始（月）23", kind: 'num', min: 0, max: 2 },
  { no: 416, label: "賃金支払対象期間開始（日）23", kind: 'num', min: 0, max: 2 },
  { no: 417, label: "賃金支払対象期間終了（月）23", kind: 'num', min: 0, max: 2 },
  { no: 418, label: "賃金支払対象期間終了（日）23", kind: 'num', min: 0, max: 2 },
  { no: 419, label: "賃金支払対象期間基礎日数23", kind: 'num', min: 0, max: 2 },
  { no: 420, label: "賃金額Ａ23", kind: 'kanji', min: 0, max: 7 },
  { no: 421, label: "賃金額Ｂ23", kind: 'kanji', min: 0, max: 7 },
  { no: 422, label: "賃金額計23", kind: 'kanji', min: 0, max: 8 },
  { no: 423, label: "賃金支払備考23", kind: 'kanji', min: 0, max: 16 },
  { no: 424, label: "被保険者期間算定対象期間開始（月）24", kind: 'num', min: 0, max: 2 },
  { no: 425, label: "被保険者期間算定対象期間開始（日）24", kind: 'num', min: 0, max: 2 },
  { no: 426, label: "被保険者期間算定対象期間終了（月）24", kind: 'num', min: 0, max: 2 },
  { no: 427, label: "被保険者期間算定対象期間終了（日）24", kind: 'num', min: 0, max: 2 },
  { no: 428, label: "短期雇用特例被保険者（月）24", kind: 'num', min: 0, max: 2 },
  { no: 429, label: "賃金支払基礎日数24", kind: 'num', min: 0, max: 2 },
  { no: 430, label: "賃金支払対象期間開始（月）24", kind: 'num', min: 0, max: 2 },
  { no: 431, label: "賃金支払対象期間開始（日）24", kind: 'num', min: 0, max: 2 },
  { no: 432, label: "賃金支払対象期間終了（月）24", kind: 'num', min: 0, max: 2 },
  { no: 433, label: "賃金支払対象期間終了（日）24", kind: 'num', min: 0, max: 2 },
  { no: 434, label: "賃金支払対象期間基礎日数24", kind: 'num', min: 0, max: 2 },
  { no: 435, label: "賃金額Ａ24", kind: 'kanji', min: 0, max: 7 },
  { no: 436, label: "賃金額Ｂ24", kind: 'kanji', min: 0, max: 7 },
  { no: 437, label: "賃金額計24", kind: 'kanji', min: 0, max: 8 },
  { no: 438, label: "賃金支払備考24", kind: 'kanji', min: 0, max: 16 },
  { no: 439, label: "被保険者期間算定対象期間開始（月）25", kind: 'num', min: 0, max: 2 },
  { no: 440, label: "被保険者期間算定対象期間開始（日）25", kind: 'num', min: 0, max: 2 },
  { no: 441, label: "被保険者期間算定対象期間終了（月）25", kind: 'num', min: 0, max: 2 },
  { no: 442, label: "被保険者期間算定対象期間終了（日）25", kind: 'num', min: 0, max: 2 },
  { no: 443, label: "短期雇用特例被保険者（月）25", kind: 'num', min: 0, max: 2 },
  { no: 444, label: "賃金支払基礎日数25", kind: 'num', min: 0, max: 2 },
  { no: 445, label: "賃金支払対象期間開始（月）25", kind: 'num', min: 0, max: 2 },
  { no: 446, label: "賃金支払対象期間開始（日）25", kind: 'num', min: 0, max: 2 },
  { no: 447, label: "賃金支払対象期間終了（月）25", kind: 'num', min: 0, max: 2 },
  { no: 448, label: "賃金支払対象期間終了（日）25", kind: 'num', min: 0, max: 2 },
  { no: 449, label: "賃金支払対象期間基礎日数25", kind: 'num', min: 0, max: 2 },
  { no: 450, label: "賃金額Ａ25", kind: 'kanji', min: 0, max: 7 },
  { no: 451, label: "賃金額Ｂ25", kind: 'kanji', min: 0, max: 7 },
  { no: 452, label: "賃金額計25", kind: 'kanji', min: 0, max: 8 },
  { no: 453, label: "賃金支払備考25", kind: 'kanji', min: 0, max: 16 },
  { no: 454, label: "賃金に関する特記事項", kind: 'kanji', min: 0, max: 140 },
  { no: 455, label: "賃金に関する特記事項（続紙用）", kind: 'kanji', min: 0, max: 140 },
  { no: 456, label: "離職者署名（記載内容相違）", kind: 'kanji', min: 0, max: 20 },
  { no: 457, label: "作成年月日（元号）", kind: 'kanji', min: 0, max: 2 },
  { no: 458, label: "作成年月日（年）", kind: 'num', min: 0, max: 2 },
  { no: 459, label: "作成年月日（月）", kind: 'num', min: 0, max: 2 },
  { no: 460, label: "作成年月日（日）", kind: 'num', min: 0, max: 2 },
  { no: 461, label: "提出代行者・事務代理者の表示", kind: 'kanji', min: 0, max: 12 },
  { no: 462, label: "社会保険労務士氏名", kind: 'kanji', min: 0, max: 30 },
  { no: 463, label: "社会保険労務士電話番号（市外局番）", kind: 'num', min: 0, max: 5 },
  { no: 464, label: "社会保険労務士電話番号（市内局番）", kind: 'num', min: 0, max: 5 },
  { no: 465, label: "社会保険労務士電話番号（加入者番号）", kind: 'num', min: 0, max: 5 },
  { no: 466, label: "社労士付記欄", kind: 'kanji', min: 0, max: 250 },
  { no: 467, label: "社労士付記欄（続紙）", kind: 'kanji', min: 0, max: 250 },
  { no: 468, label: "選択１－１", kind: 'num', min: 1, max: 1 },
  { no: 469, label: "選択１－２", kind: 'num', min: 1, max: 1 },
  { no: 470, label: "選択２", kind: 'num', min: 1, max: 1 },
  { no: 471, label: "選択３－１", kind: 'num', min: 1, max: 1 },
  { no: 472, label: "選択３－２", kind: 'num', min: 1, max: 1 },
  { no: 473, label: "選択３－３", kind: 'num', min: 1, max: 1 },
  { no: 474, label: "選択３－４", kind: 'num', min: 1, max: 1 },
  { no: 475, label: "選択４－１", kind: 'num', min: 1, max: 1 },
  { no: 476, label: "選択４－２", kind: 'num', min: 1, max: 1 },
  { no: 477, label: "選択４－３－１", kind: 'num', min: 1, max: 1 },
  { no: 478, label: "選択４－３－２", kind: 'num', min: 1, max: 1 },
  { no: 479, label: "選択５－１－１", kind: 'num', min: 1, max: 1 },
  { no: 480, label: "選択５－１－２", kind: 'num', min: 1, max: 1 },
  { no: 481, label: "選択５－１－３", kind: 'num', min: 1, max: 1 },
  { no: 482, label: "選択５－１－４", kind: 'num', min: 1, max: 1 },
  { no: 483, label: "選択５－１－５", kind: 'num', min: 1, max: 1 },
  { no: 484, label: "選択５－１－６", kind: 'num', min: 1, max: 1 },
  { no: 485, label: "選択５－１－７", kind: 'num', min: 1, max: 1 },
  { no: 486, label: "選択５－２", kind: 'num', min: 1, max: 1 },
  { no: 487, label: "選択６", kind: 'num', min: 1, max: 1 },
  { no: 488, label: "選択２（定年年齢）", kind: 'num', min: 0, max: 2 },
  { no: 489, label: "選択２（定年後の継続雇用）", kind: 'num', min: 0, max: 1 },
  { no: 490, label: "選択２（継続雇用の事由）", kind: 'num', min: 0, max: 1 },
  { no: 491, label: "選択２（具体的理由）", kind: 'kanji', min: 0, max: 34 },
  { no: 492, label: "選択３－１（１回の契約期間）", kind: 'num', min: 0, max: 3 },
  { no: 493, label: "選択３－１（通算契約期間）", kind: 'num', min: 0, max: 3 },
  { no: 494, label: "選択３－１（契約更新回数）", kind: 'num', min: 0, max: 3 },
  { no: 495, label: "選択３－１（上限短縮による離職）", kind: 'num', min: 0, max: 1 },
  { no: 496, label: "選択３－１（規定上限による離職）", kind: 'num', min: 0, max: 1 },
  { no: 497, label: "選択３－１（雇用期限による離職）", kind: 'num', min: 0, max: 1 },
  { no: 498, label: "選択３－１（通算契約期間の上限による離職）", kind: 'num', min: 0, max: 1 },
  { no: 499, label: "選択３－１（上限の定めの有無）", kind: 'num', min: 0, max: 1 },
  { no: 500, label: "選択３－２（労働者種別）", kind: 'num', min: 0, max: 1 },
  { no: 501, label: "選択３－２－１（１回の契約期間）", kind: 'num', min: 0, max: 3 },
  { no: 502, label: "選択３－２－１（通算契約期間）", kind: 'num', min: 0, max: 3 },
  { no: 503, label: "選択３－２－１（契約更新回数）", kind: 'num', min: 0, max: 3 },
  { no: 504, label: "選択３－２－１（確約合意の有無）", kind: 'num', min: 0, max: 1 },
  { no: 505, label: "選択３－２－１（明示の有無）", kind: 'num', min: 0, max: 1 },
  { no: 506, label: "選択３－２－１（雇止め通知の有無）", kind: 'num', min: 0, max: 1 },
  { no: 507, label: "選択３－２－１（不更新条項の追加の有無）", kind: 'num', min: 0, max: 1 },
  { no: 508, label: "選択３－２－１（労働者からの申出）", kind: 'num', min: 0, max: 1 },
  { no: 509, label: "選択３－２－２（１回の契約期間）", kind: 'num', min: 0, max: 3 },
  { no: 510, label: "選択３－２－２（通算契約期間）", kind: 'num', min: 0, max: 3 },
  { no: 511, label: "選択３－２－２（契約更新回数）", kind: 'num', min: 0, max: 3 },
  { no: 512, label: "選択３－２－２（確約合意の有無）", kind: 'num', min: 0, max: 1 },
  { no: 513, label: "選択３－２－２（明示の有無）", kind: 'num', min: 0, max: 1 },
  { no: 514, label: "選択３－２－２（労働者からの申出）", kind: 'num', min: 0, max: 1 },
  { no: 515, label: "選択３－２－２（派遣就業指示の選択）", kind: 'num', min: 0, max: 1 },
  { no: 516, label: "選択４－３－２（具体的理由）", kind: 'kanji', min: 0, max: 33 },
  { no: 517, label: "選択５－１－５（教育訓練の有無）", kind: 'num', min: 0, max: 1 },
  { no: 518, label: "選択５－１－６（所在地）", kind: 'kanji', min: 0, max: 13 },
  { no: 519, label: "選択５－１－７（具体的理由）", kind: 'kanji', min: 0, max: 32 },
  { no: 520, label: "選択６（具体的理由）", kind: 'kanji', min: 0, max: 37 },
  { no: 521, label: "具体的事情記載欄", kind: 'kanji', min: 0, max: 110 },
  { no: 522, label: "異議の有無", kind: 'num', min: 0, max: 1 },
  { no: 523, label: "離職者署名", kind: 'kanji', min: 0, max: 15 },
  { no: 524, label: "申請者用自由入力欄", kind: 'num', min: 0, max: 20 },
];

// ---- 期間の自動計算 ----

export function lastDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/** 'YYYY-MM-DD' に月を足し引きする。日が無い月は月末に寄せる */
export function addMonthsClamped(iso: string, delta: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return '';
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const total = (y * 12 + (mo - 1)) + delta;
  const ny = Math.floor(total / 12), nm = (total % 12) + 1;
  const nd = Math.min(d, lastDayOfMonth(ny, nm));
  return `${ny}-${pad2(nm)}-${pad2(nd)}`;
}

export function addDays(iso: string, delta: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return '';
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + delta);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export type WageRow = {
  /** 被保険者期間算定対象期間（離職日の翌日から1か月ずつさかのぼる） */
  periodStart: string;
  periodEnd: string;
  /** 賃金支払基礎日数 */
  baseDays: number | null;
  /** 賃金支払対象期間（賃金の締切期間） */
  payStart: string;
  payEnd: string;
  payBaseDays: number | null;
  /** 賃金額。月によって決まる賃金はＡ、日や時間で決まる賃金はＢ */
  wageA: number | null;
  wageB: number | null;
  note: string;
};

export const EMPTY_WAGE_ROW: WageRow = {
  periodStart: '', periodEnd: '', baseDays: null,
  payStart: '', payEnd: '', payBaseDays: null,
  wageA: null, wageB: null, note: '',
};

/**
 * 離職日から、賃金の欄の期間をうめます。
 *
 * 被保険者期間算定対象期間は、離職日の翌日から1か月ずつさかのぼります。
 *   例）離職日が6月12日 → 1行目は5月13日〜6月12日、2行目は4月13日〜5月12日
 *   その日が無い月（31日など）は、その月の末日に寄せます。
 *
 * 賃金支払対象期間は、賃金の締切日で区切ります。closingDay に 0 を渡すと
 * 月末締めになります（御社は当月末締め）。
 *   例）離職日が6月12日・月末締め → 1行目は6月1日〜6月12日、2行目は5月1日〜5月31日
 */
export function wagePeriodsFor(leaveDate: string, rows = 13, closingDay = 0): WageRow[] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(leaveDate || ''));
  if (!m) return [];
  const next = addDays(leaveDate, 1);
  const out: WageRow[] = [];
  const n = Math.min(HW_WAGE_ROWS, Math.max(1, rows));
  for (let i = 1; i <= n; i++) {
    const start = addMonthsClamped(next, -i);
    const end = i === 1 ? leaveDate : addDays(addMonthsClamped(next, -(i - 1)), -1);
    // 賃金の締切期間
    let payStart = '', payEnd = '';
    if (closingDay === 0) {
      const y = Number(m[1]), mo = Number(m[2]);
      const t = y * 12 + (mo - 1) - (i - 1);
      const py = Math.floor(t / 12), pm = (t % 12) + 1;
      payStart = `${py}-${pad2(pm)}-01`;
      payEnd = i === 1 ? leaveDate : `${py}-${pad2(pm)}-${pad2(lastDayOfMonth(py, pm))}`;
    }
    out.push({ ...EMPTY_WAGE_ROW, periodStart: start, periodEnd: end, payStart, payEnd });
  }
  return out;
}

/** 'YYYY-MM-DD' の月・日を、前0を付けた2文字で返す */
function mmdd(iso: string): [string, string] {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  return m ? [m[1], m[2]] : ['', ''];
}
const amount = (v: number | null | undefined) =>
  (v == null || !Number.isFinite(Number(v)) || Number(v) < 0) ? '' : String(Math.round(Number(v)));
const count = (v: number | null | undefined) =>
  (v == null || !Number.isFinite(Number(v)) || Number(v) < 0) ? '' : pad2(Math.round(Number(v)));

/** 離職理由（仕様書 ４.１.７ 項番468〜487、離職証明書⑦欄） */
export const HW_RISHOKU_REASONS = [
  { key: '1-1', field: '選択１－１', group: '1 事業所の倒産等によるもの', label: '(1) 倒産手続開始、手形取引停止による離職' },
  { key: '1-2', field: '選択１－２', group: '1 事業所の倒産等によるもの', label: '(2) 事業所の廃止又は事業活動停止後事業再開の見込みがないため離職' },
  { key: '2', field: '選択２', group: '2 定年によるもの', label: '定年による離職' },
  { key: '3-1', field: '選択３－１', group: '3 労働契約期間満了等によるもの', label: '(1) 採用又は定年後の再雇用時等にあらかじめ定められた雇用期限到来による離職' },
  { key: '3-2', field: '選択３－２', group: '3 労働契約期間満了等によるもの', label: '(2) 労働契約期間満了による離職' },
  { key: '3-3', field: '選択３－３', group: '3 労働契約期間満了等によるもの', label: '(3) 早期退職優遇制度、選択定年制度等により離職' },
  { key: '3-4', field: '選択３－４', group: '3 労働契約期間満了等によるもの', label: '(4) 移籍出向' },
  { key: '4-1', field: '選択４－１', group: '4 事業主からの働きかけによるもの', label: '(1) 解雇（重責解雇を除く。）' },
  { key: '4-2', field: '選択４－２', group: '4 事業主からの働きかけによるもの', label: '(2) 重責解雇（労働者の責めに帰すべき重大な理由による解雇）' },
  { key: '4-3-1', field: '選択４－３－１', group: '4 事業主からの働きかけによるもの', label: '(3)① 希望退職の募集又は退職勧奨（事業の縮小又は一部休廃止に伴う人員整理）' },
  { key: '4-3-2', field: '選択４－３－２', group: '4 事業主からの働きかけによるもの', label: '(3)② 希望退職の募集又は退職勧奨（その他）' },
  { key: '5-1-1', field: '選択５－１－１', group: '5 労働者の判断によるもの', label: '(1)① 労働条件に係る問題（賃金低下、賃金遅配、時間外労働、採用条件との相違等）があったと労働者が判断したため' },
  { key: '5-1-2', field: '選択５－１－２', group: '5 労働者の判断によるもの', label: '(1)② 事業主又は他の労働者から就業環境が著しく害されるような言動（故意の排斥、嫌がらせ等）を受けたと労働者が判断したため' },
  { key: '5-1-3', field: '選択５－１－３', group: '5 労働者の判断によるもの', label: '(1)③ 妊娠、出産、育児休業、介護休業等に係る問題があったと労働者が判断したため' },
  { key: '5-1-4', field: '選択５－１－４', group: '5 労働者の判断によるもの', label: '(1)④ 事業所での大規模な人員整理があったことを考慮した離職' },
  { key: '5-1-5', field: '選択５－１－５', group: '5 労働者の判断によるもの', label: '(1)⑤ 職種転換等に適応することが困難であったため' },
  { key: '5-1-6', field: '選択５－１－６', group: '5 労働者の判断によるもの', label: '(1)⑥ 事業所移転により通勤困難となった（なる）ため' },
  { key: '5-1-7', field: '選択５－１－７', group: '5 労働者の判断によるもの', label: '(1)⑦ その他（理由を具体的に）' },
  { key: '5-2', field: '選択５－２', group: '5 労働者の判断によるもの', label: '(2) 労働者の個人的な事情による離職（一身上の都合、転職希望等）' },
  { key: '6', field: '選択６', group: '6 その他', label: '1〜5のいずれにも該当しない場合（理由を具体的に）' },
];

/** 離職理由を選んだときに、あわせて入れる欄（仕様書 項番488〜520） */
export const HW_RISHOKU_DETAIL_FIELDS: { field: string; forKeys: string[]; label: string; type: 'text' | 'choice'; choices?: { code: string; label: string }[]; max: number }[] = [
  { field: '選択２（定年年齢）', forKeys: ['2'], label: '定年（歳）', type: 'text', max: 2 },
  { field: '選択２（定年後の継続雇用）', forKeys: ['2'], label: '定年後の継続雇用', type: 'choice', max: 1,
    choices: [{ code: '0', label: '希望していた' }, { code: '1', label: '希望していなかった' }] },
  { field: '選択２（継続雇用の事由）', forKeys: ['2'], label: '継続雇用を希望していた場合の事由', type: 'choice', max: 1,
    choices: [{ code: '0', label: 'a 就業規則に定める解雇事由又は退職事由に該当したため' },
      { code: '1', label: 'b 平成25年3月31日以前の労使協定で定めた基準に該当しなかったため' },
      { code: '2', label: 'c その他' }] },
  { field: '選択２（具体的理由）', forKeys: ['2'], label: 'c その他の具体的理由', type: 'text', max: 33 },
  { field: '選択４－３－２（具体的理由）', forKeys: ['4-3-2'], label: '具体的理由', type: 'text', max: 33 },
  { field: '選択５－１－５（教育訓練の有無）', forKeys: ['5-1-5'], label: '教育訓練の有無', type: 'choice', max: 1,
    choices: [{ code: '0', label: '有' }, { code: '1', label: '無' }] },
  { field: '選択５－１－６（所在地）', forKeys: ['5-1-6'], label: '（新）所在地', type: 'text', max: 13 },
  { field: '選択５－１－７（具体的理由）', forKeys: ['5-1-7'], label: '具体的理由', type: 'text', max: 32 },
  { field: '選択６（具体的理由）', forKeys: ['6'], label: '具体的理由', type: 'text', max: 37 },
];

export type HwRishokuInput = {
  // 資格喪失届の部分（項番1〜55）
  myNumber: string;
  insuranceNumber: string;
  acquiredDate: string;
  leaveDate: string;
  reason: string;              // 喪失原因（1〜3）
  kanaName: string;
  kanjiName: string;
  gender: string;
  birthDate: string;
  address: string;
  officeName: string;
  leaveReasonText: string;
  weeklyHours: number;
  weeklyMinutes: number;
  hwName: string;
  // 離職証明書の部分（項番56〜83）
  certOfficeName: string;
  certOfficeAddress: string;
  leaverPostalParent: string;
  leaverPostalChild: string;
  leaverAddress: string;
  leaverTel1: string;
  leaverTel2: string;
  leaverTel3: string;
  ownerAddress: string;
  ownerName1: string;
  ownerName2: string;
  // 賃金の欄（項番84〜453）
  wageRows: WageRow[];
  // 項番454〜467
  wageNote: string;
  wageNoteExtra: string;
  createdDate: string;
  // 離職理由（項番468〜524）
  reasonKey: string;
  reasonDetails: Record<string, string>;
  situationNote: string;
  objection: string;           // 異議の有無（0=有り 1=無し）
  leaverSignature: string;
};

/** データレコード（資格喪失届（離職票交付あり）・524項目） */
export function buildHwRishokuFields(office: OfficeInfo, p: HwRishokuInput): string[] {
  const acq = toWareki(p.acquiredDate);
  const lv = toWareki(p.leaveDate);
  const birth = toWareki(p.birthDate);
  const made = toWareki(p.createdDate);
  const n = splitInsuranceNumber(p.insuranceNumber);

  // 項番1〜55（交付なしと同じ並び。離職票交付希望だけが「1」）
  const head: string[] = [
    HW_FORM_RISHOKU,
    '',
    digits(p.myNumber),
    n.four, n.six, n.cd,
    office.eiOffice, office.eiSerial, office.eiCheck,
    acq ? acq.name : '', acq ? acq.yy : '', acq ? acq.mm : '', acq ? acq.dd : '',
    lv ? lv.name : '', lv ? lv.yy : '', lv ? lv.mm : '', lv ? lv.dd : '',
    String(p.reason || ''),
    '1',                                  // 離職票交付希望＝有
    '',                                   // 喪失時被保険者種類（設定なし）
    '', '',                               // 新氏名フリガナ・新氏名
    '無',                                 // 補充採用予定の有無
    normalizeKanaName(p.kanaName),
    normalizeKanjiName(p.kanjiName),
    genderCode(p.gender),
    birth ? birth.name : '', birth ? birth.yy : '', birth ? birth.mm : '', birth ? birth.dd : '',
    String(p.address || ''),
    String(p.officeName || ''),
    '', '', '', '',                       // 氏名変更年月日
    String(p.leaveReasonText || ''),
    pad2(Math.max(0, Number(p.weeklyHours) || 0)),
    pad2(Math.max(0, Number(p.weeklyMinutes) || 0)),
    String(p.hwName || ''),
    '', '', '', '', '', '', '', '', '', '',   // 外国人に関する10項目（項番41〜50）
    '', '', '', '', '',                   // 項番51〜55（設定なし）
  ];

  // 項番56〜83（離職証明書の見出し）
  const nextDay = mmdd(addDays(p.leaveDate, 1));
  const cert: string[] = [
    n.four, n.six, n.cd,
    office.eiOffice, office.eiSerial, office.eiCheck,
    normalizeKanaName(p.kanaName),
    normalizeKanjiName(p.kanjiName),
    lv ? lv.name : '', lv ? lv.yy : '', lv ? lv.mm : '', lv ? lv.dd : '',
    String(p.certOfficeName || ''),
    String(p.certOfficeAddress || ''),
    office.tel1, office.tel2, office.tel3,
    String(p.leaverPostalParent || ''), String(p.leaverPostalChild || ''),
    String(p.leaverAddress || ''),
    String(p.leaverTel1 || ''), String(p.leaverTel2 || ''), String(p.leaverTel3 || ''),
    String(p.ownerAddress || ''),
    normalizeKanjiName(p.ownerName1 || ''),
    normalizeKanjiName(p.ownerName2 || ''),
    nextDay[0], nextDay[1],
  ];

  // 項番84〜453（賃金の欄。1行目は10項目、2行目以降は15項目）
  const rows = Array.isArray(p.wageRows) ? p.wageRows : [];
  const wage: string[] = [];
  for (let i = 0; i < HW_WAGE_ROWS; i++) {
    const r = rows[i] || EMPTY_WAGE_ROW;
    const [ps, pd] = mmdd(r.periodStart);
    const [pe, ped] = mmdd(r.periodEnd);
    const [bs, bsd] = mmdd(r.payStart);
    const [be, bed] = mmdd(r.payEnd);
    const totals = (r.wageA == null && r.wageB == null)
      ? '' : String((Number(r.wageA) || 0) + (Number(r.wageB) || 0));
    if (i === 0) {
      // 1行目は終了日が離職日なので、終了の欄と短期雇用特例の欄がありません
      wage.push(ps, pd, count(r.baseDays), bs, bsd, count(r.payBaseDays),
        amount(r.wageA), amount(r.wageB), totals, String(r.note || ''));
    } else {
      wage.push(ps, pd, pe, ped, '', count(r.baseDays), bs, bsd, be, bed,
        count(r.payBaseDays), amount(r.wageA), amount(r.wageB), totals, String(r.note || ''));
    }
  }

  // 項番454〜467
  const mid: string[] = [
    String(p.wageNote || ''), String(p.wageNoteExtra || ''),
    '',                                   // 離職者署名（記載内容相違）
    made ? made.name : '', made ? made.yy : '', made ? made.mm : '', made ? made.dd : '',
    '', '', '', '', '', '', '',           // 社労士に関する7項目（項番461〜467）
  ];

  // 項番468〜487（離職理由の選択。選べるのは1つだけ）
  const flags = HW_RISHOKU_REASONS.map((r) => (r.key === p.reasonKey ? '1' : '0'));

  // 項番488〜520（選択に付く欄）
  const detailNames = HW_RISHOKU_SPECS.slice(487, 520).map((s) => s.label);
  const details = detailNames.map((name) => String(p.reasonDetails?.[name] ?? ''));

  const tail: string[] = [
    String(p.situationNote || ''),
    String(p.objection ?? ''),
    String(p.leaverSignature || ''),
    '',                                   // 申請者用自由入力欄
  ];

  return [...head, ...cert, ...wage, ...mid, ...flags, ...details, ...tail];
}

export function buildHwRishoku(office: OfficeInfo, p: HwRishokuInput): string {
  return join(buildHwRishokuFields(office, p));
}

// ============================================================
// 健康保険・厚生年金保険 被保険者報酬月額算定基礎届
//   ／厚生年金保険70歳以上被用者算定基礎届
//   仕様書 ４．７．１（年金事務所提出・53項目）
//
//   4月・5月・6月に「支払った」給与をもとに、9月からの標準報酬月額を決めます。
//   御社は当月末締め・翌月25日払いなので、
//     4月支給 ＝ 3月分の給与
//     5月支給 ＝ 4月分の給与
//     6月支給 ＝ 5月分の給与
//   になります。仕様書の作成例も、基礎日数が「31,30,31」（3月・4月・5月の
//   暦日数）で、同じ締め・支払いの形を示しています。
// ============================================================

export const NENKIN_SANTEI_FORM_CODE = '2225700';

export const NENKIN_SANTEI_SPECS: FieldSpec[] = [
  { no: 1, label: '様式コード', kind: 'num', min: 7, max: 7 },
  { no: 2, label: '都道府県コード', kind: 'num', min: 2, max: 2 },
  { no: 3, label: '郡市区符号', kind: 'num', min: 2, max: 2 },
  { no: 4, label: '事業所記号', kind: 'kana', min: 1, max: 4 },
  { no: 5, label: '被保険者整理番号', kind: 'num', min: 0, max: 6 },
  { no: 6, label: '被保険者氏名（カナ）', kind: 'kana', min: 1, max: 25 },
  { no: 7, label: '被保険者氏名（漢字）', kind: 'kanji', min: 0, max: 12 },
  { no: 8, label: '元号（生年月日）', kind: 'num', min: 1, max: 1 },
  { no: 9, label: '生年月日', kind: 'num', min: 6, max: 6 },
  { no: 10, label: '元号（適用年月）', kind: 'num', min: 1, max: 1 },
  { no: 11, label: '年（適用年月）', kind: 'num', min: 2, max: 2 },
  { no: 12, label: '月（適用年月）', kind: 'num', min: 2, max: 2 },
  { no: 13, label: '従前の標準報酬月額（健保）', kind: 'num', min: 0, max: 4 },
  { no: 14, label: '従前の標準報酬月額（厚年）', kind: 'num', min: 0, max: 4 },
  { no: 15, label: '元号（従前の改定月）', kind: 'num', min: 1, max: 1 },
  { no: 16, label: '年（従前の改定月）', kind: 'num', min: 2, max: 2 },
  { no: 17, label: '月（従前の改定月）', kind: 'num', min: 2, max: 2 },
  { no: 18, label: '昇(降)給月', kind: 'num', min: 0, max: 2 },
  { no: 19, label: '昇(降)給区分', kind: 'num', min: 0, max: 1 },
  { no: 20, label: '遡及支払月', kind: 'num', min: 0, max: 2 },
  { no: 21, label: '遡及支払額', kind: 'num', min: 0, max: 7 },
  { no: 22, label: '給与支給月（4月）', kind: 'num', min: 2, max: 2 },
  { no: 23, label: '給与支給月（5月）', kind: 'num', min: 2, max: 2 },
  { no: 24, label: '給与支給月（6月）', kind: 'num', min: 2, max: 2 },
  { no: 25, label: '給与計算の基礎日数（4月）', kind: 'num', min: 2, max: 2 },
  { no: 26, label: '給与計算の基礎日数（5月）', kind: 'num', min: 2, max: 2 },
  { no: 27, label: '給与計算の基礎日数（6月）', kind: 'num', min: 2, max: 2 },
  { no: 28, label: '通貨によるものの額（4月）', kind: 'num', min: 1, max: 7 },
  { no: 29, label: '通貨によるものの額（5月）', kind: 'num', min: 1, max: 7 },
  { no: 30, label: '通貨によるものの額（6月）', kind: 'num', min: 1, max: 7 },
  { no: 31, label: '現物によるものの額（4月）', kind: 'num', min: 1, max: 7 },
  { no: 32, label: '現物によるものの額（5月）', kind: 'num', min: 1, max: 7 },
  { no: 33, label: '現物によるものの額（6月）', kind: 'num', min: 1, max: 7 },
  { no: 34, label: '合計（4月）', kind: 'num', min: 1, max: 7 },
  { no: 35, label: '合計（5月）', kind: 'num', min: 1, max: 7 },
  { no: 36, label: '合計（6月）', kind: 'num', min: 1, max: 7 },
  { no: 37, label: '総計', kind: 'num', min: 1, max: 7 },
  { no: 38, label: '平均額', kind: 'num', min: 1, max: 7 },
  { no: 39, label: '修正平均額', kind: 'num', min: 0, max: 7 },
  { no: 40, label: '個人番号', kind: 'num', min: 0, max: 12 },
  { no: 41, label: '課所符号', kind: 'num', min: 0, max: 4 },
  { no: 42, label: '一連番号', kind: 'num', min: 0, max: 6 },
  { no: 43, label: '備考欄項目1（70歳以上被用者）', kind: 'num', min: 0, max: 1 },
  { no: 44, label: '70歳算定基礎月', kind: 'num', min: 0, max: 4 },
  { no: 45, label: '備考欄項目2（二以上事業所勤務）', kind: 'num', min: 0, max: 1 },
  { no: 46, label: '備考欄項目3（月額変更の予定）', kind: 'num', min: 0, max: 1 },
  { no: 47, label: '備考欄項目4（途中入社）', kind: 'num', min: 0, max: 1 },
  { no: 48, label: '備考欄項目5（病休・育休・休職）', kind: 'num', min: 0, max: 1 },
  { no: 49, label: '備考欄項目6（短時間労働者）', kind: 'num', min: 0, max: 1 },
  { no: 50, label: '備考欄項目7（パート）', kind: 'num', min: 0, max: 1 },
  { no: 51, label: '備考欄項目8（年間平均）', kind: 'num', min: 0, max: 1 },
  { no: 52, label: '備考欄', kind: 'mixed', min: 0, max: 37, maxHalf: 75 },
  { no: 53, label: '70歳以上被用者届のみ提出', kind: 'num', min: 0, max: 1 },
];

/** 被保険者の区分。平均額を出すときの基礎日数のしきい値が変わります */
export const SANTEI_KINDS = {
  normal: { label: '一般の被保険者', threshold: 17 },
  part: { label: 'パート扱いする者（短時間就労者）', threshold: 17, fallback: 15 },
  shortTime: { label: '特定適用事業所の短時間労働者', threshold: 11 },
};
export type SanteiKind = 'normal' | 'part' | 'shortTime';

export type SanteiMonth = {
  /** その月に支払った給与の、計算の基礎となる日数 */
  days: number | null;
  /** 通貨によるものの額 */
  cash: number | null;
  /** 現物によるものの額 */
  goods: number | null;
};

export const EMPTY_SANTEI_MONTH: SanteiMonth = { days: null, cash: null, goods: null };

export type SanteiTotals = {
  monthTotals: number[];    // 4月・5月・6月それぞれの合計
  total: number;            // 総計（しきい値を満たした月だけ）
  average: number;          // 平均額（1円未満切り捨て）
  usedMonths: number[];     // 平均に入れた月（0=4月, 1=5月, 2=6月）
  threshold: number;        // 使ったしきい値
  fellBackTo15: boolean;    // パートで17日以上が無く15日に下げたか
};

/**
 * 総計と平均額を出します（仕様書 項番37・38）。
 *   一般の被保険者          … 基礎日数17日以上の月
 *   パート扱いする者        … 17日以上の月。1つも無ければ15日以上の月
 *   特定適用事業所の短時間労働者 … 11日以上の月
 * どの月も満たさないときは、総計も平均額も0にします。
 * 平均額は1円未満を切り捨てます。
 */
export function santeiTotals(months: SanteiMonth[], kind: SanteiKind = 'normal'): SanteiTotals {
  const three = [0, 1, 2].map((i) => months?.[i] || EMPTY_SANTEI_MONTH);
  const monthTotals = three.map((m) => (Number(m.cash) || 0) + (Number(m.goods) || 0));
  const base = kind === 'shortTime' ? 11 : 17;
  const pick = (t: number) => [0, 1, 2].filter((i) => (Number(three[i].days) || 0) >= t);
  let used = pick(base);
  let threshold = base;
  let fellBackTo15 = false;
  if (kind === 'part' && used.length === 0) {
    used = pick(15);
    threshold = 15;
    fellBackTo15 = used.length > 0;
  }
  const total = used.reduce((s, i) => s + monthTotals[i], 0);
  const average = used.length > 0 ? Math.floor(total / used.length) : 0;
  return { monthTotals, total, average, usedMonths: used, threshold, fellBackTo15 };
}

/** 標準報酬月額（円）を、届出の4桁（千円単位）にします。300000円 → 「0300」 */
export function standardRemunerationCode(yen: number | null | undefined): string {
  const n = Number(yen);
  if (!Number.isFinite(n) || n <= 0) return '';
  return String(Math.round(n / 1000)).padStart(4, '0').slice(-4);
}

export type NenkinSanteiInput = {
  insuredNumber: string;     // 被保険者整理番号
  kanaName: string;
  kanjiName: string;
  birthDate: string;
  /** 適用年月（算定基礎届は、その年の9月から） */
  applyYear: number;
  /** 従前の標準報酬月額（円） */
  prevHealth: number | null;
  prevPension: number | null;
  /** 従前の改定月 'YYYY-MM' */
  prevRevisedMonth: string;
  raiseMonth: string;        // 昇(降)給月（'04' など）
  raiseKind: string;         // 1=昇給 2=降給
  retroMonth: string;        // 遡及支払月
  retroAmount: number | null;
  months: SanteiMonth[];     // 4月・5月・6月
  kind: SanteiKind;
  correctedAverage: number | null;  // 修正平均額
  myNumber: string;
  pensionNumber: string;
  note1?: boolean;           // 70歳以上被用者
  over70SanteiMonths?: string;
  note2?: boolean;           // 二以上事業所勤務
  note3?: boolean;           // 月額変更の予定
  note4?: boolean;           // 途中入社
  note5?: boolean;           // 病休・育休・休職
  note8?: boolean;           // 年間平均
  note?: string;             // 備考欄
  over70Only?: boolean;
};

/** 算定基礎届・70歳以上被用者算定基礎届 データレコード（年金事務所提出・53項目） */
export function buildNenkinSanteiFields(office: OfficeInfo, p: NenkinSanteiInput): string[] {
  const birth = toWareki(p.birthDate);
  // 適用年月は、その年の9月
  const apply = toWareki(`${p.applyYear}-09-01`);
  const prevM = /^(\d{4})-(\d{2})$/.exec(String(p.prevRevisedMonth || ''));
  const prev = prevM ? toWareki(`${prevM[1]}-${prevM[2]}-01`) : null;
  const my = digits(p.myNumber);
  const pn = digits(p.pensionNumber);
  const t = santeiTotals(p.months, p.kind);
  const m = (i: number) => p.months?.[i] || EMPTY_SANTEI_MONTH;
  const amt = (v: number | null | undefined) =>
    (v == null || !Number.isFinite(Number(v))) ? '0' : String(Math.max(0, Math.round(Number(v))));
  const dayCount = (v: number | null | undefined) =>
    (v == null || !Number.isFinite(Number(v))) ? '00' : pad2(Math.max(0, Math.min(99, Math.round(Number(v)))));

  return [
    NENKIN_SANTEI_FORM_CODE,
    office.prefCode, office.cityCode, office.officeSymbol,
    digits(p.insuredNumber),
    normalizeKanaName(p.kanaName),
    normalizeKanjiName(p.kanjiName),
    birth ? String(birth.code) : '',
    birth ? birth.yymmdd : '',
    apply ? String(apply.code) : '',
    apply ? apply.yy : '',
    '09',
    standardRemunerationCode(p.prevHealth),
    standardRemunerationCode(p.prevPension),
    prev ? String(prev.code) : '',
    prev ? prev.yy : '',
    prev ? prev.mm : '',
    String(p.raiseMonth || ''),
    String(p.raiseKind || ''),
    String(p.retroMonth || ''),
    p.retroAmount != null && Number(p.retroAmount) > 0 ? String(Math.round(Number(p.retroAmount))) : '',
    '04', '05', '06',
    dayCount(m(0).days), dayCount(m(1).days), dayCount(m(2).days),
    amt(m(0).cash), amt(m(1).cash), amt(m(2).cash),
    amt(m(0).goods), amt(m(1).goods), amt(m(2).goods),
    String(t.monthTotals[0]), String(t.monthTotals[1]), String(t.monthTotals[2]),
    String(t.total), String(t.average),
    p.correctedAverage != null && Number(p.correctedAverage) > 0
      ? String(Math.floor(Number(p.correctedAverage))) : '',
    my,
    my ? '' : pn.slice(0, 4),
    my ? '' : pn.slice(4, 10),
    flag(p.note1),
    String(p.over70SanteiMonths || ''),
    flag(p.note2), flag(p.note3), flag(p.note4), flag(p.note5),
    flag(p.kind === 'shortTime'),     // 備考欄項目6（短時間労働者）
    flag(p.kind === 'part'),          // 備考欄項目7（パート）
    flag(p.note8),
    String(p.note || ''),
    flag(p.over70Only),
  ];
}

export function buildNenkinSantei(office: OfficeInfo, p: NenkinSanteiInput): string {
  return join(buildNenkinSanteiFields(office, p));
}

// ============================================================
// 健康保険・厚生年金保険 被保険者賞与支払届
//   ／厚生年金保険70歳以上被用者賞与支払届
//   仕様書 ４．９．１（年金事務所提出・21項目）
//
//   対象は「三月を超える期間ごとに受けるもの」、つまり年3回以下の賞与です。
//   年4回以上支払われるものは報酬に当たるため、この届出には入れません。
// ============================================================

export const NENKIN_BONUS_FORM_CODE = '2265700';

export const NENKIN_BONUS_SPECS: FieldSpec[] = [
  { no: 1, label: '様式コード', kind: 'num', min: 7, max: 7 },
  { no: 2, label: '都道府県コード', kind: 'num', min: 2, max: 2 },
  { no: 3, label: '郡市区符号', kind: 'num', min: 2, max: 2 },
  { no: 4, label: '事業所記号', kind: 'kana', min: 1, max: 4 },
  { no: 5, label: '被保険者整理番号', kind: 'num', min: 0, max: 6 },
  { no: 6, label: '被保険者氏名（カナ）', kind: 'kana', min: 1, max: 25 },
  { no: 7, label: '被保険者氏名（漢字）', kind: 'kanji', min: 0, max: 12 },
  { no: 8, label: '元号（生年月日）', kind: 'num', min: 1, max: 1 },
  { no: 9, label: '生年月日', kind: 'num', min: 6, max: 6 },
  { no: 10, label: '元号（賞与支払年月日）', kind: 'num', min: 1, max: 1 },
  { no: 11, label: '賞与支払年月日', kind: 'num', min: 6, max: 6 },
  { no: 12, label: '通貨によるものの額', kind: 'num', min: 1, max: 7 },
  { no: 13, label: '現物によるものの額', kind: 'num', min: 1, max: 7 },
  { no: 14, label: '合計（賞与額）', kind: 'num', min: 1, max: 7 },
  { no: 15, label: '個人番号', kind: 'num', min: 0, max: 12 },
  { no: 16, label: '課所符号', kind: 'num', min: 0, max: 4 },
  { no: 17, label: '一連番号', kind: 'num', min: 0, max: 6 },
  { no: 18, label: '備考欄項目1（70歳以上被用者）', kind: 'num', min: 0, max: 1 },
  { no: 19, label: '備考欄項目2（二以上事業所勤務）', kind: 'num', min: 0, max: 1 },
  { no: 20, label: '備考欄項目3（同一月内の賞与合算・初回支払日）', kind: 'num', min: 0, max: 2 },
  { no: 21, label: '70歳以上被用者届のみ提出', kind: 'num', min: 0, max: 1 },
];

/** 賞与額の上限。これ以上は決まった値に置き換えます（仕様書 項番12〜14） */
export const BONUS_LIMIT = 10000000;

export type BonusAmounts = {
  cash: number;      // 通貨によるものの額（届出に入れる値）
  goods: number;     // 現物によるものの額（同上）
  total: number;     // 合計（賞与額）
  rawTotal: number;  // 切り捨て前の合計
  cut: number;       // 切り捨てた額（1,000円未満）
  capped: boolean;   // 1千万円以上で置き換えたか
};

/**
 * 賞与額を、届出に入れる形にします（仕様書 項番12〜14）。
 *   ・合計（賞与額）は、通貨と現物の合計から1,000円未満を切り捨てます
 *       （例）600,870円 → 600000
 *   ・1千万円以上のときは、仕様書のとおり決まった値に置き換えます
 *       通貨か現物の一方だけで1千万円以上 → 合計は「9999000」
 *       両方あって合計が1千万円以上       → 合計は「9999999」
 *       通貨・現物それぞれが1千万円以上   → その欄は「9999999」
 */
export function bonusAmounts(cash: number | null, goods: number | null): BonusAmounts {
  const c = Math.max(0, Math.round(Number(cash) || 0));
  const g = Math.max(0, Math.round(Number(goods) || 0));
  const sum = c + g;
  const cashField = c >= BONUS_LIMIT ? 9999999 : c;
  const goodsField = g >= BONUS_LIMIT ? 9999999 : g;
  let total: number;
  let capped = false;
  if (sum >= BONUS_LIMIT) {
    total = (c > 0 && g > 0) ? 9999999 : 9999000;
    capped = true;
  } else {
    total = Math.floor(sum / 1000) * 1000;
  }
  return { cash: cashField, goods: goodsField, total, rawTotal: sum, cut: capped ? 0 : sum - total, capped };
}

export type NenkinBonusInput = {
  insuredNumber: string;
  kanaName: string;
  kanjiName: string;
  birthDate: string;
  paymentDate: string;       // 賞与を支払った日 'YYYY-MM-DD'
  cashAmount: number | null;
  goodsAmount: number | null;
  myNumber: string;
  pensionNumber: string;
  note1?: boolean;           // 70歳以上被用者
  note2?: boolean;           // 二以上事業所勤務
  firstPayDay?: string;      // 同一月内の賞与合算のときの初回支払日（'05' など）
  over70Only?: boolean;
};

/** 賞与支払届・70歳以上被用者賞与支払届 データレコード（年金事務所提出・21項目） */
export function buildNenkinBonusFields(office: OfficeInfo, p: NenkinBonusInput): string[] {
  const birth = toWareki(p.birthDate);
  const pay = toWareki(p.paymentDate);
  const my = digits(p.myNumber);
  const pn = digits(p.pensionNumber);
  const a = bonusAmounts(p.cashAmount, p.goodsAmount);
  return [
    NENKIN_BONUS_FORM_CODE,
    office.prefCode, office.cityCode, office.officeSymbol,
    digits(p.insuredNumber),
    normalizeKanaName(p.kanaName),
    normalizeKanjiName(p.kanjiName),
    birth ? String(birth.code) : '',
    birth ? birth.yymmdd : '',
    pay ? String(pay.code) : '',
    pay ? pay.yymmdd : '',
    String(a.cash), String(a.goods), String(a.total),
    my,
    my ? '' : pn.slice(0, 4),
    my ? '' : pn.slice(4, 10),
    flag(p.note1), flag(p.note2),
    String(p.firstPayDay || ''),
    flag(p.over70Only),
  ];
}

export function buildNenkinBonus(office: OfficeInfo, p: NenkinBonusInput): string {
  return join(buildNenkinBonusFields(office, p));
}

// ============================================================
// 健康保険・厚生年金保険 被保険者報酬月額変更届
//   ／厚生年金保険70歳以上被用者月額変更届（随時改定）
//   仕様書 ４．８．１（年金事務所提出・49項目）
//
//   固定的賃金が変わった月から3か月の報酬で、標準報酬月額を見直します。
//   3か月とも、給与計算の基礎日数が17日以上（特定適用事業所の短時間労働者は
//   11日以上）でないと、随時改定の対象になりません（仕様書 項番25〜27・38）。
//   改定後の標準報酬月額は、変わった月の4か月目から使います。
// ============================================================

export const NENKIN_GEGAKU_FORM_CODE = '2221700';

export const NENKIN_GEGAKU_SPECS: FieldSpec[] = [
  { no: 1, label: '様式コード', kind: 'num', min: 7, max: 7 },
  { no: 2, label: '都道府県コード', kind: 'num', min: 2, max: 2 },
  { no: 3, label: '郡市区符号', kind: 'num', min: 2, max: 2 },
  { no: 4, label: '事業所記号', kind: 'kana', min: 1, max: 4 },
  { no: 5, label: '被保険者整理番号', kind: 'num', min: 0, max: 6 },
  { no: 6, label: '被保険者氏名（カナ）', kind: 'kana', min: 1, max: 25 },
  { no: 7, label: '被保険者氏名（漢字）', kind: 'kanji', min: 0, max: 12 },
  { no: 8, label: '元号（生年月日）', kind: 'num', min: 1, max: 1 },
  { no: 9, label: '生年月日', kind: 'num', min: 6, max: 6 },
  { no: 10, label: '元号（改定年月）', kind: 'num', min: 1, max: 1 },
  { no: 11, label: '年（改定年月）', kind: 'num', min: 2, max: 2 },
  { no: 12, label: '月（改定年月）', kind: 'num', min: 2, max: 2 },
  { no: 13, label: '従前の標準報酬月額（健保）', kind: 'num', min: 0, max: 4 },
  { no: 14, label: '従前の標準報酬月額（厚年）', kind: 'num', min: 0, max: 4 },
  { no: 15, label: '元号（従前の改定月）', kind: 'num', min: 1, max: 1 },
  { no: 16, label: '年（従前の改定月）', kind: 'num', min: 2, max: 2 },
  { no: 17, label: '月（従前の改定月）', kind: 'num', min: 2, max: 2 },
  { no: 18, label: '昇（降）給月', kind: 'num', min: 0, max: 2 },
  { no: 19, label: '昇（降）給区分', kind: 'num', min: 0, max: 1 },
  { no: 20, label: '遡及支払月', kind: 'num', min: 0, max: 2 },
  { no: 21, label: '遡及支払額', kind: 'num', min: 0, max: 7 },
  { no: 22, label: '給与支給月（前三ヶ月）', kind: 'num', min: 2, max: 2 },
  { no: 23, label: '給与支給月（前二ヶ月）', kind: 'num', min: 2, max: 2 },
  { no: 24, label: '給与支給月（前一ヶ月）', kind: 'num', min: 2, max: 2 },
  { no: 25, label: '給与計算の基礎日数（前三ヶ月）', kind: 'num', min: 2, max: 2 },
  { no: 26, label: '給与計算の基礎日数（前二ヶ月）', kind: 'num', min: 2, max: 2 },
  { no: 27, label: '給与計算の基礎日数（前一ヶ月）', kind: 'num', min: 2, max: 2 },
  { no: 28, label: '通貨によるものの額（前三ヶ月）', kind: 'num', min: 1, max: 7 },
  { no: 29, label: '通貨によるものの額（前二ヶ月）', kind: 'num', min: 1, max: 7 },
  { no: 30, label: '通貨によるものの額（前一ヶ月）', kind: 'num', min: 1, max: 7 },
  { no: 31, label: '現物によるものの額（前三ヶ月）', kind: 'num', min: 1, max: 7 },
  { no: 32, label: '現物によるものの額（前二ヶ月）', kind: 'num', min: 1, max: 7 },
  { no: 33, label: '現物によるものの額（前一ヶ月）', kind: 'num', min: 1, max: 7 },
  { no: 34, label: '合計（前三ヶ月）', kind: 'num', min: 1, max: 7 },
  { no: 35, label: '合計（前二ヶ月）', kind: 'num', min: 1, max: 7 },
  { no: 36, label: '合計（前一ヶ月）', kind: 'num', min: 1, max: 7 },
  { no: 37, label: '総計', kind: 'num', min: 1, max: 7 },
  { no: 38, label: '平均額', kind: 'num', min: 1, max: 7 },
  { no: 39, label: '修正平均額', kind: 'num', min: 0, max: 7 },
  { no: 40, label: '個人番号', kind: 'num', min: 0, max: 12 },
  { no: 41, label: '課所符号', kind: 'num', min: 0, max: 4 },
  { no: 42, label: '一連番号', kind: 'num', min: 0, max: 6 },
  { no: 43, label: '備考欄項目1（70歳以上被用者）', kind: 'num', min: 0, max: 1 },
  { no: 44, label: '備考欄項目2（二以上事業所勤務）', kind: 'num', min: 0, max: 1 },
  { no: 45, label: '備考欄項目3（短時間労働者）', kind: 'num', min: 0, max: 1 },
  { no: 46, label: '備考欄項目4（昇給・降給の理由）', kind: 'mixed', min: 0, max: 37, maxHalf: 75 },
  { no: 47, label: '備考欄項目5（健康保険のみ月額変更）', kind: 'num', min: 0, max: 1 },
  { no: 48, label: '備考欄', kind: 'mixed', min: 0, max: 37, maxHalf: 75 },
  { no: 49, label: '70歳以上被用者届のみ提出', kind: 'num', min: 0, max: 1 },
];

/** 随時改定の区分。基礎日数のしきい値が変わります（仕様書 項番25〜27） */
export const GEGAKU_KINDS = {
  normal: { label: '一般の被保険者', threshold: 17 },
  shortTime: { label: '特定適用事業所の短時間労働者', threshold: 11 },
};
export type GegakuKind = 'normal' | 'shortTime';

export type GegakuTotals = {
  monthTotals: number[];
  total: number;
  average: number;
  threshold: number;
  /** 3か月とも基礎日数がしきい値以上か。満たさないと随時改定の対象外 */
  eligible: boolean;
  shortMonths: number[];   // しきい値に届かなかった月（0=前三ヶ月）
};

/**
 * 総計と平均額を出します（仕様書 項番37・38）。
 * 算定基礎届と違い、しきい値で月を絞りません。3か月すべてが対象で、
 * 1つでも基礎日数がしきい値に届かない月があれば、随時改定の対象外です。
 * 平均額は総計を3で割り、1円未満を切り捨てます。
 */
export function gegakuTotals(months: SanteiMonth[], kind: GegakuKind = 'normal'): GegakuTotals {
  const three = [0, 1, 2].map((i) => months?.[i] || EMPTY_SANTEI_MONTH);
  const monthTotals = three.map((m) => (Number(m.cash) || 0) + (Number(m.goods) || 0));
  const threshold = kind === 'shortTime' ? 11 : 17;
  const shortMonths = [0, 1, 2].filter((i) => (Number(three[i].days) || 0) < threshold);
  const total = monthTotals.reduce((s, v) => s + v, 0);
  const average = Math.floor(total / 3);
  return { monthTotals, total, average, threshold, eligible: shortMonths.length === 0, shortMonths };
}

/** 'YYYY-MM' に月を足し引きする */
export function addMonthsToYm(ym: string, delta: number): string {
  const m = /^(\d{4})-(\d{2})$/.exec(String(ym || ''));
  if (!m) return '';
  const t = Number(m[1]) * 12 + (Number(m[2]) - 1) + delta;
  return `${Math.floor(t / 12)}-${pad2((t % 12) + 1)}`;
}

export type NenkinGegakuInput = {
  insuredNumber: string;
  kanaName: string;
  kanjiName: string;
  birthDate: string;
  /** 改定年月 'YYYY-MM'（昇給・降給のあった月の4か月目） */
  revisedMonth: string;
  prevHealth: number | null;
  prevPension: number | null;
  prevRevisedMonth: string;   // 'YYYY-MM'
  raiseMonth: string;         // 昇（降）給月（'09' など）
  raiseKind: string;          // 1=昇給 2=降給
  retroMonth: string;
  retroAmount: number | null;
  /** 改定年月の前三ヶ月・前二ヶ月・前一ヶ月 */
  months: SanteiMonth[];
  kind: GegakuKind;
  correctedAverage: number | null;
  myNumber: string;
  pensionNumber: string;
  note1?: boolean;            // 70歳以上被用者
  note2?: boolean;            // 二以上事業所勤務
  reasonText: string;         // 備考欄項目4（昇給・降給の理由）
  note5?: boolean;            // 健康保険のみ月額変更
  note?: string;              // 備考欄
  over70Only?: boolean;
};

/** 月額変更届・70歳以上被用者月額変更届 データレコード（年金事務所提出・49項目） */
export function buildNenkinGegakuFields(office: OfficeInfo, p: NenkinGegakuInput): string[] {
  const birth = toWareki(p.birthDate);
  const rev = /^(\d{4})-(\d{2})$/.exec(String(p.revisedMonth || ''));
  const revW = rev ? toWareki(`${rev[1]}-${rev[2]}-01`) : null;
  const prevM = /^(\d{4})-(\d{2})$/.exec(String(p.prevRevisedMonth || ''));
  const prevW = prevM ? toWareki(`${prevM[1]}-${prevM[2]}-01`) : null;
  const my = digits(p.myNumber);
  const pn = digits(p.pensionNumber);
  const t = gegakuTotals(p.months, p.kind);
  const m = (i: number) => p.months?.[i] || EMPTY_SANTEI_MONTH;
  const amt = (v: number | null | undefined) =>
    (v == null || !Number.isFinite(Number(v))) ? '0' : String(Math.max(0, Math.round(Number(v))));
  const dayCount = (v: number | null | undefined) =>
    (v == null || !Number.isFinite(Number(v))) ? '00' : pad2(Math.max(0, Math.min(99, Math.round(Number(v)))));
  // 給与支給月は、改定年月の前三ヶ月・前二ヶ月・前一ヶ月
  const payMonth = (back: number) => {
    const ym = addMonthsToYm(p.revisedMonth, -back);
    return ym ? ym.slice(5, 7) : '';
  };

  return [
    NENKIN_GEGAKU_FORM_CODE,
    office.prefCode, office.cityCode, office.officeSymbol,
    digits(p.insuredNumber),
    normalizeKanaName(p.kanaName),
    normalizeKanjiName(p.kanjiName),
    birth ? String(birth.code) : '',
    birth ? birth.yymmdd : '',
    revW ? String(revW.code) : '',
    revW ? revW.yy : '',
    revW ? revW.mm : '',
    standardRemunerationCode(p.prevHealth),
    standardRemunerationCode(p.prevPension),
    prevW ? String(prevW.code) : '',
    prevW ? prevW.yy : '',
    prevW ? prevW.mm : '',
    String(p.raiseMonth || ''),
    String(p.raiseKind || ''),
    String(p.retroMonth || ''),
    p.retroAmount != null && Number(p.retroAmount) > 0 ? String(Math.round(Number(p.retroAmount))) : '',
    payMonth(3), payMonth(2), payMonth(1),
    dayCount(m(0).days), dayCount(m(1).days), dayCount(m(2).days),
    amt(m(0).cash), amt(m(1).cash), amt(m(2).cash),
    amt(m(0).goods), amt(m(1).goods), amt(m(2).goods),
    String(t.monthTotals[0]), String(t.monthTotals[1]), String(t.monthTotals[2]),
    String(t.total), String(t.average),
    p.correctedAverage != null && Number(p.correctedAverage) > 0
      ? String(Math.floor(Number(p.correctedAverage))) : '',
    my,
    my ? '' : pn.slice(0, 4),
    my ? '' : pn.slice(4, 10),
    flag(p.note1), flag(p.note2),
    flag(p.kind === 'shortTime'),
    String(p.reasonText || ''),
    flag(p.note5),
    String(p.note || ''),
    flag(p.over70Only),
  ];
}

export function buildNenkinGegaku(office: OfficeInfo, p: NenkinGegakuInput): string {
  return join(buildNenkinGegakuFields(office, p));
}

// ============================================================
// 産前産後休業取得者申出書／変更（終了）届
//   仕様書 ４．１２．１（年金事務所提出・33項目）
//
//   出産（予定）日や終了予定日を変えるときは「変更欄」も、
//   予定より早く終わったときは「終了欄」も入れます。
// ============================================================

export const NENKIN_SANZEN_FORM_CODE = '2273700';

export const NENKIN_SANZEN_SPECS: FieldSpec[] = [
  { no: 1, label: '様式コード', kind: 'num', min: 7, max: 7 },
  { no: 2, label: '都道府県コード', kind: 'num', min: 2, max: 2 },
  { no: 3, label: '郡市区符号', kind: 'num', min: 2, max: 2 },
  { no: 4, label: '事業所記号', kind: 'kana', min: 1, max: 4 },
  { no: 5, label: '被保険者整理番号', kind: 'num', min: 0, max: 6 },
  { no: 6, label: '被保険者氏名（カナ）', kind: 'kana', min: 1, max: 25 },
  { no: 7, label: '被保険者氏名（漢字）', kind: 'kanji', min: 0, max: 12 },
  { no: 8, label: '被保険者の個人番号', kind: 'num', min: 0, max: 12 },
  { no: 9, label: '課所符号', kind: 'num', min: 0, max: 4 },
  { no: 10, label: '一連番号', kind: 'num', min: 0, max: 6 },
  { no: 11, label: '元号（被保険者生年月日）', kind: 'num', min: 1, max: 1 },
  { no: 12, label: '被保険者生年月日', kind: 'num', min: 6, max: 6 },
  { no: 13, label: '元号（出産予定年月日）', kind: 'num', min: 1, max: 1 },
  { no: 14, label: '出産予定年月日', kind: 'num', min: 6, max: 6 },
  { no: 15, label: '出産種別', kind: 'num', min: 1, max: 1 },
  { no: 16, label: '元号（産前産後休業開始年月日）', kind: 'num', min: 1, max: 1 },
  { no: 17, label: '産前産後休業開始年月日', kind: 'num', min: 6, max: 6 },
  { no: 18, label: '元号（産前産後休業終了予定年月日）', kind: 'num', min: 1, max: 1 },
  { no: 19, label: '産前産後休業終了予定年月日', kind: 'num', min: 6, max: 6 },
  { no: 20, label: '予備1', kind: 'kana', min: 0, max: 25 },
  { no: 21, label: '予備2', kind: 'kanji', min: 0, max: 12 },
  { no: 22, label: '元号（出産年月日）', kind: 'num', min: 0, max: 1 },
  { no: 23, label: '出産年月日', kind: 'num', min: 0, max: 6 },
  { no: 24, label: '備考', kind: 'mixed', min: 0, max: 37, maxHalf: 75 },
  { no: 25, label: '元号（変更後の出産（予定）年月日）', kind: 'num', min: 0, max: 1 },
  { no: 26, label: '変更後の出産（予定）年月日', kind: 'num', min: 0, max: 6 },
  { no: 27, label: '変更後の出産種別', kind: 'num', min: 0, max: 1 },
  { no: 28, label: '元号（変更後の産前産後休業開始年月日）', kind: 'num', min: 0, max: 1 },
  { no: 29, label: '変更後の産前産後休業開始年月日', kind: 'num', min: 0, max: 6 },
  { no: 30, label: '元号（変更後の産前産後休業終了予定年月日）', kind: 'num', min: 0, max: 1 },
  { no: 31, label: '変更後の産前産後休業終了予定年月日', kind: 'num', min: 0, max: 6 },
  { no: 32, label: '元号（産前産後休業終了年月日）', kind: 'num', min: 0, max: 1 },
  { no: 33, label: '産前産後休業終了年月日', kind: 'num', min: 0, max: 6 },
];

/** 出産種別（仕様書 項番15）。双子以上は多胎 */
export const BIRTH_TYPES = [
  { code: '0', label: '単胎（お一人）' },
  { code: '1', label: '多胎（双子以上）' },
];

export type NenkinSanzenInput = {
  insuredNumber: string;
  kanaName: string;
  kanjiName: string;
  birthDate: string;          // 被保険者の生年月日
  myNumber: string;
  pensionNumber: string;
  dueDate: string;            // 出産予定日
  multipleBirth: boolean;     // 多胎かどうか
  startDate: string;          // 産前産後休業開始年月日
  plannedEndDate: string;     // 産前産後休業終了予定年月日
  childBirthDate: string;     // 出産年月日（産後に出す場合）
  note: string;
  // 変更欄
  newDueDate?: string;
  newMultipleBirth?: boolean | null;
  newStartDate?: string;
  newPlannedEndDate?: string;
  // 終了欄
  actualEndDate?: string;
};

/** 和暦の「元号コード・YYMMDD」を2つ並べて返す。日付が無ければ空2つ */
function warekiPair(iso: string): [string, string] {
  const w = toWareki(iso);
  return w ? [String(w.code), w.yymmdd] : ['', ''];
}

/** 産前産後休業取得者申出書／変更（終了）届 データレコード（33項目） */
export function buildNenkinSanzenFields(office: OfficeInfo, p: NenkinSanzenInput): string[] {
  const my = digits(p.myNumber);
  const pn = digits(p.pensionNumber);
  const birth = warekiPair(p.birthDate);
  const due = warekiPair(p.dueDate);
  const start = warekiPair(p.startDate);
  const planned = warekiPair(p.plannedEndDate);
  const born = warekiPair(p.childBirthDate);
  const newDue = warekiPair(p.newDueDate || '');
  const newStart = warekiPair(p.newStartDate || '');
  const newPlanned = warekiPair(p.newPlannedEndDate || '');
  const actual = warekiPair(p.actualEndDate || '');
  return [
    NENKIN_SANZEN_FORM_CODE,
    office.prefCode, office.cityCode, office.officeSymbol,
    digits(p.insuredNumber),
    normalizeKanaName(p.kanaName),
    normalizeKanjiName(p.kanjiName),
    my,
    // この様式の課所符号・一連番号は「個人番号が空欄の場合省略不可」とされており、
    // 個人番号があっても省略しなければならない欄ではありません
    //（仕様書 項番9・10）。仕様書の作成例も両方が入っています。
    pn.slice(0, 4), pn.slice(4, 10),
    birth[0], birth[1],
    due[0], due[1],
    p.multipleBirth ? '1' : '0',
    start[0], start[1],
    planned[0], planned[1],
    '', '',                               // 予備1・予備2
    born[0], born[1],
    String(p.note || ''),
    newDue[0], newDue[1],
    p.newMultipleBirth == null ? '' : (p.newMultipleBirth ? '1' : '0'),
    newStart[0], newStart[1],
    newPlanned[0], newPlanned[1],
    actual[0], actual[1],
  ];
}

export function buildNenkinSanzen(office: OfficeInfo, p: NenkinSanzenInput): string {
  return join(buildNenkinSanzenFields(office, p));
}

// ============================================================
// 育児休業等取得者申出書（新規・延長）／終了届
//   仕様書 ４．１３．１（年金事務所提出・56項目）
//
//   終了予定日を延ばすときは「延長欄」、予定より早く終わったときは
//   「終了欄」も入れます。開始日と終了予定日の翌日が同じ月に入り、
//   かつ複数回取るときは「育休等取得内訳欄」（①〜④）も入れます。
// ============================================================

export const NENKIN_IKUJI_FORM_CODE = '2263700';

export const NENKIN_IKUJI_SPECS: FieldSpec[] = [
  { no: 1, label: '様式コード', kind: 'num', min: 7, max: 7 },
  { no: 2, label: '都道府県コード', kind: 'num', min: 2, max: 2 },
  { no: 3, label: '郡市区符号', kind: 'num', min: 2, max: 2 },
  { no: 4, label: '事業所記号', kind: 'kana', min: 1, max: 4 },
  { no: 5, label: '被保険者整理番号', kind: 'num', min: 0, max: 6 },
  { no: 6, label: '被保険者氏名（カナ）', kind: 'kana', min: 1, max: 25 },
  { no: 7, label: '被保険者氏名（漢字）', kind: 'kanji', min: 0, max: 12 },
  { no: 8, label: '被保険者の個人番号', kind: 'num', min: 0, max: 12 },
  { no: 9, label: '課所符号', kind: 'num', min: 0, max: 4 },
  { no: 10, label: '一連番号', kind: 'num', min: 0, max: 6 },
  { no: 11, label: '元号（被保険者生年月日）', kind: 'num', min: 1, max: 1 },
  { no: 12, label: '被保険者生年月日', kind: 'num', min: 6, max: 6 },
  { no: 13, label: '被保険者の性別', kind: 'num', min: 1, max: 1 },
  { no: 14, label: '養育する子の氏名（カナ）', kind: 'kana', min: 1, max: 25 },
  { no: 15, label: '養育する子の氏名（漢字）', kind: 'kanji', min: 1, max: 12 },
  { no: 16, label: '元号（養育する子の生年月日）', kind: 'num', min: 1, max: 1 },
  { no: 17, label: '養育する子の生年月日', kind: 'num', min: 6, max: 6 },
  { no: 18, label: '区分（実子かその他か）', kind: 'num', min: 1, max: 1 },
  { no: 19, label: '元号（養育開始年月日（実子以外））', kind: 'num', min: 0, max: 1 },
  { no: 20, label: '養育開始年月日（実子以外）', kind: 'num', min: 0, max: 6 },
  { no: 21, label: '元号（育児休業等開始年月日）', kind: 'num', min: 1, max: 1 },
  { no: 22, label: '育児休業等開始年月日', kind: 'num', min: 6, max: 6 },
  { no: 23, label: '元号（育児休業等終了（予定）年月日）', kind: 'num', min: 1, max: 1 },
  { no: 24, label: '育児休業等終了（予定）年月日', kind: 'num', min: 6, max: 6 },
  { no: 25, label: '育児休業等取得日数', kind: 'num', min: 0, max: 2 },
  { no: 26, label: '就業予定日数', kind: 'num', min: 0, max: 2 },
  { no: 27, label: 'パパママ育休プラス該当区分', kind: 'num', min: 0, max: 1 },
  { no: 28, label: '備考', kind: 'mixed', min: 0, max: 37, maxHalf: 75 },
  { no: 29, label: '元号（育児休業等終了（予定）年月日（変更後））', kind: 'num', min: 0, max: 1 },
  { no: 30, label: '育児休業等終了（予定）年月日（変更後）', kind: 'num', min: 0, max: 6 },
  { no: 31, label: '育児休業等取得日数（変更後）①', kind: 'num', min: 0, max: 2 },
  { no: 32, label: '元号（育児休業等終了年月日）', kind: 'num', min: 0, max: 1 },
  { no: 33, label: '育児休業等終了年月日', kind: 'num', min: 0, max: 6 },
  { no: 34, label: '育児休業等取得日数（変更後）②', kind: 'num', min: 0, max: 2 },
  { no: 35, label: '元号（育児休業等開始年月日①）', kind: 'num', min: 0, max: 1 },
  { no: 36, label: '育児休業等開始年月日①', kind: 'num', min: 0, max: 6 },
  { no: 37, label: '元号（育児休業等終了（予定）年月日①）', kind: 'num', min: 0, max: 1 },
  { no: 38, label: '育児休業等終了（予定）年月日①', kind: 'num', min: 0, max: 6 },
  { no: 39, label: '育児休業等取得日数①', kind: 'num', min: 0, max: 2 },
  { no: 40, label: '就業予定日数①', kind: 'num', min: 0, max: 2 },
  { no: 41, label: '元号（育児休業等開始年月日②）', kind: 'num', min: 0, max: 1 },
  { no: 42, label: '育児休業等開始年月日②', kind: 'num', min: 0, max: 6 },
  { no: 43, label: '元号（育児休業等終了（予定）年月日②）', kind: 'num', min: 0, max: 1 },
  { no: 44, label: '育児休業等終了（予定）年月日②', kind: 'num', min: 0, max: 6 },
  { no: 45, label: '育児休業等取得日数②', kind: 'num', min: 0, max: 2 },
  { no: 46, label: '就業予定日数②', kind: 'num', min: 0, max: 2 },
  { no: 47, label: '元号（育児休業等開始年月日③）', kind: 'num', min: 0, max: 1 },
  { no: 48, label: '育児休業等開始年月日③', kind: 'num', min: 0, max: 6 },
  { no: 49, label: '元号（育児休業等終了（予定）年月日③）', kind: 'num', min: 0, max: 1 },
  { no: 50, label: '育児休業等終了（予定）年月日③', kind: 'num', min: 0, max: 6 },
  { no: 51, label: '育児休業等取得日数③', kind: 'num', min: 0, max: 2 },
  { no: 52, label: '元号（育児休業等開始年月日④）', kind: 'num', min: 0, max: 1 },
  { no: 53, label: '育児休業等開始年月日④', kind: 'num', min: 0, max: 6 },
  { no: 54, label: '元号（育児休業等終了（予定）年月日④）', kind: 'num', min: 0, max: 1 },
  { no: 55, label: '育児休業等終了（予定）年月日④', kind: 'num', min: 0, max: 6 },
  { no: 56, label: '育児休業等取得日数④', kind: 'num', min: 0, max: 2 },
];

/** 養育する子の区分（仕様書 項番18） */
export const CHILD_RELATIONS = [
  { code: '1', label: '実子' },
  { code: '2', label: 'その他（養子など）' },
];

export type NenkinIkujiInput = {
  insuredNumber: string;
  kanaName: string;
  kanjiName: string;
  birthDate: string;
  gender: string;
  myNumber: string;
  pensionNumber: string;
  childKana: string;
  childKanji: string;
  childBirthDate: string;
  childRelation: string;      // 1=実子 2=その他
  careStartDate: string;      // 養育開始年月日（実子以外）
  startDate: string;          // 育児休業等開始年月日
  plannedEndDate: string;     // 育児休業等終了（予定）年月日
  leaveDays: number | null;   // 育児休業等取得日数（同一月内のときだけ）
  workDays: number | null;    // 就業予定日数（同上）
  papaMamaPlus: boolean;
  note: string;
  // 延長欄
  newPlannedEndDate?: string;
  newLeaveDays1?: number | null;
  // 終了欄
  actualEndDate?: string;
  newLeaveDays2?: number | null;
};

/** 育児休業等取得者申出書（新規・延長）／終了届 データレコード（56項目） */
export function buildNenkinIkujiFields(office: OfficeInfo, p: NenkinIkujiInput): string[] {
  const my = digits(p.myNumber);
  const pn = digits(p.pensionNumber);
  const birth = warekiPair(p.birthDate);
  const childBirth = warekiPair(p.childBirthDate);
  const care = warekiPair(p.careStartDate || '');
  const start = warekiPair(p.startDate);
  const planned = warekiPair(p.plannedEndDate);
  const newPlanned = warekiPair(p.newPlannedEndDate || '');
  const actual = warekiPair(p.actualEndDate || '');
  const dayCount = (v: number | null | undefined) =>
    (v == null || !Number.isFinite(Number(v))) ? '' : pad2(Math.max(0, Math.min(99, Math.round(Number(v)))));
  return [
    NENKIN_IKUJI_FORM_CODE,
    office.prefCode, office.cityCode, office.officeSymbol,
    digits(p.insuredNumber),
    normalizeKanaName(p.kanaName),
    normalizeKanjiName(p.kanjiName),
    my,
    // 産前産後と同じく、個人番号があっても省略しなければならない欄ではありません
    pn.slice(0, 4), pn.slice(4, 10),
    birth[0], birth[1],
    genderCode(p.gender),
    normalizeKanaName(p.childKana),
    normalizeKanjiName(p.childKanji),
    childBirth[0], childBirth[1],
    String(p.childRelation || ''),
    care[0], care[1],
    start[0], start[1],
    planned[0], planned[1],
    dayCount(p.leaveDays), dayCount(p.workDays),
    flag(p.papaMamaPlus),
    String(p.note || ''),
    newPlanned[0], newPlanned[1], dayCount(p.newLeaveDays1),
    actual[0], actual[1], dayCount(p.newLeaveDays2),
    // 育休等取得内訳欄①〜④（項番35〜56）。Brown Work ではまだ使いません
    '', '', '', '', '', '',
    '', '', '', '', '', '',
    '', '', '', '', '',
    '', '', '', '', '',
  ];
}

export function buildNenkinIkuji(office: OfficeInfo, p: NenkinIkujiInput): string {
  return join(buildNenkinIkujiFields(office, p));
}
