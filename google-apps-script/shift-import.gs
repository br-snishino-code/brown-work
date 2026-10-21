/**
 * Brown Work のシフト希望を、このスプレッドシートに取り込むスクリプト。
 *
 * ■ 設置方法
 *   1. スプレッドシートを開く
 *   2. メニューの「拡張機能」→「Apps Script」
 *   3. 既定の Code.gs の中身をすべて消し、このファイルの内容を貼り付けて保存
 *   4. スプレッドシートを再読み込みすると、上部に「Brown Work」メニューが出ます
 *   5. 「Brown Work」→「接続の設定」で、接続先と合言葉を入力
 *
 * ■ 翌月のファイルを複製で作ったとき
 *   「Brown Work」→「複製したファイルの初期設定」を一度押してください。
 *   設定は隠しシート（_BrownWork設定）に入っていて複製と一緒についてきますが、
 *   合言葉と自動実行の設定だけは引き継がれないため、ここでそろえます。
 *
 * ■ 使い方
 *   「Brown Work」→「シフト希望を取り込む」→ 対象月を入力
 *   「シフト希望_2026-11」というシートが作られ（あれば上書き）、
 *   スタッフ×日付の表が書き込まれます。
 *
 * ■ 自動で取り込む場合
 *   「Brown Work」→「自動取り込みの間隔を選ぶ」から、毎朝1回・30分おき・15分おきを選べます。
 *   止めるときは「自動取り込みを解除」。今の設定は「自動取り込みの状態を見る」で確認できます。
 *   内容が前回と変わっていないときはシートを書き換えないため、
 *   短い間隔にしても、見ている最中に表示が消えることはありません。
 */

var SHEET_PREFIX = 'シフト希望_';
// 前回取り込んだ内容の指紋と、最後に動いた時刻を覚えておくための名前
var FINGERPRINT_PROP = 'SHIFT_IMPORT_FINGERPRINT_';
var LAST_RUN_PROP = 'SHIFT_IMPORT_LAST_RUN';
// 確定シフトを送るときに使うもの
var PUSH_FINGERPRINT_PROP = 'SHIFT_PUSH_FINGERPRINT_';
var LAST_PUSH_PROP = 'SHIFT_PUSH_LAST_RUN';
var CONFIRMED_SHEET_PROP = 'CONFIRMED_SHEET_NAME';
// 設定を書いておく隠しシート。スプレッドシートを複製すると一緒についてくるため、
// 翌月のファイルでも設定を引き継げる。合言葉だけはここに書かない。
var CONFIG_SHEET_NAME = '_BrownWork設定';
var SECRET_KEYS = ['SHIFT_API_KEY'];
var NAME_COLUMN_PROP = 'CONFIRMED_NAME_COLUMN';
var START_ROW_PROP = 'CONFIRMED_START_ROW';
var END_ROW_PROP = 'CONFIRMED_END_ROW';
// 見出しにこの文字が入っている列を氏名の列とみなす
var NAME_HEADER_WORDS = ['スタッフ名', '氏名', '名前', '社員名', '従業員名'];

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Brown Work')
    .addItem('シフト希望を取り込む', 'importShiftRequestsPrompt')
    .addItem('確定シフトを送る', 'pushConfirmedShiftsPrompt')
    .addSeparator()
    .addItem('自動取り込みの間隔を選ぶ', 'chooseTriggerInterval')
    .addItem('自動取り込みの状態を見る', 'showTriggerStatus')
    .addItem('自動取り込みを解除', 'removeDailyTrigger')
    .addSeparator()
    .addItem('確定シフトの読み取り設定', 'setConfirmedReadSettings')
    .addSeparator()
    .addItem('接続の設定', 'setConnectionSettings')
    .addItem('複製したファイルの初期設定', 'setupCopiedFile')
    .addToUi();
}

/** 対象月を聞いてから取り込む */
function importShiftRequestsPrompt() {
  var ui = SpreadsheetApp.getUi();
  var res = ui.prompt('シフト希望の取り込み', '対象月を YYYY-MM の形式で入力してください（例：2026-11）', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  var month = res.getResponseText().trim();
  if (!/^\d{4}-\d{2}$/.test(month)) {
    ui.alert('対象月の形式が違います。2026-11 のように入力してください。');
    return;
  }
  try {
    // 手動のときは、変化がなくても必ず書き直す
    var result = importShiftRequests(month, true);
    ui.alert(
      '取り込みました',
      month + '分：' + result.submittedCount + '／' + result.totalCount + '名が提出済みです。\n' +
      'シート「' + SHEET_PREFIX + month + '」をご確認ください。',
      ui.ButtonSet.OK
    );
  } catch (e) {
    ui.alert('取り込みに失敗しました', String(e.message || e), ui.ButtonSet.OK);
  }
}

/** 自動取り込み用。翌月分を取り込む */
function importNextMonthShiftRequests() {
  var now = new Date();
  var y = now.getMonth() === 11 ? now.getFullYear() + 1 : now.getFullYear();
  var m = now.getMonth() === 11 ? 1 : now.getMonth() + 2;
  importShiftRequests(y + '-' + ('0' + m).slice(-2));
}

/** 本体：APIから取得してシートへ書き込む */
function importShiftRequests(month, force) {
  var baseUrl = (readConfig('SUPABASE_URL') || '').replace(/\/+$/, '');
  var apiKey = readConfig('SHIFT_API_KEY') || '';
  if (!baseUrl || !apiKey) {
    throw new Error('接続先が設定されていません。「Brown Work」→「接続の設定」から設定してください。');
  }

  var url = baseUrl + '/functions/v1/shift-requests-export?month=' + encodeURIComponent(month);
  var response = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: { 'x-api-key': apiKey },
    muteHttpExceptions: true
  });
  var code = response.getResponseCode();
  var body = response.getContentText();
  if (code !== 200) {
    var message = body;
    try { message = JSON.parse(body).error || body; } catch (ignore) {}
    throw new Error('APIエラー（' + code + '）：' + message);
  }
  var data = JSON.parse(body);

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetName = SHEET_PREFIX + month;
  var sheet = ss.getSheetByName(sheetName);
  var props = PropertiesService.getScriptProperties();
  props.setProperty(LAST_RUN_PROP, Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm'));

  // 前回と中身が同じなら、シートを書き換えずに終わる。
  // 短い間隔で動かしても、見ている最中に表示が消えないようにするため。
  // 取り込み日時は毎回変わるので、指紋には含めない。
  var fingerprint = buildFingerprint(data);
  var previous = props.getProperty(FINGERPRINT_PROP + month);
  if (sheet && previous === fingerprint && !force) {
    data.skipped = true;
    return data;
  }

  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  } else {
    sheet.clear();
  }

  // 1行目：取り込み日時と提出状況
  var stamp = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');
  sheet.getRange(1, 1).setValue(
    month + '分のシフト希望　取り込み：' + stamp +
    '　提出 ' + data.submittedCount + '／' + data.totalCount + '名' +
    (data.deadline ? '　締切 ' + data.deadline : '')
  );
  sheet.getRange(1, 1).setFontWeight('bold');

  // 2行目：見出し（氏名・グループ・日付・メモ）
  var header = ['氏名', 'グループ'];
  for (var i = 0; i < data.days.length; i++) {
    header.push(data.days[i].day + '(' + data.days[i].weekday + ')');
  }
  header.push('出勤可能', 'メモ');
  sheet.getRange(2, 1, 1, header.length).setValues([header]);

  // 3行目以降：スタッフごとの希望
  var values = [];
  for (var r = 0; r < data.rows.length; r++) {
    var row = data.rows[r];
    var line = [row.name, row.group];
    var okCount = 0;
    for (var c = 0; c < row.cells.length; c++) {
      line.push(row.cells[c]);
      // ● のほか、活動場所が書かれている日も出勤可能として数える
      if (row.cells[c] && row.cells[c] !== '×' && row.cells[c] !== '有給') okCount++;
    }
    line.push(row.submitted ? okCount : '未提出');
    line.push(row.note || '');
    values.push(line);
  }
  if (values.length > 0) {
    sheet.getRange(3, 1, values.length, header.length).setValues(values);
  }

  // 見た目を整える
  sheet.setFrozenRows(2);
  sheet.setFrozenColumns(2);
  sheet.getRange(2, 1, 1, header.length).setFontWeight('bold').setBackground('#f1f3f4');
  sheet.setColumnWidth(1, 110);
  sheet.setColumnWidth(2, 90);
  for (var d = 0; d < data.days.length; d++) {
    sheet.setColumnWidth(3 + d, 34);
    // 土日は色を変える
    var wd = data.days[d].weekday;
    if (wd === '土' || wd === '日') {
      sheet.getRange(2, 3 + d, Math.max(values.length, 1) + 1, 1)
        .setBackground(wd === '日' ? '#fce8e6' : '#e8f0fe');
    }
  }
  if (data.days.length > 0) {
    sheet.getRange(3, 3, Math.max(values.length, 1), data.days.length)
      .setHorizontalAlignment('center');
  }

  props.setProperty(FINGERPRINT_PROP + month, fingerprint);
  data.skipped = false;
  return data;
}

/** 取り込んだ内容から指紋を作る。中身が1文字でも違えば別の文字列になる */
function buildFingerprint(data) {
  var parts = [String(data.deadline || ''), String(data.isOpen)];
  for (var i = 0; i < data.rows.length; i++) {
    var row = data.rows[i];
    parts.push(row.name + '\u0001' + row.group + '\u0001' + (row.submitted ? '1' : '0') +
      '\u0001' + row.cells.join('\u0002') + '\u0001' + (row.note || ''));
  }
  var text = parts.join('\u0003');
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, text, Utilities.Charset.UTF_8);
  var hex = '';
  for (var b = 0; b < bytes.length; b++) {
    hex += ('0' + (bytes[b] & 0xff).toString(16)).slice(-2);
  }
  return hex;
}

/** 自動取り込みの間隔。メニューに出る順番で並べる */
var INTERVALS = [
  { key: 'daily',  label: '毎朝1回（6時台）' },
  { key: 'm30',    label: '30分おき' },
  { key: 'm15',    label: '15分おき' },
  { key: 'm5',     label: '5分おき' },
];

var INTERVAL_PROP = 'SHIFT_IMPORT_INTERVAL';

/** 間隔を選んで自動取り込みを設定する */
function chooseTriggerInterval() {
  var ui = SpreadsheetApp.getUi();
  var lines = [];
  for (var i = 0; i < INTERVALS.length; i++) {
    lines.push((i + 1) + '：' + INTERVALS[i].label);
  }
  var res = ui.prompt(
    '自動取り込みの間隔',
    '番号で選んでください。\n\n' + lines.join('\n') +
    '\n\n受付期間中だけ短くして、締め切ったら「毎朝1回」に戻す使い方がおすすめです。',
    ui.ButtonSet.OK_CANCEL
  );
  if (res.getSelectedButton() !== ui.Button.OK) return;

  var n = parseInt(res.getResponseText().trim(), 10);
  if (!(n >= 1 && n <= INTERVALS.length)) {
    ui.alert('1〜' + INTERVALS.length + ' の番号で入力してください。');
    return;
  }
  var chosen = INTERVALS[n - 1];
  setTriggerInterval(chosen.key);
  ui.alert(
    '設定しました',
    '「' + chosen.label + '」で、翌月分のシフト希望を自動で取り込みます。\n' +
    '内容が前回と変わっていないときは、シートを書き換えません。',
    ui.ButtonSet.OK
  );
}

/** 指定された間隔でトリガーを作り直す */
function setTriggerInterval(key) {
  removeTriggersOnly();
  // シフト希望の取り込みと、確定シフトの送信を同じ間隔で動かす
  ['importNextMonthShiftRequests', 'pushConfirmedShiftsAuto'].forEach(function (fn) {
    var builder = ScriptApp.newTrigger(fn).timeBased();
    switch (key) {
      case 'm5':  builder.everyMinutes(5); break;
      case 'm15': builder.everyMinutes(15); break;
      case 'm30': builder.everyMinutes(30); break;
      default:    builder.atHour(6).everyDays(1); break;
    }
    builder.create();
  });
  if (['m5', 'm15', 'm30'].indexOf(key) < 0) key = 'daily';
  writeConfig(INTERVAL_PROP, key);
}

/** 今の設定を表示する */
function showTriggerStatus() {
  var ui = SpreadsheetApp.getUi();
  var triggers = ScriptApp.getProjectTriggers();
  var running = false;
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'importNextMonthShiftRequests') running = true;
  }
  var lastPush = PropertiesService.getScriptProperties().getProperty(LAST_PUSH_PROP);
  if (!running) {
    ui.alert('自動取り込みの状態', '今は自動取り込みを設定していません。', ui.ButtonSet.OK);
    return;
  }
  var key = readConfig(INTERVAL_PROP) || 'daily';
  var label = key;
  for (var j = 0; j < INTERVALS.length; j++) {
    if (INTERVALS[j].key === key) label = INTERVALS[j].label;
  }
  var last = PropertiesService.getScriptProperties().getProperty(LAST_RUN_PROP);
  ui.alert(
    '自動取り込みの状態',
    '間隔：' + label + '\n' +
    'シフト希望の取り込み：' + (last || '記録なし') + '\n' +
    '確定シフトの送信：' + (lastPush || '記録なし'),
    ui.ButtonSet.OK
  );
}

/** 旧バージョンとの互換。毎朝1回で設定する */
function createDailyTrigger() {
  setTriggerInterval('daily');
  SpreadsheetApp.getUi().alert('毎朝6時台に、翌月分のシフト希望を自動で取り込みます。');
}

/** トリガーだけを消す（メッセージを出さない） */
function removeTriggersOnly() {
  var mine = ['importNextMonthShiftRequests', 'pushConfirmedShiftsAuto'];
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (mine.indexOf(triggers[i].getHandlerFunction()) >= 0) {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
}

/** 自動取り込みを止める */
function removeDailyTrigger() {
  removeTriggersOnly();
  writeConfig(INTERVAL_PROP, '');
  SpreadsheetApp.getUi().alert('自動取り込みを解除しました。');
}

// ============================================================
// 確定シフトを Brown Work へ送る
// ============================================================
//
// 読み取り方：
//   ・見出し行は「1(日)」「2(月)」…のようなセルが並んでいる行を自動で探す
//   ・氏名は、日付が始まる列より左にある列から自動で探す
//   ・対象月は、ファイル名（例：2026年11月スタッフ勤務シフト）から読み取る
//     読み取れないときは入力を求める
//
// セルの中身：
//   空欄        → 休み
//   有給を含む  → 有給
//   それ以外    → 出勤。その文字をそのまま活動場所として送る

/** 設定を読む。スクリプト プロパティ → 設定シート の順に探す */
function readConfig(key) {
  var fromProps = PropertiesService.getScriptProperties().getProperty(key);
  if (fromProps !== null && fromProps !== '') return fromProps;
  if (SECRET_KEYS.indexOf(key) >= 0) return null;   // 合言葉はシートに書かない
  var map = readConfigSheet();
  return map[key] || null;
}

/** 設定を書く。スクリプト プロパティと設定シートの両方に残す */
function writeConfig(key, value) {
  var props = PropertiesService.getScriptProperties();
  if (value === null || value === '') props.deleteProperty(key);
  else props.setProperty(key, String(value));
  if (SECRET_KEYS.indexOf(key) >= 0) return;
  writeConfigSheet(key, value);
}

/** 設定シートを読む */
function readConfigSheet() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG_SHEET_NAME);
  var map = {};
  if (!sheet) return map;
  var values = sheet.getDataRange().getValues();
  for (var i = 0; i < values.length; i++) {
    var k = String(values[i][0] == null ? '' : values[i][0]).trim();
    if (k && k.charAt(0) !== '#') map[k] = String(values[i][1] == null ? '' : values[i][1]).trim();
  }
  return map;
}

/** 設定シートに1行書く。無ければシートを作る */
function writeConfigSheet(key, value) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CONFIG_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG_SHEET_NAME);
    sheet.getRange(1, 1, 1, 3).setValues([['# 設定名', '値', '説明']]);
    sheet.getRange(1, 1, 1, 3).setFontWeight('bold').setBackground('#f1f3f4');
    sheet.setColumnWidth(1, 220);
    sheet.setColumnWidth(2, 280);
    sheet.setColumnWidth(3, 420);
    sheet.getRange(2, 1).setValue('# このシートは Brown Work 連携の設定です。削除しないでください。');
    sheet.hideSheet();
  }
  var values = sheet.getDataRange().getValues();
  var target = -1;
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0] == null ? '' : values[i][0]).trim() === key) { target = i + 1; break; }
  }
  if (value === null || value === '') {
    if (target > 0) sheet.getRange(target, 2).setValue('');
    return;
  }
  if (target < 0) {
    target = sheet.getLastRow() + 1;
    sheet.getRange(target, 1).setValue(key);
    sheet.getRange(target, 3).setValue(CONFIG_DESCRIPTIONS[key] || '');
  }
  sheet.getRange(target, 2).setValue(String(value));
}

var CONFIG_DESCRIPTIONS = {
  SUPABASE_URL: 'Brown Work の接続先。https://〇〇〇〇.supabase.co',
  CONFIRMED_SHEET_NAME: '確定シフトを読み取るシート（タブ）の名前。空なら自動',
  CONFIRMED_NAME_COLUMN: 'スタッフのフルネームが入っている列。例：E。空なら自動',
  CONFIRMED_START_ROW: '読み取りを始める行。例：457。空なら自動',
  CONFIRMED_END_ROW: '読み取りを終える行。例：554。空なら次の見出し行の手前まで',
  SHIFT_IMPORT_INTERVAL: '自動実行の間隔（daily / m30 / m15 / m5）'
};

/** 「E」「5」などの指定を列番号（1始まり）にする。分からなければ 0 */
function parseColumn(value) {
  var text = String(value == null ? '' : value).trim().toUpperCase();
  if (!text) return 0;
  if (/^\d+$/.test(text)) return Number(text);
  if (!/^[A-Z]{1,3}$/.test(text)) return 0;
  var n = 0;
  for (var i = 0; i < text.length; i++) n = n * 26 + (text.charCodeAt(i) - 64);
  return n;
}

/** 列番号（1始まり）を「E」のような文字にする */
function columnLetter(n) {
  var out = '';
  while (n > 0) {
    var rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/** 日付の見出しらしいセルか（「1(日)」「12(金)」など） */
function looksLikeDayHeader(value) {
  var text = String(value == null ? '' : value).replace(/　/g, ' ').trim();
  return /^\d{1,2}\s*[（(][日月火水木金土][）)]$/.test(text) || /^\d{1,2}$/.test(text);
}

/** 見出しセルから日にちの数字を取り出す */
function dayNumberOf(value) {
  var m = String(value == null ? '' : value).match(/\d{1,2}/);
  return m ? Number(m[0]) : 0;
}

/** ファイル名やシート名から対象月（YYYY-MM）を推測する */
function guessTargetMonth(sheet) {
  var fileName = SpreadsheetApp.getActiveSpreadsheet().getName();
  var m = fileName.match(/(20\d{2})\s*年\s*(\d{1,2})\s*月/);
  if (m) return m[1] + '-' + ('0' + m[2]).slice(-2);

  // ファイル名に年が無い場合、シート名の「11月」と今の年から組み立てる
  var sm = String(sheet.getName()).match(/(\d{1,2})\s*月/);
  if (sm) {
    var month = Number(sm[1]);
    var now = new Date();
    var year = now.getFullYear();
    // 12月のシートを1月に開いたときなど、前後の年を考える
    if (now.getMonth() + 1 >= 10 && month <= 3) year += 1;
    if (now.getMonth() + 1 <= 3 && month >= 10) year -= 1;
    return year + '-' + ('0' + month).slice(-2);
  }
  return '';
}

/** 確定シフトのシートを選ぶ。設定があればそれ、無ければ「〇月」の名前を探す */
function findConfirmedSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var saved = readConfig(CONFIRMED_SHEET_PROP);
  if (saved) {
    var bySaved = ss.getSheetByName(saved);
    if (bySaved) return bySaved;
  }
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    if (/^\d{1,2}\s*月$/.test(sheets[i].getName())) return sheets[i];
  }
  // 見つからなければ、今開いているシート
  return ss.getActiveSheet();
}

/** シートを読んで、送る形に組み立てる */
function buildConfirmedPayload(sheet, month) {
  var range = sheet.getDataRange();
  var values = range.getValues();
  if (values.length === 0) throw new Error('シートが空です。');

  // 結合セルは左上にしか値が入らない。他のセルにも同じ値を入れておく。
  // （2日分をまとめて1マスに書いている場合に、2日目が抜けるのを防ぐ）
  try {
    var merged = range.getMergedRanges();
    for (var mi = 0; mi < merged.length; mi++) {
      var m = merged[mi];
      var r0 = m.getRow() - 1, c0 = m.getColumn() - 1;
      var nr = m.getNumRows(), nc = m.getNumColumns();
      var mv = values[r0] ? values[r0][c0] : '';
      if (mv === '' || mv === null || mv === undefined) continue;
      for (var rr = r0; rr < r0 + nr && rr < values.length; rr++) {
        for (var cc = c0; cc < c0 + nc && cc < values[rr].length; cc++) {
          if (values[rr][cc] === '' || values[rr][cc] === null) values[rr][cc] = mv;
        }
      }
    }
  } catch (e) {
    // 結合セルが取得できない環境でも、そのまま読み進める
  }

  // 日付の見出し行を探す。
  // 1枚のシートに店舗ごとの表とスタッフごとの表が縦に並んでいることがあるため、
  // 見出し行が複数あるときは「いちばん下の見出し行」を使い、その下から読む。
  var headerRows = [];
  var dateColsByRow = {};
  for (var r = 0; r < values.length; r++) {
    var cols = [];
    for (var c = 0; c < values[r].length; c++) {
      if (looksLikeDayHeader(values[r][c])) cols.push(c);
    }
    if (cols.length >= 20) { headerRows.push(r); dateColsByRow[r] = cols; }
  }
  if (headerRows.length === 0) {
    throw new Error('日付の見出し行が見つかりませんでした。「1(日)」のように日付が並んだ行がある表をお使いください。');
  }
  // 見出し行で区間に分ける。区間は「見出しの次の行」から「次の見出しの手前」まで
  var sections = [];
  for (var hi = 0; hi < headerRows.length; hi++) {
    sections.push({
      headerRow: headerRows[hi],
      from: headerRows[hi] + 1,
      to: (hi + 1 < headerRows.length ? headerRows[hi + 1] : values.length) - 1
    });
  }

  // 氏名の列を決める。
  //   1. 設定があればそれを使う
  //   2. 見出しが「スタッフ名」「氏名」などの列
  //   3. それも無ければ、日付の左側でフルネームらしい値がいちばん多い列
  var firstDateCol = dateColsByRow[headerRows[0]][0];
  var nameCol = -1;

  var fixedCol = readConfig(NAME_COLUMN_PROP);
  if (fixedCol) {
    var parsed = parseColumn(fixedCol);
    if (parsed > 0) nameCol = parsed - 1;
  }

  if (nameCol < 0) {
    // 見出しの文字は、いちばん上の見出し行にだけ書かれていることがある
    for (var hr = 0; hr < headerRows.length && nameCol < 0; hr++) {
      var hrow = values[headerRows[hr]];
      for (var hc = 0; hc < firstDateCol; hc++) {
        var head = String(hrow[hc] == null ? '' : hrow[hc]).replace(/\s/g, '');
        for (var w = 0; w < NAME_HEADER_WORDS.length; w++) {
          if (head.indexOf(NAME_HEADER_WORDS[w]) >= 0) { nameCol = hc; break; }
        }
        if (nameCol >= 0) break;
      }
    }
  }

  if (nameCol < 0) {
    var bestCount = -1;
    for (var col = 0; col < firstDateCol; col++) {
      var count = 0;
      for (var row = headerRows[0] + 1; row < values.length; row++) {
        var v = String(values[row][col] == null ? '' : values[row][col]).trim();
        // 姓だけの列と取り違えないよう、空白を含む氏名を数える
        if (v && isNaN(Number(v)) && /\s/.test(v.replace(/\u3000/g, ' '))) count++;
      }
      if (count > bestCount) { bestCount = count; nameCol = col; }
    }
  }
  if (nameCol < 0) nameCol = 0;

  // どの区間を読むか決める。
  // 店舗ごとの表はセルが「●」「★」などの記号、
  // スタッフごとの表はセルが店舗名（文字）なので、それで見分ける。
  // 氏名が入っていて、かつ記号以外の文字が書かれている行の数で判定する。
  var SYMBOL_ONLY = /^[●○★☆◎▲△■□×✕✖╳\-ー—－\s]*$/;
  var sectionScore = function (section) {
    var cols = dateColsByRow[section.headerRow] || [];
    var n = 0;
    for (var row = section.from; row <= section.to && row < values.length; row++) {
      var name = String(values[row][nameCol] == null ? '' : values[row][nameCol]).replace(/\u3000/g, ' ').trim();
      if (!name || !isNaN(Number(name))) continue;
      for (var ci = 0; ci < cols.length; ci++) {
        var cell = String(values[row][cols[ci]] == null ? '' : values[row][cols[ci]]).replace(/\u3000/g, ' ').trim();
        // 記号だけ・空欄ではない＝活動場所が書かれている
        if (cell && !SYMBOL_ONLY.test(cell)) { n++; break; }
      }
    }
    return n;
  };
  var picked = sections[0];
  var pickedScore = -1;
  for (var si = 0; si < sections.length; si++) {
    var score = sectionScore(sections[si]);
    if (score > pickedScore) { pickedScore = score; picked = sections[si]; }
  }

  var headerRow = picked.headerRow;
  var dateCols = dateColsByRow[headerRow];
  var startRow = picked.from;
  var endRow = picked.to;

  // 読み始める行の設定があれば、そこから。終わりは次の見出し行の手前まで
  var fixedStart = readConfig(START_ROW_PROP);
  var fixedEnd = readConfig(END_ROW_PROP);
  if (fixedStart && Number(fixedStart) > 0) {
    startRow = Number(fixedStart) - 1;
    // 終わりは、指定があればそれ。無ければ次の見出し行の手前まで
    endRow = values.length - 1;
    for (var sj = 0; sj < headerRows.length; sj++) {
      if (headerRows[sj] > startRow) { endRow = headerRows[sj] - 1; break; }
    }
    // 日付の並びは、その区間の直前にある見出し行から読む
    for (var sk = headerRows.length - 1; sk >= 0; sk--) {
      if (headerRows[sk] < startRow) { headerRow = headerRows[sk]; dateCols = dateColsByRow[headerRow]; break; }
    }
  }
  if (fixedEnd && Number(fixedEnd) > 0) {
    endRow = Math.min(Number(fixedEnd) - 1, values.length - 1);
  }

  var lastDay = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();

  // 日にち → 列 の対応を作る。
  // その区間の見出し行を優先し、足りない日は他の見出し行から補う。
  // （見出し行によっては一部の日が書かれていないことがあるため）
  var dayToCol = {};
  for (var dc = 0; dc < dateCols.length; dc++) {
    var dnum = dayNumberOf(values[headerRow][dateCols[dc]]);
    if (dnum >= 1 && dnum <= lastDay && dayToCol[dnum] === undefined) dayToCol[dnum] = dateCols[dc];
  }
  for (var hx = headerRows.length - 1; hx >= 0; hx--) {
    var otherCols = dateColsByRow[headerRows[hx]];
    for (var oc = 0; oc < otherCols.length; oc++) {
      var onum = dayNumberOf(values[headerRows[hx]][otherCols[oc]]);
      if (onum >= 1 && onum <= lastDay && dayToCol[onum] === undefined) dayToCol[onum] = otherCols[oc];
    }
  }
  var foundDays = 0;
  var missingDays = [];
  for (var dd = 1; dd <= lastDay; dd++) {
    if (dayToCol[dd] === undefined) missingDays.push(dd);
    else foundDays++;
  }

  var rows = [];
  for (var row2 = startRow; row2 <= endRow && row2 < values.length; row2++) {
    var name = String(values[row2][nameCol] == null ? '' : values[row2][nameCol]).replace(/　/g, ' ').trim();
    if (!name) continue;
    var cells = {};
    var any = false;
    for (var day = 1; day <= lastDay; day++) {
      var col = dayToCol[day];
      if (col === undefined) continue;
      var key = month + '-' + ('0' + day).slice(-2);
      var raw = values[row2][col];
      var text = String(raw == null ? '' : raw).replace(/　/g, ' ').trim();
      cells[key] = text;
      if (text) any = true;
    }
    // 1日も入っていない行は、空行や区切り行とみなして送らない
    if (any) rows.push({ name: name, cells: cells });
  }

  return {
    month: month,
    sheetName: sheet.getName(),
    rows: rows,
    nameColumn: nameCol + 1,
    headerRow: headerRow + 1,
    startRow: startRow + 1,
    endRow: endRow + 1,
    headerRowCount: headerRows.length,
    headerRowList: headerRows.map(function (r) { return r + 1; }),
    foundDays: foundDays,
    lastDay: lastDay,
    missingDays: missingDays
  };
}

/** 送る内容から指紋を作る */
function buildPushFingerprint(payload) {
  var parts = [payload.month];
  for (var i = 0; i < payload.rows.length; i++) {
    var row = payload.rows[i];
    var keys = Object.keys(row.cells).sort();
    var line = row.name;
    for (var k = 0; k < keys.length; k++) line += '\u0001' + keys[k] + '=' + row.cells[keys[k]];
    parts.push(line);
  }
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, parts.join('\u0003'), Utilities.Charset.UTF_8);
  var hex = '';
  for (var b = 0; b < bytes.length; b++) hex += ('0' + (bytes[b] & 0xff).toString(16)).slice(-2);
  return hex;
}

/** Brown Work へ送る */
function sendConfirmedShifts(payload) {
  var baseUrl = (readConfig('SUPABASE_URL') || '').replace(/\/+$/, '');
  var apiKey = readConfig('SHIFT_API_KEY') || '';
  if (!baseUrl || !apiKey) {
    throw new Error('接続先が設定されていません。「Brown Work」→「接続の設定」から設定してください。');
  }
  var response = UrlFetchApp.fetch(baseUrl + '/functions/v1/shift-confirmed-import', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-api-key': apiKey },
    payload: JSON.stringify({ month: payload.month, sheetName: payload.sheetName, rows: payload.rows }),
    muteHttpExceptions: true
  });
  var code = response.getResponseCode();
  var body = response.getContentText();
  if (code !== 200) {
    var message = body;
    try { message = JSON.parse(body).error || body; } catch (ignore) {}
    throw new Error('APIエラー（' + code + '）：' + message);
  }
  return JSON.parse(body);
}

/** メニューから：確認してから送る */
function pushConfirmedShiftsPrompt() {
  var ui = SpreadsheetApp.getUi();
  try {
    var sheet = findConfirmedSheet();
    var month = guessTargetMonth(sheet);
    if (!month) {
      var ask = ui.prompt('確定シフトを送る', '対象月を YYYY-MM の形式で入力してください（例：2026-11）', ui.ButtonSet.OK_CANCEL);
      if (ask.getSelectedButton() !== ui.Button.OK) return;
      month = ask.getResponseText().trim();
      if (!/^\d{4}-\d{2}$/.test(month)) { ui.alert('対象月の形式が違います。'); return; }
    }

    var payload = buildConfirmedPayload(sheet, month);
    if (payload.rows.length === 0) {
      ui.alert(
        '送れる行がありませんでした',
        'シート「' + sheet.getName() + '」から氏名とシフトを読み取れませんでした。\n\n' +
        '氏名の列：' + columnLetter(payload.nameColumn) + '列\n' +
        '読み取る範囲：' + payload.startRow + '〜' + payload.endRow + '行目\n' +
        '日付の見出し行：' + payload.headerRowList.join('、') + '行目\n\n' +
        '「確定シフトの読み取り設定」で、氏名の列と読み始める行を指定してください。',
        ui.ButtonSet.OK
      );
      return;
    }

    // 読み取った内容を見せてから確認する
    var sample = [];
    for (var i = 0; i < Math.min(3, payload.rows.length); i++) {
      var r = payload.rows[i];
      var keys = Object.keys(r.cells).sort();
      var preview = [];
      for (var k = 0; k < Math.min(5, keys.length); k++) {
        preview.push(Number(keys[k].slice(-2)) + '日:' + (r.cells[keys[k]] || '休'));
      }
      sample.push('　' + r.name + ' … ' + preview.join('、') + ' …');
    }
    var res = ui.alert(
      '確定シフトを送ります',
      'シート：' + sheet.getName() + '\n' +
      '対象月：' + month + '\n' +
      '人数：' + payload.rows.length + '名\n' +
      '氏名の列：' + columnLetter(payload.nameColumn) + '列　見出し行：' + payload.headerRow + '行目\n' +
      '読み取る範囲：' + payload.startRow + '〜' + payload.endRow + '行目' +
      '（日付の見出し行：' + payload.headerRowList.join('、') + '行目）\n' +
      '読み取れた日数：' + payload.foundDays + '／' + payload.lastDay + '日' +
      (payload.missingDays.length > 0 ? '　※' + payload.missingDays.join('、') + '日 の列が見つかりません' : '') + '\n\n' +
      '読み取り例\n' + sample.join('\n') + '\n\n' +
      '（空欄は休み、有給は有給として送ります）\n\n' +
      'この内容で送ってよろしいですか？',
      ui.ButtonSet.OK_CANCEL
    );
    if (res !== ui.Button.OK) return;

    var result = sendConfirmedShifts(payload);
    PropertiesService.getScriptProperties().setProperty(PUSH_FINGERPRINT_PROP + month, buildPushFingerprint(payload));
    PropertiesService.getScriptProperties().setProperty(LAST_PUSH_PROP, Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm'));

    var msg = month + '分を送りました。\n' +
      '　反映：' + result.matchedRows + '／' + result.totalRows + '名　' + result.assignmentCount + '件\n' +
      '　出勤 ' + result.workDays + '日　有給 ' + result.paidDays + '日　休み ' + result.offDays + '日';
    if (result.unmatchedNames && result.unmatchedNames.length > 0) {
      msg += '\n\n【氏名が一致しなかった方】\n　' + result.unmatchedNames.join('\n　') +
             '\n\nBrown Work の登録氏名と、表記（姓と名の間の半角スペースなど）をそろえてください。';
    }
    if (result.duplicatedNames && result.duplicatedNames.length > 0) {
      msg += '\n\n【同姓同名のため送れなかった方】\n　' + result.duplicatedNames.join('\n　');
    }
    if (result.resignedNames && result.resignedNames.length > 0) {
      msg += '\n\n【退職済みのため飛ばした方】\n　' + result.resignedNames.join('、');
    }
    if (result.firstImport) {
      msg += '\n\nこの月の初回の取り込みです。';
    } else if (result.changeCount > 0) {
      msg += '\n\n前回から ' + result.changedStaffCount + '名・' + result.changeCount + '日分 が変わりました。';
    } else {
      msg += '\n\n前回から変更はありませんでした。';
    }
    ui.alert('送信しました', msg, ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('送信に失敗しました', String(e.message || e), ui.ButtonSet.OK);
  }
}

/** 自動実行用：内容が変わっていたときだけ送る */
function pushConfirmedShiftsAuto() {
  var sheet = findConfirmedSheet();
  var month = guessTargetMonth(sheet);
  if (!month) return;
  var payload = buildConfirmedPayload(sheet, month);
  if (payload.rows.length === 0) return;

  var props = PropertiesService.getScriptProperties();
  props.setProperty(LAST_PUSH_PROP, Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm'));

  var fingerprint = buildPushFingerprint(payload);
  if (props.getProperty(PUSH_FINGERPRINT_PROP + month) === fingerprint) return;

  sendConfirmedShifts(payload);
  props.setProperty(PUSH_FINGERPRINT_PROP + month, fingerprint);
}

/** 接続先と合言葉を設定する */
function setConnectionSettings() {
  var ui = SpreadsheetApp.getUi();

  var nowUrl = readConfig('SUPABASE_URL') || '（未設定）';
  var res1 = ui.prompt(
    '接続先（SUPABASE_URL）',
    'Brown Work の接続先を入力してください。\n　例）https://ommtelelmjnyazflfcoo.supabase.co\n\n今の設定：' + nowUrl +
    '\n\n空のまま OK を押すと、今の設定のままにします。',
    ui.ButtonSet.OK_CANCEL
  );
  if (res1.getSelectedButton() !== ui.Button.OK) return;
  var url = res1.getResponseText().trim().replace(/\/+$/, '');
  if (url) {
    if (!/^https:\/\/[\w.-]+\.supabase\.co$/.test(url)) {
      ui.alert('接続先の形式が違います。https://〇〇〇〇.supabase.co の形で入力してください。');
      return;
    }
    writeConfig('SUPABASE_URL', url);
  }

  var hasKey = !!readConfig('SHIFT_API_KEY');
  var res2 = ui.prompt(
    '合言葉（SHIFT_API_KEY）',
    'Brown Work 側で設定した合言葉を入力してください。\n\n今の設定：' + (hasKey ? '設定済み' : '未設定') +
    '\n\n空のまま OK を押すと、今の設定のままにします。' +
    '\n（合言葉はこのスクリプトにだけ保存され、シートには書きません）',
    ui.ButtonSet.OK_CANCEL
  );
  if (res2.getSelectedButton() !== ui.Button.OK) return;
  var key = res2.getResponseText().trim();
  if (key) writeConfig('SHIFT_API_KEY', key);

  ui.alert(
    '設定しました',
    '接続先：' + (readConfig('SUPABASE_URL') || '（未設定）') + '\n' +
    '合言葉：' + (readConfig('SHIFT_API_KEY') ? '設定済み' : '未設定'),
    ui.ButtonSet.OK
  );
}

/** 複製して作った翌月分のファイルで、引き継げなかった設定をそろえる */
function setupCopiedFile() {
  var ui = SpreadsheetApp.getUi();
  var fromSheet = readConfigSheet();
  var missing = [];

  // 1. 接続先。設定シートから引き継げていればそれを使う
  if (!PropertiesService.getScriptProperties().getProperty('SUPABASE_URL') && fromSheet.SUPABASE_URL) {
    PropertiesService.getScriptProperties().setProperty('SUPABASE_URL', fromSheet.SUPABASE_URL);
  }
  if (!readConfig('SUPABASE_URL')) missing.push('接続先');

  // 2. 合言葉はシートに書いていないため、毎回ここで入力してもらう
  if (!readConfig('SHIFT_API_KEY')) {
    var res = ui.prompt(
      '合言葉の入力',
      'このファイルにはまだ合言葉が設定されていません。\n' +
      'Brown Work 側で設定した合言葉を入力してください。\n\n' +
      '（合言葉だけは、複製しても引き継がれません）',
      ui.ButtonSet.OK_CANCEL
    );
    if (res.getSelectedButton() !== ui.Button.OK) return;
    var key = res.getResponseText().trim();
    if (!key) { ui.alert('合言葉が入力されませんでした。'); return; }
    writeConfig('SHIFT_API_KEY', key);
  }

  // 3. 自動実行を、前月と同じ間隔で作り直す
  var interval = readConfig(INTERVAL_PROP) || '';
  var intervalLabel = '設定なし';
  if (interval) {
    setTriggerInterval(interval);
    for (var i = 0; i < INTERVALS.length; i++) {
      if (INTERVALS[i].key === interval) intervalLabel = INTERVALS[i].label;
    }
  }

  // 4. 前月分の取り込み記録は引き継がない（新しい月として送り直せるようにする）
  var props = PropertiesService.getScriptProperties();
  var all = props.getProperties();
  Object.keys(all).forEach(function (k) {
    if (k.indexOf(FINGERPRINT_PROP) === 0 || k.indexOf(PUSH_FINGERPRINT_PROP) === 0) props.deleteProperty(k);
  });

  var sheet = findConfirmedSheet();
  var month = guessTargetMonth(sheet);

  ui.alert(
    '初期設定が終わりました',
    '接続先：' + (readConfig('SUPABASE_URL') || '（未設定）') + '\n' +
    '合言葉：' + (readConfig('SHIFT_API_KEY') ? '設定済み' : '未設定') + '\n' +
    '自動実行：' + intervalLabel + '\n' +
    '読み取るシート：' + sheet.getName() + '\n' +
    '読み取る行：' + (readConfig(START_ROW_PROP) ? readConfig(START_ROW_PROP) + (readConfig(END_ROW_PROP) ? '-' + readConfig(END_ROW_PROP) : '以降') : '（自動）') + '\n' +
    '対象月：' + (month || '（ファイル名から読み取れません）') +
    (missing.length > 0 ? '\n\n【未設定】' + missing.join('、') + '\n「接続の設定」から設定してください。' : '') +
    '\n\n対象月やシート名が違う場合は、ファイル名とシート名の月をご確認ください。',
    ui.ButtonSet.OK
  );
}

/** 読み取るシートと氏名の列を手で決める */
function setConfirmedReadSettings() {
  var ui = SpreadsheetApp.getUi();
  var props = PropertiesService.getScriptProperties();

  var nowSheet = readConfig(CONFIRMED_SHEET_PROP) || '（自動）';
  var res1 = ui.prompt(
    '確定シフトのシート名',
    '読み取るシート（タブ）の名前を入力してください。\n今の設定：' + nowSheet + '\n\n空のまま OK を押すと自動で探します。',
    ui.ButtonSet.OK_CANCEL
  );
  if (res1.getSelectedButton() !== ui.Button.OK) return;
  var name = res1.getResponseText().trim();
  writeConfig(CONFIRMED_SHEET_PROP, name);

  var nowCol = readConfig(NAME_COLUMN_PROP) || '（自動）';
  var res2 = ui.prompt(
    '氏名の列',
    'スタッフのフルネームが入っている列を入力してください（例：E）。\n今の設定：' + nowCol +
    '\n\n空のまま OK を押すと自動で探します。' +
    '\n（見出しが「スタッフ名」「氏名」などの列を優先して探します）',
    ui.ButtonSet.OK_CANCEL
  );
  if (res2.getSelectedButton() !== ui.Button.OK) return;
  var col = res2.getResponseText().trim();
  if (col) {
    if (parseColumn(col) <= 0) { ui.alert('列の指定が読み取れません。「E」または「5」のように入力してください。'); return; }
    writeConfig(NAME_COLUMN_PROP, col);
  } else {
    writeConfig(NAME_COLUMN_PROP, '');
  }

  var nowStart = readConfig(START_ROW_PROP);
  var nowEnd = readConfig(END_ROW_PROP);
  var nowRange = nowStart ? (nowStart + (nowEnd ? '-' + nowEnd : '')) : '（自動）';
  var res3 = ui.prompt(
    '読み取る行の範囲',
    'スタッフの個人シフトが入っている行を入力してください。\n' +
    '　例）457-554　　開始だけなら 457\n' +
    '今の設定：' + nowRange +
    '\n\n空のまま OK を押すと自動で決めます。',
    ui.ButtonSet.OK_CANCEL
  );
  if (res3.getSelectedButton() !== ui.Button.OK) return;
  var range = res3.getResponseText().replace(/[〜～–—]/g, '-').replace(/\s/g, '').trim();
  var rangeLabel = '（自動）';
  if (range) {
    var m = range.match(/^(\d+)(?:-(\d+))?$/);
    if (!m) { ui.alert('範囲の形式が違います。「457-554」または「457」のように入力してください。'); return; }
    if (m[2] && Number(m[2]) < Number(m[1])) { ui.alert('終わりの行が開始より前になっています。'); return; }
    writeConfig(START_ROW_PROP, m[1]);
    writeConfig(END_ROW_PROP, m[2] || '');
    rangeLabel = m[1] + (m[2] ? '-' + m[2] : '以降');
  } else {
    writeConfig(START_ROW_PROP, '');
    writeConfig(END_ROW_PROP, '');
  }

  ui.alert(
    '設定しました',
    'シート：' + (name || '（自動）') + '\n氏名の列：' + (col || '（自動）') + '\n読み取る行：' + rangeLabel +
    '\n\n「確定シフトを送る」で読み取り内容をご確認ください。',
    ui.ButtonSet.OK
  );
}
