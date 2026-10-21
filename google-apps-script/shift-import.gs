/**
 * Brown Work のシフト希望を、このスプレッドシートに取り込むスクリプト。
 *
 * ■ 設置方法
 *   1. スプレッドシートを開く
 *   2. メニューの「拡張機能」→「Apps Script」
 *   3. 既定の Code.gs の中身をすべて消し、このファイルの内容を貼り付けて保存
 *   4. メニューの「プロジェクトの設定」→「スクリプト プロパティ」で次の2つを追加
 *        SUPABASE_URL   … https://xxxxxxxx.supabase.co
 *        SHIFT_API_KEY  … supabase secrets set SHIFT_EXPORT_KEY で決めた文字列
 *   5. スプレッドシートを再読み込みすると、上部に「Brown Work」メニューが出ます
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

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Brown Work')
    .addItem('シフト希望を取り込む', 'importShiftRequestsPrompt')
    .addSeparator()
    .addItem('自動取り込みの間隔を選ぶ', 'chooseTriggerInterval')
    .addItem('自動取り込みの状態を見る', 'showTriggerStatus')
    .addItem('自動取り込みを解除', 'removeDailyTrigger')
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
  var props = PropertiesService.getScriptProperties();
  var baseUrl = (props.getProperty('SUPABASE_URL') || '').replace(/\/+$/, '');
  var apiKey = props.getProperty('SHIFT_API_KEY') || '';
  if (!baseUrl || !apiKey) {
    throw new Error('スクリプト プロパティに SUPABASE_URL と SHIFT_API_KEY を設定してください。');
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
  var builder = ScriptApp.newTrigger('importNextMonthShiftRequests').timeBased();
  switch (key) {
    case 'm5':  builder.everyMinutes(5); break;
    case 'm15': builder.everyMinutes(15); break;
    case 'm30': builder.everyMinutes(30); break;
    default:    builder.atHour(6).everyDays(1); key = 'daily'; break;
  }
  builder.create();
  PropertiesService.getScriptProperties().setProperty(INTERVAL_PROP, key);
}

/** 今の設定を表示する */
function showTriggerStatus() {
  var ui = SpreadsheetApp.getUi();
  var triggers = ScriptApp.getProjectTriggers();
  var running = false;
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'importNextMonthShiftRequests') running = true;
  }
  if (!running) {
    ui.alert('自動取り込みの状態', '今は自動取り込みを設定していません。', ui.ButtonSet.OK);
    return;
  }
  var key = PropertiesService.getScriptProperties().getProperty(INTERVAL_PROP) || 'daily';
  var label = key;
  for (var j = 0; j < INTERVALS.length; j++) {
    if (INTERVALS[j].key === key) label = INTERVALS[j].label;
  }
  var last = PropertiesService.getScriptProperties().getProperty(LAST_RUN_PROP);
  ui.alert(
    '自動取り込みの状態',
    '間隔：' + label + '\n' +
    '最後に動いた時刻：' + (last || '記録なし'),
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
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'importNextMonthShiftRequests') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
}

/** 自動取り込みを止める */
function removeDailyTrigger() {
  removeTriggersOnly();
  PropertiesService.getScriptProperties().deleteProperty(INTERVAL_PROP);
  SpreadsheetApp.getUi().alert('自動取り込みを解除しました。');
}
