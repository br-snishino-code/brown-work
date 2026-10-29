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
  addressKanji: '', nameKanji: '', ownerKanji: '',
  tel1: '', tel2: '', tel3: '',
  eiOffice: '', eiSerial: '', eiCheck: '',
  hwName: '', mediaSeq: 1,
};

export const OFFICE_FIELD_LABELS: Record<keyof OfficeInfo, string> = {
  prefCode: '都道府県コード', cityCode: '郡市区符号', officeSymbol: '事業所記号',
  officeNumber: '事業所番号', postalParent: '郵便番号（上3桁）', postalChild: '郵便番号（下4桁）',
  addressKanji: '事業所所在地', nameKanji: '事業所名称', ownerKanji: '事業主氏名',
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
  { no: 9, label: '被保険者氏名フリガナ', kind: 'kana', min: 1, max: 20 },
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
  { no: 21, label: '新氏名フリガナ', kind: 'kana', min: 0, max: 20 },
  { no: 22, label: '新氏名', kind: 'kanji', min: 0, max: 12 },
  { no: 23, label: '補充採用予定の有無', kind: 'kanji', min: 1, max: 1 },
  { no: 24, label: '被保険者氏名フリガナ', kind: 'kana', min: 1, max: 20 },
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
  office: OfficeInfo, kind: 'shutoku' | 'soshitsu', dataLines: string[], createdAt: Date,
): string {
  const version = kind === 'shutoku' ? HW_VERSION_SHUTOKU : HW_VERSION_SOSHITSU;
  const header = kind === 'shutoku' ? HW_SHUTOKU_HEADER : HW_SOSHITSU_HEADER;
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
