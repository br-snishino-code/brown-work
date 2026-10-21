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
 * ■ 毎日自動で取り込む場合
 *   「Brown Work」→「毎日の自動取り込みを設定」を一度押してください。
 *   毎朝6時台に、翌月分を自動で取り込みます。止めるときは「自動取り込みを解除」。
 */

var SHEET_PREFIX = 'シフト希望_';

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Brown Work')
    .addItem('シフト希望を取り込む', 'importShiftRequestsPrompt')
    .addSeparator()
    .addItem('毎日の自動取り込みを設定', 'createDailyTrigger')
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
    var result = importShiftRequests(month);
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
function importShiftRequests(month) {
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

  return data;
}

/** 毎朝6時台に翌月分を取り込む */
function createDailyTrigger() {
  removeDailyTrigger();
  ScriptApp.newTrigger('importNextMonthShiftRequests')
    .timeBased()
    .atHour(6)
    .everyDays(1)
    .create();
  SpreadsheetApp.getUi().alert('毎朝6時台に、翌月分のシフト希望を自動で取り込みます。');
}

/** 自動取り込みを止める */
function removeDailyTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'importNextMonthShiftRequests') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
}
