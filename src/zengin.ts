// 全銀協規定形式（給与振込・賞与振込）の振込データを作る
//
// 出どころ（2つで突き合わせ済み）
//   群馬銀行「全銀協制定ファイルフォーマット【給与(賞与)振込】」
//     https://www.gunmabank.co.jp/hojin/biznb/service/pdf/z_format2.pdf
//   三井住友銀行「給与／賞与振込（全銀形式）」
//     https://www.smbc.co.jp/hojin/eb/web21/pdf/file-layout_02.pdf
//
// レコードは4種類、いずれも120バイト固定長です。
//   ヘッダー（1）→ データ（2）を人数分 → トレーラ（8）→ エンド（9）
//
// 属性
//   N（数字）… 右詰め、余白は 0 で埋める
//   C（半角文字）… 左詰め、余白はスペースで埋める
//
// ⚠ 銀行によって細かい決まりが違うことがあります（改行の有無、
//   銀行名・支店名を空けてよいか、使える記号など）。
//   はじめて出すときは、必ず取引銀行にテストデータで確認してください。

export const ZENGIN_RECORD_LENGTH = 120;

/** 種別コード */
export const ZENGIN_KINDS = {
  salary: { code: '11', label: '給与振込' },
  bonus: { code: '12', label: '賞与振込' },
} as const;
export type ZenginKind = keyof typeof ZENGIN_KINDS;

/** 預金種目 */
export const ZENGIN_ACCOUNT_TYPES: Record<string, string> = {
  普通: '1',
  当座: '2',
  貯蓄: '4',
  その他: '9',
};

// 使用できる文字。全銀協規定形式は半角のみです。
//   数字・英大文字・半角カナ（濁点半濁点は独立した1文字）・スペース
//   記号は銀行によって差があるため、広く認められているものだけにしています。
const ALLOWED_SYMBOLS = ' .-()/\\,';
function isAllowedChar(ch: string): boolean {
  if (ch >= '0' && ch <= '9') return true;
  if (ch >= 'A' && ch <= 'Z') return true;
  if (ALLOWED_SYMBOLS.indexOf(ch) >= 0) return true;
  const c = ch.charCodeAt(0);
  // 半角カナ（｡ から ﾟ まで）。濁点ﾞ・半濁点ﾟもこの範囲です
  if (c >= 0xff61 && c <= 0xff9f) return true;
  return false;
}

/** 使えない文字を拾う（出力前に画面で知らせるため） */
export function badChars(src: string): string[] {
  const bad: string[] = [];
  for (const ch of String(src || '')) {
    if (!isAllowedChar(ch) && bad.indexOf(ch) < 0) bad.push(ch);
  }
  return bad;
}

/** 半角カナ・英大文字にそろえる。変換できない文字はそのまま残す（あとで知らせる） */
export function toZenginText(src: string, toHalfKana: (s: string) => string): string {
  return toHalfKana(String(src || '')).toUpperCase();
}

/** N（数字）… 右詰め・0埋め。長すぎるときは下位を残す */
export function num(value: string | number, width: number): string {
  const digits = String(value ?? '').replace(/[^0-9]/g, '');
  if (digits.length >= width) return digits.slice(digits.length - width);
  return digits.padStart(width, '0');
}

/** C（半角文字）… 左詰め・スペース埋め。長すぎるときは切る */
export function text(value: string, width: number): string {
  const s = String(value ?? '');
  if (s.length >= width) return s.slice(0, width);
  return s.padEnd(width, ' ');
}

export type ZenginPayer = {
  consignorCode: string;    // 委託者コード（10桁・銀行が定める）
  consignorName: string;    // 振込依頼人名（カナ40）
  bankCode: string;         // 仕向銀行番号（4）
  bankKana: string;         // 仕向銀行名（カナ15）
  branchCode: string;       // 仕向支店番号（3）
  branchKana: string;       // 仕向支店名（カナ15）
  accountType: string;      // 預金種目（1/2/4/9）
  accountNumber: string;    // 口座番号（7）
};

export type ZenginRow = {
  bankCode: string;         // 被仕向銀行番号（4）
  bankKana: string;         // 被仕向銀行名（カナ15）
  branchCode: string;       // 被仕向支店番号（3）
  branchKana: string;       // 被仕向支店名（カナ15）
  accountType: string;      // 預金種目（1/2/4/9）
  accountNumber: string;    // 口座番号（7）
  holderKana: string;       // 受取人名（カナ30）
  amount: number;           // 振込金額
  staffNumber?: string;     // 社員番号（10・任意）
  groupCode?: string;       // 所属コード（10・任意）
};

/** ヘッダー・レコード（データ区分1） */
export function zenginHeader(payer: ZenginPayer, kind: ZenginKind, payDate: { month: number; day: number }): string {
  return [
    '1',                               // 1 データ区分
    ZENGIN_KINDS[kind].code,           // 2 種別コード（11給与／12賞与）
    '0',                               // 3 コード区分（0=JIS）
    num(payer.consignorCode, 10),      // 4 振込依頼人コード
    text(payer.consignorName, 40),     // 5 振込依頼人名
    num(payDate.month, 2) + num(payDate.day, 2), // 6 振込指定日（MMDD）
    num(payer.bankCode, 4),            // 7 仕向銀行番号
    text(payer.bankKana, 15),          // 8 仕向銀行名
    num(payer.branchCode, 3),          // 9 仕向支店番号
    text(payer.branchKana, 15),        // 10 仕向支店名
    num(payer.accountType, 1),         // 11 預金種目
    num(payer.accountNumber, 7),       // 12 口座番号
    text('', 17),                      // 13 ダミー
  ].join('');
}

/** データ・レコード（データ区分2） */
export function zenginData(row: ZenginRow): string {
  return [
    '2',                               // 1 データ区分
    num(row.bankCode, 4),              // 2 被仕向銀行番号
    text(row.bankKana, 15),            // 3 被仕向銀行名
    num(row.branchCode, 3),            // 4 被仕向支店番号
    text(row.branchKana, 15),          // 5 被仕向支店名
    num(0, 4),                         // 6 手形交換所番号（未使用・0）
    num(row.accountType, 1),           // 7 預金種目
    num(row.accountNumber, 7),         // 8 口座番号
    text(row.holderKana, 30),          // 9 受取人名
    num(Math.max(0, Math.round(row.amount)), 10), // 10 振込金額
    num(0, 1),                         // 11 新規コード（未使用・0）
    text(row.staffNumber || '', 10),   // 12 社員番号
    text(row.groupCode || '', 10),     // 13 所属コード
    text('', 9),                       // 14 ダミー
  ].join('');
}

/** トレーラ・レコード（データ区分8） */
export function zenginTrailer(count: number, total: number): string {
  return ['8', num(count, 6), num(total, 12), text('', 101)].join('');
}

/** エンド・レコード（データ区分9） */
export function zenginEnd(): string {
  return ['9', text('', 119)].join('');
}

export type ZenginIssue = { where: string; message: string };

/**
 * 振込データを組み立てます。
 * 出せない行があるときは、作らずに理由を返します（金額の取り違えを防ぐため）。
 */
export function buildZengin(
  payer: ZenginPayer,
  rows: ZenginRow[],
  kind: ZenginKind,
  payDate: { month: number; day: number },
  options: { newline?: string } = {},
): { text: string; count: number; total: number; issues: ZenginIssue[] } {
  const issues: ZenginIssue[] = [];
  const need = (where: string, label: string, v: string) => {
    if (!String(v || '').trim()) issues.push({ where, message: `${label}が未登録です。` });
  };

  need('振込元', '委託者コード', payer.consignorCode);
  need('振込元', '振込依頼人名', payer.consignorName);
  need('振込元', '仕向銀行番号', payer.bankCode);
  need('振込元', '仕向支店番号', payer.branchCode);
  need('振込元', '口座番号', payer.accountNumber);
  [['振込依頼人名', payer.consignorName], ['仕向銀行名', payer.bankKana], ['仕向支店名', payer.branchKana]]
    .forEach(([label, v]) => {
      const bad = badChars(String(v || ''));
      if (bad.length) issues.push({ where: '振込元', message: `${label}に使えない文字があります（${bad.join('')}）。` });
    });

  rows.forEach((r, i) => {
    const who = r.holderKana || `${i + 1}行目`;
    need(who, '銀行コード', r.bankCode);
    need(who, '支店コード', r.branchCode);
    need(who, '口座番号', r.accountNumber);
    need(who, '口座名義（カナ）', r.holderKana);
    if (!(Math.round(r.amount) > 0)) issues.push({ where: who, message: '振込金額が0円以下です。' });
    [['口座名義', r.holderKana], ['銀行名', r.bankKana], ['支店名', r.branchKana], ['社員番号', r.staffNumber || '']]
      .forEach(([label, v]) => {
        const bad = badChars(String(v || ''));
        if (bad.length) issues.push({ where: who, message: `${label}に使えない文字があります（${bad.join('')}）。` });
      });
    if (String(r.holderKana || '').length > 30) {
      issues.push({ where: who, message: '口座名義が30文字を超えています。切り詰めると別人の口座に振り込まれる恐れがあります。' });
    }
  });

  const count = rows.length;
  const total = rows.reduce((s, r) => s + Math.max(0, Math.round(r.amount)), 0);
  if (issues.length > 0) return { text: '', count, total, issues };

  const nl = options.newline ?? '\r\n';
  const lines = [
    zenginHeader(payer, kind, payDate),
    ...rows.map(zenginData),
    zenginTrailer(count, total),
    zenginEnd(),
  ];
  return { text: lines.join(nl) + nl, count, total, issues };
}
