import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Clock, MapPin, CheckCircle2, XCircle, AlertTriangle, LogIn, LogOut, FileEdit, Users, Bell, Calendar, Mail, LogOut as LogoutIcon, UserPlus, Lock, User, Monitor, Smartphone, Palmtree, Plus, Pencil, CalendarDays, ListChecks, ClipboardList, MessageSquare, Coffee, BarChart3, Home, Download, ChevronRight, LayoutGrid, Wallet, Briefcase, UserCog, Construction, Megaphone, Paperclip, FileText, Pin, Trash2, Key, ShieldCheck } from 'lucide-react';
import { supabase, CLOUD_ENABLED, usernameToEmail } from './supabaseClient';

// ---- constants ----
const SCHEDULED_START = '09:00';
const SCHEDULED_END = '18:00';
const BREAK_MINUTES_DEFAULT = 60;
const STANDARD_CLOCK_IN_HOUR = 10; // 出勤確認ポップアップの基準時刻（10:00）
const STANDARD_CLOCK_OUT_HOUR = 19; // 退勤確認ポップアップの基準時刻（19:00）

const pad = (n) => String(n).padStart(2, '0');
const todayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayAt = (hour, minute, from = new Date()) => new Date(from.getFullYear(), from.getMonth(), from.getDate(), hour, minute, 0, 0);
const CLOCK_IN_STATUS_LABEL = {
  early_confirmed: '早出（10:00で記録）',
  early_manual: '早出（実打刻で記録）',
  forgot_corrected: '打刻漏れ（10:00に自動修正）',
  late: '遅刻',
  event: 'イベント',
};
const CLOCK_OUT_STATUS_LABEL = {
  overtime: '残業',
  forgot_corrected_out: '打刻漏れ（19:00に自動修正）',
};
const NEEDS_APPROVAL_STATUSES = ['late', 'event', 'early_confirmed', 'early_manual'];
const timeStr = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const hhmm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const toMinutes = (hhmmStr) => {
  if (!hhmmStr) return null;
  const [h, m] = hhmmStr.split(':').map(Number);
  return h * 60 + m;
};
const minutesToHHMM = (mins) => {
  if (mins == null || isNaN(mins)) return '--:--';
  const sign = mins < 0 ? '-' : '';
  const abs = Math.abs(mins);
  return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
};
const dateLabel = (key) => {
  const d = new Date(key + 'T00:00:00');
  const days = ['日', '月', '火', '水', '木', '金', '土'];
  return `${d.getMonth() + 1}/${d.getDate()}（${days[d.getDay()]}）`;
};

// ---- 日本の祝日判定 ----
const _nthMonday = (year, month, n) => {
  let count = 0;
  for (let d = 1; d <= 31; d++) {
    const dt = new Date(year, month - 1, d);
    if (dt.getMonth() !== month - 1) break;
    if (dt.getDay() === 1) {
      count++;
      if (count === n) return d;
    }
  }
  return null;
};
const _holidayCache = {};
function getJapaneseHolidays(year) {
  if (_holidayCache[year]) return _holidayCache[year];
  const base = {};
  const add = (m, d, name) => { if (d) base[`${year}-${pad(m)}-${pad(d)}`] = name; };

  add(1, 1, '元日');
  add(1, _nthMonday(year, 1, 2), '成人の日');
  add(2, 11, '建国記念の日');
  if (year >= 2020) add(2, 23, '天皇誕生日');
  const shunbun = Math.floor(20.8431 + 0.242194 * (year - 1980)) - Math.floor((year - 1980) / 4);
  add(3, shunbun, '春分の日');
  add(4, 29, '昭和の日');
  add(5, 3, '憲法記念日');
  add(5, 4, 'みどりの日');
  add(5, 5, 'こどもの日');
  add(7, _nthMonday(year, 7, 3), '海の日');
  add(8, 11, '山の日');
  add(9, _nthMonday(year, 9, 3), '敬老の日');
  const shubun = Math.floor(23.2488 + 0.242194 * (year - 1980)) - Math.floor((year - 1980) / 4);
  add(9, shubun, '秋分の日');
  add(10, _nthMonday(year, 10, 2), 'スポーツの日');
  add(11, 3, '文化の日');
  add(11, 23, '勤労感謝の日');

  const result = { ...base };

  // 国民の休日：前後を祝日に挟まれた平日（日曜以外）
  Object.keys(base).forEach((dateStr) => {
    const d = new Date(dateStr + 'T00:00:00');
    const next = new Date(d);
    next.setDate(next.getDate() + 2);
    const nextKey = todayKey(next);
    const between = new Date(d);
    between.setDate(between.getDate() + 1);
    const betweenKey = todayKey(between);
    if (base[nextKey] && !base[betweenKey] && between.getDay() !== 0) {
      result[betweenKey] = '国民の休日';
    }
  });

  // 振替休日：日曜に当たる祝日の翌日以降、最初の非祝日
  Object.entries(base).forEach(([dateStr, name]) => {
    const d = new Date(dateStr + 'T00:00:00');
    if (d.getDay() === 0) {
      let next = new Date(d);
      do {
        next.setDate(next.getDate() + 1);
      } while (result[todayKey(next)]);
      result[todayKey(next)] = '振替休日';
    }
  });

  _holidayCache[year] = result;
  return result;
}
const getHolidayName = (dateStr) => {
  const year = Number(dateStr.slice(0, 4));
  return getJapaneseHolidays(year)[dateStr] || null;
};

// 管理者向け一覧用：YYYY-MM-DD → MM-DD(曜) ／ 土=水色・日祝=ピンクの表示情報も返す
const formatAdminDate = (key) => {
  const d = new Date(key + 'T00:00:00');
  const days = ['日', '月', '火', '水', '木', '金', '土'];
  const wd = d.getDay();
  const holidayName = getHolidayName(key);
  const label = `${pad(d.getMonth() + 1)}-${pad(d.getDate())}(${days[wd]}${holidayName ? '・祝' : ''})`;
  const badgeClass = (wd === 0 || holidayName) ? 'bg-rose-100 text-rose-700' : wd === 6 ? 'bg-sky-100 text-sky-700' : '';
  return { label, badgeClass, holidayName };
};

// ---- Leave (休暇) ----
const LEAVE_TYPES = ['有休', '振休', '代休', '特別休暇'];
const DEFAULT_PAID_LEAVE_TOTAL = 10;
const daysBetweenInclusive = (startKey, endKey) => {
  const s = new Date(startKey + 'T00:00:00');
  const e = new Date(endKey + 'T00:00:00');
  return Math.max(1, Math.round((e.getTime() - s.getTime()) / 86400000) + 1);
};

// 労働基準法39条：週5日・フルタイム勤務を前提とした法定付与日数のスケジュール
// （勤続6ヶ月で10日、以降1年ごとに加算、6年6ヶ月以降は20日で頭打ち）
const STATUTORY_LEAVE_SCHEDULE = [
  { months: 6, days: 10 },
  { months: 18, days: 11 },
  { months: 30, days: 12 },
  { months: 42, days: 14 },
  { months: 54, days: 16 },
  { months: 66, days: 18 },
  { months: 78, days: 20 },
];

const monthsBetween = (start, end) => {
  let months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
  if (end.getDate() < start.getDate()) months -= 1;
  return Math.max(0, months);
};

function computeStatutoryPaidLeaveDays(hireDateStr, asOf = new Date()) {
  if (!hireDateStr) return 0;
  const hire = new Date(hireDateStr + 'T00:00:00');
  if (isNaN(hire.getTime()) || hire > asOf) return 0;
  const tenureMonths = monthsBetween(hire, asOf);
  let granted = 0;
  for (const tier of STATUTORY_LEAVE_SCHEDULE) {
    if (tenureMonths >= tier.months) granted = tier.days;
  }
  return granted;
}

// 労働基準法：週の所定労働日数が少ないパート・アルバイト向けの比例付与表
const PROPORTIONAL_LEAVE_TABLE = {
  4: [7, 8, 9, 10, 12, 13, 15],
  3: [5, 6, 6, 8, 9, 10, 11],
  2: [3, 4, 4, 5, 6, 6, 7],
  1: [1, 2, 2, 2, 3, 3, 3],
};

function computeProportionalLeaveDays(hireDateStr, weeklyDays, asOf = new Date()) {
  if (!hireDateStr) return 0;
  const table = PROPORTIONAL_LEAVE_TABLE[weeklyDays];
  if (!table) return computeStatutoryPaidLeaveDays(hireDateStr, asOf);
  const hire = new Date(hireDateStr + 'T00:00:00');
  if (isNaN(hire.getTime()) || hire > asOf) return 0;
  const tenureMonths = monthsBetween(hire, asOf);
  let granted = 0;
  STATUTORY_LEAVE_SCHEDULE.forEach((tier, i) => {
    if (tenureMonths >= tier.months) granted = table[i];
  });
  return granted;
}

// 社員1人分の有休付与日数（優先順位：パート/アルバイトは比例付与 → 法定自動計算）＋手動調整
// ※グループ別の月次規定日数は「出勤規定日数」（給与計算用）に用途変更されたため、有休計算では使用しない
function computeLeaveTotal(employee, now, groupLeaveSchedules) {
  if (!employee) return 0;
  const isPartTime = employee.staffType === 'パート' || employee.staffType === 'アルバイト';
  let base;
  if (isPartTime) {
    base = employee.scheduledWeeklyDays
      ? computeProportionalLeaveDays(employee.hireDate, employee.scheduledWeeklyDays, now)
      : computeStatutoryPaidLeaveDays(employee.hireDate, now);
  } else {
    base = computeStatutoryPaidLeaveDays(employee.hireDate, now);
  }
  return Math.max(0, base + (Number(employee.leaveAdjustment) || 0));
}

// グループ別または個人別の「出勤規定日数」を、指定した月について取得する
// 優先順位：社員にメイングループが設定されていればグループ規定 → 未設定なら個人別の月次設定
function getPrescribedAttendanceDays(employee, month, groupAttendanceSchedules, employeeAttendanceSchedules) {
  if (!employee) return null;
  if (employee.mainGroup) {
    const schedule = groupAttendanceSchedules?.[employee.mainGroup];
    const v = schedule ? schedule[month] : null;
    return v != null && v !== '' ? Number(v) : null;
  }
  const personal = employeeAttendanceSchedules?.[employee.id];
  const v = personal ? personal[month] : null;
  return v != null && v !== '' ? Number(v) : null;
}

function tenureLabel(hireDateStr, asOf = new Date()) {
  if (!hireDateStr) return '入職日未設定';
  const hire = new Date(hireDateStr + 'T00:00:00');
  const totalMonths = monthsBetween(hire, asOf);
  const y = Math.floor(totalMonths / 12);
  const m = totalMonths % 12;
  return `勤続${y}年${m}ヶ月`;
}

// ---- Performance reports (個人実績) ----
const lastDayOfMonth = (year, month) => new Date(year, month, 0).getDate();
const halfPeriodLabel = (year, month, half) =>
  half === 1 ? `${year}年${month}月 前半（1日〜15日）` : `${year}年${month}月 後半（16日〜${lastDayOfMonth(year, month)}日）`;
const monthPeriodLabel = (year, month) => `${year}年${month}月度 月次まとめ`;
const defaultHalfForToday = () => {
  const d = new Date();
  return d.getDate() <= 15 ? 1 : 2;
};

// ---- eo業務 実績管理（新規実績・既存実績・インセンティブ） ----
const EO_GROUP_NAME = 'eo業務';

// 新規実績：成約内訳・エンパケ成約内訳・後日成約内訳の共通ポイント表
const NEW_PERF_POINTS = { net: 5, tvMulti: 2, tvBasic: 1, g10: 2, secpack: 1, mesh: 1 };
// 新規実績：サービス追加（既存契約への当日追加）のポイント表
const NEW_PERF_ADD_POINTS = { net: 5, tvMulti: 2, tvBasic: 1, g10: 2 };

const NEW_PERF_CONTRACT_FIELDS = [
  { key: 'net', label: 'ネット' },
  { key: 'tvMulti', label: 'テレビ(多ch)' },
  { key: 'tvBasic', label: 'テレビ(地デジBS)' },
  { key: 'g10', label: '10G' },
  { key: 'secpack', label: 'セキュパ' },
  { key: 'mesh', label: 'メッシュ' },
];
const NEW_PERF_ADD_FIELDS = [
  { key: 'net', label: 'ネット' },
  { key: 'tvMulti', label: 'テレビ(多ch)' },
  { key: 'tvBasic', label: 'テレビ(地デジBS)' },
  { key: 'g10', label: '10G' },
];

const emptyNewPerfDay = () => ({
  store: '', targets: '', approaches: '', negotiations: '',
  contract: { net: '', tvMulti: '', tvBasic: '', g10: '', secpack: '', mesh: '' },
  empakeCount: '',
  empake: { net: '', tvMulti: '', tvBasic: '', g10: '', secpack: '', mesh: '' },
  laterOwnDate: '', laterReceiver: '',
  later: { net: '', tvMulti: '', tvBasic: '', g10: '', secpack: '', mesh: '' },
  add: { net: '', tvMulti: '', tvBasic: '', g10: '' },
});

// 新規実績：1日分のポイントを計算
function computeNewPerfDayPoints(day) {
  if (!day) return 0;
  const sumGroup = (group, table) => Object.entries(table).reduce((s, [k, p]) => s + (Number(group?.[k]) || 0) * p, 0);
  return (
    sumGroup(day.contract, NEW_PERF_POINTS) +
    sumGroup(day.empake, NEW_PERF_POINTS) +
    sumGroup(day.later, NEW_PERF_POINTS) +
    sumGroup(day.add, NEW_PERF_ADD_POINTS)
  );
}

// 新規実績：月合計ポイント（タブレット不備・キャンセルの減点は含まない生のポイント）
function computeNewPerfMonthPoints(daily) {
  return Object.values(daily || {}).reduce((sum, day) => sum + computeNewPerfDayPoints(day), 0);
}

// 既存実績（アップセルLTV）：項目とポイント表（2026年度アップセルポイント一覧表に準拠）
const EXISTING_PERF_FIELDS = [
  { key: 'netAdd', label: 'ネット追加', points: 5 },
  { key: 'g10', label: '10G', points: 2 },
  { key: 'phoneAdd', label: '電話追加', points: 40 },
  { key: 'tvMultiAdd', label: 'テレビ多ch追加', points: 2 },
  { key: 'tvBasicAdd', label: 'テレビ地デジBS追加', points: 1 },
  { key: 'choki', label: '長割', points: 15 },
  { key: 'wirelessRt', label: '無線RT機能', points: 5 },
  { key: 'extender', label: '無線LAN中継器', points: 10 },
  { key: 'mesh', label: 'eoメッシュWi-Fi', points: 20 },
  { key: 'sp', label: 'セキュリティパック', points: 10 },
  { key: 'remoteSupport', label: 'リモートサポートプラス', points: 10 },
  { key: 'sagiWall', label: 'ネットサギウォール', points: 1 },
  { key: 'machineHosho', label: 'おうちの機器補償', points: 1 },
  { key: 'mailAdd', label: 'メールアドレス追加', points: 15 },
  { key: 'mailboxAdd', label: 'メールボックス容量追加', points: 5 },
  { key: 'mailVirus', label: 'メールウイルスチェック', points: 1 },
  { key: 'phonePaidOpt', label: '電話オプション（有料）', points: 10 },
  { key: 'anshinPack', label: 'あんしん電話パック', points: 10 },
  { key: 'phoneFreeOpt', label: '電話オプション（無料）', points: 1 },
  { key: 'csOpt', label: 'CSオプションch', points: 10 },
  { key: 'tvGuide', label: 'テレビガイド誌', points: 10 },
  { key: 'paidStb', label: '有料STB', points: 15 },
  { key: 'up1g', label: 'ネット100M→1Gコースアップ', points: 5 },
  { key: 'up5g', label: 'ネット100M/1G→5Gコースアップ', points: 10 },
  { key: 'up10g', label: 'ネット100M/1G→10Gコースアップ', points: 30 },
  { key: 'up5to10g', label: 'ネット5G→10Gコースアップ', points: 20 },
  { key: 'netflix', label: 'Netflixパック追加', points: 10 },
  { key: 'tvCourseUp', label: 'テレビコースアップ(地デジBS→多ch)', points: 25 },
  { key: 'teigaku4k', label: '定額4Kテレビ', points: 10 },
  { key: 'teigakuGame', label: '定額ゲーミングデバイス', points: 5 },
  { key: 'moving', label: '引越し', points: 25 },
];

const emptyExistingPerfDay = () => Object.fromEntries(EXISTING_PERF_FIELDS.map((f) => [f.key, '']));

function computeExistingPerfDayPoints(day) {
  if (!day) return 0;
  return EXISTING_PERF_FIELDS.reduce((sum, f) => sum + (Number(day[f.key]) || 0) * f.points, 0);
}

function computeExistingPerfMonthPoints(daily) {
  return Object.values(daily || {}).reduce((sum, day) => sum + computeExistingPerfDayPoints(day), 0);
}

// 新規実績：月間エンパケ配布枚数の合計（インセンティブの3枚以上／4枚以上判定に使用）
function computeMonthEmpakeCount(daily) {
  return Object.values(daily || {}).reduce((sum, day) => sum + (Number(day?.empakeCount) || 0), 0);
}

// 新規実績：月間の10G付帯率の目安（10G成約数 ÷ ネット成約数）
// ※「高速回線対象案件」に限定した正式な率ではなく参考値。正式判定は管理者が上書きできる。
function computeApproxG10Rate(daily) {
  let netTotal = 0;
  let g10Total = 0;
  Object.values(daily || {}).forEach((day) => {
    ['contract', 'empake', 'later'].forEach((section) => {
      netTotal += Number(day?.[section]?.net) || 0;
      g10Total += Number(day?.[section]?.g10) || 0;
    });
  });
  if (netTotal === 0) return null;
  return g10Total / netTotal;
}

// eo業務インセンティブ計算
// staffMonthData: { newPoints, empakeCount, tabletIssues, cancellations, existingPoints, g10HalfOverride, approxG10Rate }
// groupFlags: { cancelTargetMet, empakeTargetMet, upsellTargetMet }
// upsellRank: このスタッフのグループ内アップセルLTV順位（1始まり）。順位対象外はnull
function computeEoIncentive(staffMonthData, groupFlags, upsellRank) {
  const { newPoints, empakeCount, tabletIssues, cancellations, existingPoints, g10HalfOverride, approxG10Rate } = staffMonthData;
  const adjustedNewPoints = newPoints - (Number(tabletIssues) || 0) * 2 - (Number(cancellations) || 0) * 3;

  let newPointsForJudge = adjustedNewPoints;
  if (groupFlags?.cancelTargetMet) newPointsForJudge += 6;
  if (groupFlags?.empakeTargetMet && empakeCount >= 4) newPointsForJudge += 5;

  const isHalf = g10HalfOverride != null ? g10HalfOverride : (approxG10Rate != null && approxG10Rate < 0.4);

  let newAcquisitionAmount = 0;
  const eligible = existingPoints >= 60 && newPointsForJudge >= 80 && empakeCount >= 3;
  if (eligible) {
    newAcquisitionAmount = 8000;
    const over = newPointsForJudge - 80;
    if (over > 0) newAcquisitionAmount += Math.floor(over / 5) * 2000;
    if (isHalf) newAcquisitionAmount = Math.round(newAcquisitionAmount / 2);
  }

  let upsellAmount = 0;
  if (groupFlags?.upsellTargetMet && existingPoints >= 140) {
    upsellAmount = 5000;
    if (upsellRank === 1) upsellAmount += 10000;
    else if (upsellRank === 2 || upsellRank === 3) upsellAmount += 7000;
    else if (upsellRank === 4 || upsellRank === 5) upsellAmount += 5000;
  }

  return {
    adjustedNewPoints,
    newPointsForJudge,
    isHalf,
    newAcquisitionEligible: eligible,
    newAcquisitionAmount,
    upsellAmount,
    totalAmount: newAcquisitionAmount + upsellAmount,
  };
}

function useNow() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function computeDayStatus(record) {
  if (!record || !record.clockIn) return { label: '未出勤', tone: 'neutral' };
  if (record.clockIn && !record.clockOut) {
    const key = record.date;
    const isToday = key === todayKey();
    if (!isToday) return { label: '未退勤（打刻漏れ）', tone: 'danger' };
    return { label: '勤務中', tone: 'active' };
  }
  return { label: '退勤済み', tone: 'done' };
}

// 位置情報が記録されていない打刻が何回連続しているか（直近から遡って計算）
function computeConsecutiveMissingLocation(employeeRecords) {
  const dates = Object.keys(employeeRecords || {}).sort((a, b) => (a < b ? 1 : -1));
  let count = 0;
  for (const d of dates) {
    const r = employeeRecords[d];
    if (!r?.clockIn) continue;
    if (!r.clockInLocation) {
      count += 1;
    } else {
      break;
    }
  }
  return count;
}

function computeGpsAlertEmployees(employeeAccounts, records, threshold = 5) {
  return employeeAccounts
    .map((acc) => ({ employeeId: acc.id, employeeName: acc.name, consecutiveCount: computeConsecutiveMissingLocation(records[acc.id] || {}) }))
    .filter((x) => x.consecutiveCount >= threshold);
}

function getRecordedBreakMinutes(record, asOf = new Date()) {
  if (!record) return BREAK_MINUTES_DEFAULT;
  // 休憩は実際の打刻に関わらず、常に固定1時間（管理者による個別の手動修正がある場合のみそれに従う）
  if (record.breakMinutesOverride != null) return Number(record.breakMinutesOverride);
  return BREAK_MINUTES_DEFAULT;
}

function computeMetrics(record) {
  if (!record || !record.clockIn || !record.clockOut) return null;
  const inMin = toMinutes(hhmm(new Date(record.clockIn)));
  const outMin = toMinutes(hhmm(new Date(record.clockOut)));
  const breakMin = getRecordedBreakMinutes(record, new Date(record.clockOut));
  const workedMin = Math.max(0, outMin - inMin - breakMin);
  const schedStart = toMinutes(record.scheduledStart || SCHEDULED_START);
  const schedEnd = toMinutes(record.scheduledEnd || SCHEDULED_END);
  const schedWorked = Math.max(0, schedEnd - schedStart - BREAK_MINUTES_DEFAULT);
  const lateMin = Math.max(0, inMin - schedStart);
  const earlyLeaveMin = Math.max(0, schedEnd - outMin);
  const overtimeMin = Math.max(0, workedMin - schedWorked);
  return { workedMin, lateMin, earlyLeaveMin, overtimeMin, breakMin };
}

// 給与計算も実打刻を1分単位で集計。日ごとの一律15分切り捨ては行わない。
function computePayrollMetrics(record) {
  const metrics = computeMetrics(record);
  if (!metrics) return null;
  return {
    workedMin: metrics.workedMin,
    overtimeMin: metrics.overtimeMin,
    breakMin: metrics.breakMin,
    inRounded: hhmm(new Date(record.clockIn)),
    outRounded: hhmm(new Date(record.clockOut)),
  };
}

function computeMonthlySummary(records, target = new Date()) {
  const prefix = `${target.getFullYear()}-${pad(target.getMonth() + 1)}-`;
  return Object.entries(records || {}).reduce((acc, [key, record]) => {
    if (!key.startsWith(prefix)) return acc;
    const m = computeMetrics(record);
    if (!m) return acc;
    acc.days += 1;
    acc.workedMin += m.workedMin;
    acc.overtimeMin += m.overtimeMin;
    acc.lateMin += m.lateMin;
    acc.earlyLeaveMin += m.earlyLeaveMin;
    return acc;
  }, { days: 0, workedMin: 0, overtimeMin: 0, lateMin: 0, earlyLeaveMin: 0 });
}

// ---- Geolocation ----
function useGeolocation() {
  const [status, setStatus] = useState('idle');
  const capture = useCallback(() => {
    return new Promise((resolve) => {
      if (!navigator.geolocation) {
        setStatus('error');
        resolve(null);
        return;
      }
      setStatus('loading');
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setStatus('granted');
          resolve({ lat: Number(pos.coords.latitude.toFixed(5)), lng: Number(pos.coords.longitude.toFixed(5)) });
        },
        () => {
          setStatus('denied');
          resolve(null);
        },
        { timeout: 8000 }
      );
    });
  }, []);
  return { status, capture };
}

// ---- Toast ----
function useToast() {
  const [toast, setToast] = useState(null);
  const timerRef = useRef(null);
  const show = (msg, tone = 'default') => {
    setToast({ msg, tone });
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setToast(null), 3200);
  };
  return { toast, show };
}

function ToastView({ toast }) {
  if (!toast) return null;
  const toneStyles = {
    default: 'bg-slate-800 text-white',
    success: 'bg-emerald-600 text-white',
    warn: 'bg-amber-600 text-white',
  };
  return (
    <div className={`fixed bottom-5 left-1/2 -translate-x-1/2 px-4 py-2.5 rounded-lg shadow-lg text-sm font-medium z-50 ${toneStyles[toast.tone] || toneStyles.default}`}>
      {toast.msg}
    </div>
  );
}

// ============================================================
// Supabase データ層
// ここから下が、旧 app_state（単一JSON）方式から
// 正規化テーブル + Supabase Auth に置き換えた部分です。
// 以降のコンポーネント（LoginScreenなど）は一切変更していません。
// ============================================================

const EMPTY_DATA = { accounts: [], records: {}, corrections: [], notifications: [], leaveRequests: [], leaveBalances: {}, performanceReports: [], payrollRecords: [], auditLogs: [], profileUpdateRequests: [], groupLeaveSchedules: {}, employeeAttendanceSchedules: {}, announcements: [] };

// ---- row(snake_case) → app(camelCase) 変換 ----
const rowToAccount = (row) => ({
  id: row.id,
  username: row.username,
  name: row.name,
  furigana: row.furigana || '',
  role: row.role,
  adminPermissions: Array.isArray(row.admin_permissions) ? row.admin_permissions : ['attendance', 'labor', 'hr', 'payroll'],
  hireDate: row.hire_date,
  resignationDate: row.resignation_date,
  contactEmail: row.contact_email || '',
  staffNumber: row.staff_number || '',
  address: row.address || '',
  phone: row.phone || '',
  emergencyContactName: row.emergency_contact_name || '',
  emergencyContactPhone: row.emergency_contact_phone || '',
  wageType: row.wage_type || 'hourly',
  hourlyWage: row.hourly_wage != null ? Number(row.hourly_wage) : 0,
  monthlySalary: row.monthly_salary != null ? Number(row.monthly_salary) : 0,
  birthDate: row.birth_date || '',
  staffType: row.staff_type || '社員',
  mainGroup: row.main_group || '',
  subGroup: row.sub_group || '',
  commuteAllowance: row.commute_allowance != null ? Number(row.commute_allowance) : 0,
  deemedOvertimeHours: row.deemed_overtime_hours != null ? Number(row.deemed_overtime_hours) : null,
  nearestStation: row.nearest_station || '',
  staffNote1: row.staff_note1 || '',
  staffNote2: row.staff_note2 || '',
  staffNote3: row.staff_note3 || '',
  leaveAdjustment: row.leave_adjustment != null ? Number(row.leave_adjustment) : 0,
  scheduledWeeklyDays: row.scheduled_weekly_days != null ? Number(row.scheduled_weekly_days) : null,
  jobTitle: row.job_title || '',
  contractStart: row.contract_start || '',
  contractEnd: row.contract_end || '',
  bankCode: row.bank_code || '',
  bankName: row.bank_name || '',
  branchCode: row.branch_code || '',
  branchName: row.branch_name || '',
  accountType: row.account_type || '普通',
  accountHolder: row.account_holder || '',
  accountNumber: row.account_number || '',
  standardRemunerationHealth: row.standard_remuneration_health != null ? Number(row.standard_remuneration_health) : null,
  standardRemunerationPension: row.standard_remuneration_pension != null ? Number(row.standard_remuneration_pension) : null,
  healthInsuranceStatus: row.health_insurance_status || '未加入',
  healthInsuranceNumber: row.health_insurance_number || '',
  healthInsuranceAcquiredDate: row.health_insurance_acquired_date || '',
  healthInsuranceLostDate: row.health_insurance_lost_date || '',
  pensionStatus: row.pension_status || '未加入',
  pensionBasicNumber: row.pension_basic_number || '',
  pensionAcquiredDate: row.pension_acquired_date || '',
  pensionLostDate: row.pension_lost_date || '',
  employmentInsuranceStatus: row.employment_insurance_status || '未加入',
  employmentInsuranceNumber: row.employment_insurance_number || '',
  employmentInsuranceAcquiredDate: row.employment_insurance_acquired_date || '',
  employmentInsuranceLostDate: row.employment_insurance_lost_date || '',
  spouseStatus: row.spouse_status || '無',
  spouseAnnualIncome: row.spouse_annual_income != null ? Number(row.spouse_annual_income) : null,
  spouseMonthlyIncome: row.spouse_monthly_income != null ? Number(row.spouse_monthly_income) : null,
  familyMembers: Array.isArray(row.family_members) ? row.family_members : [],
  residentTaxMunicipalityCode: row.resident_tax_municipality_code || '',
  residentTaxMunicipality: row.resident_tax_municipality || '',
  residentTaxCollectionMethod: row.resident_tax_collection_method || '特別徴収',
  taxTableType: row.tax_table_type || '甲欄',
  isNonResident: !!row.is_non_resident,
  disabilityClassification: row.disability_classification || '対象外',
  isWorkingStudent: !!row.is_working_student,
  singleParentClassification: row.single_parent_classification || '対象外',
});

const rowToPayroll = (row) => ({
  id: row.id,
  employeeId: row.employee_id,
  employeeName: row.employees?.name || '',
  year: row.year,
  month: row.month,
  wageType: row.wage_type,
  wageRate: Number(row.wage_rate),
  workedMinutes: row.worked_minutes,
  overtimeMinutes: row.overtime_minutes,
  baseAmount: Number(row.base_amount),
  overtimeAmount: Number(row.overtime_amount),
  totalAmount: Number(row.total_amount),
  status: row.status,
  notes: row.notes,
  generatedAt: row.generated_at,
  publishedAt: row.published_at,
});

const rowToRecord = (row) => ({
  date: row.date,
  clockIn: row.clock_in,
  clockOut: row.clock_out,
  breakPeriods: row.break_periods || [],
  breakStartedAt: row.break_started_at,
  breakMinutesOverride: row.break_minutes_override,
  clockInLocation: row.clock_in_location,
  clockOutLocation: row.clock_out_location,
  scheduledStart: row.scheduled_start || SCHEDULED_START,
  scheduledEnd: row.scheduled_end || SCHEDULED_END,
  clockInActual: row.clock_in_actual,
  clockInStatus: row.clock_in_status,
  clockInNote: row.clock_in_note,
  clockInApproval: row.clock_in_approval,
  clockOutActual: row.clock_out_actual,
  clockOutStatus: row.clock_out_status,
  clockOutNote: row.clock_out_note,
});

const rowToCorrection = (row) => ({
  id: row.id,
  employeeId: row.employee_id,
  employeeName: row.employees?.name || '',
  date: row.date,
  original: row.original,
  requested: row.requested,
  reason: row.reason,
  status: row.status,
  submittedAt: row.submitted_at,
  decidedAt: row.decided_at,
});

const rowToLeave = (row) => ({
  id: row.id,
  employeeId: row.employee_id,
  employeeName: row.employees?.name || '',
  type: row.type,
  halfDay: row.half_day,
  startDate: row.start_date,
  endDate: row.end_date,
  days: Number(row.days),
  reason: row.reason,
  status: row.status,
  submittedAt: row.submitted_at,
  decidedAt: row.decided_at,
});

const rowToPerf = (row) => ({
  id: row.id,
  employeeId: row.employee_id,
  employeeName: row.employees?.name || '',
  type: row.type,
  year: row.year,
  month: row.month,
  half: row.half,
  periodLabel: row.period_label,
  summary: row.summary,
  numericLabel: row.numeric_label,
  numericValue: row.numeric_value,
  notes: row.notes,
  status: row.status,
  adminMemo: row.admin_memo,
  submittedAt: row.submitted_at,
  decidedAt: row.decided_at,
});

const rowToNotif = (row) => ({
  id: row.id,
  to: row.to_role || row.to_employee_id,
  toEmployeeId: row.to_employee_id,
  toRole: row.to_role,
  subject: row.subject,
  body: row.body,
  sentAt: row.sent_at,
  relatedId: row.related_id,
  isRead: !!row.is_read,
});

const rowToAudit = (row) => ({
  id: row.id,
  actorId: row.actor_id,
  actorName: row.actor_name,
  action: row.action,
  targetEmployeeId: row.target_employee_id,
  targetEmployeeName: row.target_employee_name || '',
  detail: row.detail,
  createdAt: row.created_at,
});

const PROFILE_EDITABLE_FIELDS = [
  { key: 'contactEmail', label: '連絡用メールアドレス' },
  { key: 'address', label: '住所' },
  { key: 'nearestStation', label: '最寄り駅' },
  { key: 'phone', label: '電話番号' },
  { key: 'emergencyContactName', label: '緊急連絡先（氏名）' },
  { key: 'emergencyContactPhone', label: '緊急連絡先（電話）' },
];

const rowToProfileRequest = (row) => ({
  id: row.id,
  employeeId: row.employee_id,
  employeeName: row.employees?.name || '',
  requestedChanges: row.requested_changes || {},
  originalValues: row.original_values || {},
  reason: row.reason,
  status: row.status,
  adminMemo: row.admin_memo,
  submittedAt: row.submitted_at,
  decidedAt: row.decided_at,
});

const ANNOUNCEMENT_CATEGORIES = ['お知らせ', '制度・インセンティブ', '資料・料金表', 'キャンペーン', 'その他'];

const rowToAnnouncement = (row) => ({
  id: row.id,
  title: row.title,
  category: row.category || 'お知らせ',
  body: row.body || '',
  filePath: row.file_path || '',
  fileName: row.file_name || '',
  createdByName: row.created_by_name || '',
  isPinned: !!row.is_pinned,
  createdAt: row.created_at,
});

// ---- 現在ログイン中のユーザーが見える範囲のデータを全テーブルから取得 ----
// （RLSが自動でフィルタしてくれるため、社員は自分の行だけ、管理者は全行が返る）
async function fetchAllData() {
  const [
    employeesRes,
    recordsRes,
    correctionsRes,
    leaveRes,
    perfRes,
    notifRes,
    payrollRes,
    auditRes,
    profileReqRes,
    groupLeaveRes,
    employeeAttendanceRes,
    announcementsRes,
  ] = await Promise.all([
    supabase.from('employees').select('*'),
    supabase.from('attendance_records').select('*'),
    supabase.from('corrections').select('*, employees(name)'),
    supabase.from('leave_requests').select('*, employees(name)'),
    supabase.from('performance_reports').select('*, employees(name)'),
    supabase.from('notifications').select('*').order('sent_at', { ascending: false }).limit(50),
    supabase.from('payroll_records').select('*, employees(name)'),
    supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(100),
    supabase.from('profile_update_requests').select('*, employees(name)').order('submitted_at', { ascending: false }),
    supabase.from('group_attendance_schedules').select('*'),
    supabase.from('employee_attendance_schedules').select('*'),
    supabase.from('announcements').select('*').order('is_pinned', { ascending: false }).order('created_at', { ascending: false }),
  ]);

  for (const res of [employeesRes, recordsRes, correctionsRes, leaveRes, perfRes, notifRes, payrollRes, auditRes, profileReqRes, groupLeaveRes, employeeAttendanceRes, announcementsRes]) {
    if (res.error) throw res.error;
  }

  const records = {};
  (recordsRes.data || []).forEach((row) => {
    records[row.employee_id] = records[row.employee_id] || {};
    records[row.employee_id][row.date] = rowToRecord(row);
  });

  // グループ別「出勤規定日数」（月ごと・1〜12月）
  const groupLeaveSchedules = {};
  (groupLeaveRes.data || []).forEach((row) => {
    groupLeaveSchedules[row.group_name] = groupLeaveSchedules[row.group_name] || {};
    groupLeaveSchedules[row.group_name][row.month] = Number(row.days);
  });

  // 個人別「出勤規定日数」（グループ未設定の社員が対象・月ごと）
  const employeeAttendanceSchedules = {};
  (employeeAttendanceRes.data || []).forEach((row) => {
    employeeAttendanceSchedules[row.employee_id] = employeeAttendanceSchedules[row.employee_id] || {};
    employeeAttendanceSchedules[row.employee_id][row.month] = Number(row.days);
  });

  return {
    accounts: (employeesRes.data || []).map(rowToAccount),
    records,
    corrections: (correctionsRes.data || []).map(rowToCorrection),
    leaveRequests: (leaveRes.data || []).map(rowToLeave),
    leaveBalances: {},
    payrollRecords: (payrollRes.data || []).map(rowToPayroll),
    performanceReports: (perfRes.data || []).map(rowToPerf),
    notifications: (notifRes.data || []).map(rowToNotif),
    auditLogs: (auditRes.data || []).map(rowToAudit),
    profileUpdateRequests: (profileReqRes.data || []).map(rowToProfileRequest),
    groupLeaveSchedules,
    employeeAttendanceSchedules,
    announcements: (announcementsRes.data || []).map(rowToAnnouncement),
  };
}

// 通知はベストエフォート（失敗してもメイン処理は止めない）
async function notify(subject, body, relatedId, toEmployeeId = null, toRole = 'admin') {
  try {
    await supabase.from('notifications').insert({
      to_employee_id: toEmployeeId,
      to_role: toRole,
      subject,
      body,
      related_id: relatedId,
    });
  } catch (e) {
    console.error('通知の記録に失敗しました', e);
  }
}

// 実メール送信（Resend未設定の場合は何もしない。失敗してもアプリ本体は止めない）
async function sendEmailBestEffort(toEmail, subject, text) {
  if (!toEmail) return;
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData?.session?.access_token;
    await supabase.functions.invoke('send-email', {
      body: { to: toEmail, subject, text },
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
    });
  } catch (e) {
    console.error('メール送信に失敗しました（アプリの動作には影響ありません）', e);
  }
}

// シフト希望が届いたらGoogleスプレッドシートに反映（未設定でも申請処理自体は失敗させない）
async function markNotificationRead(id) {
  try {
    await supabase.from('notifications').update({ is_read: true }).eq('id', id);
  } catch (e) {
    console.error('既読処理に失敗しました', e);
  }
}

async function logAudit(actor, action, detail, targetEmployeeId = null, targetEmployeeName = '') {
  try {
    await supabase.from('audit_logs').insert({
      actor_id: actor?.id || null,
      actor_name: actor?.name || '',
      action,
      target_employee_id: targetEmployeeId,
      target_employee_name: targetEmployeeName,
      detail,
    });
  } catch (e) {
    console.error('監査ログの記録に失敗しました', e);
  }
}

// ---- eo業務 実績データの読み書き（対象者が少ないため全体fetchAllDataには含めず個別に取得） ----
async function fetchNewPerf(employeeId, year, month) {
  const { data, error } = await supabase
    .from('staff_new_performance')
    .select('*')
    .eq('employee_id', employeeId)
    .eq('year', year)
    .eq('month', month)
    .maybeSingle();
  if (error) { console.error('新規実績の取得に失敗しました', error); return null; }
  return data;
}

async function saveNewPerf(employeeId, year, month, patch) {
  const { error } = await supabase.from('staff_new_performance').upsert(
    { employee_id: employeeId, year, month, ...patch, updated_at: new Date().toISOString() },
    { onConflict: 'employee_id,year,month' }
  );
  if (error) { console.error('新規実績の保存に失敗しました', error); return false; }
  return true;
}

async function fetchExistingPerf(employeeId, year, month) {
  const { data, error } = await supabase
    .from('staff_existing_performance')
    .select('*')
    .eq('employee_id', employeeId)
    .eq('year', year)
    .eq('month', month)
    .maybeSingle();
  if (error) { console.error('既存実績の取得に失敗しました', error); return null; }
  return data;
}

async function saveExistingPerf(employeeId, year, month, daily) {
  const { error } = await supabase.from('staff_existing_performance').upsert(
    { employee_id: employeeId, year, month, daily, updated_at: new Date().toISOString() },
    { onConflict: 'employee_id,year,month' }
  );
  if (error) { console.error('既存実績の保存に失敗しました', error); return false; }
  return true;
}

// 管理者用：グループ全員分のその月の実績をまとめて取得（RLSにより管理者のみ取得可能）
async function fetchGroupPerfAll(employeeIds, year, month) {
  if (!employeeIds || employeeIds.length === 0) return { newRows: [], existingRows: [] };
  const [newRes, existingRes] = await Promise.all([
    supabase.from('staff_new_performance').select('*').in('employee_id', employeeIds).eq('year', year).eq('month', month),
    supabase.from('staff_existing_performance').select('*').in('employee_id', employeeIds).eq('year', year).eq('month', month),
  ]);
  if (newRes.error) console.error('新規実績一覧の取得に失敗しました', newRes.error);
  if (existingRes.error) console.error('既存実績一覧の取得に失敗しました', existingRes.error);
  return { newRows: newRes.data || [], existingRows: existingRes.data || [] };
}

async function fetchGroupIncentiveFlags(groupName, year, month) {
  const { data, error } = await supabase
    .from('group_incentive_flags')
    .select('*')
    .eq('group_name', groupName)
    .eq('year', year)
    .eq('month', month)
    .maybeSingle();
  if (error) { console.error('グループ目標フラグの取得に失敗しました', error); return null; }
  return data;
}

async function saveGroupIncentiveFlags(groupName, year, month, flags) {
  const { error } = await supabase.from('group_incentive_flags').upsert(
    { group_name: groupName, year, month, ...flags, updated_at: new Date().toISOString() },
    { onConflict: 'group_name,year,month' }
  );
  if (error) { console.error('グループ目標フラグの保存に失敗しました', error); return false; }
  return true;
}

// ---- 月ごとの規定勤怠時間パターン（社員が月初に自分で設定） ----
async function fetchSchedulePatterns(employeeId, year, month) {
  const { data, error } = await supabase
    .from('employee_schedule_patterns')
    .select('*')
    .eq('employee_id', employeeId)
    .eq('year', year)
    .eq('month', month)
    .order('pattern_no', { ascending: true });
  if (error) { console.error('規定勤怠時間の取得に失敗しました', error); return []; }
  return (data || []).map((row) => ({
    patternNo: row.pattern_no,
    label: row.label || '',
    startTime: row.start_time,
    endTime: row.end_time,
  }));
}

async function saveSchedulePatterns(employeeId, year, month, patterns) {
  // 空欄になったパターンは削除、それ以外はupsert
  const toSave = patterns.filter((p) => p.startTime && p.endTime);
  const toDeleteNos = patterns.filter((p) => !p.startTime || !p.endTime).map((p) => p.patternNo);
  if (toSave.length > 0) {
    const { error } = await supabase.from('employee_schedule_patterns').upsert(
      toSave.map((p) => ({
        employee_id: employeeId,
        year,
        month,
        pattern_no: p.patternNo,
        label: p.label || null,
        start_time: p.startTime,
        end_time: p.endTime,
        updated_at: new Date().toISOString(),
      })),
      { onConflict: 'employee_id,year,month,pattern_no' }
    );
    if (error) { console.error('規定勤怠時間の保存に失敗しました', error); return false; }
  }
  if (toDeleteNos.length > 0) {
    const { error } = await supabase
      .from('employee_schedule_patterns')
      .delete()
      .eq('employee_id', employeeId)
      .eq('year', year)
      .eq('month', month)
      .in('pattern_no', toDeleteNos);
    if (error) console.error('規定勤怠時間の削除に失敗しました', error);
  }
  return true;
}

// ============================================================
// Main App
// ============================================================
export default function AttendanceApp() {
  const [data, setData] = useState(EMPTY_DATA);
  const [loaded, setLoaded] = useState(false);
  const [cloudStatus, setCloudStatus] = useState(CLOUD_ENABLED ? 'connecting' : 'local');
  const [session, setSession] = useState(null); // { id, username, name, role, hireDate, resignationDate }
  const [correctionModal, setCorrectionModal] = useState(null);
  const [leaveModalOpen, setLeaveModalOpen] = useState(false);
  const [performanceModal, setPerformanceModal] = useState(null);
  const [employeeTab, setEmployeeTab] = useState('attendance');
  const [topTab, setTopTab] = useState('attendance'); // attendance | labor | hr | payroll
  const [viewMode, setViewMode] = useState(() => (typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches ? 'desktop' : 'mobile'));
  const [schedulePatterns, setSchedulePatterns] = useState([]);
  const [activePatternNo, setActivePatternNo] = useState(1);
  const now = useNow();
  const geo = useGeolocation();
  const { toast, show } = useToast();

  // カテゴリー（上部タブ・下部ナビ）を切り替えたら画面を一番上に戻す
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [topTab, employeeTab]);

  // 今月の規定勤怠時間パターンを取得（社員のみ）
  useEffect(() => {
    if (!session || session.role !== 'employee') return;
    const y = now.getFullYear();
    const m = now.getMonth() + 1;
    fetchSchedulePatterns(session.id, y, m).then((patterns) => {
      setSchedulePatterns(patterns);
      if (patterns.length > 0 && !patterns.some((p) => p.patternNo === activePatternNo)) {
        setActivePatternNo(patterns[0].patternNo);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id, now.getFullYear(), now.getMonth()]);

  const savePatterns = async (patterns) => {
    const y = now.getFullYear();
    const m = now.getMonth() + 1;
    const ok = await saveSchedulePatterns(session.id, y, m, patterns);
    if (ok) {
      const updated = await fetchSchedulePatterns(session.id, y, m);
      setSchedulePatterns(updated);
      if (updated.length > 0 && !updated.some((p) => p.patternNo === activePatternNo)) {
        setActivePatternNo(updated[0].patternNo);
      }
      show('規定勤怠時間を保存しました', 'success');
    } else {
      show('規定勤怠時間の保存に失敗しました', 'warn');
    }
  };

  const loadSessionAndData = useCallback(async () => {
    if (!CLOUD_ENABLED) {
      setLoaded(true);
      setCloudStatus('local');
      show('Supabaseの環境変数が未設定のため、クラウド機能は無効です', 'warn');
      return;
    }
    try {
      const { data: authData } = await supabase.auth.getSession();
      const authUser = authData?.session?.user;
      if (!authUser) {
        setSession(null);
        setData(EMPTY_DATA);
        setLoaded(true);
        setCloudStatus('cloud');
        return;
      }
      const { data: empRow, error: empErr } = await supabase
        .from('employees')
        .select('*')
        .eq('id', authUser.id)
        .single();
      if (empErr || !empRow) {
        // employeesテーブルに行が無い＝プロビジョニング未完了のアカウント
        await supabase.auth.signOut();
        setSession(null);
        setData(EMPTY_DATA);
        setLoaded(true);
        setCloudStatus('cloud');
        return;
      }
      if (empRow.resignation_date && empRow.resignation_date <= todayKey()) {
        // 退職日を過ぎているアカウントはログインさせない
        await supabase.auth.signOut();
        setSession(null);
        setData(EMPTY_DATA);
        setLoaded(true);
        setCloudStatus('cloud');
        show('退職日を過ぎているため、このアカウントではログインできません', 'warn');
        return;
      }
      setSession(rowToAccount(empRow));
      const fresh = await fetchAllData();
      setData(fresh);
      setLoaded(true);
      setCloudStatus('cloud');
    } catch (e) {
      console.error('データ読み込みに失敗しました', e);
      setLoaded(true);
      setCloudStatus('error');
      show('クラウドからの読み込みに失敗しました', 'warn');
    }
  }, []);

  useEffect(() => {
    loadSessionAndData();
    if (!CLOUD_ENABLED) return;
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        setSession(null);
        setData(EMPTY_DATA);
      }
    });
    return () => sub?.subscription?.unsubscribe();
  }, [loadSessionAndData]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const media = window.matchMedia('(min-width: 1024px)');
    const syncViewMode = (event) => setViewMode(event.matches ? 'desktop' : 'mobile');
    setViewMode(media.matches ? 'desktop' : 'mobile');
    media.addEventListener?.('change', syncViewMode);
    return () => media.removeEventListener?.('change', syncViewMode);
  }, []);

  // 個々のミューテーションの後、DBの最新状態を再取得してUIへ反映する。
  // （旧app_state方式のように巨大JSONを毎回書き戻すのではなく、
  //   テーブル単位の差分更新＋再読み込みに変更）
  const refreshData = async () => {
    try {
      const fresh = await fetchAllData();
      setData(fresh);
      setCloudStatus('cloud');
    } catch (e) {
      console.error('再読み込みに失敗しました', e);
      setCloudStatus('error');
    }
  };

  // 管理者への通知（アプリ内通知＋実メール、メールはResend設定済みの場合のみ実際に届く）
  const notifyAdmin = async (subject, body, relatedId) => {
    await notify(subject, body, relatedId, null, 'admin');
    const admin = data.accounts.find((a) => a.role === 'admin' && a.contactEmail);
    if (admin) await sendEmailBestEffort(admin.contactEmail, subject, body);
  };

  // 特定社員への通知（アプリ内通知＋実メール）
  const notifyEmployeeUser = async (targetEmployeeId, subject, body, relatedId) => {
    await notify(subject, body, relatedId, targetEmployeeId, 'employee');
    const emp = data.accounts.find((a) => a.id === targetEmployeeId);
    if (emp?.contactEmail) await sendEmailBestEffort(emp.contactEmail, subject, body);
  };

  const handleLogin = async (username, password) => {
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: usernameToEmail(username),
        password,
      });
      if (error) {
        show('ユーザー名またはパスワードが違います', 'warn');
        return false;
      }
      await loadSessionAndData();
      show('おかえりなさい', 'success');
      return true;
    } catch (e) {
      show('ログインに失敗しました', 'warn');
      return false;
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setSession(null);
    setData(EMPTY_DATA);
  };

  const handleAddAccount = async (payload) => {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;
      const { data: fnData, error } = await supabase.functions.invoke('create-employee', {
        body: {
          username: payload.username,
          password: payload.password,
          name: payload.name,
          furigana: payload.furigana,
          hireDate: payload.hireDate,
          role: payload.role,
          adminPermissions: payload.adminPermissions,
          contactEmail: payload.contactEmail,
        },
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
      });
      if (error || fnData?.error) {
        let detail = fnData?.error;
        if (!detail && error?.context) {
          try {
            const body = await error.context.json();
            detail = body?.error || body?.message;
          } catch (_) {
            try { detail = await error.context.text(); } catch (__) { /* noop */ }
          }
        }
        console.error('アカウント作成エラー詳細:', detail || error);
        show(detail || 'アカウント作成に失敗しました', 'warn');
        return false;
      }
      await refreshData();
      await logAudit(session, '社員アカウントを作成', `username: ${payload.username}`, fnData?.id || null, payload.name);
      show(`${payload.name}さんのアカウントを作成しました`, 'success');
      return true;
    } catch (e) {
      console.error('アカウント作成エラー:', e);
      show('アカウント作成に失敗しました', 'warn');
      return false;
    }
  };

  const handleDeleteAccount = async (account) => {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;
      const { data: fnData, error } = await supabase.functions.invoke('delete-employee', {
        body: { employeeId: account.id },
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
      });
      if (error || fnData?.error) {
        show(fnData?.error || '削除に失敗しました', 'warn');
        return false;
      }
      await refreshData();
      await logAudit(session, '社員アカウントを削除', `username: ${account.username}`, null, account.name);
      show(`${account.name}さんのアカウントを削除しました`, 'success');
      return true;
    } catch (e) {
      show('削除に失敗しました', 'warn');
      return false;
    }
  };

  const handleResetPassword = async (account, newPassword) => {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;
      const { data: fnData, error } = await supabase.functions.invoke('reset-password', {
        body: { employeeId: account.id, newPassword },
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
      });
      if (error || fnData?.error) {
        show(fnData?.error || 'パスワードのリセットに失敗しました', 'warn');
        return false;
      }
      await logAudit(session, 'パスワードをリセット', `対象: ${account.username}`, account.id, account.name);
      show(`${account.name}さんのパスワードをリセットしました`, 'success');
      return true;
    } catch (e) {
      show('パスワードのリセットに失敗しました', 'warn');
      return false;
    }
  };

  const updateAdminAccess = async (targetEmployeeId, patch) => {
    const ok = await updateEmployeeProfile(targetEmployeeId, patch);
    if (ok) await logAudit(session, '管理者権限を変更', JSON.stringify(patch), targetEmployeeId);
    return ok;
  };

  // マイナンバーは別テーブル・マスター管理者のみアクセス可。
  // 一覧に含めず、開いたときだけ都度取得する（不要な露出を減らすため）。
  const fetchMyNumber = async (targetEmployeeId) => {
    try {
      const { data: row, error } = await supabase
        .from('employee_my_numbers')
        .select('*')
        .eq('employee_id', targetEmployeeId)
        .maybeSingle();
      if (error) throw error;
      await logAudit(session, 'マイナンバーを閲覧', '', targetEmployeeId);
      return row ? { number: row.my_number_encrypted, purposes: row.purposes || [] } : { number: '', purposes: [] };
    } catch (e) {
      show('マイナンバーの取得に失敗しました', 'warn');
      return null;
    }
  };

  const saveMyNumber = async (targetEmployeeId, { number, purposes }) => {
    try {
      const { error } = await supabase.from('employee_my_numbers').upsert(
        {
          employee_id: targetEmployeeId,
          my_number_encrypted: number,
          purposes,
          updated_by: session.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'employee_id' }
      );
      if (error) throw error;
      await logAudit(session, 'マイナンバーを更新', `利用目的: ${purposes.join('、')}`, targetEmployeeId);
      show('マイナンバーを保存しました', 'success');
      return true;
    } catch (e) {
      show('マイナンバーの保存に失敗しました', 'warn');
      return false;
    }
  };

  const today = todayKey();
  const employeeId = session?.id;
  const employeeRecords = (employeeId && data.records[employeeId]) || {};
  const todayRecord = employeeRecords[today];

  const activePattern = schedulePatterns.find((p) => p.patternNo === activePatternNo) || schedulePatterns[0] || null;

  const handleClockIn = async (confirm = {}) => {
    const loc = await geo.capture();
    const actualNow = new Date();
    const clockInDate = confirm.clockInTime || actualNow;
    const { error } = await supabase.from('attendance_records').upsert(
      {
        employee_id: employeeId,
        date: today,
        clock_in: clockInDate.toISOString(),
        clock_in_actual: actualNow.toISOString(),
        clock_in_status: confirm.status || null,
        clock_in_note: confirm.note || null,
        clock_in_approval: NEEDS_APPROVAL_STATUSES.includes(confirm.status) ? 'pending' : null,
        clock_out: null,
        break_periods: [],
        break_started_at: null,
        scheduled_start: activePattern?.startTime || SCHEDULED_START,
        scheduled_end: activePattern?.endTime || SCHEDULED_END,
        clock_in_location: loc,
        clock_out_location: null,
      },
      { onConflict: 'employee_id,date' }
    );
    if (error) {
      show('出勤の記録に失敗しました', 'warn');
      return;
    }
    await refreshData();
    const needsApproval = NEEDS_APPROVAL_STATUSES.includes(confirm.status);
    if (needsApproval) {
      const reasonLabel = CLOCK_IN_STATUS_LABEL[confirm.status] || confirm.status;
      await notifyAdmin(
        `【出勤確認】${session.name} - ${reasonLabel}の承認待ち`,
        `${session.name}さんが「${reasonLabel}」として出勤を記録しました（${confirm.note ? `メモ：${confirm.note}` : 'メモなし'}）。内容をご確認のうえ、勤怠一覧上部の「承認待ちの出勤」から承認してください。`,
        today
      );
    }
    show(
      needsApproval
        ? '出勤を記録しました（管理者の承認待ちです）'
        : (loc ? '出勤を記録しました（位置情報を取得）' : '出勤を記録しました（位置情報の取得に失敗）'),
      needsApproval ? 'warn' : (loc ? 'success' : 'warn')
    );
  };

  const handleClockOut = async (confirm = {}) => {
    const loc = await geo.capture();
    const existing = employeeRecords[today] || { breakPeriods: [] };
    const actualNow = new Date();
    const clockOutDate = confirm.clockOutTime || actualNow;
    const nowIso = actualNow.toISOString();
    let breakPeriods = existing.breakPeriods || [];
    if (existing.breakStartedAt) {
      breakPeriods = [...breakPeriods, { start: existing.breakStartedAt, end: nowIso }];
    }
    const { error } = await supabase.from('attendance_records').upsert(
      {
        employee_id: employeeId,
        date: today,
        break_periods: breakPeriods,
        break_started_at: null,
        clock_out: clockOutDate.toISOString(),
        clock_out_actual: nowIso,
        clock_out_status: confirm.status || null,
        clock_out_note: confirm.note || null,
        clock_out_location: loc,
      },
      { onConflict: 'employee_id,date' }
    );
    if (error) {
      show('退勤の記録に失敗しました', 'warn');
      return;
    }
    await refreshData();
    show(loc ? '退勤を記録しました（位置情報を取得）' : '退勤を記録しました（位置情報の取得に失敗）', loc ? 'success' : 'warn');
  };

  const handleBreakStart = async () => {
    const existing = employeeRecords[today];
    if (!existing?.clockIn || existing.clockOut || existing.breakStartedAt) return;
    const { error } = await supabase.from('attendance_records').upsert(
      {
        employee_id: employeeId,
        date: today,
        break_periods: existing.breakPeriods || [],
        break_started_at: new Date().toISOString(),
      },
      { onConflict: 'employee_id,date' }
    );
    if (error) {
      show('休憩開始の記録に失敗しました', 'warn');
      return;
    }
    await refreshData();
    show('休憩を開始しました', 'success');
  };

  const handleBreakEnd = async () => {
    const existing = employeeRecords[today];
    if (!existing?.breakStartedAt || existing.clockOut) return;
    const end = new Date().toISOString();
    const { error } = await supabase.from('attendance_records').upsert(
      {
        employee_id: employeeId,
        date: today,
        break_periods: [...(existing.breakPeriods || []), { start: existing.breakStartedAt, end }],
        break_started_at: null,
      },
      { onConflict: 'employee_id,date' }
    );
    if (error) {
      show('休憩終了の記録に失敗しました', 'warn');
      return;
    }
    await refreshData();
    show('休憩を終了しました', 'success');
  };

  const submitCorrection = async (payload) => {
    const { data: inserted, error } = await supabase
      .from('corrections')
      .insert({
        employee_id: employeeId,
        date: payload.date,
        original: employeeRecords[payload.date] || null,
        requested: payload,
        reason: payload.reason,
        status: 'pending',
      })
      .select()
      .single();
    if (error) {
      show('修正申請の送信に失敗しました', 'warn');
      return;
    }
    await notifyAdmin(
      `【勤怠修正申請】${session.name} - ${dateLabel(payload.date)}`,
      `${session.name}さんより ${dateLabel(payload.date)} の勤怠修正申請が届きました。内容をご確認のうえ承認してください。`,
      inserted?.id
    );
    await refreshData();
    setCorrectionModal(null);
    show('修正申請を送信しました。管理者に通知しました', 'success');
  };

  // 管理者が勤怠一覧から直接、出退勤時刻を修正する（承認フローを介さず即時反映）
  const adminUpdateAttendance = async (targetEmployeeId, dateStr, patch, opts = {}) => {
    const existing = data.records[targetEmployeeId]?.[dateStr] || null;
    const toIso = (hhmmStr) => {
      if (!hhmmStr) return null;
      const [h, m] = hhmmStr.split(':').map(Number);
      return new Date(`${dateStr}T${pad(h)}:${pad(m)}:00`).toISOString();
    };
    const { error } = await supabase.from('attendance_records').upsert(
      {
        employee_id: targetEmployeeId,
        date: dateStr,
        clock_in: patch.clockIn ? toIso(patch.clockIn) : (patch.clockIn === '' ? null : existing?.clockIn || null),
        clock_out: patch.clockOut ? toIso(patch.clockOut) : (patch.clockOut === '' ? null : existing?.clockOut || null),
        break_periods: existing?.breakPeriods || [],
        break_started_at: existing?.breakStartedAt || null,
        break_minutes_override: patch.breakMinutes != null ? Number(patch.breakMinutes) : existing?.breakMinutesOverride ?? null,
        scheduled_start: existing?.scheduledStart || SCHEDULED_START,
        scheduled_end: existing?.scheduledEnd || SCHEDULED_END,
        clock_in_location: existing?.clockInLocation || null,
        clock_out_location: existing?.clockOutLocation || null,
        clock_in_actual: existing?.clockInActual || null,
        clock_in_status: existing?.clockInStatus || null,
        clock_in_note: existing?.clockInNote || null,
        clock_in_approval: patch.approve === true ? 'approved' : (patch.approve === false ? null : (existing?.clockInApproval || null)),
        clock_out_actual: existing?.clockOutActual || null,
        clock_out_status: existing?.clockOutStatus || null,
        clock_out_note: existing?.clockOutNote || null,
      },
      { onConflict: 'employee_id,date' }
    );
    if (error) {
      if (!opts.silent) show('勤怠の修正に失敗しました', 'warn');
      return false;
    }
    if (!opts.silent) {
      await refreshData();
      const target = data.accounts.find((a) => a.id === targetEmployeeId);
      await logAudit(session, '管理者が勤怠を修正', `${dateStr}（${patch.clockIn || '--'} - ${patch.clockOut || '--'}）`, targetEmployeeId, target?.name || '');
      show('勤怠を修正しました', 'success');
    }
    return true;
  };

  // 管理者が複数行をまとめて修正（1件ずつ保存し、最後にまとめて反映・通知）
  const adminUpdateAttendanceBatch = async (changes) => {
    let okCount = 0;
    for (const { employeeId: targetEmployeeId, date: dateStr, patch } of changes) {
      const ok = await adminUpdateAttendance(targetEmployeeId, dateStr, patch, { silent: true });
      if (ok) okCount++;
    }
    await refreshData();
    if (okCount > 0) {
      await logAudit(session, '管理者が勤怠をまとめて修正', `${okCount}件`);
      show(`${okCount}件の勤怠を更新しました`, 'success');
    }
    if (okCount < changes.length) {
      show(`${changes.length - okCount}件の更新に失敗しました`, 'warn');
    }
    return okCount;
  };

  const decideCorrection = async (id, decision) => {
    const correction = data.corrections.find((c) => c.id === id);
    if (!correction) return;
    const { error } = await supabase
      .from('corrections')
      .update({ status: decision, decided_at: new Date().toISOString() })
      .eq('id', id);
    if (error) {
      show('処理に失敗しました', 'warn');
      return;
    }
    if (decision === 'approved') {
      const req = correction.requested;
      const base = new Date(correction.date + 'T00:00:00');
      const buildIso = (hhmmStr) => {
        if (!hhmmStr) return null;
        const [h, m] = hhmmStr.split(':').map(Number);
        const d = new Date(base);
        d.setHours(h, m, 0, 0);
        return d.toISOString();
      };
      const existing = (data.records[correction.employeeId] || {})[correction.date] || {};
      await supabase.from('attendance_records').upsert(
        {
          employee_id: correction.employeeId,
          date: correction.date,
          clock_in: req.clockIn ? buildIso(req.clockIn) : existing.clockIn,
          clock_out: req.clockOut ? buildIso(req.clockOut) : existing.clockOut,
          break_minutes_override: req.breakMinutes != null ? Number(req.breakMinutes) : existing.breakMinutesOverride,
        },
        { onConflict: 'employee_id,date' }
      );
    }
    await refreshData();
    await logAudit(session, decision === 'approved' ? '勤怠修正申請を承認' : '勤怠修正申請を却下', `${dateLabel(correction.date)}分の勤怠修正申請`, correction.employeeId, correction.employeeName);
    show(decision === 'approved' ? '修正申請を承認しました' : '修正申請を却下しました', decision === 'approved' ? 'success' : 'warn');
  };

  const submitLeaveRequest = async (payload) => {
    const days = payload.halfDay ? 0.5 : daysBetweenInclusive(payload.startDate, payload.endDate);
    const { data: inserted, error } = await supabase
      .from('leave_requests')
      .insert({
        employee_id: employeeId,
        type: payload.type,
        half_day: !!payload.halfDay,
        start_date: payload.startDate,
        end_date: payload.endDate,
        days,
        reason: payload.reason,
        status: 'pending',
      })
      .select()
      .single();
    if (error) {
      show('休暇申請の送信に失敗しました', 'warn');
      return;
    }
    const rangeLabel = payload.startDate === payload.endDate ? dateLabel(payload.startDate) : `${dateLabel(payload.startDate)}〜${dateLabel(payload.endDate)}`;
    const typeLabel = payload.halfDay ? `${payload.type}（半休）` : payload.type;
    await notifyAdmin(
      `【休暇申請】${session.name} - ${typeLabel}（${rangeLabel}）`,
      `${session.name}さんより ${typeLabel} の休暇申請（${rangeLabel}／${days}日間）が届きました。内容をご確認のうえ承認してください。`,
      inserted?.id
    );
    await refreshData();
    setLeaveModalOpen(false);
    show('休暇申請を送信しました。管理者に通知しました', 'success');
  };

  const decideLeaveRequest = async (id, decision) => {
    const leave = data.leaveRequests.find((l) => l.id === id);
    const { error } = await supabase
      .from('leave_requests')
      .update({ status: decision, decided_at: new Date().toISOString() })
      .eq('id', id);
    if (error) {
      show('処理に失敗しました', 'warn');
      return;
    }
    await refreshData();
    if (leave) await logAudit(session, decision === 'approved' ? '休暇申請を承認' : '休暇申請を却下', `${leave.type}（${dateLabel(leave.startDate)}〜${dateLabel(leave.endDate)}）`, leave.employeeId, leave.employeeName);
    show(decision === 'approved' ? '休暇申請を承認しました' : '休暇申請を却下しました', decision === 'approved' ? 'success' : 'warn');
  };

  const updateEmployeeProfile = async (targetEmployeeId, patch) => {
    const colMap = {
      hireDate: 'hire_date',
      resignationDate: 'resignation_date',
      furigana: 'furigana',
      role: 'role',
      adminPermissions: 'admin_permissions',
      contactEmail: 'contact_email',
      staffNumber: 'staff_number',
      address: 'address',
      phone: 'phone',
      emergencyContactName: 'emergency_contact_name',
      emergencyContactPhone: 'emergency_contact_phone',
      wageType: 'wage_type',
      hourlyWage: 'hourly_wage',
      monthlySalary: 'monthly_salary',
      birthDate: 'birth_date',
      staffType: 'staff_type',
      mainGroup: 'main_group',
      subGroup: 'sub_group',
      commuteAllowance: 'commute_allowance',
      deemedOvertimeHours: 'deemed_overtime_hours',
      nearestStation: 'nearest_station',
      staffNote1: 'staff_note1',
      staffNote2: 'staff_note2',
      staffNote3: 'staff_note3',
      leaveAdjustment: 'leave_adjustment',
      scheduledWeeklyDays: 'scheduled_weekly_days',
      jobTitle: 'job_title',
      contractStart: 'contract_start',
      contractEnd: 'contract_end',
      bankCode: 'bank_code',
      bankName: 'bank_name',
      branchCode: 'branch_code',
      branchName: 'branch_name',
      accountType: 'account_type',
      accountHolder: 'account_holder',
      accountNumber: 'account_number',
      standardRemunerationHealth: 'standard_remuneration_health',
      standardRemunerationPension: 'standard_remuneration_pension',
      healthInsuranceStatus: 'health_insurance_status',
      healthInsuranceNumber: 'health_insurance_number',
      healthInsuranceAcquiredDate: 'health_insurance_acquired_date',
      healthInsuranceLostDate: 'health_insurance_lost_date',
      pensionStatus: 'pension_status',
      pensionBasicNumber: 'pension_basic_number',
      pensionAcquiredDate: 'pension_acquired_date',
      pensionLostDate: 'pension_lost_date',
      employmentInsuranceStatus: 'employment_insurance_status',
      employmentInsuranceNumber: 'employment_insurance_number',
      employmentInsuranceAcquiredDate: 'employment_insurance_acquired_date',
      employmentInsuranceLostDate: 'employment_insurance_lost_date',
      spouseStatus: 'spouse_status',
      spouseAnnualIncome: 'spouse_annual_income',
      spouseMonthlyIncome: 'spouse_monthly_income',
      familyMembers: 'family_members',
      residentTaxMunicipalityCode: 'resident_tax_municipality_code',
      residentTaxMunicipality: 'resident_tax_municipality',
      residentTaxCollectionMethod: 'resident_tax_collection_method',
      taxTableType: 'tax_table_type',
      isNonResident: 'is_non_resident',
      disabilityClassification: 'disability_classification',
      isWorkingStudent: 'is_working_student',
      singleParentClassification: 'single_parent_classification',
    };
    const dbPatch = {};
    Object.entries(patch).forEach(([key, value]) => {
      if (value !== undefined && colMap[key]) dbPatch[colMap[key]] = value;
    });
    const { error } = await supabase.from('employees').update(dbPatch).eq('id', targetEmployeeId);
    if (error) {
      show('社員情報の更新に失敗しました', 'warn');
      return false;
    }
    await refreshData();
    if (session && session.id === targetEmployeeId) {
      setSession((prev) => ({ ...prev, ...patch }));
    }
    show('社員情報を更新しました', 'success');
    return true;
  };
  // 過去の呼び出し名との互換用エイリアス
  const updateEmployeeDates = updateEmployeeProfile;

  const submitProfileUpdateRequest = async (changes, reason) => {
    const originalValues = {};
    PROFILE_EDITABLE_FIELDS.forEach(({ key }) => { originalValues[key] = session[key] || ''; });
    const { data: inserted, error } = await supabase
      .from('profile_update_requests')
      .insert({
        employee_id: employeeId,
        requested_changes: changes,
        original_values: originalValues,
        reason: reason || null,
        status: 'pending',
      })
      .select()
      .single();
    if (error) {
      show('変更申請の送信に失敗しました', 'warn');
      return;
    }
    const changedLabels = Object.keys(changes).map((k) => PROFILE_EDITABLE_FIELDS.find((f) => f.key === k)?.label || k).join('、');
    await notifyAdmin(
      `【個人情報変更申請】${session.name}`,
      `${session.name}さんより個人情報の変更申請（${changedLabels}）が届きました。内容をご確認のうえ承認してください。`,
      inserted?.id
    );
    await refreshData();
    show('変更を申請しました。管理者に通知しました', 'success');
  };

  const decideProfileUpdateRequest = async (id, decision, memo) => {
    const request = data.profileUpdateRequests.find((r) => r.id === id);
    if (!request) return;
    const { error } = await supabase
      .from('profile_update_requests')
      .update({ status: decision, admin_memo: memo || '', decided_at: new Date().toISOString() })
      .eq('id', id);
    if (error) {
      show('処理に失敗しました', 'warn');
      return;
    }
    if (decision === 'approved') {
      await updateEmployeeProfile(request.employeeId, request.requestedChanges);
    }
    await notifyEmployeeUser(
      request.employeeId,
      `【個人情報変更${decision === 'approved' ? '承認' : '却下'}】`,
      `個人情報の変更申請が${decision === 'approved' ? '承認され、反映されました' : '却下されました'}。${memo ? `管理者コメント：${memo}` : ''}`,
      id
    );
    await refreshData();
    await logAudit(session, decision === 'approved' ? '個人情報変更を承認' : '個人情報変更を却下', Object.keys(request.requestedChanges).join('、'), request.employeeId, request.employeeName);
    show(decision === 'approved' ? '変更申請を承認しました' : '変更申請を却下しました', decision === 'approved' ? 'success' : 'warn');
  };

  const saveGroupLeaveSchedule = async (groupName, monthlyDays) => {
    const rows = Object.entries(monthlyDays).map(([month, days]) => ({
      group_name: groupName,
      month: Number(month),
      days: Number(days) || 0,
    }));
    const { error } = await supabase.from('group_attendance_schedules').upsert(rows, { onConflict: 'group_name,month' });
    if (error) {
      show('グループの出勤規定日数の保存に失敗しました', 'warn');
      return;
    }
    await refreshData();
    await logAudit(session, 'グループ別出勤規定日数を更新', groupName);
    show(`「${groupName}」の出勤規定日数を保存しました`, 'success');
  };

  // グループ未設定の社員向け：個人別の出勤規定日数（月ごと）を保存
  const saveEmployeeAttendanceSchedule = async (employeeId, monthlyDays) => {
    const rows = Object.entries(monthlyDays).map(([month, days]) => ({
      employee_id: employeeId,
      month: Number(month),
      days: Number(days) || 0,
    }));
    const { error } = await supabase.from('employee_attendance_schedules').upsert(rows, { onConflict: 'employee_id,month' });
    if (error) {
      show('個人別の出勤規定日数の保存に失敗しました', 'warn');
      return;
    }
    await refreshData();
    const target = data.accounts.find((a) => a.id === employeeId);
    await logAudit(session, '個人別出勤規定日数を更新', target?.name || '', employeeId, target?.name || '');
    show('出勤規定日数を保存しました', 'success');
  };

  const submitAnnouncement = async ({ title, category, body, file, isPinned }) => {
    let filePath = null;
    let fileName = null;
    if (file) {
      // ストレージのキーは日本語や記号を含められないため、拡張子だけ残してASCIIのみのキーにする
      // （画面に表示する元のファイル名は fileName 側にそのまま保持）
      const extMatch = file.name.match(/\.[a-zA-Z0-9]+$/);
      const ext = extMatch ? extMatch[0] : '';
      const randomPart = Math.random().toString(36).slice(2, 8);
      filePath = `${Date.now()}_${randomPart}${ext}`;
      const { error: uploadError } = await supabase.storage.from('announcements').upload(filePath, file);
      if (uploadError) {
        show(`ファイルのアップロードに失敗しました: ${uploadError.message}`, 'warn');
        return false;
      }
      fileName = file.name;
    }
    const { error } = await supabase.from('announcements').insert({
      title,
      category,
      body: body || null,
      file_path: filePath,
      file_name: fileName,
      created_by: session.id,
      created_by_name: session.name,
      is_pinned: !!isPinned,
    });
    if (error) {
      show('お知らせの投稿に失敗しました', 'warn');
      return false;
    }
    await refreshData();
    await logAudit(session, 'お知らせを配信', `${category}：${title}`);
    show('お知らせを配信しました', 'success');
    return true;
  };

  const deleteAnnouncement = async (announcement) => {
    if (announcement.filePath) {
      await supabase.storage.from('announcements').remove([announcement.filePath]);
    }
    const { error } = await supabase.from('announcements').delete().eq('id', announcement.id);
    if (error) {
      show('削除に失敗しました', 'warn');
      return;
    }
    await refreshData();
    show('お知らせを削除しました', 'success');
  };

  const getAnnouncementFileUrl = async (filePath) => {
    const { data: signed, error } = await supabase.storage.from('announcements').createSignedUrl(filePath, 60 * 10);
    if (error || !signed) {
      show('ファイルの取得に失敗しました', 'warn');
      return null;
    }
    return signed.signedUrl;
  };

  const savePayrollDraft = async (payload) => {
    const { error } = await supabase.from('payroll_records').upsert(
      {
        employee_id: payload.employeeId,
        year: payload.year,
        month: payload.month,
        wage_type: payload.wageType,
        wage_rate: payload.wageRate,
        worked_minutes: payload.workedMinutes,
        overtime_minutes: payload.overtimeMinutes,
        base_amount: payload.baseAmount,
        overtime_amount: payload.overtimeAmount,
        total_amount: payload.totalAmount,
        status: 'draft',
        notes: payload.notes || null,
      },
      { onConflict: 'employee_id,year,month' }
    );
    if (error) {
      show('給与明細の保存に失敗しました', 'warn');
      return;
    }
    await refreshData();
    show('給与明細を下書き保存しました', 'success');
  };

  const publishPayroll = async (id) => {
    const { error } = await supabase.from('payroll_records').update({ status: 'published', published_at: new Date().toISOString() }).eq('id', id);
    if (error) {
      show('公開に失敗しました', 'warn');
      return;
    }
    const record = data.payrollRecords.find((p) => p.id === id);
    if (record) {
      await notifyEmployeeUser(
        record.employeeId,
        `【給与明細】${record.year}年${record.month}月分`,
        `${record.year}年${record.month}月分の給与明細が公開されました。ご確認ください。`,
        id
      );
    }
    await refreshData();
    await logAudit(session, '給与明細を公開', record ? `${record.year}年${record.month}月分` : '', record?.employeeId, record?.employeeName);
    show('給与明細を公開しました', 'success');
  };

  const submitPerformanceReport = async (payload) => {
    const periodLabel = payload.type === 'half'
      ? halfPeriodLabel(payload.year, payload.month, payload.half)
      : monthPeriodLabel(payload.year, payload.month);
    const { data: inserted, error } = await supabase
      .from('performance_reports')
      .insert({
        employee_id: employeeId,
        type: payload.type,
        year: payload.year,
        month: payload.month,
        half: payload.half || null,
        period_label: periodLabel,
        summary: payload.summary,
        numeric_label: payload.numericLabel || '',
        numeric_value: payload.numericValue === '' ? null : payload.numericValue,
        notes: payload.notes || '',
        status: 'pending',
      })
      .select()
      .single();
    if (error) {
      show('実績の送信に失敗しました', 'warn');
      return;
    }
    await notifyAdmin(
      `【個人実績】${session.name} - ${periodLabel}`,
      `${session.name}さんより ${periodLabel} の実績報告が届きました。内容をご確認のうえ承認してください。`,
      inserted?.id
    );
    await refreshData();
    setPerformanceModal(null);
    show('実績を提出しました。管理者に通知しました', 'success');
  };

  const decidePerformanceReport = async (id, decision, memo) => {
    const report = data.performanceReports.find((r) => r.id === id);
    const { error } = await supabase
      .from('performance_reports')
      .update({ status: decision, admin_memo: memo || '', decided_at: new Date().toISOString() })
      .eq('id', id);
    if (error) {
      show('処理に失敗しました', 'warn');
      return;
    }
    if (report) {
      await notifyEmployeeUser(
        report.employeeId,
        `【実績${decision === 'approved' ? '承認' : '却下'}】${report.periodLabel}`,
        `${report.periodLabel} の実績報告が${decision === 'approved' ? '承認されました' : '却下されました'}。${memo ? `管理者コメント：${memo}` : ''}`,
        id
      );
    }
    await refreshData();
    if (report) await logAudit(session, decision === 'approved' ? '実績報告を承認' : '実績報告を却下', report.periodLabel, report.employeeId, report.employeeName);
    show(decision === 'approved' ? '実績を承認しました' : '実績を却下しました', decision === 'approved' ? 'success' : 'warn');
  };

  const cloudStatusLabel = cloudStatus === 'cloud' ? 'クラウド同期' : cloudStatus === 'connecting' ? '接続中' : cloudStatus === 'error' ? '同期エラー' : '端末保存';
  const cloudStatusClass = cloudStatus === 'cloud' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : cloudStatus === 'error' ? 'bg-rose-50 text-rose-700 border-rose-200' : 'bg-slate-50 text-slate-600 border-slate-200';
  if (!loaded) {
    return <div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-400 font-sans text-sm">読み込み中…</div>;
  }

  if (!session) {
    return <LoginScreen onLogin={handleLogin} toast={toast} />;
  }

  const isDesktop = viewMode === 'desktop';

  const historyDates = Array.from(new Set([...Object.keys(employeeRecords), today])).sort((a, b) => (a < b ? 1 : -1));
  const myCorrections = data.corrections.filter((c) => c.employeeId === employeeId);
  const myLeaveRequests = data.leaveRequests.filter((l) => l.employeeId === employeeId);
  const myLeaveTotal = computeLeaveTotal(session, now, data.groupLeaveSchedules);
  const myLeaveUsed = myLeaveRequests
    .filter((l) => l.type === '有休' && l.status === 'approved')
    .reduce((sum, l) => sum + l.days, 0);
  const myPerformanceReports = data.performanceReports.filter((r) => r.employeeId === employeeId);

  const employeeAccounts = data.accounts.filter((a) => a.role === 'employee');
  const pendingCorrectionCount = data.corrections.filter((c) => c.status === 'pending').length;
  const pendingLeaveCount = data.leaveRequests.filter((l) => l.status === 'pending').length;
  const pendingPerformanceCount = data.performanceReports.filter((r) => r.status === 'pending').length;
  const missingPunchCount = employeeAccounts.reduce((sum, acc) => {
    const recs = data.records[acc.id] || {};
    return sum + Object.keys(recs).filter((k) => k !== today && recs[k]?.clockIn && !recs[k]?.clockOut).length;
  }, 0);

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900">
      <div style={{ paddingTop: 'env(safe-area-inset-top)' }} className="bg-slate-950">
        <GlobalTopTabs topTab={topTab} setTopTab={setTopTab} session={session} />
      </div>
      <Header
        session={session}
        onLogout={handleLogout}
        pendingCount={pendingCorrectionCount + pendingLeaveCount + pendingPerformanceCount}
        missingPunchCount={missingPunchCount}
        viewMode={viewMode}
        cloudStatusLabel={cloudStatusLabel}
        cloudStatusClass={cloudStatusClass}
      />
      <main className={isDesktop ? 'max-w-6xl mx-auto px-6 pb-16 pt-8' : 'max-w-3xl mx-auto px-4 pb-24 pt-6'}>
        {topTab === 'labor' && (
          <AnnouncementsView
            announcements={data.announcements}
            isAdmin={session.role === 'admin' || session.role === 'master_admin'}
            onSubmit={submitAnnouncement}
            onDelete={deleteAnnouncement}
            onGetFileUrl={getAnnouncementFileUrl}
            isDesktop={isDesktop}
          />
        )}
        {topTab === 'hr' && (
          session.role === 'employee' ? (
            <ProfileRequestView
              session={session}
              requests={data.profileUpdateRequests.filter((r) => r.employeeId === employeeId)}
              onSubmit={submitProfileUpdateRequest}
            />
          ) : (
            <AdminProfileRequestsTab
              requests={data.profileUpdateRequests}
              onDecide={decideProfileUpdateRequest}
              isDesktop={isDesktop}
            />
          )
        )}
        {topTab === 'payroll' && (
          session.role === 'employee' ? (
            <PayslipView records={data.payrollRecords.filter((p) => p.employeeId === employeeId && p.status === 'published')} employeeName={session.name} />
          ) : (
            <PayrollAdminTab
              employeeAccounts={employeeAccounts}
              records={data.records}
              payrollRecords={data.payrollRecords}
              groupAttendanceSchedules={data.groupLeaveSchedules}
              employeeAttendanceSchedules={data.employeeAttendanceSchedules}
              onSaveDraft={savePayrollDraft}
              onPublish={publishPayroll}
              onUpdateWage={updateEmployeeProfile}
              isDesktop={isDesktop}
            />
          )
        )}
        {topTab === 'attendance' && (session.role === 'employee' ? (
          <div className="space-y-5">
            {isDesktop && (
              <div className="flex items-center bg-white rounded-2xl border border-slate-200 p-1.5 text-[12px] font-bold max-w-2xl shadow-sm">
                {[
                  ['attendance','勤怠'],['leave','休暇申請'],['performance','実績']
                ].map(([key,label]) => <button key={key} onClick={() => setEmployeeTab(key)} className={`flex-1 py-2.5 rounded-xl transition-colors ${employeeTab === key ? 'bg-slate-950 text-white' : 'text-slate-500 hover:bg-slate-50'}`}>{label}</button>)}
              </div>
            )}
            {employeeTab === 'attendance' && (
              <EmployeeView
                now={now}
                todayRecord={todayRecord}
                onClockIn={handleClockIn}
                onClockOut={handleClockOut}
                onBreakStart={handleBreakStart}
                onBreakEnd={handleBreakEnd}
                geoStatus={geo.status}
                historyDates={historyDates}
                records={employeeRecords}
                corrections={myCorrections}
                onOpenCorrection={(dateKey) => setCorrectionModal(dateKey)}
                notifications={data.notifications.filter((n) => n.toEmployeeId === employeeId)}
                onMarkNotificationRead={async (id) => { await markNotificationRead(id); await refreshData(); }}
                schedulePatterns={schedulePatterns}
                activePatternNo={activePatternNo}
                onSetActivePattern={setActivePatternNo}
                onSavePatterns={savePatterns}
                isDesktop={isDesktop}
              />
            )}
            {employeeTab === 'leave' && (
              <LeaveView
                leaveRequests={myLeaveRequests}
                leaveTotal={myLeaveTotal}
                leaveUsed={myLeaveUsed}
                hireDate={session.hireDate}
                onOpenLeaveModal={() => setLeaveModalOpen(true)}
                isDesktop={isDesktop}
              />
            )}
            {employeeTab === 'performance' && (
              <div className="space-y-5">
                {session.mainGroup === EO_GROUP_NAME && (
                  <EoPerformanceSection employeeId={session.id} isDesktop={isDesktop} />
                )}
                <PerformanceView
                  reports={myPerformanceReports}
                  onOpenModal={(type) => setPerformanceModal(type)}
                  isDesktop={isDesktop}
                />
              </div>
            )}
          </div>
        ) : (
          <AdminView
            data={data}
            employeeAccounts={employeeAccounts}
            session={session}
            onDecide={decideCorrection}
            onDecideLeave={decideLeaveRequest}
            onDecidePerformance={decidePerformanceReport}
            onAddAccount={handleAddAccount}
            onDeleteAccount={handleDeleteAccount}
            onResetPassword={handleResetPassword}
            onFetchMyNumber={fetchMyNumber}
            onSaveMyNumber={saveMyNumber}
            onUpdateDates={updateEmployeeDates}
            onUpdateAdminAccess={updateAdminAccess}
            onSaveGroupLeave={saveGroupLeaveSchedule}
            onSaveEmployeeAttendance={saveEmployeeAttendanceSchedule}
            onAdminUpdateAttendance={adminUpdateAttendance}
            onAdminUpdateAttendanceBatch={adminUpdateAttendanceBatch}
            isDesktop={isDesktop}
          />
        ))}
      </main>
      {correctionModal && (
        <CorrectionModal
          dateKey={correctionModal}
          record={employeeRecords[correctionModal]}
          onClose={() => setCorrectionModal(null)}
          onSubmit={submitCorrection}
        />
      )}
      {leaveModalOpen && (
        <LeaveRequestModal
          leaveRemaining={myLeaveTotal - myLeaveUsed}
          onClose={() => setLeaveModalOpen(false)}
          onSubmit={submitLeaveRequest}
        />
      )}
      {performanceModal && (
        <PerformanceModal
          type={performanceModal}
          onClose={() => setPerformanceModal(null)}
          onSubmit={submitPerformanceReport}
        />
      )}
      {session.role === 'employee' && !isDesktop && (
        <nav className="fixed inset-x-3 bottom-3 z-40 mx-auto max-w-md rounded-[22px] border border-slate-200/80 bg-white/95 p-1.5 shadow-2xl backdrop-blur">
          <div className="grid grid-cols-4 gap-1">
            {[
              ['attendance','勤怠',Clock],['leave','休暇',Palmtree],['performance','実績',BarChart3]
            ].map(([key,label,Icon]) => <button key={key} onClick={() => setEmployeeTab(key)} className={`flex flex-col items-center gap-1 rounded-2xl py-2 text-[10px] font-bold transition ${employeeTab === key ? 'bg-slate-950 text-white' : 'text-slate-400'}`}><Icon size={17}/>{label}</button>)}
          </div>
        </nav>
      )}
      <ToastView toast={toast} />
    </div>
  );
}

function LoginScreen({ onLogin, toast }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const submit = (e) => {
    e.preventDefault();
    if (username.trim().length > 0 && password.length > 0) {
      onLogin(username.trim(), password);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-white flex items-center justify-center px-4 py-[max(1rem,env(safe-area-inset-top))] font-sans">
      <div className="w-full max-w-[360px]">
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-slate-950 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-amber-200">
            <Clock size={26} className="text-white" strokeWidth={2.4} />
          </div>
          <h1 className="text-slate-800 font-bold text-[21px] tracking-tight">Brown Work</h1>
          <p className="text-slate-500 text-[13px] mt-1.5">勤怠・シフト・申請をひとつに</p>
        </div>
        <form onSubmit={submit} className="bg-white rounded-2xl p-6 space-y-4 border-2 border-slate-200 shadow-lg">
          <div>
            <label className="block text-[12.5px] font-bold text-slate-800 mb-1.5">ユーザー名（メールアドレスでも可）</label>
            <div className="flex items-center border-2 border-slate-200 rounded-xl px-3.5 gap-2 focus-within:border-slate-900 transition-colors">
              <User size={16} className="text-slate-400 shrink-0" />
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full py-3 text-[15px] outline-none bg-transparent text-slate-800"
                placeholder="ユーザー名またはメールアドレス"
                autoCapitalize="none"
                autoFocus
                required
              />
            </div>
          </div>
          <div>
            <label className="block text-[12.5px] font-bold text-slate-800 mb-1.5">パスワード</label>
            <div className="flex items-center border-2 border-slate-200 rounded-xl px-3.5 gap-2 focus-within:border-slate-900 transition-colors">
              <Lock size={16} className="text-slate-400 shrink-0" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full py-3 text-[15px] outline-none bg-transparent text-slate-800"
                placeholder="パスワードを入力"
                required
              />
            </div>
          </div>
          <button
            type="submit"
            className="w-full py-3.5 rounded-xl bg-slate-950 text-white text-[15px] font-bold flex items-center justify-center gap-2 shadow-md shadow-amber-200 active:brightness-95 transition-all mt-2"
          >
            <LogIn size={17} strokeWidth={2.4} />
            ログイン
          </button>
        </form>
      </div>
      <ToastView toast={toast} />
    </div>
  );
}

function GlobalTopTabs({ topTab, setTopTab, session }) {
  const allTabs = [
    { key: 'attendance', label: '勤怠', icon: <Clock size={14} /> },
    { key: 'labor', label: '労務', icon: <Briefcase size={14} /> },
    { key: 'hr', label: '人材', icon: <UserCog size={14} /> },
    { key: 'payroll', label: '給与', icon: <Wallet size={14} /> },
  ];
  // 権限を制限された管理者は、許可されたタブのみ表示（社員・マスター管理者は全タブ表示）
  const isRestrictedAdmin = session?.role === 'admin';
  const tabs = isRestrictedAdmin
    ? allTabs.filter((t) => (session.adminPermissions || []).includes(t.key))
    : allTabs;

  useEffect(() => {
    if (isRestrictedAdmin && tabs.length > 0 && !tabs.some((t) => t.key === topTab)) {
      setTopTab(tabs[0].key);
    }
  }, [isRestrictedAdmin, topTab, tabs.map((t) => t.key).join(',')]);

  return (
    <div className="bg-slate-950 text-slate-300">
      <div className="max-w-6xl mx-auto px-4 flex items-center gap-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTopTab(t.key)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-[12.5px] font-bold border-b-2 transition-colors ${
              topTab === t.key ? 'text-white border-amber-500' : 'text-slate-400 border-transparent hover:text-slate-200'
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
        {session?.role === 'master_admin' && (
          <span className="ml-auto text-[10px] font-bold text-amber-500 bg-amber-500/10 px-2 py-1 rounded-full">マスター管理者</span>
        )}
      </div>
    </div>
  );
}

function ComingSoonPanel({ title }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm px-6 py-16 flex flex-col items-center text-center">
      <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
        <Construction size={24} className="text-slate-400" />
      </div>
      <h2 className="font-bold text-[16px] text-slate-800 mb-1.5">{title}機能は準備中です</h2>
      <p className="text-[12.5px] text-slate-400 max-w-xs">今後追加予定です。必要な機能が決まりましたら教えてください。</p>
    </div>
  );
}

const CATEGORY_COLORS = {
  'お知らせ': 'bg-slate-100 text-slate-600',
  '制度・インセンティブ': 'bg-amber-50 text-amber-700',
  '資料・料金表': 'bg-blue-50 text-blue-700',
  'キャンペーン': 'bg-rose-50 text-rose-700',
  'その他': 'bg-slate-100 text-slate-600',
};

function AnnouncementsView({ announcements, isAdmin, onSubmit, onDelete, onGetFileUrl, isDesktop }) {
  const [composerOpen, setComposerOpen] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [downloading, setDownloading] = useState(null);

  const filtered = categoryFilter === 'all' ? announcements : announcements.filter((a) => a.category === categoryFilter);
  const categoriesInUse = Array.from(new Set(announcements.map((a) => a.category)));

  const openFile = async (a) => {
    setDownloading(a.id);
    const url = await onGetFileUrl(a.filePath);
    setDownloading(null);
    if (url) window.open(url, '_blank');
  };

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-100 flex items-center gap-2 flex-wrap">
          <Megaphone size={16} className="text-slate-400" />
          <h2 className="font-bold text-[14px] text-slate-800">お知らせ</h2>
          {isAdmin && (
            <button
              onClick={() => setComposerOpen(true)}
              className="ml-auto flex items-center gap-1.5 bg-amber-600 text-white text-[12.5px] font-bold px-3 py-1.5 rounded-lg shadow-sm active:brightness-95"
            >
              <Plus size={13} /> 配信する
            </button>
          )}
        </div>
        {categoriesInUse.length > 0 && (
          <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setCategoryFilter('all')}
              className={`text-[11.5px] font-bold px-3 py-1 rounded-full ${categoryFilter === 'all' ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-500'}`}
            >
              すべて
            </button>
            {categoriesInUse.map((c) => (
              <button
                key={c}
                onClick={() => setCategoryFilter(c)}
                className={`text-[11.5px] font-bold px-3 py-1 rounded-full ${categoryFilter === c ? 'bg-slate-800 text-white' : CATEGORY_COLORS[c] || 'bg-slate-100 text-slate-500'}`}
              >
                {c}
              </button>
            ))}
          </div>
        )}
        {filtered.length === 0 ? (
          <div className="px-5 py-14 text-center text-[12.5px] text-slate-300">お知らせはまだありません</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {filtered.map((a) => (
              <div key={a.id} className="px-5 py-4">
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    {a.isPinned && <Pin size={12} className="text-amber-600" />}
                    <span className={`text-[10.5px] font-bold px-2 py-0.5 rounded-full ${CATEGORY_COLORS[a.category] || 'bg-slate-100 text-slate-500'}`}>{a.category}</span>
                    <span className="text-[14px] font-bold text-slate-800">{a.title}</span>
                  </div>
                  {isAdmin && (
                    <button onClick={() => onDelete(a)} className="text-slate-300 hover:text-rose-500 shrink-0">
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
                {a.body && <div className="text-[12.5px] text-slate-600 whitespace-pre-wrap mb-2">{a.body}</div>}
                {a.filePath && (
                  <button
                    onClick={() => openFile(a)}
                    disabled={downloading === a.id}
                    className="flex items-center gap-1.5 text-[12px] font-bold text-blue-700 bg-blue-50 rounded-lg px-3 py-1.5 mb-2"
                  >
                    <FileText size={13} /> {downloading === a.id ? '開いています…' : a.fileName || '添付ファイルを開く'}
                  </button>
                )}
                <div className="text-[10.5px] text-slate-300">{a.createdByName} ・ {new Date(a.createdAt).toLocaleString('ja-JP')}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {composerOpen && (
        <AnnouncementComposerModal onClose={() => setComposerOpen(false)} onSubmit={onSubmit} />
      )}
    </div>
  );
}

function AnnouncementComposerModal({ onClose, onSubmit }) {
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState(ANNOUNCEMENT_CATEGORIES[0]);
  const [body, setBody] = useState('');
  const [file, setFile] = useState(null);
  const [isPinned, setIsPinned] = useState(false);
  const [saving, setSaving] = useState(false);
  const canSubmit = title.trim().length > 0;

  const submit = async () => {
    setSaving(true);
    const ok = await onSubmit({ title: title.trim(), category, body: body.trim(), file, isPinned });
    setSaving(false);
    if (ok) onClose();
  };

  return createPortal(
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-40 p-0 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md max-h-[92vh] overflow-y-auto">
        <div className="px-5 pt-5 pb-3 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white">
          <h3 className="font-bold text-[15px]">お知らせを配信</h3>
          <button onClick={onClose} className="text-slate-400 text-xl leading-none px-1">×</button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <Field label="分類">
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[14px] bg-white">
              {ANNOUNCEMENT_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="タイトル">
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例）2026年度アップセルポイント一覧表" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[14px]" />
          </Field>
          <Field label="本文（任意）">
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} placeholder="内容の説明などを入力" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13.5px] resize-none" />
          </Field>
          <Field label="添付ファイル（PDFなど・任意）">
            <label className="flex items-center gap-2 border-2 border-dashed border-slate-200 rounded-lg px-3 py-3 cursor-pointer text-[12.5px] text-slate-500">
              <Paperclip size={14} />
              {file ? file.name : 'タップしてファイルを選択'}
              <input type="file" className="hidden" onChange={(e) => setFile(e.target.files?.[0] || null)} />
            </label>
          </Field>
          <label className="flex items-center gap-2 text-[12.5px] text-slate-600">
            <input type="checkbox" checked={isPinned} onChange={(e) => setIsPinned(e.target.checked)} />
            上部に固定表示する
          </label>
        </div>
        <div className="px-5 pb-5 pt-1 flex gap-2 sticky bottom-0 bg-white">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-lg border border-slate-200 text-[13.5px] font-medium text-slate-500">キャンセル</button>
          <button onClick={submit} disabled={!canSubmit || saving} className="flex-1 py-2.5 rounded-lg bg-amber-600 disabled:bg-slate-200 text-white text-[13.5px] font-bold">
            {saving ? '配信中…' : '配信する'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function Header({ session, onLogout, pendingCount, missingPunchCount, viewMode, cloudStatusLabel, cloudStatusClass }) {
  const alertCount = pendingCount + missingPunchCount;
  const isDesktop = viewMode === 'desktop';
  return (
    <header className="bg-slate-800 text-white sticky top-0 z-30 shadow-sm">
      <div className={`${isDesktop ? 'max-w-6xl px-6' : 'max-w-3xl px-4'} mx-auto py-3.5 flex items-center justify-between`}>
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-md bg-slate-950 flex items-center justify-center">
            <Clock size={17} className="text-white" strokeWidth={2.4} />
          </div>
          <div>
            <div className="font-bold text-[15px] leading-tight tracking-tight">勤怠打刻</div>
            <div className="text-[10.5px] text-slate-400 leading-tight">{session.name}（{session.role === 'master_admin' ? 'マスター管理者' : session.role === 'admin' ? '管理者' : '社員'}）</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {(session.role === 'admin' || session.role === 'master_admin') && alertCount > 0 && (
            <span className="w-5 h-5 bg-amber-600 rounded-full text-[10px] flex items-center justify-center text-white font-bold">
              {alertCount}
            </span>
          )}
          {cloudStatusLabel && (
            <span className={`hidden sm:inline-flex items-center rounded-full border px-2.5 py-1 text-[10.5px] font-semibold ${cloudStatusClass}`}>
              {cloudStatusLabel}
            </span>
          )}
          <div className="hidden md:flex items-center gap-1.5 rounded-lg bg-white/10 px-2.5 py-1.5 text-[10.5px] font-bold text-slate-300">
            {isDesktop ? <Monitor size={13} /> : <Smartphone size={13} />}
            {isDesktop ? 'PC表示' : 'スマホ表示'}
          </div>
          <button
            onClick={onLogout}
            className="flex items-center gap-1 text-[12px] font-medium text-slate-300 bg-white/10 rounded-lg px-3 py-1.5"
          >
            <LogoutIcon size={13} /> ログアウト
          </button>
        </div>
      </div>
      {cloudStatusLabel && (
        <div className="sm:hidden px-4 pb-2 -mt-1">
          <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-semibold ${cloudStatusClass}`}>
            {cloudStatusLabel}
          </span>
        </div>
      )}
    </header>
  );
}

function EmployeeView({ now, todayRecord, onClockIn, onClockOut, geoStatus, historyDates, records, corrections, onOpenCorrection, notifications, onMarkNotificationRead, schedulePatterns = [], activePatternNo, onSetActivePattern, onSavePatterns, isDesktop }) {
  const status = computeDayStatus(todayRecord);
  const canClockIn = !todayRecord?.clockIn;
  const canClockOut = todayRecord?.clockIn && !todayRecord?.clockOut;
  const doneToday = todayRecord?.clockIn && todayRecord?.clockOut;
  const monthly = computeMonthlySummary(records, now);
  const todayBreak = todayRecord ? getRecordedBreakMinutes(todayRecord, now) : 0;
  const todayKeyStr = todayKey();
  const missingDate = historyDates.find((k) => k !== todayKeyStr && records[k]?.clockIn && !records[k]?.clockOut);
  const missingCount = historyDates.filter((k) => k !== todayKeyStr && records[k]?.clockIn && !records[k]?.clockOut).length;
  const hasMissingPunch = missingCount > 0;
  const activePattern = schedulePatterns.find((p) => p.patternNo === activePatternNo) || schedulePatterns[0] || null;
  const standardStartMinutes = activePattern ? toMinutes(activePattern.startTime) : STANDARD_CLOCK_IN_HOUR * 60;
  const standardEndMinutes = activePattern ? toMinutes(activePattern.endTime) : STANDARD_CLOCK_OUT_HOUR * 60;
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const isLateClockOut = nowMinutes >= standardEndMinutes;
  const primaryLabel = doneToday ? '退勤済み' : canClockIn ? '出勤' : '退勤';
  const [clockInConfirmOpen, setClockInConfirmOpen] = useState(false);
  const [clockOutConfirmOpen, setClockOutConfirmOpen] = useState(false);
  const primaryAction = canClockIn
    ? (hasMissingPunch ? undefined : () => setClockInConfirmOpen(true))
    : canClockOut
      ? (isLateClockOut ? () => setClockOutConfirmOpen(true) : onClockOut)
      : undefined;
  const primaryDisabled = doneToday || (canClockIn && hasMissingPunch);

  const patternSection = (schedulePatterns.length > 0 || canClockIn) && (
    <SchedulePatternCard
      now={now}
      patterns={schedulePatterns}
      activePatternNo={activePatternNo}
      onSetActivePattern={onSetActivePattern}
      onSavePatterns={onSavePatterns}
      locked={!canClockIn}
    />
  );

  const clockSection = (
    <div className="space-y-4">
      <div className="rounded-[22px] bg-white border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-3 bg-slate-100 flex items-center justify-between">
          <span className="text-[12.5px] font-bold text-slate-500">
            {now.getFullYear()}年{now.getMonth() + 1}月{now.getDate()}日（{['日','月','火','水','木','金','土'][now.getDay()]}）
          </span>
          <span className={`rounded-full px-3 py-1 text-[11px] font-bold ${status.tone === 'active' ? 'bg-emerald-100 text-emerald-700' : status.tone === 'danger' ? 'bg-rose-100 text-rose-700' : 'bg-slate-200 text-slate-600'}`}>
            {status.label}
          </span>
        </div>

        <div className="px-6 pt-6 pb-5 text-center">
          <div className="font-mono text-[46px] sm:text-[52px] font-bold leading-none tracking-tight tabular-nums text-slate-900">{timeStr(now)}</div>
        </div>

        {canClockIn && hasMissingPunch && (
          <div className="mx-6 mb-3 bg-rose-50 border border-rose-200 rounded-xl px-3.5 py-2.5 text-[11.5px] text-rose-700">
            {dateLabel(missingDate)}の退勤打刻が漏れています。修正を申請してから出勤を記録してください。
            <button onClick={() => onOpenCorrection(missingDate)} className="block mt-1 font-bold underline">今すぐ修正申請する</button>
          </div>
        )}

        <div className="px-6 pb-5">
          <button
            onClick={primaryAction}
            disabled={primaryDisabled || !primaryAction}
            className="w-full rounded-xl bg-amber-500 disabled:bg-slate-200 disabled:text-slate-400 text-white py-4 text-[16px] font-bold tracking-wide shadow-sm active:brightness-95 transition"
          >
            {primaryLabel}
          </button>
        </div>

        <div className="px-6 pb-4 grid grid-cols-3 gap-2 border-t border-slate-100 pt-4">
          <div className="text-center"><div className="text-[10px] text-slate-400">出勤</div><div className="mt-1 font-mono text-[14px] font-bold text-slate-800">{todayRecord?.clockIn ? hhmm(new Date(todayRecord.clockIn)) : '--:--'}</div></div>
          <div className="text-center border-x border-slate-100"><div className="text-[10px] text-slate-400">退勤</div><div className="mt-1 font-mono text-[14px] font-bold text-slate-800">{todayRecord?.clockOut ? hhmm(new Date(todayRecord.clockOut)) : '--:--'}</div></div>
          <div className="text-center"><div className="text-[10px] text-slate-400">休憩（自動）</div><div className="mt-1 font-mono text-[14px] font-bold text-slate-800">{todayRecord?.clockIn ? `${todayBreak}分` : '--'}</div></div>
        </div>
        <div className="px-6 pb-4 flex items-center justify-center gap-1.5 text-[10.5px] text-slate-400">
          <MapPin size={11} />{geoStatus === 'loading' ? '位置情報を取得中…' : geoStatus === 'denied' ? '位置情報が許可されていません' : '打刻時に位置情報を記録'}
        </div>
      </div>

      {patternSection}

      <div className="rounded-2xl bg-white border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-3 bg-slate-100 text-[12.5px] font-bold text-slate-500">以下の項目の確認をお願いいたします</div>
        <button onClick={() => missingCount > 0 && historyDates[0] && onOpenCorrection(historyDates.find((k) => k !== todayKeyStr && records[k]?.clockIn && !records[k]?.clockOut))} className="w-full px-5 py-3 flex items-center justify-between text-[13px] hover:bg-slate-50 transition-colors">
          <span className="text-slate-600">打刻漏れ・打刻間違い</span>
          <span className={`font-bold ${missingCount > 0 ? 'text-rose-600 underline' : 'text-slate-300'}`}>{missingCount}件</span>
        </button>
      </div>

      <div className="rounded-2xl bg-white border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-3 bg-slate-100 flex items-center justify-between">
          <span className="text-[12.5px] font-bold text-slate-500">管理者からのお知らせ</span>
          {notifications && notifications.some((n) => !n.isRead) && (
            <span className="text-[10px] font-bold text-white bg-rose-500 rounded-full px-2 py-0.5">未読 {notifications.filter((n) => !n.isRead).length}</span>
          )}
        </div>
        {(!notifications || notifications.length === 0) ? (
          <div className="px-5 py-4 text-[12.5px] text-slate-400">管理者からのお知らせはありません</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {notifications.slice(0, 5).map((n) => (
              <button
                key={n.id}
                onClick={() => !n.isRead && onMarkNotificationRead(n.id)}
                className="w-full text-left px-5 py-3 hover:bg-slate-50 transition-colors"
              >
                <div className="flex items-center gap-1.5">
                  {!n.isRead && <span className="w-1.5 h-1.5 rounded-full bg-rose-500 shrink-0" />}
                  <span className="text-[12.5px] font-bold text-slate-700">{n.subject}</span>
                </div>
                <div className="text-[11.5px] text-slate-500 mt-0.5">{n.body}</div>
                <div className="text-[10px] text-slate-300 mt-1">{new Date(n.sentAt).toLocaleString('ja-JP')}</div>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SummaryTile label="今月の出勤" value={`${monthly.days}日`} icon={<CalendarDays size={16}/>} />
        <SummaryTile label="総実働" value={minutesToHHMM(monthly.workedMin)} icon={<Clock size={16}/>} />
        <SummaryTile label="残業" value={minutesToHHMM(monthly.overtimeMin)} icon={<BarChart3 size={16}/>} />
        <SummaryTile label="遅刻・早退" value={`${monthly.lateMin + monthly.earlyLeaveMin}分`} icon={<AlertTriangle size={16}/>} />
      </div>
      {doneToday && <DayMetricsCard record={todayRecord} />}
    </div>
  );

  const historySection = (
    <div className="bg-white rounded-[24px] shadow-sm border border-slate-200 overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
        <div className="flex items-center gap-2"><Calendar size={16} className="text-slate-400"/><h2 className="font-bold text-[14px]">勤怠履歴</h2></div>
        <span className="text-[10.5px] text-slate-400">1分単位で集計</span>
      </div>
      <div className={`divide-y divide-slate-100 ${isDesktop ? 'max-h-[650px] overflow-y-auto' : ''}`}>
        {historyDates.slice(0, 31).map((dateKey) => {
          const r = records[dateKey]; const dayStatus = computeDayStatus(r); const metrics = computeMetrics(r);
          const pendingForDay = corrections.find((c) => c.date === dateKey && c.status === 'pending');
          return (
            <div key={dateKey} className="px-5 py-4 flex items-center justify-between gap-3 hover:bg-slate-50/70">
              <div className="min-w-0">
                <div className="flex items-center gap-2"><span className="text-[13px] font-bold text-slate-800">{dateLabel(dateKey)}</span>{dayStatus.tone === 'danger' && <span className="text-[10px] font-bold text-rose-600">未退勤</span>}{pendingForDay && <span className="text-[10px] font-bold text-amber-600">申請中</span>}</div>
                <div className="mt-1 font-mono text-[12px] text-slate-500">{r?.clockIn ? hhmm(new Date(r.clockIn)) : '--:--'} — {r?.clockOut ? hhmm(new Date(r.clockOut)) : '--:--'}{metrics && <span className="ml-2 text-slate-400">実働 {minutesToHHMM(metrics.workedMin)} / 休憩 {metrics.breakMin}分</span>}</div>
                {r?.clockInStatus && CLOCK_IN_STATUS_LABEL[r.clockInStatus] && (
                  <div className="mt-0.5 text-[10.5px] font-medium text-blue-600">
                    {CLOCK_IN_STATUS_LABEL[r.clockInStatus]}
                    {r.clockInActual && r.clockInActual !== r.clockIn && <span className="text-slate-400 font-normal">（実打刻 {hhmm(new Date(r.clockInActual))}）</span>}
                    {r.clockInNote && <span className="text-slate-400 font-normal">・{r.clockInNote}</span>}
                  </div>
                )}
                {r?.clockOutStatus && CLOCK_OUT_STATUS_LABEL[r.clockOutStatus] && (
                  <div className="mt-0.5 text-[10.5px] font-medium text-purple-600">
                    {CLOCK_OUT_STATUS_LABEL[r.clockOutStatus]}
                    {r.clockOutActual && r.clockOutActual !== r.clockOut && <span className="text-slate-400 font-normal">（実打刻 {hhmm(new Date(r.clockOutActual))}）</span>}
                    {r.clockOutNote && <span className="text-slate-400 font-normal">・{r.clockOutNote}</span>}
                  </div>
                )}
                {metrics && (metrics.lateMin > 0 || metrics.earlyLeaveMin > 0 || metrics.overtimeMin > 0) && <div className="mt-1 text-[10.5px] font-medium"><span className="text-rose-500">{metrics.lateMin > 0 ? `遅刻 ${metrics.lateMin}分 ` : ''}{metrics.earlyLeaveMin > 0 ? `早退 ${metrics.earlyLeaveMin}分` : ''}</span>{metrics.overtimeMin > 0 && <span className="ml-2 text-amber-600">残業 {minutesToHHMM(metrics.overtimeMin)}</span>}</div>}
              </div>
              <button onClick={() => onOpenCorrection(dateKey)} className="shrink-0 rounded-xl border border-slate-200 p-2.5 text-slate-500 hover:bg-white"><FileEdit size={15}/></button>
            </div>
          );
        })}
      </div>
    </div>
  );

  if (isDesktop) return (
    <div className="grid grid-cols-[420px_1fr] gap-6 items-start">
      {clockSection}
      {historySection}
      {clockInConfirmOpen && (
        <ClockInConfirmModal
          now={now}
          standardMinutes={standardStartMinutes}
          onClose={() => setClockInConfirmOpen(false)}
          onConfirm={async (payload) => { await onClockIn(payload); setClockInConfirmOpen(false); }}
        />
      )}
      {clockOutConfirmOpen && (
        <ClockOutConfirmModal
          now={now}
          standardMinutes={standardEndMinutes}
          onClose={() => setClockOutConfirmOpen(false)}
          onConfirm={async (payload) => { await onClockOut(payload); setClockOutConfirmOpen(false); }}
        />
      )}
    </div>
  );
  return (
    <div className="space-y-5">
      {clockSection}
      {historySection}
      {clockInConfirmOpen && (
        <ClockInConfirmModal
          now={now}
          standardMinutes={standardStartMinutes}
          onClose={() => setClockInConfirmOpen(false)}
          onConfirm={async (payload) => { await onClockIn(payload); setClockInConfirmOpen(false); }}
        />
      )}
      {clockOutConfirmOpen && (
        <ClockOutConfirmModal
          now={now}
          standardMinutes={standardEndMinutes}
          onClose={() => setClockOutConfirmOpen(false)}
          onConfirm={async (payload) => { await onClockOut(payload); setClockOutConfirmOpen(false); }}
        />
      )}
    </div>
  );
}

function SummaryTile({ label, value, icon }) {
  return <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-center gap-1.5 text-[10.5px] font-bold text-slate-400">{icon}{label}</div><div className="mt-2 font-mono text-[20px] font-bold tracking-tight text-slate-900">{value}</div></div>;
}

function DayMetricsCard({ record }) {
  const m = computeMetrics(record);
  if (!m) return null;
  return (
    <div className="rounded-[22px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-3 text-[12px] font-bold text-slate-500">本日の勤務結果</div>
      <div className="grid grid-cols-4 gap-2 text-center">
        <Metric label="実働" value={minutesToHHMM(m.workedMin)} />
        <Metric label="休憩" value={`${m.breakMin}分`} />
        <Metric label="残業" value={m.overtimeMin ? minutesToHHMM(m.overtimeMin) : 'なし'} warn={m.overtimeMin > 0} />
        <Metric label="遅刻/早退" value={m.lateMin + m.earlyLeaveMin ? `${m.lateMin + m.earlyLeaveMin}分` : 'なし'} danger={m.lateMin + m.earlyLeaveMin > 0} />
      </div>
      <div className="mt-4 rounded-xl bg-emerald-50 px-3 py-2.5 text-[11px] font-medium text-emerald-800">給与計算用の勤務時間も、実打刻を1分単位で集計します。</div>
    </div>
  );
}

function Metric({ label, value, warn = false, danger = false }) {
  return <div><div className="text-[9.5px] font-bold text-slate-400">{label}</div><div className={`mt-1 font-mono text-[13px] font-bold ${danger ? 'text-rose-600' : warn ? 'text-amber-600' : 'text-slate-800'}`}>{value}</div></div>;
}

function SchedulePatternCard({ now, patterns, activePatternNo, onSetActivePattern, onSavePatterns, locked }) {
  const [editing, setEditing] = useState(patterns.length === 0);
  const [form, setForm] = useState(() => {
    const base = [1, 2, 3].map((no) => {
      const existing = patterns.find((p) => p.patternNo === no);
      return existing ? { ...existing } : { patternNo: no, label: '', startTime: '', endTime: '' };
    });
    return base;
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm([1, 2, 3].map((no) => {
      const existing = patterns.find((p) => p.patternNo === no);
      return existing ? { ...existing } : { patternNo: no, label: '', startTime: '', endTime: '' };
    }));
  }, [patterns.length]);

  const setFormField = (no, field, value) => {
    setForm((prev) => prev.map((p) => (p.patternNo === no ? { ...p, [field]: value } : p)));
  };

  const save = async () => {
    setSaving(true);
    await onSavePatterns(form);
    setSaving(false);
    setEditing(false);
  };

  const monthLabel = `${now.getFullYear()}年${now.getMonth() + 1}月`;

  return (
    <div className="rounded-2xl bg-white border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-5 py-3 bg-slate-100 flex items-center justify-between">
        <span className="text-[12.5px] font-bold text-slate-500">今月（{monthLabel}）の規定勤怠時間</span>
        {!editing && (
          <button onClick={() => setEditing(true)} className="text-[11px] font-bold text-slate-500 border border-slate-200 rounded-md px-2 py-1 bg-white">編集</button>
        )}
      </div>

      {editing ? (
        <div className="px-5 py-4 space-y-3">
          <div className="text-[11px] text-slate-400">パターンは最大3つまで設定できます。1つだけ設定すれば、その時間が毎日自動で使われます。2つ以上ある場合は、下で毎日どのパターンかを選んでください。</div>
          {form.map((p) => (
            <div key={p.patternNo} className="grid grid-cols-[70px_1fr_auto_1fr] items-center gap-2">
              <div className="text-[11.5px] font-bold text-slate-500">パターン{p.patternNo}</div>
              <input
                value={p.label}
                onChange={(e) => setFormField(p.patternNo, 'label', e.target.value)}
                placeholder="呼び方（任意）"
                className="border border-slate-200 rounded-lg px-2 py-1.5 text-[12.5px]"
              />
              <input
                type="time"
                value={p.startTime}
                onChange={(e) => setFormField(p.patternNo, 'startTime', e.target.value)}
                className="border border-slate-200 rounded-lg px-2 py-1.5 font-mono text-[12.5px]"
              />
              <input
                type="time"
                value={p.endTime}
                onChange={(e) => setFormField(p.patternNo, 'endTime', e.target.value)}
                className="border border-slate-200 rounded-lg px-2 py-1.5 font-mono text-[12.5px]"
              />
            </div>
          ))}
          <button onClick={save} disabled={saving} className="w-full py-2.5 rounded-lg bg-slate-800 disabled:bg-slate-300 text-white text-[13px] font-bold">
            {saving ? '保存中…' : '保存する'}
          </button>
        </div>
      ) : (
        <div className="px-5 py-4 space-y-3">
          {patterns.length > 1 && (
            <div>
              <div className="text-[11px] text-slate-400 mb-1.5">{locked ? '本日のパターン（出勤打刻後は変更できません）' : '本日のパターンを選んでください'}</div>
              <div className="flex gap-2 flex-wrap">
                {patterns.map((p) => (
                  <button
                    key={p.patternNo}
                    onClick={() => !locked && onSetActivePattern(p.patternNo)}
                    disabled={locked}
                    className={`px-3 py-2 rounded-lg text-[12.5px] font-bold border-2 ${activePatternNo === p.patternNo ? 'border-amber-500 bg-amber-50 text-amber-700' : 'border-slate-200 text-slate-500'} ${locked ? 'opacity-70' : ''}`}
                  >
                    {p.label || `パターン${p.patternNo}`}（{p.startTime}〜{p.endTime}）
                  </button>
                ))}
              </div>
            </div>
          )}
          {patterns.length === 1 && (
            <div className="text-[12.5px] text-slate-600">
              規定時間：<b className="font-mono">{patterns[0].startTime}〜{patterns[0].endTime}</b>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ClockInConfirmModal({ now, standardMinutes, onClose, onConfirm }) {
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState('');
  const [lateChoice, setLateChoice] = useState(null); // 'forgot' | 'late' | 'event'
  const stdMinutes = standardMinutes != null ? standardMinutes : STANDARD_CLOCK_IN_HOUR * 60;
  const stdHour = Math.floor(stdMinutes / 60);
  const stdMin = stdMinutes % 60;
  const stdLabel = `${pad(stdHour)}:${pad(stdMin)}`;
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const isEarly = nowMinutes < stdMinutes;
  const nowLabel = `${pad(now.getHours())}:${pad(now.getMinutes())}`;

  const run = async (payload) => {
    setSaving(true);
    await onConfirm(payload);
    setSaving(false);
  };

  return createPortal(
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-40 p-0 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-sm max-h-[90vh] overflow-y-auto">
        <div className="px-5 pt-5 pb-3 border-b border-slate-100 flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-amber-50 flex items-center justify-center shrink-0">
            <Clock size={16} className="text-amber-600" />
          </div>
          <h3 className="font-bold text-[15px]">出勤時刻の確認</h3>
        </div>

        {isEarly ? (
          <div className="px-5 py-4 space-y-3">
            <div className="text-[12.5px] text-slate-600">
              現在の時刻は <b className="font-mono">{nowLabel}</b> です。出勤時刻を <b>{stdLabel}</b> として記録しますか？
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-[11px] text-amber-700">
              規定時間より早い出勤のため、記録後に管理者の承認が必要になります。
            </div>
            <button
              onClick={() => run({ clockInTime: todayAt(stdHour, stdMin, now), status: 'early_confirmed' })}
              disabled={saving}
              className="w-full py-2.5 rounded-lg bg-amber-600 disabled:bg-slate-200 text-white text-[13.5px] font-bold"
            >
              はい（{stdLabel}で記録する）
            </button>
            <button
              onClick={() => run({ clockInTime: now, status: 'early_manual' })}
              disabled={saving}
              className="w-full py-2.5 rounded-lg border border-slate-200 text-[13.5px] font-medium text-slate-600"
            >
              いいえ（実際の時刻 {nowLabel} で記録する）
            </button>
          </div>
        ) : (
          <div className="px-5 py-4 space-y-3">
            <div className="text-[12.5px] text-slate-600">
              現在の時刻は <b className="font-mono">{nowLabel}</b> です（{stdLabel}より後）。今回の出勤はどれに当てはまりますか？
            </div>
            <div className="space-y-2">
              <button
                onClick={() => setLateChoice('forgot')}
                className={`w-full py-2.5 rounded-lg border-2 text-[13px] font-bold text-left px-3.5 ${lateChoice === 'forgot' ? 'border-amber-500 bg-amber-50 text-amber-700' : 'border-slate-200 text-slate-600'}`}
              >
                打刻漏れ（本当は{stdLabel}に出勤していた）
              </button>
              <button
                onClick={() => setLateChoice('late')}
                className={`w-full py-2.5 rounded-lg border-2 text-[13px] font-bold text-left px-3.5 ${lateChoice === 'late' ? 'border-rose-500 bg-rose-50 text-rose-700' : 'border-slate-200 text-slate-600'}`}
              >
                遅刻
              </button>
              <button
                onClick={() => setLateChoice('event')}
                className={`w-full py-2.5 rounded-lg border-2 text-[13px] font-bold text-left px-3.5 ${lateChoice === 'event' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600'}`}
              >
                イベント（会議・研修など）
              </button>
            </div>
            {lateChoice === 'forgot' && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5 text-[11.5px] text-amber-700">
                出勤時刻は <b>{stdLabel}</b> に自動修正されます。実際に打刻した時刻（{nowLabel}）は記録として残ります。
              </div>
            )}
            {(lateChoice === 'late' || lateChoice === 'event') && (
              <Field label="メモ（任意）">
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={lateChoice === 'late' ? '理由があれば入力' : '会議名・研修名など'} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px]" />
              </Field>
            )}
            <button
              onClick={() => {
                if (lateChoice === 'forgot') run({ clockInTime: todayAt(stdHour, stdMin, now), status: 'forgot_corrected' });
                else if (lateChoice === 'late') run({ clockInTime: now, status: 'late', note });
                else if (lateChoice === 'event') run({ clockInTime: now, status: 'event', note });
              }}
              disabled={!lateChoice || saving}
              className="w-full py-2.5 rounded-lg bg-slate-800 disabled:bg-slate-200 text-white text-[13.5px] font-bold"
            >
              {saving ? '記録中…' : 'この内容で出勤を記録する'}
            </button>
          </div>
        )}

        <div className="px-5 pb-5 pt-1">
          <button onClick={onClose} className="w-full py-2.5 rounded-lg text-[12.5px] font-medium text-slate-400">キャンセル</button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function ClockOutConfirmModal({ now, standardMinutes, onClose, onConfirm }) {
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState('');
  const [choice, setChoice] = useState(null); // 'overtime' | 'forgot'
  const stdMinutes = standardMinutes != null ? standardMinutes : STANDARD_CLOCK_OUT_HOUR * 60;
  const stdHour = Math.floor(stdMinutes / 60);
  const stdMin = stdMinutes % 60;
  const stdLabel = `${pad(stdHour)}:${pad(stdMin)}`;
  const nowLabel = `${pad(now.getHours())}:${pad(now.getMinutes())}`;

  const run = async (payload) => {
    setSaving(true);
    await onConfirm(payload);
    setSaving(false);
  };

  return createPortal(
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-40 p-0 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-sm max-h-[90vh] overflow-y-auto">
        <div className="px-5 pt-5 pb-3 border-b border-slate-100 flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-amber-50 flex items-center justify-center shrink-0">
            <Clock size={16} className="text-amber-600" />
          </div>
          <h3 className="font-bold text-[15px]">退勤時刻の確認</h3>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div className="text-[12.5px] text-slate-600">
            現在の時刻は <b className="font-mono">{nowLabel}</b> です（{stdLabel}より後）。今回の退勤はどちらに当てはまりますか？
          </div>
          <div className="space-y-2">
            <button
              onClick={() => setChoice('overtime')}
              className={`w-full py-2.5 rounded-lg border-2 text-[13px] font-bold text-left px-3.5 ${choice === 'overtime' ? 'border-amber-500 bg-amber-50 text-amber-700' : 'border-slate-200 text-slate-600'}`}
            >
              残業（実際に{nowLabel}まで勤務していた）
            </button>
            <button
              onClick={() => setChoice('forgot')}
              className={`w-full py-2.5 rounded-lg border-2 text-[13px] font-bold text-left px-3.5 ${choice === 'forgot' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600'}`}
            >
              打刻漏れ（本当は{stdLabel}に退勤していた）
            </button>
          </div>
          {choice === 'forgot' && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2.5 text-[11.5px] text-blue-700">
              退勤時刻は <b>{stdLabel}</b> に自動修正されます。実際に打刻した時刻（{nowLabel}）は記録として残ります。
            </div>
          )}
          {choice === 'overtime' && (
            <Field label="メモ（任意）">
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="残業の理由があれば入力" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px]" />
            </Field>
          )}
          <button
            onClick={() => {
              if (choice === 'overtime') run({ clockOutTime: now, status: 'overtime', note });
              else if (choice === 'forgot') run({ clockOutTime: todayAt(stdHour, stdMin, now), status: 'forgot_corrected_out' });
            }}
            disabled={!choice || saving}
            className="w-full py-2.5 rounded-lg bg-slate-800 disabled:bg-slate-200 text-white text-[13.5px] font-bold"
          >
            {saving ? '記録中…' : 'この内容で退勤を記録する'}
          </button>
        </div>
        <div className="px-5 pb-5 pt-1">
          <button onClick={onClose} className="w-full py-2.5 rounded-lg text-[12.5px] font-medium text-slate-400">キャンセル</button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function CorrectionModal({ dateKey, record, onClose, onSubmit }) {
  const [clockIn, setClockIn] = useState(record?.clockIn ? hhmm(new Date(record.clockIn)) : '');
  const [clockOut, setClockOut] = useState(record?.clockOut ? hhmm(new Date(record.clockOut)) : '');
  const [breakMinutes, setBreakMinutes] = useState(record?.breakMinutes ?? BREAK_MINUTES_DEFAULT);
  const [reason, setReason] = useState('');
  const canSubmit = reason.trim().length > 0 && (clockIn || clockOut);

  return createPortal(
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-40 p-0 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-sm max-h-[90vh] overflow-y-auto">
        <div className="px-5 pt-5 pb-3 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white">
          <div>
            <div className="text-[11px] text-slate-400 font-medium">{dateLabel(dateKey)}</div>
            <h3 className="font-bold text-[15px]">勤怠修正申請</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 text-xl leading-none px-1">×</button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <Field label="出勤時刻">
            <input type="time" value={clockIn} onChange={(e) => setClockIn(e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 font-mono text-[14px]" />
          </Field>
          <Field label="退勤時刻">
            <input type="time" value={clockOut} onChange={(e) => setClockOut(e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 font-mono text-[14px]" />
          </Field>
          <Field label="休憩時間（分）">
            <input type="number" min="0" step="5" value={breakMinutes} onChange={(e) => setBreakMinutes(e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 font-mono text-[14px]" />
          </Field>
          <Field label="修正理由">
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="例）打刻を忘れたため" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13.5px] resize-none" />
          </Field>
          <div className="flex items-start gap-2 bg-slate-50 rounded-lg p-3 text-[11.5px] text-slate-500">
            <Mail size={13} className="mt-0.5 shrink-0" />
            <span>申請すると管理者にメール通知が送信されます（承認されるまで反映されません）</span>
          </div>
        </div>
        <div className="px-5 pb-5 pt-1 flex gap-2 sticky bottom-0 bg-white">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-lg border border-slate-200 text-[13.5px] font-medium text-slate-500">キャンセル</button>
          <button
            onClick={() => canSubmit && onSubmit({ date: dateKey, clockIn: clockIn || null, clockOut: clockOut || null, breakMinutes: Number(breakMinutes), reason })}
            disabled={!canSubmit}
            className="flex-1 py-2.5 rounded-lg bg-slate-800 disabled:bg-slate-200 text-white text-[13.5px] font-bold"
          >
            申請する
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-[11.5px] font-medium text-slate-500 mb-1">{label}</label>
      {children}
    </div>
  );
}

function LeaveView({ leaveRequests, leaveTotal, leaveUsed, hireDate, onOpenLeaveModal, isDesktop }) {
  const remaining = leaveTotal - leaveUsed;
  const pct = leaveTotal > 0 ? Math.min(100, Math.round((leaveUsed / leaveTotal) * 100)) : 0;

  const balanceCard = (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
      <div className="px-5 py-4 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center shrink-0">
          <Palmtree size={18} className="text-amber-600" />
        </div>
        <div className="flex-1">
          <div className="text-[11px] text-slate-400 font-medium">有休残日数</div>
          <div className="flex items-baseline gap-1">
            <span className="font-mono text-[22px] font-bold text-slate-800">{remaining}</span>
            <span className="text-[12px] text-slate-400">/ {leaveTotal}日</span>
          </div>
        </div>
        <button
          onClick={onOpenLeaveModal}
          className="flex items-center gap-1.5 bg-amber-600 text-white text-[13px] font-bold px-4 py-2.5 rounded-xl shadow-md shadow-amber-200 active:brightness-95"
        >
          <Plus size={15} strokeWidth={2.5} /> 休暇を申請
        </button>
      </div>
      <div className="px-5 pb-4">
        <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
          <div className="h-full bg-amber-600 rounded-full" style={{ width: `${pct}%` }} />
        </div>
        <div className="text-[10.5px] text-slate-400 mt-1.5">これまでの有休消化：{leaveUsed}日　／　{tenureLabel(hireDate)}（法定基準で自動計算）</div>
      </div>
    </div>
  );

  const listCard = (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
      <div className="px-5 py-3.5 border-b border-slate-100 flex items-center gap-2">
        <Calendar size={15} className="text-slate-400" />
        <h2 className="font-bold text-[13.5px]">申請履歴</h2>
      </div>
      {leaveRequests.length === 0 ? (
        <div className="px-5 py-10 text-center text-[12.5px] text-slate-300">休暇申請はまだありません</div>
      ) : (
        <div className="divide-y divide-slate-100">
          {leaveRequests.map((l) => (
            <div key={l.id} className="px-5 py-3.5">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span className="text-[12.5px] font-bold text-slate-800 bg-slate-50 px-2 py-0.5 rounded-md">{l.type}{l.halfDay ? '（半休）' : ''}</span>
                  <span className="text-[13px] font-semibold text-slate-800">
                    {l.startDate === l.endDate ? dateLabel(l.startDate) : `${dateLabel(l.startDate)} 〜 ${dateLabel(l.endDate)}`}
                  </span>
                </div>
                <LeaveStatusBadge status={l.status} />
              </div>
              <div className="text-[11.5px] text-slate-400">{l.days}日間・理由：{l.reason}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  if (isDesktop) {
    return (
      <div className="grid grid-cols-[340px_1fr] gap-6 items-start">
        {balanceCard}
        {listCard}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {balanceCard}
      {listCard}
    </div>
  );
}

function LeaveStatusBadge({ status }) {
  const map = {
    pending: { label: '承認待ち', cls: 'bg-amber-50 text-amber-600' },
    approved: { label: '承認済み', cls: 'bg-emerald-50 text-emerald-600' },
    rejected: { label: '却下', cls: 'bg-slate-100 text-slate-400' },
  };
  const s = map[status] || map.pending;
  return <span className={`text-[10.5px] font-bold px-2 py-1 rounded-full shrink-0 ${s.cls}`}>{s.label}</span>;
}

function LeaveRequestModal({ leaveRemaining, onClose, onSubmit }) {
  const [type, setType] = useState('有休');
  const [startDate, setStartDate] = useState(todayKey());
  const [endDate, setEndDate] = useState(todayKey());
  const [halfDay, setHalfDay] = useState(false);
  const [reason, setReason] = useState('');
  const isSingleDay = startDate === endDate;
  const days = halfDay && isSingleDay ? 0.5 : daysBetweenInclusive(startDate, endDate);
  const exceedsBalance = type === '有休' && days > leaveRemaining;
  const canSubmit = reason.trim().length > 0 && startDate && endDate && new Date(endDate) >= new Date(startDate) && !exceedsBalance;

  const handleTypeChange = (t) => {
    setType(t);
    if (t !== '有休') setHalfDay(false);
  };

  const handleStartChange = (v) => {
    setStartDate(v);
    if (v > endDate) setEndDate(v);
    if (v !== endDate) setHalfDay(false);
  };

  const handleEndChange = (v) => {
    setEndDate(v);
    if (v !== startDate) setHalfDay(false);
  };

  return createPortal(
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-40 p-0 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-sm max-h-[90vh] overflow-y-auto">
        <div className="px-5 pt-5 pb-3 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white">
          <h3 className="font-bold text-[15px]">休暇申請</h3>
          <button onClick={onClose} className="text-slate-400 text-xl leading-none px-1">×</button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <Field label="休暇の種類">
            <div className="grid grid-cols-2 gap-2">
              {LEAVE_TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => handleTypeChange(t)}
                  className={`py-2 rounded-lg text-[13px] font-semibold border-2 transition-colors ${type === t ? 'border-amber-600 bg-amber-50 text-amber-600' : 'border-slate-200 text-slate-500'}`}
                >
                  {t}
                </button>
              ))}
            </div>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="開始日">
              <input type="date" value={startDate} onChange={(e) => handleStartChange(e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 font-mono text-[13.5px]" />
            </Field>
            <Field label="終了日">
              <input type="date" value={endDate} min={startDate} onChange={(e) => handleEndChange(e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 font-mono text-[13.5px]" />
            </Field>
          </div>
          {type === '有休' && isSingleDay && (
            <Field label="取得単位">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setHalfDay(false)}
                  className={`py-2 rounded-lg text-[13px] font-semibold border-2 transition-colors ${!halfDay ? 'border-amber-600 bg-amber-50 text-amber-600' : 'border-slate-200 text-slate-500'}`}
                >
                  全休
                </button>
                <button
                  type="button"
                  onClick={() => setHalfDay(true)}
                  className={`py-2 rounded-lg text-[13px] font-semibold border-2 transition-colors ${halfDay ? 'border-amber-600 bg-amber-50 text-amber-600' : 'border-slate-200 text-slate-500'}`}
                >
                  半休
                </button>
              </div>
            </Field>
          )}
          <div className="flex items-center justify-between bg-slate-50 rounded-lg px-3 py-2 text-[12.5px]">
            <span className="text-slate-500">申請日数</span>
            <span className="font-mono font-bold text-slate-800">{days}日間</span>
          </div>
          {exceedsBalance && (
            <div className="text-[11.5px] text-rose-600 font-medium">有休残日数（{leaveRemaining}日）を超えています</div>
          )}
          <Field label="申請理由">
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="例）私用のため" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13.5px] resize-none" />
          </Field>
          <div className="flex items-start gap-2 bg-slate-50 rounded-lg p-3 text-[11.5px] text-slate-500">
            <Mail size={13} className="mt-0.5 shrink-0" />
            <span>申請すると管理者にメール通知が送信されます（承認されるまで反映されません）</span>
          </div>
        </div>
        <div className="px-5 pb-5 pt-1 flex gap-2 sticky bottom-0 bg-white">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-lg border border-slate-200 text-[13.5px] font-medium text-slate-500">キャンセル</button>
          <button
            onClick={() => canSubmit && onSubmit({ type, startDate, endDate, halfDay: halfDay && isSingleDay, reason })}
            disabled={!canSubmit}
            className="flex-1 py-2.5 rounded-lg bg-amber-600 disabled:bg-slate-200 text-white text-[13.5px] font-bold"
          >
            申請する
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function PerformanceModal({ type, onClose, onSubmit }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [half, setHalf] = useState(defaultHalfForToday());
  const [summary, setSummary] = useState('');
  const [numericLabel, setNumericLabel] = useState('');
  const [numericValue, setNumericValue] = useState('');
  const [notes, setNotes] = useState('');
  const canSubmit = summary.trim().length > 0;
  const periodLabel = type === 'half' ? halfPeriodLabel(year, month, half) : monthPeriodLabel(year, month);

  const years = [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1];
  const months = Array.from({ length: 12 }, (_, i) => i + 1);

  return createPortal(
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-40 p-0 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-sm max-h-[90vh] overflow-y-auto">
        <div className="px-5 pt-5 pb-3 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white">
          <h3 className="font-bold text-[15px]">{type === 'half' ? '半月実績の提出' : '月末まとめの提出'}</h3>
          <button onClick={onClose} className="text-slate-400 text-xl leading-none px-1">×</button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <div className={`grid gap-3 ${type === 'half' ? 'grid-cols-3' : 'grid-cols-2'}`}>
            <Field label="年">
              <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="w-full border border-slate-200 rounded-lg px-2 py-2 text-[13px] bg-white">
                {years.map((y) => <option key={y} value={y}>{y}年</option>)}
              </select>
            </Field>
            <Field label="月">
              <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className="w-full border border-slate-200 rounded-lg px-2 py-2 text-[13px] bg-white">
                {months.map((m) => <option key={m} value={m}>{m}月</option>)}
              </select>
            </Field>
            {type === 'half' && (
              <Field label="期間">
                <select value={half} onChange={(e) => setHalf(Number(e.target.value))} className="w-full border border-slate-200 rounded-lg px-2 py-2 text-[13px] bg-white">
                  <option value={1}>前半</option>
                  <option value={2}>後半</option>
                </select>
              </Field>
            )}
          </div>
          <div className="bg-slate-50 rounded-lg px-3 py-2 text-[12px] text-slate-500">{periodLabel}</div>
          <Field label={type === 'half' ? '実績内容' : '月次まとめ'}>
            <textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={4} placeholder="対応した業務・成果などを記入してください" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13.5px] resize-none" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="数値項目名（任意）">
              <input value={numericLabel} onChange={(e) => setNumericLabel(e.target.value)} placeholder="例）受注件数" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px]" />
            </Field>
            <Field label="数値（任意）">
              <input type="number" value={numericValue} onChange={(e) => setNumericValue(e.target.value)} placeholder="例）12" className="w-full border border-slate-200 rounded-lg px-3 py-2 font-mono text-[13px]" />
            </Field>
          </div>
          <Field label="所感・備考（任意）">
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="課題や来期に向けてなど" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13.5px] resize-none" />
          </Field>
          <div className="flex items-start gap-2 bg-slate-50 rounded-lg p-3 text-[11.5px] text-slate-500">
            <Mail size={13} className="mt-0.5 shrink-0" />
            <span>提出すると管理者にメール通知が送信されます。承認・却下の結果とコメントはこの画面に表示されます</span>
          </div>
        </div>
        <div className="px-5 pb-5 pt-1 flex gap-2 sticky bottom-0 bg-white">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-lg border border-slate-200 text-[13.5px] font-medium text-slate-500">キャンセル</button>
          <button
            onClick={() => canSubmit && onSubmit({ type, year, month, half: type === 'half' ? half : null, summary, numericLabel, numericValue, notes })}
            disabled={!canSubmit}
            className="flex-1 py-2.5 rounded-lg bg-amber-600 disabled:bg-slate-200 text-white text-[13.5px] font-bold"
          >
            提出する
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ==== eo業務 実績管理（新規実績・既存実績・インセンティブ） ====

const NEW_PERF_BASIC_FIELDS = [
  { key: 'store', label: '入店店舗', type: 'text' },
  { key: 'targets', label: '対象者数' },
  { key: 'approaches', label: 'アプローチ数' },
  { key: 'negotiations', label: '商談数' },
];
const NEW_PERF_LATER_META_FIELDS = [
  { key: 'laterOwnDate', label: '自身商談日', type: 'date' },
  { key: 'laterReceiver', label: '受付担当者', type: 'text' },
];

const NEW_PERF_COLUMN_GROUPS = [
  { label: '基本', fields: NEW_PERF_BASIC_FIELDS, path: null },
  { label: '新規ご成約内訳', fields: NEW_PERF_CONTRACT_FIELDS, path: 'contract' },
  { label: 'エンパケ', fields: [{ key: 'empakeCount', label: '配布枚数' }], path: null },
  { label: 'エンパケご成約内訳', fields: NEW_PERF_CONTRACT_FIELDS, path: 'empake' },
  { label: '後日成約', fields: NEW_PERF_LATER_META_FIELDS, path: null },
  { label: '後日成約内訳', fields: NEW_PERF_CONTRACT_FIELDS, path: 'later' },
  { label: 'サービス追加', fields: NEW_PERF_ADD_FIELDS, path: 'add' },
];

function EoNewPerfCell({ value, onChange, type = 'number' }) {
  if (type === 'text') {
    return <input value={value} onChange={(e) => onChange(e.target.value)} className="w-16 border border-slate-200 rounded px-1 py-1 text-[11px]" />;
  }
  if (type === 'date') {
    return <input type="date" value={value} onChange={(e) => onChange(e.target.value)} className="w-28 border border-slate-200 rounded px-1 py-1 font-mono text-[10.5px]" />;
  }
  return <input type="number" value={value} onChange={(e) => onChange(e.target.value)} className="w-12 border border-slate-200 rounded px-1 py-1 font-mono text-[11px] text-right" />;
}

function EoNewPerfTable({ year, month, daily, onUpdateDay }) {
  const days = Array.from({ length: lastDayOfMonth(year, month) }, (_, i) => i + 1);
  return (
    <div className="overflow-x-auto border border-slate-200 rounded-xl">
      <table className="text-[11px] border-collapse">
        <thead>
          <tr className="bg-slate-50">
            <th rowSpan={2} className="sticky left-0 bg-slate-50 border-b border-r border-slate-200 px-2 py-1 z-10">日</th>
            {NEW_PERF_COLUMN_GROUPS.map((g) => (
              <th key={g.label} colSpan={g.fields.length} className="border-b border-r border-slate-200 px-2 py-1 text-slate-500 font-bold whitespace-nowrap">{g.label}</th>
            ))}
            <th rowSpan={2} className="border-b border-slate-200 px-2 py-1 whitespace-nowrap">Pt</th>
          </tr>
          <tr className="bg-slate-50">
            {NEW_PERF_COLUMN_GROUPS.flatMap((g) => g.fields.map((f) => (
              <th key={g.label + f.key} className="border-b border-r border-slate-200 px-1 py-1 font-normal text-slate-400 whitespace-nowrap">{f.label}</th>
            )))}
          </tr>
        </thead>
        <tbody>
          {days.map((d) => {
            const day = daily[d] || emptyNewPerfDay();
            const pt = computeNewPerfDayPoints(day);
            return (
              <tr key={d} className="border-b border-slate-100 last:border-0">
                <td className="sticky left-0 bg-white border-r border-slate-200 px-2 py-1 font-bold text-slate-500 whitespace-nowrap">{d}日</td>
                {NEW_PERF_COLUMN_GROUPS.flatMap((g) => g.fields.map((f) => {
                  const value = g.path ? (day[g.path]?.[f.key] ?? '') : (day[f.key] ?? '');
                  const onChange = (v) => onUpdateDay(d, (cur) => {
                    if (g.path) return { ...cur, [g.path]: { ...cur[g.path], [f.key]: v } };
                    return { ...cur, [f.key]: v };
                  });
                  return (
                    <td key={g.label + f.key} className="border-r border-slate-100 px-1 py-1">
                      <EoNewPerfCell value={value} onChange={onChange} type={f.type} />
                    </td>
                  );
                }))}
                <td className="px-2 py-1 font-mono font-bold text-slate-700 text-right whitespace-nowrap">{pt}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function EoExistingPerfTable({ year, month, daily, onUpdateDay }) {
  const days = Array.from({ length: lastDayOfMonth(year, month) }, (_, i) => i + 1);
  return (
    <div className="overflow-x-auto border border-slate-200 rounded-xl">
      <table className="text-[11px] border-collapse">
        <thead>
          <tr className="bg-slate-50">
            <th className="sticky left-0 bg-slate-50 border-b border-r border-slate-200 px-2 py-1 z-10">日</th>
            {EXISTING_PERF_FIELDS.map((f) => (
              <th key={f.key} className="border-b border-r border-slate-200 px-1.5 py-1 font-normal text-slate-500 whitespace-nowrap">{f.label}<div className="text-[9.5px] text-slate-300">{f.points}P</div></th>
            ))}
            <th className="border-b border-slate-200 px-2 py-1 whitespace-nowrap">Pt</th>
          </tr>
        </thead>
        <tbody>
          {days.map((d) => {
            const day = daily[d] || emptyExistingPerfDay();
            const pt = computeExistingPerfDayPoints(day);
            return (
              <tr key={d} className="border-b border-slate-100 last:border-0">
                <td className="sticky left-0 bg-white border-r border-slate-200 px-2 py-1 font-bold text-slate-500 whitespace-nowrap">{d}日</td>
                {EXISTING_PERF_FIELDS.map((f) => (
                  <td key={f.key} className="border-r border-slate-100 px-1 py-1">
                    <input
                      type="number"
                      value={day[f.key] ?? ''}
                      onChange={(e) => onUpdateDay(d, f.key, e.target.value)}
                      className="w-11 border border-slate-200 rounded px-1 py-1 font-mono text-[11px] text-right"
                    />
                  </td>
                ))}
                <td className="px-2 py-1 font-mono font-bold text-slate-700 text-right whitespace-nowrap">{pt}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function EoPerformanceSection({ employeeId, isDesktop }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [sheet, setSheet] = useState('new');
  const [loading, setLoading] = useState(true);
  const [newDaily, setNewDaily] = useState({});
  const [tabletIssues, setTabletIssues] = useState('0');
  const [cancellations, setCancellations] = useState('0');
  const [existingDaily, setExistingDaily] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([fetchNewPerf(employeeId, year, month), fetchExistingPerf(employeeId, year, month)]).then(([np, ep]) => {
      if (cancelled) return;
      setNewDaily(np?.daily || {});
      setTabletIssues(String(np?.tablet_issues ?? 0));
      setCancellations(String(np?.cancellations ?? 0));
      setExistingDaily(ep?.daily || {});
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [employeeId, year, month]);

  const updateNewDay = (d, updater) => {
    setNewDaily((prev) => ({ ...prev, [d]: updater(prev[d] || emptyNewPerfDay()) }));
  };
  const updateExistingDay = (d, key, value) => {
    setExistingDaily((prev) => ({ ...prev, [d]: { ...(prev[d] || emptyExistingPerfDay()), [key]: value } }));
  };

  const monthNewPoints = computeNewPerfMonthPoints(newDaily);
  const monthExistingPoints = computeExistingPerfMonthPoints(existingDaily);
  const empakeTotal = computeMonthEmpakeCount(newDaily);
  const approxG10Rate = computeApproxG10Rate(newDaily);
  const adjustedNewPoints = monthNewPoints - (Number(tabletIssues) || 0) * 2 - (Number(cancellations) || 0) * 3;

  const save = async () => {
    setSaving(true);
    if (sheet === 'new') {
      await saveNewPerf(employeeId, year, month, { daily: newDaily, tablet_issues: Number(tabletIssues) || 0, cancellations: Number(cancellations) || 0 });
    } else {
      await saveExistingPerf(employeeId, year, month, existingDaily);
    }
    setSaving(false);
  };

  const years = [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1];
  const months = Array.from({ length: 12 }, (_, i) => i + 1);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-5 py-3.5 border-b border-slate-100 flex items-center gap-2 flex-wrap">
        <BarChart3 size={15} className="text-slate-400" />
        <h2 className="font-bold text-[13.5px]">eo業務 実績入力</h2>
        <div className="ml-auto flex items-center gap-2">
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="border border-slate-200 rounded-lg px-2 py-1.5 text-[12.5px] bg-white">
            {years.map((y) => <option key={y} value={y}>{y}年</option>)}
          </select>
          <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className="border border-slate-200 rounded-lg px-2 py-1.5 text-[12.5px] bg-white">
            {months.map((m) => <option key={m} value={m}>{m}月</option>)}
          </select>
        </div>
      </div>

      <div className="px-5 pt-3 flex gap-2">
        <button onClick={() => setSheet('new')} className={`px-3 py-1.5 rounded-lg text-[12.5px] font-bold ${sheet === 'new' ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-500'}`}>新規実績</button>
        <button onClick={() => setSheet('existing')} className={`px-3 py-1.5 rounded-lg text-[12.5px] font-bold ${sheet === 'existing' ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-500'}`}>既存実績（アップセルLTV）</button>
      </div>

      <div className="p-5 grid grid-cols-2 sm:grid-cols-4 gap-3">
        <PayrollMetric label="新規獲得Pt(月合計)" value={`${monthNewPoints}P`} />
        <PayrollMetric label="調整後Pt" value={`${adjustedNewPoints}P`} />
        <PayrollMetric label="既存(アップセルLTV)Pt" value={`${monthExistingPoints}P`} />
        <PayrollMetric label="エンパケ配布(月合計)" value={`${empakeTotal}枚`} />
      </div>

      {sheet === 'new' && (
        <div className="px-5 pb-3 grid grid-cols-2 gap-3">
          <Field label="タブレット不備件数（-2P/件）">
            <input type="number" value={tabletIssues} onChange={(e) => setTabletIssues(e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 font-mono text-[13px]" />
          </Field>
          <Field label="キャンセル件数（-3P/件）">
            <input type="number" value={cancellations} onChange={(e) => setCancellations(e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 font-mono text-[13px]" />
          </Field>
        </div>
      )}
      {sheet === 'new' && approxG10Rate != null && (
        <div className="px-5 pb-3 text-[11px] text-slate-400">10G付帯率（参考値・ネット成約数に対する10G成約数の割合）：{Math.round(approxG10Rate * 1000) / 10}%</div>
      )}

      {loading ? (
        <div className="px-5 pb-6 text-center text-[12.5px] text-slate-300 py-10">読み込み中…</div>
      ) : (
        <div className="px-5 pb-5">
          {sheet === 'new' ? (
            <EoNewPerfTable year={year} month={month} daily={newDaily} onUpdateDay={updateNewDay} />
          ) : (
            <EoExistingPerfTable year={year} month={month} daily={existingDaily} onUpdateDay={updateExistingDay} />
          )}
          <button onClick={save} disabled={saving} className="mt-4 w-full py-2.5 rounded-lg bg-slate-800 disabled:bg-slate-300 text-white text-[13px] font-bold">
            {saving ? '保存中…' : 'この内容で保存する'}
          </button>
        </div>
      )}
    </div>
  );
}

// 管理者用：eo業務グループのインセンティブ集計
function EoAdminIncentiveTab({ employeeAccounts, isDesktop }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [loading, setLoading] = useState(true);
  const [newRows, setNewRows] = useState([]);
  const [existingRows, setExistingRows] = useState([]);
  const [flags, setFlags] = useState({ cancel_target_met: false, empake_target_met: false, upsell_target_met: false });
  const [savingFlags, setSavingFlags] = useState(false);

  const eoStaff = employeeAccounts.filter((a) => a.mainGroup === EO_GROUP_NAME);
  const eoIds = eoStaff.map((a) => a.id);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([fetchGroupPerfAll(eoIds, year, month), fetchGroupIncentiveFlags(EO_GROUP_NAME, year, month)]).then(([perf, flagRow]) => {
      if (cancelled) return;
      setNewRows(perf.newRows);
      setExistingRows(perf.existingRows);
      setFlags({
        cancel_target_met: !!flagRow?.cancel_target_met,
        empake_target_met: !!flagRow?.empake_target_met,
        upsell_target_met: !!flagRow?.upsell_target_met,
      });
      setLoading(false);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month, eoIds.join(',')]);

  const saveFlags = async () => {
    setSavingFlags(true);
    await saveGroupIncentiveFlags(EO_GROUP_NAME, year, month, flags);
    setSavingFlags(false);
  };

  // 個人別アップセルLTV順位を算出
  const existingTotals = eoStaff.map((a) => {
    const row = existingRows.find((r) => r.employee_id === a.id);
    return { id: a.id, points: computeExistingPerfMonthPoints(row?.daily || {}) };
  }).sort((a, b) => b.points - a.points);
  const rankOf = (id) => {
    const idx = existingTotals.findIndex((x) => x.id === id);
    if (idx < 0 || existingTotals[idx].points <= 0) return null;
    return idx + 1;
  };

  const rows = eoStaff.map((a) => {
    const newRow = newRows.find((r) => r.employee_id === a.id);
    const existingRow = existingRows.find((r) => r.employee_id === a.id);
    const daily = newRow?.daily || {};
    const existingDaily = existingRow?.daily || {};
    const newPoints = computeNewPerfMonthPoints(daily);
    const existingPoints = computeExistingPerfMonthPoints(existingDaily);
    const empakeCount = computeMonthEmpakeCount(daily);
    const approxG10Rate = computeApproxG10Rate(daily);
    const incentive = computeEoIncentive(
      {
        newPoints,
        empakeCount,
        tabletIssues: newRow?.tablet_issues || 0,
        cancellations: newRow?.cancellations || 0,
        existingPoints,
        g10HalfOverride: newRow?.g10_half_override,
        approxG10Rate,
      },
      { cancelTargetMet: flags.cancel_target_met, empakeTargetMet: flags.empake_target_met, upsellTargetMet: flags.upsell_target_met },
      rankOf(a.id)
    );
    return { account: a, newPoints, existingPoints, empakeCount, rank: rankOf(a.id), incentive };
  });

  const years = [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1];
  const months = Array.from({ length: 12 }, (_, i) => i + 1);

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="font-bold text-[14px] text-slate-800 flex items-center gap-2"><Wallet size={16} className="text-slate-400" />eo業務 インセンティブ集計</h2>
          <div className="ml-auto flex items-center gap-2">
            <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="border border-slate-200 rounded-lg px-2 py-1.5 text-[12.5px] bg-white">
              {years.map((y) => <option key={y} value={y}>{y}年</option>)}
            </select>
            <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className="border border-slate-200 rounded-lg px-2 py-1.5 text-[12.5px] bg-white">
              {months.map((m) => <option key={m} value={m}>{m}月</option>)}
            </select>
          </div>
        </div>

        <div className="bg-slate-50 rounded-xl p-4 space-y-2">
          <div className="text-[12px] font-bold text-slate-600">グループ全体の目標達成フラグ（この月・全員に一律で適用）</div>
          <label className="flex items-center gap-2 text-[12.5px] text-slate-600">
            <input type="checkbox" checked={flags.cancel_target_met} onChange={(e) => setFlags((f) => ({ ...f, cancel_target_met: e.target.checked }))} />
            全体キャンセル率目標（10.1%未満）達成 → 新規獲得ポイントに+6P
          </label>
          <label className="flex items-center gap-2 text-[12.5px] text-slate-600">
            <input type="checkbox" checked={flags.empake_target_met} onChange={(e) => setFlags((f) => ({ ...f, empake_target_met: e.target.checked }))} />
            全体エンパケ配布目標（90枚）達成 → 4枚以上配布のスタッフに+5P
          </label>
          <label className="flex items-center gap-2 text-[12.5px] text-slate-600">
            <input type="checkbox" checked={flags.upsell_target_met} onChange={(e) => setFlags((f) => ({ ...f, upsell_target_met: e.target.checked }))} />
            アップセル全体LTV目標達成 → LTV140P以上のスタッフにアップセルインセンティブを支給
          </label>
          <button onClick={saveFlags} disabled={savingFlags} className="text-[11.5px] font-bold text-amber-600">
            {savingFlags ? '保存中…' : 'フラグを保存する'}
          </button>
        </div>

        <div className="text-[11px] text-slate-400 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
          10G付帯率（40%未満で半額）は自動では正確に判定できないため、参考値をもとに社員側の画面で表示のみ行っています。個別に上書きが必要な場合は開発者にご相談ください。
        </div>
      </div>

      {loading ? (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm px-6 py-14 text-center text-[12.5px] text-slate-300">読み込み中…</div>
      ) : rows.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm px-6 py-14 text-center text-[12.5px] text-slate-300">eo業務グループの社員が登録されていません</div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-left text-[11px] text-slate-400 border-b border-slate-100">
                  <th className="px-4 py-2 font-medium">氏名</th>
                  <th className="px-4 py-2 font-medium">新規Pt(調整後)</th>
                  <th className="px-4 py-2 font-medium">既存(LTV)Pt</th>
                  <th className="px-4 py-2 font-medium">エンパケ</th>
                  <th className="px-4 py-2 font-medium">順位</th>
                  <th className="px-4 py-2 font-medium">新規獲得</th>
                  <th className="px-4 py-2 font-medium">アップセル</th>
                  <th className="px-4 py-2 font-medium">合計</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.account.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-2.5 font-semibold text-slate-800">{r.account.name}</td>
                    <td className="px-4 py-2.5 font-mono">{r.incentive.newPointsForJudge}P</td>
                    <td className="px-4 py-2.5 font-mono">{r.existingPoints}P</td>
                    <td className="px-4 py-2.5 font-mono">{r.empakeCount}枚</td>
                    <td className="px-4 py-2.5 font-mono">{r.rank ? `${r.rank}位` : '-'}</td>
                    <td className="px-4 py-2.5 font-mono">{formatYen(r.incentive.newAcquisitionAmount)}</td>
                    <td className="px-4 py-2.5 font-mono">{formatYen(r.incentive.upsellAmount)}</td>
                    <td className="px-4 py-2.5 font-mono font-bold text-slate-800">{formatYen(r.incentive.totalAmount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function AdminDashboardTab({ missingCount, correctionCount, leaveCount, performanceCount, gpsAlertCount, contractAlertCount, clockInApprovalCount = 0, employeeCount, onNavigate, isDesktop }) {
  const alertRows = [
    { label: '打刻漏れ・打刻間違い', count: missingCount, tab: 'requests', icon: <AlertTriangle size={14} /> },
    { label: '位置情報が5回以上連続で未記録', count: gpsAlertCount, tab: 'attendance', icon: <MapPin size={14} /> },
    { label: '契約更新が必要な社員がいます', count: contractAlertCount, tab: 'accounts', icon: <FileText size={14} /> },
  ];
  const unapprovedRows = [
    { label: '未承認の勤怠修正申請', count: correctionCount, tab: 'requests', icon: <FileEdit size={14} /> },
    { label: '未承認の休暇申請', count: leaveCount, tab: 'leave', icon: <Palmtree size={14} /> },
    { label: '未承認の実績報告', count: performanceCount, tab: 'performance', icon: <ClipboardList size={14} /> },
    { label: '遅刻・早出などの出勤承認', count: clockInApprovalCount, tab: 'attendance', icon: <Clock size={14} /> },
  ];
  const quickLinks = [
    { label: '勤怠一覧', tab: 'attendance', icon: <Clock size={17} /> },
    { label: '社員管理', tab: 'accounts', icon: <Users size={17} /> },
    { label: '休暇申請', tab: 'leave', icon: <Palmtree size={17} /> },
  ];

  const Row = ({ row }) => (
    <button
      onClick={() => onNavigate(row.tab)}
      className="w-full flex items-center justify-between px-4 py-3 border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors text-left"
    >
      <span className="flex items-center gap-2 text-[13px] text-slate-700">
        <span className="text-slate-400">{row.icon}</span>
        {row.label}
      </span>
      <span className="flex items-center gap-1.5">
        <span className={`text-[13px] font-bold ${row.count > 0 ? 'text-rose-600' : 'text-slate-300'}`}>{row.count}件</span>
        <ChevronRight size={14} className="text-slate-300" />
      </span>
    </button>
  );

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-100 flex items-center gap-2">
          <LayoutGrid size={15} className="text-slate-400" />
          <h2 className="font-bold text-[13.5px]">機能リンク</h2>
        </div>
        <div className={`p-4 grid gap-3 ${isDesktop ? 'grid-cols-4' : 'grid-cols-2'}`}>
          {quickLinks.map((q) => (
            <button
              key={q.tab}
              onClick={() => onNavigate(q.tab)}
              className="flex flex-col items-center gap-2 rounded-xl border border-slate-200 py-4 text-slate-700 hover:border-slate-800 hover:bg-slate-50 transition-colors"
            >
              {q.icon}
              <span className="text-[12px] font-bold">{q.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className={isDesktop ? 'grid grid-cols-2 gap-5 items-start' : 'space-y-5'}>
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-100 flex items-center gap-2">
            <AlertTriangle size={15} className="text-slate-400" />
            <h2 className="font-bold text-[13.5px]">アラート一覧</h2>
          </div>
          <div>
            {alertRows.map((row) => <Row key={row.label} row={row} />)}
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-100 flex items-center gap-2">
            <ListChecks size={15} className="text-slate-400" />
            <h2 className="font-bold text-[13.5px]">未承認一覧</h2>
          </div>
          <div>
            {unapprovedRows.map((row) => <Row key={row.label} row={row} />)}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden px-5 py-4 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">
          <Users size={18} className="text-slate-500" />
        </div>
        <div>
          <div className="text-[11px] text-slate-400">在籍社員数</div>
          <div className="font-mono text-[18px] font-bold text-slate-800">{employeeCount}名</div>
        </div>
      </div>
    </div>
  );
}

// ---- 給与計算 ----
const MONTHLY_STANDARD_HOURS = 160; // 月給制の残業単価を出すための簡易換算（週40h×概ね4週）
const OVERTIME_MULTIPLIER = 1.25;

function computePayrollPreview({ wageType, hourlyWage, monthlySalary, workedMinutes, overtimeMinutes, commuteAllowance = 0, attendanceDays = null, actualDays = 0 }) {
  const regularMinutes = Math.max(0, workedMinutes - overtimeMinutes);
  let baseAmount = 0;
  let overtimeAmount = 0;
  let wageRate = 0;
  let prorated = false;
  if (wageType === 'hourly') {
    wageRate = Number(hourlyWage) || 0;
    baseAmount = Math.round((regularMinutes / 60) * wageRate);
    overtimeAmount = Math.round((overtimeMinutes / 60) * wageRate * OVERTIME_MULTIPLIER);
  } else {
    wageRate = Number(monthlySalary) || 0;
    if (attendanceDays && attendanceDays > 0) {
      // 出勤規定日数に対する実出勤日数の割合で月給を日割り計算（規定日数を超えて働いた分は満額まで）
      const dailyWage = wageRate / attendanceDays;
      baseAmount = Math.round(dailyWage * Math.min(Number(actualDays) || 0, attendanceDays));
      prorated = true;
    } else {
      baseAmount = Math.round(wageRate);
    }
    const hourlyEquivalent = wageRate / MONTHLY_STANDARD_HOURS;
    overtimeAmount = Math.round((overtimeMinutes / 60) * hourlyEquivalent * OVERTIME_MULTIPLIER);
  }
  const allowanceAmount = Math.round(Number(commuteAllowance) || 0);
  return { wageRate, regularMinutes, baseAmount, overtimeAmount, allowanceAmount, totalAmount: baseAmount + overtimeAmount + allowanceAmount, prorated };
}

const formatYen = (n) => `¥${Math.round(n || 0).toLocaleString('ja-JP')}`;

function printPayslip(p, employeeName) {
  const win = window.open('', '_blank', 'width=480,height=700');
  if (!win) return;
  const html = `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><title>給与明細 ${p.year}年${p.month}月分</title>
<style>
  body { font-family: -apple-system, "Hiragino Sans", sans-serif; padding: 32px; color: #1e293b; }
  h1 { font-size: 18px; margin-bottom: 4px; }
  .sub { color: #64748b; font-size: 12px; margin-bottom: 20px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  td { padding: 8px 0; border-bottom: 1px solid #e2e8f0; }
  td.label { color: #64748b; }
  td.value { text-align: right; font-family: monospace; }
  .total td { font-weight: bold; font-size: 16px; border-top: 2px solid #1e293b; border-bottom: none; padding-top: 12px; }
  .note { margin-top: 24px; font-size: 10.5px; color: #94a3b8; }
</style></head>
<body>
  <h1>給与明細</h1>
  <div class="sub">${employeeName} 様　／　${p.year}年${p.month}月分</div>
  <table>
    <tr><td class="label">区分</td><td class="value">${p.wageType === 'hourly' ? `時給 ${formatYen(p.wageRate)}` : `月給 ${formatYen(p.wageRate)}`}</td></tr>
    <tr><td class="label">実働時間</td><td class="value">${minutesToHHMM(p.workedMinutes)}</td></tr>
    <tr><td class="label">残業時間</td><td class="value">${minutesToHHMM(p.overtimeMinutes)}</td></tr>
    <tr><td class="label">基本給</td><td class="value">${formatYen(p.baseAmount)}</td></tr>
    <tr><td class="label">残業手当</td><td class="value">${formatYen(p.overtimeAmount)}</td></tr>
    <tr class="total"><td>総支給額（概算）</td><td class="value">${formatYen(p.totalAmount)}</td></tr>
  </table>
  <div class="note">※税金・社会保険料などの控除は含まれていない、総支給額の概算です。正式な給与額は別途ご確認ください。</div>
</body></html>`;
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 300);
}

function PayslipView({ records, employeeName }) {
  const sorted = [...records].sort((a, b) => (a.year !== b.year ? b.year - a.year : b.month - a.month));
  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm px-5 py-3.5">
        <h2 className="font-bold text-[14px] text-slate-800 flex items-center gap-2"><Wallet size={16} className="text-slate-400" />給与明細</h2>
      </div>
      {sorted.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm px-6 py-14 text-center text-[12.5px] text-slate-300">
          公開されている給与明細はまだありません
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {sorted.map((p) => (
            <div key={p.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between">
                <span className="font-bold text-[14px] text-slate-800">{p.year}年{p.month}月分</span>
                <span className="text-[10.5px] font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-full">公開済み</span>
              </div>
              <div className="px-5 py-4 space-y-2">
                <Row label="区分" value={p.wageType === 'hourly' ? `時給 ${formatYen(p.wageRate)}` : `月給 ${formatYen(p.wageRate)}`} />
                <Row label="実働時間" value={minutesToHHMM(p.workedMinutes)} />
                <Row label="残業時間" value={minutesToHHMM(p.overtimeMinutes)} />
                <Row label="基本給" value={formatYen(p.baseAmount)} />
                <Row label="残業手当" value={formatYen(p.overtimeAmount)} />
                <div className="flex items-center justify-between pt-2 mt-2 border-t border-slate-100">
                  <span className="text-[12.5px] font-bold text-slate-700">総支給額（概算）</span>
                  <span className="font-mono text-[18px] font-bold text-slate-900">{formatYen(p.totalAmount)}</span>
                </div>
                <button
                  onClick={() => printPayslip(p, employeeName)}
                  className="w-full mt-2 py-2 rounded-lg border border-slate-200 text-[12px] font-bold text-slate-600 flex items-center justify-center gap-1.5"
                >
                  <Download size={13} /> 印刷・PDF保存
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="text-[11px] text-slate-400 px-1">※税金・社会保険料などの控除は含まれていない、総支給額の概算です。正式な給与額は別途ご確認ください。</div>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between text-[12.5px]">
      <span className="text-slate-400">{label}</span>
      <span className="font-mono font-semibold text-slate-700">{value}</span>
    </div>
  );
}

function PayrollAdminTab({ employeeAccounts, records, payrollRecords, groupAttendanceSchedules = {}, employeeAttendanceSchedules = {}, onSaveDraft, onPublish, onUpdateWage, isDesktop }) {
  const now = new Date();
  const [employeeId, setEmployeeId] = useState(employeeAccounts[0]?.id || '');
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [wageType, setWageType] = useState('hourly');
  const [hourlyWage, setHourlyWage] = useState('0');
  const [monthlySalary, setMonthlySalary] = useState('0');

  const employee = employeeAccounts.find((a) => a.id === employeeId);

  useEffect(() => {
    if (!employee) return;
    setWageType(employee.wageType || 'hourly');
    setHourlyWage(String(employee.hourlyWage || 0));
    setMonthlySalary(String(employee.monthlySalary || 0));
  }, [employeeId]);

  if (!employee) {
    return <div className="bg-white rounded-2xl border border-slate-200 shadow-sm px-6 py-14 text-center text-[12.5px] text-slate-300">社員が登録されていません</div>;
  }

  const monthly = computeMonthlySummary(records[employeeId] || {}, new Date(year, month - 1, 1));
  const attendanceDays = getPrescribedAttendanceDays(employee, month, groupAttendanceSchedules, employeeAttendanceSchedules);
  const preview = computePayrollPreview({
    wageType,
    hourlyWage,
    monthlySalary,
    workedMinutes: monthly.workedMin,
    overtimeMinutes: monthly.overtimeMin,
    commuteAllowance: employee.commuteAllowance || 0,
    attendanceDays,
    actualDays: monthly.days,
  });

  const existing = payrollRecords.find((p) => p.employeeId === employeeId && p.year === year && p.month === month);

  const saveWageSettings = async () => {
    await onUpdateWage(employeeId, {
      wageType,
      hourlyWage: wageType === 'hourly' ? Number(hourlyWage) : employee.hourlyWage,
      monthlySalary: wageType === 'monthly' ? Number(monthlySalary) : employee.monthlySalary,
    });
  };

  const generate = async () => {
    await saveWageSettings();
    await onSaveDraft({
      employeeId,
      year,
      month,
      wageType,
      wageRate: preview.wageRate,
      workedMinutes: monthly.workedMin,
      overtimeMinutes: monthly.overtimeMin,
      baseAmount: preview.baseAmount + preview.allowanceAmount,
      overtimeAmount: preview.overtimeAmount,
      totalAmount: preview.totalAmount,
      notes: [
        preview.allowanceAmount > 0 ? `交通費 ${formatYen(preview.allowanceAmount)} を基本給に含む` : null,
        preview.prorated ? `出勤規定日数 ${attendanceDays}日に対し実出勤 ${monthly.days}日で日割り計算` : null,
      ].filter(Boolean).join('／') || null,
    });
  };

  const years = [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1];
  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  const recent = payrollRecords.slice(0, 20);

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4">
        <h2 className="font-bold text-[14px] text-slate-800 flex items-center gap-2"><Wallet size={16} className="text-slate-400" />給与計算</h2>
        <div className={`grid gap-3 ${isDesktop ? 'grid-cols-3' : 'grid-cols-1'}`}>
          <Field label="社員">
            <EmployeeSearchSelect employeeAccounts={employeeAccounts} value={employeeId} onChange={setEmployeeId} showAllOption={false} />
          </Field>
          <Field label="年">
            <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[14px] bg-white">
              {years.map((y) => <option key={y} value={y}>{y}年</option>)}
            </select>
          </Field>
          <Field label="月">
            <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[14px] bg-white">
              {months.map((m) => <option key={m} value={m}>{m}月</option>)}
            </select>
          </Field>
        </div>

        <div className="bg-slate-50 rounded-xl p-4 space-y-3">
          <div className="text-[12px] font-bold text-slate-600">給与形態（{employee.name}さん）</div>
          <div className="flex gap-2">
            <button onClick={() => setWageType('hourly')} className={`flex-1 py-2 rounded-lg text-[12.5px] font-bold border-2 ${wageType === 'hourly' ? 'border-slate-800 bg-white text-slate-800' : 'border-transparent text-slate-400 bg-white'}`}>時給制</button>
            <button onClick={() => setWageType('monthly')} className={`flex-1 py-2 rounded-lg text-[12.5px] font-bold border-2 ${wageType === 'monthly' ? 'border-slate-800 bg-white text-slate-800' : 'border-transparent text-slate-400 bg-white'}`}>月給制</button>
          </div>
          {wageType === 'hourly' ? (
            <Field label="時給（円）">
              <input type="number" value={hourlyWage} onChange={(e) => setHourlyWage(e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 font-mono text-[14px] bg-white" />
            </Field>
          ) : (
            <Field label="月給（円）">
              <input type="number" value={monthlySalary} onChange={(e) => setMonthlySalary(e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 font-mono text-[14px] bg-white" />
            </Field>
          )}
          <button onClick={saveWageSettings} className="text-[11.5px] font-bold text-amber-600">この給与形態を社員情報に保存</button>
        </div>

        {wageType === 'monthly' && (
          <div className="grid grid-cols-2 gap-3">
            <PayrollMetric label={`${month}月の出勤規定日数`} value={attendanceDays != null ? `${attendanceDays}日` : '未設定'} />
            <PayrollMetric label="実出勤日数" value={`${monthly.days}日`} />
          </div>
        )}
        {wageType === 'monthly' && attendanceDays == null && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-[11.5px] text-amber-800">
            {employee.mainGroup
              ? `「${employee.mainGroup}」の${month}月の出勤規定日数が未設定のため、月給を満額（日割りなし）で計算しています。出勤規定日数設定タブから設定してください。`
              : `${employee.name}さんの出勤規定日数が未設定のため、月給を満額（日割りなし）で計算しています。社員アカウント編集画面の「グループ」タブから設定してください。`}
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <PayrollMetric label="実働" value={minutesToHHMM(monthly.workedMin)} />
          <PayrollMetric label="残業" value={minutesToHHMM(monthly.overtimeMin)} />
          <PayrollMetric label="基本給" value={formatYen(preview.baseAmount)} />
          <PayrollMetric label="残業手当" value={formatYen(preview.overtimeAmount)} />
        </div>
        {preview.allowanceAmount > 0 && (
          <div className="text-[11.5px] text-slate-500 flex items-center justify-between px-1">
            <span>交通費（社員情報の設定額・月額）</span>
            <span className="font-mono font-bold">{formatYen(preview.allowanceAmount)}</span>
          </div>
        )}
        <div className="flex items-center justify-between bg-slate-900 text-white rounded-xl px-5 py-4">
          <span className="text-[12.5px] font-bold">総支給額（概算）</span>
          <span className="font-mono text-[20px] font-bold">{formatYen(preview.totalAmount)}</span>
        </div>

        <div className="flex gap-2">
          <button onClick={generate} className="flex-1 py-2.5 rounded-lg bg-slate-800 text-white text-[13px] font-bold">
            {existing ? 'この内容で再計算・保存' : 'この内容で給与明細を作成'}
          </button>
          {existing && existing.status === 'draft' && (
            <button onClick={() => onPublish(existing.id)} className="flex-1 py-2.5 rounded-lg bg-emerald-600 text-white text-[13px] font-bold">
              確定して公開する
            </button>
          )}
          {existing && existing.status === 'published' && (
            <span className="flex-1 flex items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 text-[12.5px] font-bold">公開済みです</span>
          )}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-100 font-bold text-[13.5px]">作成済み給与明細（直近20件）</div>
        {recent.length === 0 ? (
          <div className="px-5 py-8 text-center text-[12.5px] text-slate-300">まだ作成されていません</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {recent.map((p) => (
              <div key={p.id} className="px-5 py-3 flex items-center justify-between text-[12.5px]">
                <span>{p.employeeName} — {p.year}年{p.month}月分</span>
                <span className="flex items-center gap-2">
                  <span className="font-mono font-bold text-slate-700">{formatYen(p.totalAmount)}</span>
                  <span className={`text-[10.5px] font-bold px-2 py-0.5 rounded-full ${p.status === 'published' ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}>
                    {p.status === 'published' ? '公開済み' : '下書き'}
                  </span>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PayrollMetric({ label, value }) {
  return (
    <div className="bg-white rounded-lg border border-slate-200 px-3 py-2.5 text-center">
      <div className="text-[10px] text-slate-400 font-bold">{label}</div>
      <div className="font-mono text-[14px] font-bold text-slate-800 mt-0.5">{value}</div>
    </div>
  );
}

function AdminTopNav({ tab, setTab, correctionCount, leaveCount, performanceCount, isMasterAdmin }) {
  const [open, setOpen] = useState(null);
  const wrapRef = useRef(null);

  useEffect(() => {
    const onClickOutside = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(null);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const categories = [
    {
      key: 'attendance-group',
      label: '出勤管理',
      tabs: ['attendance', 'requests'],
      items: [
        { tab: 'attendance', label: '勤怠一覧', sub: '月次一覧・CSV出力' },
        { tab: 'requests', label: '勤怠修正申請', sub: '承認・却下', badge: correctionCount },
      ],
    },
    {
      key: 'leave-group',
      label: '休暇・申請管理',
      tabs: ['leave', 'performance'],
      items: [
        { tab: 'leave', label: '休暇申請', sub: '承認・却下', badge: leaveCount },
        { tab: 'performance', label: '実績報告', sub: '承認・却下', badge: performanceCount },
      ],
    },
    {
      key: 'staff-group',
      label: 'スタッフ管理',
      tabs: isMasterAdmin ? ['accounts', 'groupleave', 'eoincentive', 'auditlog', 'adminperms'] : ['accounts', 'groupleave', 'eoincentive', 'auditlog'],
      items: isMasterAdmin
        ? [
            { tab: 'accounts', label: '社員一覧・登録', sub: '入退職日・有休管理' },
            { tab: 'groupleave', label: '出勤規定日数設定', sub: 'グループ別・月別日数' },
            { tab: 'eoincentive', label: 'eo業務インセンティブ', sub: '新規実績・既存実績・支給額' },
            { tab: 'auditlog', label: '監査ログ', sub: '承認・操作の履歴' },
            { tab: 'adminperms', label: '管理者権限', sub: '管理者アカウント・権限設定' },
          ]
        : [
            { tab: 'accounts', label: '社員一覧・登録', sub: '入退職日・有休管理' },
            { tab: 'groupleave', label: '出勤規定日数設定', sub: 'グループ別・月別日数' },
            { tab: 'eoincentive', label: 'eo業務インセンティブ', sub: '新規実績・既存実績・支給額' },
            { tab: 'auditlog', label: '監査ログ', sub: '承認・操作の履歴' },
          ],
    },
  ];

  const totalBadge = correctionCount + leaveCount + performanceCount;

  return (
    <div ref={wrapRef} className="relative bg-white rounded-2xl border border-slate-200 shadow-sm">
      <div className="flex items-center px-2">
        <button
          onClick={() => { setTab('dashboard'); setOpen(null); }}
          className={`flex items-center gap-1.5 px-4 py-3 text-[13px] font-bold rounded-lg transition-colors ${tab === 'dashboard' ? 'text-slate-900' : 'text-slate-400 hover:text-slate-700'}`}
        >
          <LayoutGrid size={15} />
          ダッシュボード
        </button>
        {categories.map((cat) => {
          const catBadge = cat.items.reduce((s, i) => s + (i.badge || 0), 0);
          const isActiveGroup = cat.tabs.includes(tab);
          return (
            <button
              key={cat.key}
              onClick={() => setOpen(open === cat.key ? null : cat.key)}
              className={`relative px-4 py-3 text-[13px] font-bold rounded-lg transition-colors ${isActiveGroup || open === cat.key ? 'text-slate-900' : 'text-slate-400 hover:text-slate-700'}`}
            >
              {cat.label}
              {catBadge > 0 && (
                <span className="absolute top-1.5 -right-0.5 w-4 h-4 bg-amber-600 rounded-full text-[9px] flex items-center justify-center text-white font-bold">
                  {catBadge}
                </span>
              )}
            </button>
          );
        })}
        {totalBadge > 0 && (
          <span className="ml-auto mr-3 text-[11px] font-bold text-rose-600">未承認 合計 {totalBadge}件</span>
        )}
      </div>
      <div className={`h-0.5 transition-all ${tab === 'dashboard' ? 'bg-transparent' : 'bg-slate-800'}`} />

      {open && (
        <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-20 p-4">
          <div className="grid grid-cols-3 gap-3">
            {categories.find((c) => c.key === open).items.map((item) => (
              <button
                key={item.tab}
                onClick={() => { setTab(item.tab); setOpen(null); }}
                className="text-left rounded-lg px-3 py-3 hover:bg-slate-50 border border-transparent hover:border-slate-200 transition-colors"
              >
                <div className="flex items-center gap-1.5 text-[13px] font-bold text-slate-800">
                  {item.label}
                  {item.badge > 0 && (
                    <span className="text-[10px] bg-amber-600 text-white rounded-full px-1.5 py-0.5 font-bold">{item.badge}</span>
                  )}
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5">{item.sub}</div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function AdminView({ data, employeeAccounts, session, onDecide, onDecideLeave, onDecidePerformance, onAddAccount, onDeleteAccount, onResetPassword, onFetchMyNumber, onSaveMyNumber, onUpdateDates, onUpdateAdminAccess, onSaveGroupLeave, onSaveEmployeeAttendance, onAdminUpdateAttendance, onAdminUpdateAttendanceBatch, isDesktop }) {
  const [tab, setTab] = useState('dashboard'); // dashboard | attendance | requests | leave | performance | accounts
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [tab]);
  const pending = data.corrections.filter((c) => c.status === 'pending');
  const decided = data.corrections.filter((c) => c.status !== 'pending').slice(0, 8);
  const leavePending = data.leaveRequests.filter((l) => l.status === 'pending');
  const leaveDecided = data.leaveRequests.filter((l) => l.status !== 'pending').slice(0, 8);
  const performancePending = data.performanceReports.filter((r) => r.status === 'pending');
  const performanceDecided = data.performanceReports.filter((r) => r.status !== 'pending').slice(0, 8);
  const today = todayKey();

  const missing = [];
  employeeAccounts.forEach((acc) => {
    const recs = data.records[acc.id] || {};
    Object.values(recs as Record<string, any>).forEach((r: any) => {
      if (r.date !== today && r.clockIn && !r.clockOut) missing.push({ ...r, employeeName: acc.name });
    });
  });

  const gpsAlerts = computeGpsAlertEmployees(employeeAccounts, data.records);
  const contractAlertDate = new Date();
  contractAlertDate.setDate(contractAlertDate.getDate() + 30);
  const contractAlertKey = todayKey(contractAlertDate);
  const contractAlerts = employeeAccounts.filter((acc) => acc.contractEnd && acc.contractEnd <= contractAlertKey);

  const clockInApprovalCount = employeeAccounts.reduce((sum, acc) => {
    const recs = data.records[acc.id] || {};
    return sum + Object.values(recs).filter((r) => r?.clockInApproval === 'pending').length;
  }, 0);

  const notifications = (data.notifications || []).slice(0, 6);
  const isMasterAdmin = session?.role === 'master_admin';
  const adminAccounts = data.accounts.filter((a) => a.role === 'admin' || a.role === 'master_admin');

  return (
    <div className="space-y-5">
      {isDesktop ? (
        <AdminTopNav
          tab={tab}
          setTab={setTab}
          correctionCount={pending.length}
          leaveCount={leavePending.length}
          performanceCount={performancePending.length}
          isMasterAdmin={isMasterAdmin}
        />
      ) : (
        <div className="flex items-center bg-white rounded-xl border border-slate-200 p-1 text-[11.5px] font-medium overflow-x-auto">
          <button onClick={() => setTab('dashboard')} className={`flex-1 py-2 rounded-lg transition-colors whitespace-nowrap px-2 ${tab === 'dashboard' ? 'bg-slate-800 text-white' : 'text-slate-500'}`}>
            ホーム
          </button>
          <button onClick={() => setTab('attendance')} className={`flex-1 py-2 rounded-lg transition-colors whitespace-nowrap px-2 ${tab === 'attendance' ? 'bg-slate-800 text-white' : 'text-slate-500'}`}>
            勤怠一覧
          </button>
          <button onClick={() => setTab('requests')} className={`flex-1 py-2 rounded-lg transition-colors whitespace-nowrap px-2 ${tab === 'requests' ? 'bg-slate-800 text-white' : 'text-slate-500'}`}>
            勤怠修正
          </button>
          <button onClick={() => setTab('leave')} className={`relative flex-1 py-2 rounded-lg transition-colors whitespace-nowrap px-2 ${tab === 'leave' ? 'bg-slate-800 text-white' : 'text-slate-500'}`}>
            休暇申請
            {leavePending.length > 0 && tab !== 'leave' && (
              <span className="absolute -top-1 -right-0.5 w-4 h-4 bg-amber-600 rounded-full text-[9px] flex items-center justify-center text-white font-bold">
                {leavePending.length}
              </span>
            )}
          </button>
          <button onClick={() => setTab('performance')} className={`relative flex-1 py-2 rounded-lg transition-colors whitespace-nowrap px-2 ${tab === 'performance' ? 'bg-slate-800 text-white' : 'text-slate-500'}`}>
            実績
            {performancePending.length > 0 && tab !== 'performance' && (
              <span className="absolute -top-1 -right-0.5 w-4 h-4 bg-amber-600 rounded-full text-[9px] flex items-center justify-center text-white font-bold">
                {performancePending.length}
              </span>
            )}
          </button>
          <button onClick={() => setTab('accounts')} className={`flex-1 py-2 rounded-lg transition-colors whitespace-nowrap px-2 ${tab === 'accounts' ? 'bg-slate-800 text-white' : 'text-slate-500'}`}>
            社員管理
          </button>
          <button onClick={() => setTab('groupleave')} className={`flex-1 py-2 rounded-lg transition-colors whitespace-nowrap px-2 ${tab === 'groupleave' ? 'bg-slate-800 text-white' : 'text-slate-500'}`}>
            出勤規定日数設定
          </button>
          <button onClick={() => setTab('eoincentive')} className={`flex-1 py-2 rounded-lg transition-colors whitespace-nowrap px-2 ${tab === 'eoincentive' ? 'bg-slate-800 text-white' : 'text-slate-500'}`}>
            eo業務インセンティブ
          </button>
          <button onClick={() => setTab('auditlog')} className={`flex-1 py-2 rounded-lg transition-colors whitespace-nowrap px-2 ${tab === 'auditlog' ? 'bg-slate-800 text-white' : 'text-slate-500'}`}>
            監査ログ
          </button>
          {isMasterAdmin && (
            <button onClick={() => setTab('adminperms')} className={`flex-1 py-2 rounded-lg transition-colors whitespace-nowrap px-2 ${tab === 'adminperms' ? 'bg-slate-800 text-white' : 'text-slate-500'}`}>
              管理者権限
            </button>
          )}
        </div>
      )}

      {missing.length > 0 && tab === 'requests' && (
        <div className="bg-rose-50 border border-rose-200 rounded-xl px-4 py-3 flex items-start gap-2.5">
          <AlertTriangle size={16} className="text-rose-500 mt-0.5 shrink-0" />
          <div className="text-[12.5px] text-rose-700">
            <div className="font-bold mb-0.5">打刻漏れが{missing.length}件あります</div>
            {missing.map((r, i) => (
              <div key={i}>{dateLabel(r.date)}：{r.employeeName} — 退勤打刻がありません</div>
            ))}
          </div>
        </div>
      )}

      {tab === 'dashboard' && (
        <AdminDashboardTab
          missingCount={missing.length}
          correctionCount={pending.length}
          leaveCount={leavePending.length}
          performanceCount={performancePending.length}
          gpsAlertCount={gpsAlerts.length}
          contractAlertCount={contractAlerts.length}
          clockInApprovalCount={clockInApprovalCount}
          employeeCount={employeeAccounts.length}
          onNavigate={setTab}
          isDesktop={isDesktop}
        />
      )}

      {tab === 'attendance' && (
        <AttendanceAdminTab data={data} employeeAccounts={employeeAccounts} gpsAlerts={gpsAlerts} onAdminUpdateAttendance={onAdminUpdateAttendance} onAdminUpdateAttendanceBatch={onAdminUpdateAttendanceBatch} isDesktop={isDesktop} />
      )}

      {tab === 'accounts' && (
        <AccountManagement
          employeeAccounts={employeeAccounts}
          onAddAccount={onAddAccount}
          onUpdateDates={onUpdateDates}
          onDeleteAccount={onDeleteAccount}
          onResetPassword={onResetPassword}
          onFetchMyNumber={onFetchMyNumber}
          onSaveMyNumber={onSaveMyNumber}
          groupLeaveSchedules={data.groupLeaveSchedules}
          employeeAttendanceSchedules={data.employeeAttendanceSchedules}
          onSaveEmployeeAttendance={onSaveEmployeeAttendance}
          session={session}
          isDesktop={isDesktop}
        />
      )}

      {tab === 'auditlog' && (
        <AdminAuditLogTab logs={data.auditLogs} isDesktop={isDesktop} />
      )}

      {tab === 'adminperms' && isMasterAdmin && (
        <AdminPermissionsTab
          adminAccounts={adminAccounts}
          currentUserId={session.id}
          onUpdateAccess={onUpdateAdminAccess}
          onResetPassword={onResetPassword}
          isDesktop={isDesktop}
        />
      )}

      {tab === 'groupleave' && (
        <GroupLeaveScheduleTab
          employeeAccounts={employeeAccounts}
          groupLeaveSchedules={data.groupLeaveSchedules}
          onSave={onSaveGroupLeave}
          isDesktop={isDesktop}
        />
      )}

      {tab === 'eoincentive' && (
        <EoAdminIncentiveTab employeeAccounts={employeeAccounts} isDesktop={isDesktop} />
      )}

      {tab === 'performance' && (
        <PerformanceAdminTab
          pending={performancePending}
          decided={performanceDecided}
          onDecide={onDecidePerformance}
          isDesktop={isDesktop}
        />
      )}

      {tab === 'leave' && (
        <div className={isDesktop ? 'grid grid-cols-2 gap-5 items-start' : 'space-y-5'}>
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-100 flex items-center gap-2">
              <Palmtree size={15} className="text-slate-400" />
              <h2 className="font-bold text-[13.5px]">承認待ちの休暇申請</h2>
              {leavePending.length > 0 && <span className="ml-auto text-[11px] bg-amber-600 text-white rounded-full px-2 py-0.5 font-bold">{leavePending.length}</span>}
            </div>
            {leavePending.length === 0 ? (
              <div className="px-5 py-8 text-center text-[12.5px] text-slate-300">承認待ちの申請はありません</div>
            ) : (
              <div className="divide-y divide-slate-100">
                {leavePending.map((l) => (
                  <div key={l.id} className="px-5 py-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-[13px] font-semibold">{l.employeeName} — {l.type}{l.halfDay ? '（半休）' : ''}</div>
                      <div className="text-[10.5px] text-slate-400">{new Date(l.submittedAt).toLocaleString('ja-JP')}</div>
                    </div>
                    <div className="font-mono text-[12.5px] text-slate-600 bg-slate-50 rounded-lg px-3 py-2 mb-2">
                      {l.startDate === l.endDate ? dateLabel(l.startDate) : `${dateLabel(l.startDate)} 〜 ${dateLabel(l.endDate)}`}
                      <span className="ml-2 text-slate-400">（{l.days}日間）</span>
                    </div>
                    <div className="text-[12.5px] text-slate-500 mb-3">理由：{l.reason}</div>
                    <div className="flex gap-2">
                      <button onClick={() => onDecideLeave(l.id, 'rejected')} className="flex-1 flex items-center justify-center gap-1 py-2 rounded-lg border border-slate-200 text-[12.5px] font-medium text-slate-500">
                        <XCircle size={13} /> 却下
                      </button>
                      <button onClick={() => onDecideLeave(l.id, 'approved')} className="flex-1 flex items-center justify-center gap-1 py-2 rounded-lg bg-emerald-600 text-white text-[12.5px] font-bold">
                        <CheckCircle2 size={13} /> 承認
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {leaveDecided.length > 0 && (
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden h-fit">
              <div className="px-5 py-3.5 border-b border-slate-100">
                <h2 className="font-bold text-[13.5px]">処理済みの休暇申請</h2>
              </div>
              <div className="divide-y divide-slate-100">
                {leaveDecided.map((l) => (
                  <div key={l.id} className="px-5 py-2.5 flex items-center justify-between text-[12.5px]">
                    <span>{l.employeeName} — {l.type}{l.halfDay ? '（半休）' : ''}（{l.startDate === l.endDate ? dateLabel(l.startDate) : `${dateLabel(l.startDate)}〜${dateLabel(l.endDate)}`}）</span>
                    <span className={`font-medium shrink-0 ml-2 ${l.status === 'approved' ? 'text-emerald-600' : 'text-slate-400'}`}>
                      {l.status === 'approved' ? '承認済み' : '却下'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'requests' && (
        <div className={isDesktop ? 'grid grid-cols-2 gap-5 items-start' : 'space-y-5'}>
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-100 flex items-center gap-2">
              <FileEdit size={15} className="text-slate-400" />
              <h2 className="font-bold text-[13.5px]">承認待ちの修正申請</h2>
              {pending.length > 0 && <span className="ml-auto text-[11px] bg-amber-600 text-white rounded-full px-2 py-0.5 font-bold">{pending.length}</span>}
            </div>
            {pending.length === 0 ? (
              <div className="px-5 py-8 text-center text-[12.5px] text-slate-300">承認待ちの申請はありません</div>
            ) : (
              <div className="divide-y divide-slate-100">
                {pending.map((c) => (
                  <div key={c.id} className="px-5 py-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-[13px] font-semibold">{c.employeeName} — {dateLabel(c.date)}</div>
                      <div className="text-[10.5px] text-slate-400">{new Date(c.submittedAt).toLocaleString('ja-JP')}</div>
                    </div>
                    <div className="font-mono text-[12.5px] text-slate-600 bg-slate-50 rounded-lg px-3 py-2 mb-2 flex flex-wrap gap-x-4 gap-y-1">
                      <span>出勤 <b className="text-slate-800">{c.requested.clockIn || '変更なし'}</b></span>
                      <span>退勤 <b className="text-slate-800">{c.requested.clockOut || '変更なし'}</b></span>
                      <span>休憩 <b className="text-slate-800">{c.requested.breakMinutes}分</b></span>
                    </div>
                    <div className="text-[12.5px] text-slate-500 mb-3">理由：{c.reason}</div>
                    <div className="flex gap-2">
                      <button onClick={() => onDecide(c.id, 'rejected')} className="flex-1 flex items-center justify-center gap-1 py-2 rounded-lg border border-slate-200 text-[12.5px] font-medium text-slate-500">
                        <XCircle size={13} /> 却下
                      </button>
                      <button onClick={() => onDecide(c.id, 'approved')} className="flex-1 flex items-center justify-center gap-1 py-2 rounded-lg bg-emerald-600 text-white text-[12.5px] font-bold">
                        <CheckCircle2 size={13} /> 承認
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className={isDesktop ? 'space-y-5' : 'contents'}>
            {decided.length > 0 && (
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="px-5 py-3.5 border-b border-slate-100">
                  <h2 className="font-bold text-[13.5px]">処理済みの申請</h2>
                </div>
                <div className="divide-y divide-slate-100">
                  {decided.map((c) => (
                    <div key={c.id} className="px-5 py-2.5 flex items-center justify-between text-[12.5px]">
                      <span>{c.employeeName} — {dateLabel(c.date)}</span>
                      <span className={`font-medium ${c.status === 'approved' ? 'text-emerald-600' : 'text-slate-400'}`}>
                        {c.status === 'approved' ? '承認済み' : '却下'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-100 flex items-center gap-2">
                <Bell size={15} className="text-slate-400" />
                <h2 className="font-bold text-[13.5px]">通知ログ（メール送信シミュレーション）</h2>
              </div>
              {notifications.length === 0 ? (
                <div className="px-5 py-8 text-center text-[12.5px] text-slate-300">通知はまだありません</div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {notifications.map((n) => (
                    <div key={n.id} className="px-5 py-3">
                      <div className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-800">
                        <Mail size={11} className="text-slate-400" /> {n.subject}
                      </div>
                      <div className="text-[11.5px] text-slate-500 mt-0.5">{n.body}</div>
                      <div className="text-[10px] text-slate-300 mt-1">{new Date(n.sentAt).toLocaleString('ja-JP')}</div>
                    </div>
                  ))}
                </div>
              )}
              <div className="px-5 py-2.5 bg-slate-50 text-[10.5px] text-slate-400 border-t border-slate-100">
                ※実際のメール送信には、サーバー側の実装（SMTP連携等）が別途必要です
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PerformanceAdminTab({ pending, decided, onDecide, isDesktop }) {
  const [memos, setMemos] = useState({});
  const setMemo = (id, v) => setMemos((m) => ({ ...m, [id]: v }));

  const pendingCard = (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
      <div className="px-5 py-3.5 border-b border-slate-100 flex items-center gap-2">
        <ClipboardList size={15} className="text-slate-400" />
        <h2 className="font-bold text-[13.5px]">承認待ちの実績</h2>
        {pending.length > 0 && <span className="ml-auto text-[11px] bg-amber-600 text-white rounded-full px-2 py-0.5 font-bold">{pending.length}</span>}
      </div>
      {pending.length === 0 ? (
        <div className="px-5 py-8 text-center text-[12.5px] text-slate-300">承認待ちの実績はありません</div>
      ) : (
        <div className="divide-y divide-slate-100">
          {pending.map((r) => (
            <div key={r.id} className="px-5 py-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md">{r.type === 'half' ? '半月' : '月末'}</span>
                  <span className="text-[13px] font-semibold text-slate-800">{r.employeeName} — {r.periodLabel}</span>
                </div>
                <div className="text-[10.5px] text-slate-400">{new Date(r.submittedAt).toLocaleString('ja-JP')}</div>
              </div>
              <div className="font-mono text-[12.5px] text-slate-600 bg-slate-50 rounded-lg px-3 py-2 mb-2 whitespace-pre-wrap">{r.summary}</div>
              {r.numericValue !== null && r.numericValue !== '' && (
                <div className="text-[12px] text-slate-500 mb-2">{r.numericLabel || '実績値'}：<span className="font-mono font-semibold text-slate-700">{r.numericValue}</span></div>
              )}
              {r.notes && <div className="text-[12px] text-slate-400 mb-2">備考：{r.notes}</div>}
              <textarea
                value={memos[r.id] ?? ''}
                onChange={(e) => setMemo(r.id, e.target.value)}
                rows={2}
                placeholder="社員に送るコメント（任意）"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[12.5px] resize-none mb-2"
              />
              <div className="flex gap-2">
                <button onClick={() => onDecide(r.id, 'rejected', memos[r.id] || '')} className="flex-1 flex items-center justify-center gap-1 py-2 rounded-lg border border-slate-200 text-[12.5px] font-medium text-slate-500">
                  <XCircle size={13} /> 却下
                </button>
                <button onClick={() => onDecide(r.id, 'approved', memos[r.id] || '')} className="flex-1 flex items-center justify-center gap-1 py-2 rounded-lg bg-emerald-600 text-white text-[12.5px] font-bold">
                  <CheckCircle2 size={13} /> 承認
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const decidedCard = decided.length > 0 && (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden h-fit">
      <div className="px-5 py-3.5 border-b border-slate-100">
        <h2 className="font-bold text-[13.5px]">処理済みの実績</h2>
      </div>
      <div className="divide-y divide-slate-100">
        {decided.map((r) => (
          <div key={r.id} className="px-5 py-2.5 text-[12.5px]">
            <div className="flex items-center justify-between">
              <span>{r.employeeName} — {r.periodLabel}</span>
              <span className={`font-medium shrink-0 ml-2 ${r.status === 'approved' ? 'text-emerald-600' : 'text-slate-400'}`}>
                {r.status === 'approved' ? '承認済み' : '却下'}
              </span>
            </div>
            {r.adminMemo && <div className="text-[11px] text-slate-400 mt-0.5">コメント：{r.adminMemo}</div>}
          </div>
        ))}
      </div>
    </div>
  );

  if (isDesktop) {
    return (
      <div className="grid grid-cols-2 gap-5 items-start">
        {pendingCard}
        {decidedCard}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {pendingCard}
      {decidedCard}
    </div>
  );
}


function AttendanceAdminTab({ data, employeeAccounts, gpsAlerts = [], onAdminUpdateAttendance, onAdminUpdateAttendanceBatch, isDesktop }) {
  const now = new Date();
  const [dateFilter, setDateFilter] = useState(todayKey());
  const [employeeFilter, setEmployeeFilter] = useState('all');
  const [groupFilter, setGroupFilter] = useState('all');
  const [edits, setEdits] = useState({}); // { 'employeeId|date': { clockIn, clockOut, breakMinutes, approve } }
  const [savingAll, setSavingAll] = useState(false);
  const gpsAlertIds = new Set(gpsAlerts.map((g) => g.employeeId));
  const groups = Array.from(new Set(employeeAccounts.map((a) => a.mainGroup).filter(Boolean)));

  const filteredAccounts = employeeAccounts.filter((acc) => {
    if (groupFilter !== 'all' && acc.mainGroup !== groupFilter) return false;
    if (employeeFilter !== 'all' && acc.id !== employeeFilter) return false;
    return true;
  });

  // 承認待ちの出勤（日付・社員フィルターに関係なく、全期間から探す）
  const [approvingKey, setApprovingKey] = useState(null);
  const pendingApprovals = [];
  employeeAccounts.forEach((acc) => {
    const recs = data.records[acc.id] || {};
    Object.values(recs).forEach((record) => {
      if (record?.clockInApproval === 'pending') {
        pendingApprovals.push({
          employeeId: acc.id,
          employeeName: acc.name,
          date: record.date,
          dateShort: formatAdminDate(record.date).label,
          statusLabel: CLOCK_IN_STATUS_LABEL[record.clockInStatus] || record.clockInStatus,
          clockIn: record.clockIn ? hhmm(new Date(record.clockIn)) : '',
          clockInActual: record.clockInActual ? hhmm(new Date(record.clockInActual)) : '',
          note: record.clockInNote || '',
        });
      }
    });
  });
  pendingApprovals.sort((a, b) => (a.date < b.date ? 1 : -1));

  const decideApproval = async (item, approve) => {
    setApprovingKey(`${item.employeeId}|${item.date}`);
    await onAdminUpdateAttendance(item.employeeId, item.date, { approve }, {});
    setApprovingKey(null);
  };

  const rows = [];
  const dateStr = dateFilter;
  filteredAccounts.forEach((acc) => {
    if (acc.hireDate && dateStr < acc.hireDate) return; // 入職前
    if (acc.resignationDate && dateStr > acc.resignationDate) return; // 退職後
    const recs = data.records[acc.id] || {};
    const record = recs[dateStr] || null;
    const metrics = computeMetrics(record);
    rows.push({
      employeeId: acc.id,
      employeeName: acc.name,
      date: dateStr,
      clockIn: record?.clockIn ? hhmm(new Date(record.clockIn)) : '',
      clockOut: record?.clockOut ? hhmm(new Date(record.clockOut)) : '',
      breakMin: record ? getRecordedBreakMinutes(record, record.clockOut ? new Date(record.clockOut) : new Date()) : 0,
      workedMin: metrics?.workedMin ?? 0,
      overtimeMin: metrics?.overtimeMin ?? 0,
      lateMin: metrics?.lateMin ?? 0,
      earlyLeaveMin: metrics?.earlyLeaveMin ?? 0,
      status: computeDayStatus(record).label,
      clockInStatusLabel: record?.clockInStatus ? (CLOCK_IN_STATUS_LABEL[record.clockInStatus] || '') : '',
      clockInActual: record?.clockInActual && record.clockInActual !== record.clockIn ? hhmm(new Date(record.clockInActual)) : '',
      clockOutStatusLabel: record?.clockOutStatus ? (CLOCK_OUT_STATUS_LABEL[record.clockOutStatus] || '') : '',
      clockOutActual: record?.clockOutActual && record.clockOutActual !== record.clockOut ? hhmm(new Date(record.clockOutActual)) : '',
      needsApproval: record?.clockInApproval === 'pending',
      breakMinutes: record ? getRecordedBreakMinutes(record, record.clockOut ? new Date(record.clockOut) : new Date()) : null,
      dateShort: formatAdminDate(dateStr).label,
      dateBadgeClass: formatAdminDate(dateStr).badgeClass,
    });
  });
  rows.sort((a, b) => a.employeeName.localeCompare(b.employeeName, 'ja'));

  const summaryByEmployee = filteredAccounts
    .map((acc) => {
      const mine = rows.filter((r) => r.employeeId === acc.id);
      return {
        id: acc.id,
        name: acc.name,
        days: mine.filter((r) => r.clockIn).length,
        workedMin: mine.reduce((sum, r) => sum + r.workedMin, 0),
        overtimeMin: mine.reduce((sum, r) => sum + r.overtimeMin, 0),
        lateEarlyCount: mine.filter((r) => r.lateMin > 0 || r.earlyLeaveMin > 0).length,
        missingCount: mine.filter((r) => r.clockIn && !r.clockOut).length,
        gpsAlert: gpsAlertIds.has(acc.id),
      };
    });

  const escapeCsv = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const exportCsv = () => {
    const header = ['社員名','日付','出勤','実打刻','出勤区分','退勤','実打刻','退勤区分','休憩(分)','実働','残業','遅刻(分)','早退(分)','状態'];
    const body = rows.map((r) => [r.employeeName,r.date,r.clockIn,r.clockInActual,r.clockInStatusLabel,r.clockOut,r.clockOutActual,r.clockOutStatusLabel,r.breakMin,minutesToHHMM(r.workedMin),minutesToHHMM(r.overtimeMin),r.lateMin,r.earlyLeaveMin,r.status]);
    const csv = '\uFEFF' + [header, ...body].map((line) => line.map(escapeCsv).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `brown-work-attendance-${dateFilter}${employeeFilter === 'all' ? '-all' : ''}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">
      {pendingApprovals.length > 0 && (
        <div className="bg-white rounded-2xl border-2 border-amber-300 shadow-sm overflow-hidden">
          <div className="px-5 py-3.5 border-b border-amber-100 bg-amber-50 flex items-center gap-2">
            <AlertTriangle size={16} className="text-amber-600" />
            <h2 className="font-bold text-[13.5px] text-amber-800">承認待ちの出勤</h2>
            <span className="ml-auto text-[11px] font-bold text-white bg-amber-600 rounded-full px-2 py-0.5">{pendingApprovals.length}件</span>
          </div>
          <div className="divide-y divide-slate-100">
            {pendingApprovals.map((item) => {
              const key = `${item.employeeId}|${item.date}`;
              const busy = approvingKey === key;
              return (
                <div key={key} className="px-5 py-3 flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <div className="text-[13px] font-bold text-slate-800">{item.employeeName} ・ {item.dateShort}</div>
                    <div className="text-[11.5px] text-slate-500 mt-0.5">
                      {item.statusLabel}／記録 {item.clockIn}{item.clockInActual && item.clockInActual !== item.clockIn ? `（実打刻 ${item.clockInActual}）` : ''}
                      {item.note && `・${item.note}`}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => decideApproval(item, false)} disabled={busy} className="text-[12px] font-bold text-slate-500 border border-slate-200 rounded-lg px-3 py-1.5 disabled:opacity-50">却下</button>
                    <button onClick={() => decideApproval(item, true)} disabled={busy} className="text-[12px] font-bold text-white bg-amber-600 rounded-lg px-3 py-1.5 disabled:opacity-50">{busy ? '処理中…' : '承認する'}</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {gpsAlerts.length > 0 && (
        <div className="bg-rose-50 border border-rose-200 rounded-xl px-4 py-3 flex items-start gap-2.5">
          <MapPin size={16} className="text-rose-500 mt-0.5 shrink-0" />
          <div className="text-[12.5px] text-rose-700">
            <div className="font-bold mb-0.5">位置情報が5回以上連続で記録されていないスタッフがいます</div>
            {gpsAlerts.map((g) => <div key={g.employeeId}>{g.employeeName}（{g.consecutiveCount}回連続）</div>)}
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 flex flex-wrap items-end gap-3">
        <Field label="対象日">
          <input type="date" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} className="border border-slate-200 rounded-lg px-3 py-2 font-mono text-[13px] bg-white" />
        </Field>
        <button onClick={() => setDateFilter(todayKey())} className="text-[12px] font-bold text-slate-500 border border-slate-200 rounded-lg px-3 py-2 bg-white">今日</button>
        {groups.length > 0 && (
          <Field label="グループ">
            <select value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)} className="border border-slate-200 rounded-lg px-3 py-2 text-[13px] bg-white min-w-[140px]">
              <option value="all">全グループ</option>
              {groups.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </Field>
        )}
        <Field label="社員">
          <EmployeeSearchSelect employeeAccounts={employeeAccounts} value={employeeFilter} onChange={setEmployeeFilter} />
        </Field>
        <button onClick={exportCsv} disabled={rows.length === 0} className="ml-auto flex items-center gap-1.5 rounded-lg bg-slate-900 disabled:bg-slate-200 text-white px-4 py-2.5 text-[12.5px] font-bold">
          <Download size={14} /> CSV出力
        </button>
      </div>

      <div className={`grid gap-3 ${isDesktop ? 'grid-cols-3' : 'grid-cols-3'}`}>
        <StatMini label="対象社員" value={`${summaryByEmployee.length}名`} />
        <StatMini label="出勤者数" value={`${summaryByEmployee.reduce((s, x) => s + x.days, 0)}名`} />
        <StatMini label="総実働" value={minutesToHHMM(summaryByEmployee.reduce((s, x) => s + x.workedMin, 0))} />
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-100 flex items-center gap-2">
          <Clock size={15} className="text-slate-400" />
          <h2 className="font-bold text-[13.5px]">{formatAdminDate(dateFilter).label}の勤怠</h2>
          <span className="text-[10.5px] text-slate-400">出勤・退勤・休憩を直接書き換えて、下の「まとめて更新」で保存できます</span>
          <span className="ml-auto text-[11px] text-slate-400">{rows.length}件</span>
        </div>
        {rows.length === 0 ? (
          <div className="px-5 py-10 text-center text-[12.5px] text-slate-300">対象日の勤怠データはありません</div>
        ) : isDesktop ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-[12.5px]">
              <thead><tr className="text-left text-[10.5px] text-slate-400 border-b border-slate-100">
                {(employeeFilter === 'all' ? ['社員','日付','出勤','実打刻','退勤','実打刻','休憩(分)','実働','残業','遅刻','早退','状態','承認'] : ['日付','出勤','実打刻','退勤','実打刻','休憩(分)','実働','残業','遅刻','早退','状態','承認']).map((h, i) => <th key={h + i} className="px-3 py-2 font-medium">{h}</th>)}
              </tr></thead>
              <tbody>{rows.map((r) => {
                const key = `${r.employeeId}|${r.date}`;
                const e = edits[key] || { clockIn: r.clockIn, clockOut: r.clockOut, breakMinutes: r.breakMin, approve: undefined };
                const setField = (field, value) => setEdits((prev) => ({ ...prev, [key]: { ...(prev[key] || { clockIn: r.clockIn, clockOut: r.clockOut, breakMinutes: r.breakMin, approve: undefined }), [field]: value } }));
                return (
                  <tr key={key} className={`border-b border-slate-100 last:border-0 ${r.needsApproval ? 'bg-amber-50/60' : r.dateBadgeClass}`}>
                    {employeeFilter === 'all' && <td className="px-3 py-2 font-semibold whitespace-nowrap">{r.employeeName}</td>}
                    <td className="px-3 py-2 font-mono font-semibold whitespace-nowrap">{r.dateShort}</td>
                    <td className="px-3 py-2"><input type="time" value={e.clockIn || ''} onChange={(ev) => setField('clockIn', ev.target.value)} className="w-[92px] border border-slate-200 rounded px-1.5 py-1 font-mono text-[12px]" /></td>
                    <td className="px-3 py-2 font-mono text-slate-400 whitespace-nowrap">
                      {r.clockInActual || ''}
                      {r.clockInStatusLabel && (
                        <div className={`text-[10px] font-sans whitespace-nowrap ${r.needsApproval ? 'text-amber-600 font-bold' : 'text-blue-600'}`}>
                          {r.clockInStatusLabel}{r.needsApproval ? '・承認待ち' : ''}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2"><input type="time" value={e.clockOut || ''} onChange={(ev) => setField('clockOut', ev.target.value)} className="w-[92px] border border-slate-200 rounded px-1.5 py-1 font-mono text-[12px]" /></td>
                    <td className="px-3 py-2 font-mono text-slate-400 whitespace-nowrap">
                      {r.clockOutActual || ''}
                      {r.clockOutStatusLabel && (
                        <div className="text-[10px] font-sans whitespace-nowrap text-purple-600">{r.clockOutStatusLabel}</div>
                      )}
                    </td>
                    <td className="px-3 py-2"><input type="number" min="0" step="5" value={e.breakMinutes ?? ''} onChange={(ev) => setField('breakMinutes', ev.target.value)} className="w-16 border border-slate-200 rounded px-1.5 py-1 font-mono text-[12px]" /></td>
                    <td className="px-3 py-2 font-mono font-semibold whitespace-nowrap">{minutesToHHMM(r.workedMin)}</td>
                    <td className="px-3 py-2 font-mono whitespace-nowrap">{minutesToHHMM(r.overtimeMin)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{r.lateMin}分</td>
                    <td className="px-3 py-2 whitespace-nowrap">{r.earlyLeaveMin}分</td>
                    <td className="px-3 py-2 whitespace-nowrap">{r.status}</td>
                    <td className="px-3 py-2">
                      {r.needsApproval && (
                        <label className="flex items-center gap-1 text-[10.5px] text-amber-700 whitespace-nowrap">
                          <input type="checkbox" checked={!!e.approve} onChange={(ev) => setField('approve', ev.target.checked)} />
                          承認
                        </label>
                      )}
                    </td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">{rows.map((r) => {
            const key = `${r.employeeId}|${r.date}`;
            const e = edits[key] || { clockIn: r.clockIn, clockOut: r.clockOut, breakMinutes: r.breakMin, approve: undefined };
            const setField = (field, value) => setEdits((prev) => ({ ...prev, [key]: { ...(prev[key] || { clockIn: r.clockIn, clockOut: r.clockOut, breakMinutes: r.breakMin, approve: undefined }), [field]: value } }));
            return (
              <div key={key} className={`px-4 py-3 ${r.needsApproval ? 'bg-amber-50/60' : r.dateBadgeClass}`}>
                <div className="flex items-center justify-between">
                  <div className="inline-block font-mono text-[13px] font-semibold text-slate-700">{r.dateShort}</div>
                  {employeeFilter === 'all' && <div className="text-[12px] font-bold text-slate-600">{r.employeeName}</div>}
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  <Field label="出勤"><input type="time" value={e.clockIn || ''} onChange={(ev) => setField('clockIn', ev.target.value)} className="w-full border border-slate-200 rounded px-2 py-1.5 font-mono text-[12.5px]" /></Field>
                  <Field label="退勤"><input type="time" value={e.clockOut || ''} onChange={(ev) => setField('clockOut', ev.target.value)} className="w-full border border-slate-200 rounded px-2 py-1.5 font-mono text-[12.5px]" /></Field>
                  <Field label="休憩(分)"><input type="number" min="0" step="5" value={e.breakMinutes ?? ''} onChange={(ev) => setField('breakMinutes', ev.target.value)} className="w-full border border-slate-200 rounded px-2 py-1.5 font-mono text-[12.5px]" /></Field>
                </div>
                <div className="mt-2 text-[11px] text-slate-400">{r.status} ・実働 {minutesToHHMM(r.workedMin)}{r.overtimeMin > 0 ? ` ・ 残業 ${minutesToHHMM(r.overtimeMin)}` : ''}{r.lateMin > 0 ? ` ・ 遅刻 ${r.lateMin}分` : ''}{r.earlyLeaveMin > 0 ? ` ・ 早退 ${r.earlyLeaveMin}分` : ''}</div>
                {r.clockInStatusLabel && <div className={`mt-1 text-[11px] font-medium ${r.needsApproval ? 'text-amber-600' : 'text-blue-600'}`}>{r.clockInStatusLabel}{r.needsApproval ? '・承認待ち' : ''}{r.clockInActual ? `（実打刻 ${r.clockInActual}）` : ''}</div>}
                {r.clockOutStatusLabel && <div className="mt-1 text-[11px] font-medium text-purple-600">{r.clockOutStatusLabel}{r.clockOutActual ? `（実打刻 ${r.clockOutActual}）` : ''}</div>}
                {r.needsApproval && (
                  <label className="mt-1.5 flex items-center gap-1.5 text-[11.5px] text-amber-700">
                    <input type="checkbox" checked={!!e.approve} onChange={(ev) => setField('approve', ev.target.checked)} />
                    この出勤を承認する
                  </label>
                )}
              </div>
            );
          })}</div>
        )}
        {rows.length > 0 && (
          <div className="px-5 py-3.5 border-t border-slate-100 flex items-center justify-end gap-2">
            {Object.keys(edits).length > 0 && (
              <button onClick={() => setEdits({})} className="text-[12px] font-medium text-slate-400 px-3 py-2">変更を取り消す</button>
            )}
            <button
              onClick={async () => {
                setSavingAll(true);
                const changes = Object.entries(edits).map(([key, patch]) => {
                  const [empId, dateStr] = key.split('|');
                  return { employeeId: empId, date: dateStr, patch };
                });
                await onAdminUpdateAttendanceBatch(changes);
                setEdits({});
                setSavingAll(false);
              }}
              disabled={Object.keys(edits).length === 0 || savingAll}
              className="rounded-lg bg-slate-900 disabled:bg-slate-200 text-white px-5 py-2.5 text-[13px] font-bold"
            >
              {savingAll ? '更新中…' : `まとめて更新${Object.keys(edits).length > 0 ? `（${Object.keys(edits).length}件）` : ''}`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// 社員数が多い場合に備えた、1文字入力するごとに絞り込まれる検索付きセレクト
function EmployeeSearchSelect({ employeeAccounts, value, onChange, allLabel = '全社員', showAllOption = true, placeholder = '名前で検索…' }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapRef = useRef(null);

  useEffect(() => {
    const onClickOutside = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const selected = employeeAccounts.find((a) => a.id === value);
  const displayValue = open ? query : (selected ? selected.name : (showAllOption ? allLabel : ''));

  const q = query.trim();
  const filtered = q
    ? employeeAccounts.filter((a) => (a.name || '').includes(q) || (a.furigana || '').includes(q))
    : employeeAccounts;

  const pick = (id) => {
    onChange(id);
    setQuery('');
    setOpen(false);
  };

  return (
    <div ref={wrapRef} className="relative">
      <input
        value={displayValue}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => { setQuery(''); setOpen(true); }}
        placeholder={placeholder}
        className="border border-slate-200 rounded-lg px-3 py-2 text-[13px] bg-white min-w-[180px] w-full"
      />
      {open && (
        <div className="absolute z-20 mt-1 w-full max-h-64 overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-lg">
          {showAllOption && (
            <button
              type="button"
              onClick={() => pick('all')}
              className={`w-full text-left px-3 py-2 text-[13px] hover:bg-slate-50 ${value === 'all' ? 'font-bold text-slate-800' : 'text-slate-600'}`}
            >
              {allLabel}
            </button>
          )}
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-[12.5px] text-slate-300">該当する社員がいません</div>
          ) : (
            filtered.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => pick(a.id)}
                className={`w-full text-left px-3 py-2 text-[13px] hover:bg-slate-50 ${value === a.id ? 'font-bold text-slate-800' : 'text-slate-600'}`}
              >
                {a.name}
                {a.furigana && <span className="ml-1.5 text-[11px] text-slate-400">{a.furigana}</span>}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function StatMini({ label, value }) {
  return <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm"><div className="text-[11px] text-slate-400 mb-1">{label}</div><div className="font-mono text-[20px] font-bold text-slate-900">{value}</div></div>;
}
function MiniValue({ label, value }) {
  return <div><div className="text-[9.5px] text-slate-400">{label}</div><div className="font-mono text-[12.5px] font-semibold text-slate-700">{value}</div></div>;
}

function ProfileRequestView({ session, requests, onSubmit }) {
  const [modalOpen, setModalOpen] = useState(false);
  const pending = requests.filter((r) => r.status === 'pending');

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-100 flex items-center gap-2">
          <UserCog size={16} className="text-slate-400" />
          <h2 className="font-bold text-[14px] text-slate-800">個人情報</h2>
          <button
            onClick={() => setModalOpen(true)}
            className="ml-auto flex items-center gap-1.5 bg-amber-600 text-white text-[12.5px] font-bold px-3 py-1.5 rounded-lg shadow-sm active:brightness-95"
          >
            <Pencil size={13} /> 変更を申請
          </button>
        </div>
        <div className="divide-y divide-slate-100">
          {PROFILE_EDITABLE_FIELDS.map(({ key, label }) => (
            <div key={key} className="px-5 py-3 flex items-center justify-between text-[13px]">
              <span className="text-slate-400">{label}</span>
              <span className="font-medium text-slate-700">{session[key] || '未設定'}</span>
            </div>
          ))}
        </div>
        <div className="px-5 py-2.5 bg-slate-50 text-[10.5px] text-slate-400 border-t border-slate-100">
          変更は管理者の承認後に反映されます。氏名・入職日・スタッフ種別などの変更はご相談ください。
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-100 flex items-center gap-2">
          <ListChecks size={15} className="text-slate-400" />
          <h2 className="font-bold text-[13.5px]">申請履歴</h2>
          {pending.length > 0 && <span className="ml-auto text-[11px] bg-amber-600 text-white rounded-full px-2 py-0.5 font-bold">{pending.length}</span>}
        </div>
        {requests.length === 0 ? (
          <div className="px-5 py-10 text-center text-[12.5px] text-slate-300">まだ申請はありません</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {requests.map((r) => (
              <div key={r.id} className="px-5 py-3.5">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11.5px] text-slate-400">{new Date(r.submittedAt).toLocaleDateString('ja-JP')}</span>
                  <LeaveStatusBadge status={r.status === 'approved' ? 'approved' : r.status} />
                </div>
                <div className="text-[12.5px] text-slate-700 space-y-0.5">
                  {Object.entries(r.requestedChanges).map(([key, value]) => (
                    <div key={key}>{PROFILE_EDITABLE_FIELDS.find((f) => f.key === key)?.label || key}：{r.originalValues?.[key] || '未設定'} → <b>{value || '未設定'}</b></div>
                  ))}
                </div>
                {r.adminMemo && (
                  <div className="mt-2 flex items-start gap-1.5 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 text-[11.5px] text-amber-800">
                    <MessageSquare size={12} className="mt-0.5 shrink-0" />
                    <span>管理者コメント：{r.adminMemo}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {modalOpen && (
        <ProfileRequestModal session={session} onClose={() => setModalOpen(false)} onSubmit={onSubmit} />
      )}
    </div>
  );
}

function ProfileRequestModal({ session, onClose, onSubmit }) {
  const [form, setForm] = useState(() => {
    const f = {};
    PROFILE_EDITABLE_FIELDS.forEach(({ key }) => { f[key] = session[key] || ''; });
    return f;
  });
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const changedFields = PROFILE_EDITABLE_FIELDS.filter(({ key }) => form[key] !== (session[key] || ''));
  const canSubmit = changedFields.length > 0;

  const submit = async () => {
    setSaving(true);
    const changes = {};
    changedFields.forEach(({ key }) => { changes[key] = form[key]; });
    await onSubmit(changes, reason);
    setSaving(false);
    onClose();
  };

  return createPortal(
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-40 p-0 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md max-h-[92vh] overflow-y-auto">
        <div className="px-5 pt-5 pb-3 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white">
          <h3 className="font-bold text-[15px]">個人情報の変更申請</h3>
          <button onClick={onClose} className="text-slate-400 text-xl leading-none px-1">×</button>
        </div>
        <div className="px-5 py-4 space-y-4">
          {PROFILE_EDITABLE_FIELDS.map(({ key, label }) => (
            <Field key={key} label={label}>
              <input value={form[key]} onChange={set(key)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[14px]" />
            </Field>
          ))}
          <Field label="変更理由（任意）">
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13.5px] resize-none" />
          </Field>
          <div className="flex items-start gap-2 bg-slate-50 rounded-lg p-3 text-[11.5px] text-slate-500">
            <Mail size={13} className="mt-0.5 shrink-0" />
            <span>申請すると管理者に通知が送信されます。承認されるまで反映されません</span>
          </div>
        </div>
        <div className="px-5 pb-5 pt-1 flex gap-2 sticky bottom-0 bg-white">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-lg border border-slate-200 text-[13.5px] font-medium text-slate-500">キャンセル</button>
          <button onClick={submit} disabled={!canSubmit || saving} className="flex-1 py-2.5 rounded-lg bg-amber-600 disabled:bg-slate-200 text-white text-[13.5px] font-bold">
            {saving ? '送信中…' : '申請する'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function AdminProfileRequestsTab({ requests, onDecide, isDesktop }) {
  const [memos, setMemos] = useState({});
  const setMemo = (id, v) => setMemos((m) => ({ ...m, [id]: v }));
  const pending = requests.filter((r) => r.status === 'pending');
  const decided = requests.filter((r) => r.status !== 'pending').slice(0, 10);

  const pendingCard = (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-5 py-3.5 border-b border-slate-100 flex items-center gap-2">
        <UserCog size={15} className="text-slate-400" />
        <h2 className="font-bold text-[13.5px]">個人情報の変更申請</h2>
        {pending.length > 0 && <span className="ml-auto text-[11px] bg-amber-600 text-white rounded-full px-2 py-0.5 font-bold">{pending.length}</span>}
      </div>
      {pending.length === 0 ? (
        <div className="px-5 py-8 text-center text-[12.5px] text-slate-300">承認待ちの申請はありません</div>
      ) : (
        <div className="divide-y divide-slate-100">
          {pending.map((r) => (
            <div key={r.id} className="px-5 py-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[13px] font-semibold text-slate-800">{r.employeeName}</span>
                <span className="text-[10.5px] text-slate-400">{new Date(r.submittedAt).toLocaleString('ja-JP')}</span>
              </div>
              <div className="font-mono text-[12px] text-slate-600 bg-slate-50 rounded-lg px-3 py-2 mb-2 space-y-0.5">
                {Object.entries(r.requestedChanges).map(([key, value]) => (
                  <div key={key}>{PROFILE_EDITABLE_FIELDS.find((f) => f.key === key)?.label || key}：{r.originalValues?.[key] || '未設定'} → <b className="text-slate-800">{value || '未設定'}</b></div>
                ))}
              </div>
              {r.reason && <div className="text-[12px] text-slate-500 mb-2">理由：{r.reason}</div>}
              <textarea
                value={memos[r.id] ?? ''}
                onChange={(e) => setMemo(r.id, e.target.value)}
                rows={2}
                placeholder="社員に送るコメント（任意）"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[12.5px] resize-none mb-2"
              />
              <div className="flex gap-2">
                <button onClick={() => onDecide(r.id, 'rejected', memos[r.id] || '')} className="flex-1 flex items-center justify-center gap-1 py-2 rounded-lg border border-slate-200 text-[12.5px] font-medium text-slate-500">
                  <XCircle size={13} /> 却下
                </button>
                <button onClick={() => onDecide(r.id, 'approved', memos[r.id] || '')} className="flex-1 flex items-center justify-center gap-1 py-2 rounded-lg bg-emerald-600 text-white text-[12.5px] font-bold">
                  <CheckCircle2 size={13} /> 承認して反映
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const decidedCard = decided.length > 0 && (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden h-fit">
      <div className="px-5 py-3.5 border-b border-slate-100">
        <h2 className="font-bold text-[13.5px]">処理済み</h2>
      </div>
      <div className="divide-y divide-slate-100">
        {decided.map((r) => (
          <div key={r.id} className="px-5 py-2.5 text-[12.5px] flex items-center justify-between">
            <span>{r.employeeName}</span>
            <span className={`font-medium ${r.status === 'approved' ? 'text-emerald-600' : 'text-slate-400'}`}>
              {r.status === 'approved' ? '承認済み' : '却下'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );

  if (isDesktop) {
    return <div className="grid grid-cols-2 gap-5 items-start">{pendingCard}{decidedCard}</div>;
  }
  return <div className="space-y-5">{pendingCard}{decidedCard}</div>;
}

function GroupLeaveScheduleTab({ employeeAccounts, groupLeaveSchedules, onSave, isDesktop }) {
  const existingGroups = Array.from(new Set(employeeAccounts.map((a) => a.mainGroup).filter(Boolean)));
  const knownGroups = Array.from(new Set([...existingGroups, ...Object.keys(groupLeaveSchedules || {})]));
  const [selectedGroup, setSelectedGroup] = useState(knownGroups[0] || '');
  const [newGroupName, setNewGroupName] = useState('');
  const [months, setMonths] = useState(() => {
    const initial = {};
    for (let m = 1; m <= 12; m++) initial[m] = String((groupLeaveSchedules?.[knownGroups[0]] || {})[m] || 0);
    return initial;
  });

  const loadGroup = (groupName) => {
    setSelectedGroup(groupName);
    const m = {};
    for (let i = 1; i <= 12; i++) m[i] = String((groupLeaveSchedules?.[groupName] || {})[i] || 0);
    setMonths(m);
  };

  const setMonth = (m) => (e) => setMonths((prev) => ({ ...prev, [m]: e.target.value }));

  const addNewGroup = () => {
    const name = newGroupName.trim();
    if (!name) return;
    setNewGroupName('');
    loadGroup(name);
  };

  const total = Object.values(months).reduce((sum, v) => sum + (Number(v) || 0), 0);

  const save = () => {
    if (!selectedGroup) return;
    onSave(selectedGroup, months);
  };

  return (
    <div className="space-y-5">
      <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-[11.5px] text-blue-800">
        メイングループごとに、月ごとの「出勤規定日数」（所定労働日数）を設定できます。ここで設定した日数は、そのグループに所属する社員の月給日割り計算（給与タブ）に使われます。グループを設定していない社員は、社員アカウント編集画面の「グループ」タブで個人別に出勤規定日数を入力してください。
      </div>

      <div className={isDesktop ? 'grid grid-cols-[240px_1fr] gap-5 items-start' : 'space-y-4'}>
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 text-[12px] font-bold text-slate-500">グループ一覧</div>
          <div className="divide-y divide-slate-100 max-h-64 overflow-y-auto">
            {knownGroups.length === 0 && <div className="px-4 py-6 text-center text-[12px] text-slate-300">グループがまだありません</div>}
            {knownGroups.map((g) => (
              <button
                key={g}
                onClick={() => loadGroup(g)}
                className={`w-full text-left px-4 py-2.5 text-[13px] ${selectedGroup === g ? 'bg-slate-800 text-white font-bold' : 'text-slate-700 hover:bg-slate-50'}`}
              >
                {g}
              </button>
            ))}
          </div>
          <div className="p-3 border-t border-slate-100 flex gap-2">
            <input value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} placeholder="新しいグループ名" className="flex-1 border border-slate-200 rounded-lg px-2.5 py-1.5 text-[12.5px]" />
            <button onClick={addNewGroup} className="text-[12px] font-bold text-amber-600 shrink-0">追加</button>
          </div>
        </div>

        {selectedGroup ? (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-100">
              <h2 className="font-bold text-[14px] text-slate-800">{selectedGroup}</h2>
              <p className="text-[11px] text-slate-400 mt-0.5">月ごとの出勤規定日数（年間合計 {total}日）</p>
            </div>
            <div className="p-5 grid grid-cols-3 sm:grid-cols-4 gap-3">
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <Field key={m} label={`${m}月`}>
                  <input type="number" step="0.5" value={months[m]} onChange={setMonth(m)} className="w-full border border-slate-200 rounded-lg px-2.5 py-2 font-mono text-[13px]" />
                </Field>
              ))}
            </div>
            <div className="px-5 pb-5">
              <button onClick={save} className="w-full py-2.5 rounded-lg bg-slate-800 text-white text-[13px] font-bold">この内容で保存する</button>
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm px-6 py-14 text-center text-[12.5px] text-slate-300">
            左のリストからグループを選ぶか、新しいグループ名を追加してください
          </div>
        )}
      </div>
    </div>
  );
}

function AdminPermissionsTab({ adminAccounts, currentUserId, onUpdateAccess, onResetPassword, isDesktop }) {
  const [resetTarget, setResetTarget] = useState(null);

  const roleLabel = (role) => (role === 'master_admin' ? 'マスター管理者' : '管理者');

  const changeRole = (acc, newRole) => {
    const patch = { role: newRole };
    if (newRole === 'admin' && (!acc.adminPermissions || acc.adminPermissions.length === 0)) {
      patch.adminPermissions = ['attendance', 'labor', 'hr', 'payroll'];
    }
    onUpdateAccess(acc.id, patch);
  };

  const togglePermission = (acc, key) => {
    const current = acc.adminPermissions || [];
    const next = current.includes(key) ? current.filter((k) => k !== key) : [...current, key];
    onUpdateAccess(acc.id, { adminPermissions: next });
  };

  return (
    <div className="space-y-5">
      <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-[11.5px] text-blue-800 flex items-start gap-2">
        <ShieldCheck size={14} className="mt-0.5 shrink-0" />
        <span>マスター管理者は常に全タブを利用できます（権限の変更はできません）。「管理者」は、チェックしたタブのみ利用できます。役割・権限の変更はマスター管理者のみ行えます。</span>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-100 flex items-center gap-2">
          <UserCog size={15} className="text-slate-400" />
          <h2 className="font-bold text-[13.5px]">管理者アカウント</h2>
          <span className="text-[11px] text-slate-400">{adminAccounts.length}名</span>
        </div>
        <div className="divide-y divide-slate-100">
          {adminAccounts.map((acc) => {
            const isMaster = acc.role === 'master_admin';
            const isSelf = acc.id === currentUserId;
            return (
              <div key={acc.id} className="px-5 py-4">
                <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                  <div>
                    <div className="text-[13px] font-semibold text-slate-800 flex items-center gap-1.5">
                      {acc.name}
                      {isSelf && <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">自分</span>}
                    </div>
                    <div className="text-[11px] text-slate-400 font-mono">ID: {acc.username}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      value={acc.role}
                      onChange={(e) => changeRole(acc, e.target.value)}
                      disabled={isSelf}
                      className={`text-[12px] font-bold border rounded-lg px-2.5 py-1.5 ${isMaster ? 'bg-amber-50 border-amber-200 text-amber-700' : 'bg-slate-50 border-slate-200 text-slate-600'}`}
                    >
                      <option value="admin">管理者</option>
                      <option value="master_admin">マスター管理者</option>
                    </select>
                    <button onClick={() => setResetTarget(acc)} className="text-slate-400 hover:text-amber-600 p-1.5 border border-slate-200 rounded-lg"><Key size={14} /></button>
                  </div>
                </div>
                {isMaster ? (
                  <div className="text-[11.5px] text-amber-700 bg-amber-50 rounded-lg px-3 py-2">全タブ利用可能（制限なし）</div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {ADMIN_TAB_OPTIONS.map((opt) => (
                      <label key={opt.key} className="flex items-center gap-2 text-[12.5px] text-slate-600 border border-slate-200 rounded-lg px-3 py-2">
                        <input
                          type="checkbox"
                          checked={(acc.adminPermissions || []).includes(opt.key)}
                          onChange={() => togglePermission(acc, opt.key)}
                        />
                        {opt.label}
                      </label>
                    ))}
                  </div>
                )}
                {isSelf && (
                  <div className="text-[10.5px] text-slate-400 mt-2">自分自身の役割は変更できません（誤って権限を失わないための制限です）。</div>
                )}
              </div>
            );
          })}
          {adminAccounts.length === 0 && (
            <div className="px-5 py-10 text-center text-[12.5px] text-slate-300">管理者アカウントがありません</div>
          )}
        </div>
      </div>

      {resetTarget && (
        <ResetPasswordModal
          account={resetTarget}
          onClose={() => setResetTarget(null)}
          onConfirm={async (newPassword) => {
            const ok = await onResetPassword(resetTarget, newPassword);
            if (ok) setResetTarget(null);
          }}
        />
      )}
    </div>
  );
}

function AdminAuditLogTab({ logs, isDesktop }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-5 py-3.5 border-b border-slate-100 flex items-center gap-2">
        <ListChecks size={15} className="text-slate-400" />
        <h2 className="font-bold text-[13.5px]">監査ログ</h2>
        <span className="text-[11px] text-slate-400">直近{logs.length}件</span>
      </div>
      {logs.length === 0 ? (
        <div className="px-5 py-14 text-center text-[12.5px] text-slate-300">まだ記録がありません</div>
      ) : isDesktop ? (
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="text-left text-[10.5px] text-slate-400 border-b border-slate-100">
              <th className="px-5 py-2 font-medium">日時</th>
              <th className="px-5 py-2 font-medium">操作者</th>
              <th className="px-5 py-2 font-medium">操作内容</th>
              <th className="px-5 py-2 font-medium">対象社員</th>
              <th className="px-5 py-2 font-medium">詳細</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.id} className="border-b border-slate-100 last:border-0">
                <td className="px-5 py-2.5 font-mono text-slate-500 whitespace-nowrap">{new Date(l.createdAt).toLocaleString('ja-JP')}</td>
                <td className="px-5 py-2.5 font-semibold text-slate-700 whitespace-nowrap">{l.actorName || '—'}</td>
                <td className="px-5 py-2.5 whitespace-nowrap">{l.action}</td>
                <td className="px-5 py-2.5 whitespace-nowrap">{l.targetEmployeeName || '—'}</td>
                <td className="px-5 py-2.5 text-slate-500">{l.detail || ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="divide-y divide-slate-100">
          {logs.map((l) => (
            <div key={l.id} className="px-5 py-3">
              <div className="flex items-center justify-between">
                <span className="text-[12.5px] font-bold text-slate-800">{l.action}</span>
                <span className="text-[10px] text-slate-300 font-mono">{new Date(l.createdAt).toLocaleString('ja-JP')}</span>
              </div>
              <div className="text-[11.5px] text-slate-500 mt-0.5">
                {l.actorName || '—'}{l.targetEmployeeName ? ` → ${l.targetEmployeeName}` : ''}
              </div>
              {l.detail && <div className="text-[11px] text-slate-400 mt-0.5">{l.detail}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const ADMIN_TAB_OPTIONS = [
  { key: 'attendance', label: '勤怠' },
  { key: 'labor', label: '労務' },
  { key: 'hr', label: '人材' },
  { key: 'payroll', label: '給与' },
];

function AccountManagement({ employeeAccounts, onAddAccount, onUpdateDates, onDeleteAccount, onResetPassword, onFetchMyNumber, onSaveMyNumber, groupLeaveSchedules, employeeAttendanceSchedules, onSaveEmployeeAttendance, session, isDesktop }) {
  const knownGroups = Array.from(new Set([...employeeAccounts.map((a) => a.mainGroup).filter(Boolean), ...Object.keys(groupLeaveSchedules || {})]));
  const [listGroupFilter, setListGroupFilter] = useState('all');
  const [listStaffTypeFilter, setListStaffTypeFilter] = useState('all');
  const [listNameQuery, setListNameQuery] = useState('');
  const [listStatusFilter, setListStatusFilter] = useState('active'); // all | active | retired
  const [listSort, setListSort] = useState('name'); // name | hireDateDesc | hireDateAsc
  const [sei, setSei] = useState('');
  const [mei, setMei] = useState('');
  const [seiKana, setSeiKana] = useState('');
  const [meiKana, setMeiKana] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [hireDate, setHireDate] = useState(todayKey());
  const [role, setRole] = useState('employee');
  const [adminPermissions, setAdminPermissions] = useState(['attendance', 'labor', 'hr', 'payroll']);
  const [showForm, setShowForm] = useState(false);
  const [profileModalAccount, setProfileModalAccount] = useState(null);
  const [csvModalOpen, setCsvModalOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [resetPasswordTarget, setResetPasswordTarget] = useState(null);
  const isMasterAdmin = session?.role === 'master_admin';

  const canSubmit = sei.trim() && mei.trim() && username.trim() && password.trim().length >= 6 && hireDate;

  const filteredEmployeeAccounts = employeeAccounts
    .filter((acc) => {
      if (listGroupFilter !== 'all' && acc.mainGroup !== listGroupFilter) return false;
      if (listStaffTypeFilter !== 'all' && acc.staffType !== listStaffTypeFilter) return false;
      if (listStatusFilter === 'active' && acc.resignationDate) return false;
      if (listStatusFilter === 'retired' && !acc.resignationDate) return false;
      const q = listNameQuery.trim();
      if (q && !((acc.name || '').includes(q) || (acc.furigana || '').includes(q))) return false;
      return true;
    })
    .sort((a, b) => {
      if (listSort === 'hireDateDesc') return (b.hireDate || '').localeCompare(a.hireDate || '');
      if (listSort === 'hireDateAsc') return (a.hireDate || '').localeCompare(b.hireDate || '');
      return (a.name || '').localeCompare(b.name || '', 'ja');
    });

  const toggleAdminPermission = (key) => {
    setAdminPermissions((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    const trimmedUsername = username.trim();
    const ok = await onAddAccount({
      name: `${sei.trim()} ${mei.trim()}`,
      furigana: [seiKana.trim(), meiKana.trim()].filter(Boolean).join(' '),
      username: trimmedUsername,
      password: password.trim(),
      hireDate,
      role,
      adminPermissions: role === 'admin' ? adminPermissions : undefined,
      // ユーザー名がメールアドレス形式の場合は、連絡用メールアドレスにも自動で反映する
      contactEmail: trimmedUsername.includes('@') ? trimmedUsername : undefined,
    });
    if (ok) {
      setSei('');
      setMei('');
      setSeiKana('');
      setMeiKana('');
      setUsername('');
      setPassword('');
      setHireDate(todayKey());
      setRole('employee');
      setAdminPermissions(['attendance', 'labor', 'hr', 'payroll']);
      setShowForm(false);
    }
  };

  const listCard = (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
      <div className="px-5 py-3.5 border-b border-slate-100 flex items-center gap-2 flex-wrap">
        <Users size={15} className="text-slate-400" />
        <h2 className="font-bold text-[13.5px]">社員一覧</h2>
        <span className="text-[11px] text-slate-400">{filteredEmployeeAccounts.length}名 / 全{employeeAccounts.length}名</span>
        <button onClick={() => setCsvModalOpen(true)} className="ml-auto flex items-center gap-1 text-[12px] font-bold text-slate-500 border border-slate-200 rounded-lg px-2.5 py-1.5">
          <Download size={13} className="rotate-180" /> CSV一括登録
        </button>
        {!isDesktop && (
          <button onClick={() => setShowForm((v) => !v)} className="flex items-center gap-1 text-[12px] font-bold text-amber-600">
            <UserPlus size={14} /> 追加
          </button>
        )}
      </div>

      <div className="px-5 py-3.5 border-b border-slate-100 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
        <Field label="氏名で検索">
          <input value={listNameQuery} onChange={(e) => setListNameQuery(e.target.value)} placeholder="1文字から絞り込み" className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-[12.5px]" />
        </Field>
        {knownGroups.length > 0 && (
          <Field label="所属グループ">
            <select value={listGroupFilter} onChange={(e) => setListGroupFilter(e.target.value)} className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-[12.5px] bg-white">
              <option value="all">全て</option>
              {knownGroups.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </Field>
        )}
        <Field label="スタッフ種別">
          <select value={listStaffTypeFilter} onChange={(e) => setListStaffTypeFilter(e.target.value)} className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-[12.5px] bg-white">
            <option value="all">全て</option>
            <option value="役員">役員</option>
            <option value="社員">社員</option>
            <option value="契約社員">契約社員</option>
            <option value="パート">パート</option>
            <option value="アルバイト">アルバイト</option>
          </select>
        </Field>
        <Field label="在籍・退職">
          <select value={listStatusFilter} onChange={(e) => setListStatusFilter(e.target.value)} className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-[12.5px] bg-white">
            <option value="active">在籍のみ</option>
            <option value="retired">退職のみ</option>
            <option value="all">全て</option>
          </select>
        </Field>
        <Field label="並び順">
          <select value={listSort} onChange={(e) => setListSort(e.target.value)} className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-[12.5px] bg-white">
            <option value="name">氏名順</option>
            <option value="hireDateDesc">入職日が新しい順</option>
            <option value="hireDateAsc">入職日が古い順</option>
          </select>
        </Field>
      </div>
      {isDesktop ? (
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left text-[11px] text-slate-400 border-b border-slate-100">
              <th className="px-5 py-2 font-medium">氏名</th>
              <th className="px-5 py-2 font-medium">雇用形態</th>
              <th className="px-5 py-2 font-medium"></th>
              <th className="px-5 py-2 font-medium"></th>
              <th className="px-5 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {filteredEmployeeAccounts.map((acc) => {
              const retired = !!acc.resignationDate;
              return (
                <tr key={acc.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-5 py-2.5 font-semibold text-slate-800 cursor-pointer hover:text-amber-700" onClick={() => setProfileModalAccount(acc)}>
                    {acc.name}
                    {retired && <span className="ml-1.5 text-[10px] font-bold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">退職済み</span>}
                    {acc.furigana && <div className="text-[10.5px] font-normal text-slate-400">{acc.furigana}</div>}
                  </td>
                  <td className="px-5 py-2.5 text-slate-600">{acc.staffType || '社員'}</td>
                  <td className="px-5 py-2.5"><button onClick={() => setProfileModalAccount(acc)} className="text-[11px] font-bold text-slate-500 border border-slate-200 rounded-md px-2 py-1">詳細</button></td>
                  <td className="px-5 py-2.5"><button onClick={() => setResetPasswordTarget(acc)} className="text-slate-300 hover:text-amber-600" title="パスワードリセット"><Key size={14} /></button></td>
                  <td className="px-5 py-2.5"><button onClick={() => setDeleteTarget(acc)} className="text-slate-300 hover:text-rose-500"><Trash2 size={14} /></button></td>
                </tr>
              );
            })}
            {filteredEmployeeAccounts.length === 0 && (
              <tr><td colSpan={5} className="px-5 py-8 text-center text-[12.5px] text-slate-300">該当する社員がいません</td></tr>
            )}
          </tbody>
        </table>
      ) : (
        <div className="divide-y divide-slate-100">
          {filteredEmployeeAccounts.map((acc) => {
            const retired = !!acc.resignationDate;
            return (
              <div key={acc.id} className="px-5 py-3.5">
                <div className="flex items-center justify-between">
                  <div className="cursor-pointer" onClick={() => setProfileModalAccount(acc)}>
                    <div className="text-[13px] font-semibold text-slate-800 flex items-center gap-1.5">
                      {acc.name}
                      {retired && <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">退職済み</span>}
                    </div>
                    {acc.furigana && <div className="text-[10.5px] text-slate-400">{acc.furigana}</div>}
                    <div className="text-[11.5px] text-slate-500 mt-0.5">{acc.staffType || '社員'}</div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => setProfileModalAccount(acc)} className="text-[11px] font-bold text-slate-500 border border-slate-200 rounded-md px-2 py-1">詳細</button>
                    <button onClick={() => setResetPasswordTarget(acc)} className="text-slate-300 hover:text-amber-600 p-1"><Key size={14} /></button>
                    <button onClick={() => setDeleteTarget(acc)} className="text-slate-300 hover:text-rose-500 p-1"><Trash2 size={14} /></button>
                  </div>
                </div>
              </div>
            );
          })}
          {filteredEmployeeAccounts.length === 0 && (
            <div className="px-5 py-8 text-center text-[12.5px] text-slate-300">該当する社員がいません</div>
          )}
        </div>
      )}
    </div>
  );

  const formCard = (showForm || isDesktop) && (
    <form onSubmit={submit} className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 space-y-3.5 h-fit">
      <h3 className="font-bold text-[13.5px] mb-1">新しい社員アカウントを作成</h3>
      <div className="grid grid-cols-2 gap-3">
        <Field label="姓">
          <input value={sei} onChange={(e) => setSei(e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[14px]" placeholder="例）田中" />
        </Field>
        <Field label="名">
          <input value={mei} onChange={(e) => setMei(e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[14px]" placeholder="例）花子" />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="せい（ふりがな）">
          <input value={seiKana} onChange={(e) => setSeiKana(e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[14px]" placeholder="例）たなか" />
        </Field>
        <Field label="めい（ふりがな）">
          <input value={meiKana} onChange={(e) => setMeiKana(e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[14px]" placeholder="例）はなこ" />
        </Field>
      </div>
      <Field label="ユーザー名（ログインID・メールアドレス）">
        <input value={username} onChange={(e) => setUsername(e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 font-mono text-[14px]" placeholder="tanaka（または example@ezweb.ne.jp）" />
        <div className="text-[10.5px] text-slate-400 mt-1">短いID（例：tanaka）でも、実際のメールアドレスでもログイン用に使えます。メールアドレスの場合、連絡用メールアドレスにも自動で設定されます。</div>
      </Field>
      <Field label="パスワード（6文字以上）">
        <input type="text" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 font-mono text-[14px]" placeholder="仮パスワードを入力" />
      </Field>
      <Field label="入職日">
        <input type="date" value={hireDate} onChange={(e) => setHireDate(e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 font-mono text-[14px]" />
      </Field>
      {isMasterAdmin && (
        <>
          <Field label="役割">
            <select value={role} onChange={(e) => setRole(e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[14px] bg-white">
              <option value="employee">社員</option>
              <option value="admin">管理者</option>
              <option value="master_admin">マスター管理者</option>
            </select>
          </Field>
          {role === 'admin' && (
            <Field label="利用できるタブ（権限）">
              <div className="grid grid-cols-2 gap-2">
                {ADMIN_TAB_OPTIONS.map((opt) => (
                  <label key={opt.key} className="flex items-center gap-2 text-[13px] text-slate-600 border border-slate-200 rounded-lg px-3 py-2">
                    <input type="checkbox" checked={adminPermissions.includes(opt.key)} onChange={() => toggleAdminPermission(opt.key)} />
                    {opt.label}
                  </label>
                ))}
              </div>
            </Field>
          )}
        </>
      )}
      <button type="submit" disabled={!canSubmit} className="w-full py-2.5 rounded-lg bg-slate-800 disabled:bg-slate-200 text-white text-[13.5px] font-bold">
        アカウントを作成
      </button>
    </form>
  );

  const disclaimer = (
    <div className="space-y-2">
      <div className="flex items-start gap-2 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-[11.5px] text-blue-800">
        <Calendar size={14} className="mt-0.5 shrink-0" />
        <span>法定有休は、入職日から週5日フルタイム勤務を前提とした労働基準法の付与スケジュール（勤続6ヶ月で10日〜6年6ヶ月以降20日）に基づき自動計算されます。パート・時短勤務者の比例付与や繰越・時効の管理には対応していないため、正確な運用には社労士への確認をおすすめします。</span>
      </div>
      <div className="flex items-start gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 text-[11.5px] text-emerald-800">
        <Lock size={14} className="mt-0.5 shrink-0" />
        <span>パスワードはSupabase Authが管理しており、アプリ側では平文はもちろんハッシュ値も保持していません。</span>
      </div>
    </div>
  );

  const modals = (
    <>
      {profileModalAccount && (
        <EmployeeProfileModal
          account={profileModalAccount}
          onClose={() => setProfileModalAccount(null)}
          onSave={onUpdateDates}
          onFetchMyNumber={onFetchMyNumber}
          onSaveMyNumber={onSaveMyNumber}
          isMasterAdmin={isMasterAdmin}
          knownGroups={knownGroups}
          groupAttendanceSchedules={groupLeaveSchedules}
          employeeAttendanceSchedule={employeeAttendanceSchedules?.[profileModalAccount.id] || {}}
          onSaveEmployeeAttendance={onSaveEmployeeAttendance}
        />
      )}
      {csvModalOpen && (
        <CsvImportModal
          onClose={() => setCsvModalOpen(false)}
          onAddAccount={onAddAccount}
        />
      )}
      {deleteTarget && (
        <DeleteAccountModal
          account={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onConfirm={async () => {
            const ok = await onDeleteAccount(deleteTarget);
            if (ok) setDeleteTarget(null);
          }}
        />
      )}
      {resetPasswordTarget && (
        <ResetPasswordModal
          account={resetPasswordTarget}
          onClose={() => setResetPasswordTarget(null)}
          onConfirm={async (newPassword) => {
            const ok = await onResetPassword(resetPasswordTarget, newPassword);
            if (ok) setResetPasswordTarget(null);
          }}
        />
      )}
    </>
  );

  if (isDesktop) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-[1fr_320px] gap-5 items-start">
          {listCard}
          {formCard}
        </div>
        {disclaimer}
        {modals}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {listCard}
      {formCard}
      {disclaimer}
      {modals}
    </div>
  );
}

function ResetPasswordModal({ account, onClose, onConfirm }) {
  const [newPassword, setNewPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const canSubmit = newPassword.trim().length >= 6;

  const run = async () => {
    setSaving(true);
    await onConfirm(newPassword.trim());
    setSaving(false);
  };

  return createPortal(
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-sm max-h-[92vh] overflow-y-auto">
        <div className="px-5 pt-5 pb-3 border-b border-slate-100 flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-amber-50 flex items-center justify-center shrink-0">
            <Key size={16} className="text-amber-600" />
          </div>
          <h3 className="font-bold text-[15px]">パスワードをリセット</h3>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div className="text-[12.5px] text-slate-500">{account.name}（ID: {account.username}）の新しいパスワードを設定します。</div>
          <Field label="新しいパスワード（6文字以上）">
            <input type="text" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="新しいパスワードを入力" className="w-full border border-slate-200 rounded-lg px-3 py-2 font-mono text-[14px]" />
          </Field>
          <div className="text-[11px] text-slate-400">設定後、このパスワードをご本人に直接お伝えください（画面には再表示されません）。</div>
        </div>
        <div className="px-5 pb-5 pt-1 flex gap-2">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-lg border border-slate-200 text-[13.5px] font-medium text-slate-500">キャンセル</button>
          <button onClick={run} disabled={!canSubmit || saving} className="flex-1 py-2.5 rounded-lg bg-amber-600 disabled:bg-slate-200 text-white text-[13.5px] font-bold">
            {saving ? '設定中…' : 'リセットする'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function DeleteAccountModal({ account, onClose, onConfirm }) {
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const canDelete = confirmText === account.name;

  const run = async () => {
    setDeleting(true);
    await onConfirm();
    setDeleting(false);
  };

  return createPortal(
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-sm max-h-[92vh] overflow-y-auto">
        <div className="px-5 pt-5 pb-3 border-b border-slate-100 flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-rose-50 flex items-center justify-center shrink-0">
            <Trash2 size={16} className="text-rose-600" />
          </div>
          <h3 className="font-bold text-[15px]">アカウントを削除しますか？</h3>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div className="bg-rose-50 border border-rose-200 rounded-lg px-3 py-3 text-[12.5px] text-rose-700">
            <p className="font-bold mb-1">{account.name}（ID: {account.username}）を削除します。</p>
            <p>この操作は元に戻せません。この社員の勤怠記録・申請・給与明細などのデータもすべて削除されます。</p>
          </div>
          <Field label={`確認のため「${account.name}」と入力してください`}>
            <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[14px]" />
          </Field>
          <div className="text-[11px] text-slate-400">データを残したまま利用停止にしたい場合は、削除ではなく「詳細」から退職日を設定することもできます。</div>
        </div>
        <div className="px-5 pb-5 pt-1 flex gap-2">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-lg border border-slate-200 text-[13.5px] font-medium text-slate-500">キャンセル</button>
          <button onClick={run} disabled={!canDelete || deleting} className="flex-1 py-2.5 rounded-lg bg-rose-600 disabled:bg-slate-200 text-white text-[13.5px] font-bold">
            {deleting ? '削除中…' : '完全に削除する'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function CsvImportModal({ onClose, onAddAccount }) {
  const [csvText, setCsvText] = useState('name,username,password,hireDate\n田中 花子,tanaka,pass1234,2026-08-01');
  const [rows, setRows] = useState([]);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState([]);

  const parse = () => {
    const lines = csvText.trim().split('\n').filter((l) => l.trim());
    if (lines.length < 2) {
      setRows([]);
      return;
    }
    const header = lines[0].split(',').map((h) => h.trim());
    const idx = {
      name: header.indexOf('name'),
      username: header.indexOf('username'),
      password: header.indexOf('password'),
      hireDate: header.indexOf('hireDate'),
    };
    if (idx.name < 0 || idx.username < 0 || idx.password < 0) {
      setRows([]);
      return;
    }
    const parsed = lines.slice(1).map((line) => {
      const cols = line.split(',').map((c) => c.trim());
      return {
        name: cols[idx.name] || '',
        username: cols[idx.username] || '',
        password: cols[idx.password] || '',
        hireDate: idx.hireDate >= 0 ? cols[idx.hireDate] || todayKey() : todayKey(),
      };
    }).filter((r) => r.name && r.username && r.password);
    setRows(parsed);
    setResults([]);
  };

  const runImport = async () => {
    setRunning(true);
    const nextResults = [];
    for (const row of rows) {
      const ok = await onAddAccount(row);
      nextResults.push({ ...row, ok });
    }
    setResults(nextResults);
    setRunning(false);
  };

  return createPortal(
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-40 p-0 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[92vh] overflow-y-auto">
        <div className="px-5 pt-5 pb-3 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white">
          <h3 className="font-bold text-[15px]">CSVで社員を一括登録</h3>
          <button onClick={onClose} className="text-slate-400 text-xl leading-none px-1">×</button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div className="text-[11.5px] text-slate-500 bg-slate-50 rounded-lg p-3">
            1行目は見出し（<code className="font-mono">name,username,password,hireDate</code>）にしてください。<br />
            2行目以降に1人ずつ、カンマ区切りで入力します。<code className="font-mono">hireDate</code>は省略可（形式：YYYY-MM-DD）。パスワードは6文字以上にしてください。
          </div>
          <textarea
            value={csvText}
            onChange={(e) => { setCsvText(e.target.value); setRows([]); setResults([]); }}
            rows={8}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 font-mono text-[12.5px] resize-none"
          />
          <button onClick={parse} className="text-[12px] font-bold text-slate-600 border border-slate-200 rounded-lg px-3 py-1.5">
            内容を確認する
          </button>

          {rows.length > 0 && results.length === 0 && (
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <div className="px-3 py-2 bg-slate-50 text-[11.5px] font-bold text-slate-600">{rows.length}名を登録します</div>
              <div className="divide-y divide-slate-100 max-h-48 overflow-y-auto">
                {rows.map((r, i) => (
                  <div key={i} className="px-3 py-1.5 text-[12px] flex items-center justify-between">
                    <span>{r.name}</span>
                    <span className="font-mono text-slate-400">{r.username}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {results.length > 0 && (
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <div className="px-3 py-2 bg-slate-50 text-[11.5px] font-bold text-slate-600">
                結果：成功 {results.filter((r) => r.ok).length}件 ／ 失敗 {results.filter((r) => !r.ok).length}件
              </div>
              <div className="divide-y divide-slate-100 max-h-48 overflow-y-auto">
                {results.map((r, i) => (
                  <div key={i} className="px-3 py-1.5 text-[12px] flex items-center justify-between">
                    <span>{r.name}（{r.username}）</span>
                    <span className={`font-bold ${r.ok ? 'text-emerald-600' : 'text-rose-600'}`}>{r.ok ? '成功' : '失敗'}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="px-5 pb-5 pt-1 flex gap-2 sticky bottom-0 bg-white">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-lg border border-slate-200 text-[13.5px] font-medium text-slate-500">閉じる</button>
          <button
            onClick={runImport}
            disabled={rows.length === 0 || running}
            className="flex-1 py-2.5 rounded-lg bg-slate-800 disabled:bg-slate-300 text-white text-[13.5px] font-bold"
          >
            {running ? '登録中…' : `${rows.length || ''}名を登録する`}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

const PROFILE_MODAL_TABS = [
  { key: 'basic', label: '基本' },
  { key: 'group', label: 'グループ' },
  { key: 'work', label: '業務・契約' },
  { key: 'pay', label: '給与・口座' },
  { key: 'insurance', label: '社会保険' },
  { key: 'family', label: '家族・配偶者' },
  { key: 'tax', label: '住民税・税区分' },
];

function EmployeeProfileModal({ account, onClose, onSave, onFetchMyNumber, onSaveMyNumber, isMasterAdmin, knownGroups = [], groupAttendanceSchedules = {}, employeeAttendanceSchedule = {}, onSaveEmployeeAttendance }) {
  const [activeTab, setActiveTab] = useState('basic');
  const containerRef = useRef(null);
  const sectionRefs = useRef({});
  const SCROLL_OFFSET = 118; // ヘッダー＋タブバーの高さ分オフセット

  // スクロール位置に応じて、今見えているセクションのタブを自動でハイライト
  const handleScroll = () => {
    if (activeTab === 'mynumber') return;
    const container = containerRef.current;
    if (!container) return;
    const scrollTop = container.scrollTop;
    let current = PROFILE_MODAL_TABS[0].key;
    for (const t of PROFILE_MODAL_TABS) {
      const el = sectionRefs.current[t.key];
      if (el && el.offsetTop - SCROLL_OFFSET <= scrollTop) {
        current = t.key;
      }
    }
    setActiveTab(current);
  };

  // タブを押したら、対応するセクションへスクロール（マイナンバーのみ通常のタブ切り替え）
  const goToTab = (key) => {
    if (key === 'mynumber') {
      setActiveTab('mynumber');
      return;
    }
    if (activeTab === 'mynumber') setActiveTab(key);
    const el = sectionRefs.current[key];
    const container = containerRef.current;
    if (el && container) {
      container.scrollTo({ top: el.offsetTop - SCROLL_OFFSET, behavior: 'smooth' });
    }
  };
  const [personalMonths, setPersonalMonths] = useState(() => {
    const initial = {};
    for (let m = 1; m <= 12; m++) initial[m] = String(employeeAttendanceSchedule[m] || 0);
    return initial;
  });
  const [savingAttendance, setSavingAttendance] = useState(false);
  const setPersonalMonth = (m) => (e) => setPersonalMonths((prev) => ({ ...prev, [m]: e.target.value }));
  const savePersonalAttendance = async () => {
    setSavingAttendance(true);
    await onSaveEmployeeAttendance(account.id, personalMonths);
    setSavingAttendance(false);
  };
  const [form, setForm] = useState({
    furigana: account.furigana || '',
    contactEmail: account.contactEmail || '',
    staffNumber: account.staffNumber || '',
    hireDate: account.hireDate || '',
    resignationDate: account.resignationDate || '',
    address: account.address || '',
    phone: account.phone || '',
    emergencyContactName: account.emergencyContactName || '',
    emergencyContactPhone: account.emergencyContactPhone || '',
    birthDate: account.birthDate || '',
    staffType: account.staffType || '社員',
    mainGroup: account.mainGroup || '',
    subGroup: account.subGroup || '',
    commuteAllowance: String(account.commuteAllowance || 0),
    deemedOvertimeHours: account.deemedOvertimeHours != null ? String(account.deemedOvertimeHours) : '',
    nearestStation: account.nearestStation || '',
    staffNote1: account.staffNote1 || '',
    staffNote2: account.staffNote2 || '',
    staffNote3: account.staffNote3 || '',
    leaveAdjustment: String(account.leaveAdjustment || 0),
    scheduledWeeklyDays: account.scheduledWeeklyDays != null ? String(account.scheduledWeeklyDays) : '',
    jobTitle: account.jobTitle || '',
    contractStart: account.contractStart || '',
    contractEnd: account.contractEnd || '',
    bankCode: account.bankCode || '',
    bankName: account.bankName || '',
    branchCode: account.branchCode || '',
    branchName: account.branchName || '',
    accountType: account.accountType || '普通',
    accountHolder: account.accountHolder || '',
    accountNumber: account.accountNumber || '',
    standardRemunerationHealth: account.standardRemunerationHealth != null ? String(account.standardRemunerationHealth) : '',
    standardRemunerationPension: account.standardRemunerationPension != null ? String(account.standardRemunerationPension) : '',
    healthInsuranceStatus: account.healthInsuranceStatus || '未加入',
    healthInsuranceNumber: account.healthInsuranceNumber || '',
    healthInsuranceAcquiredDate: account.healthInsuranceAcquiredDate || '',
    healthInsuranceLostDate: account.healthInsuranceLostDate || '',
    pensionStatus: account.pensionStatus || '未加入',
    pensionBasicNumber: account.pensionBasicNumber || '',
    pensionAcquiredDate: account.pensionAcquiredDate || '',
    pensionLostDate: account.pensionLostDate || '',
    employmentInsuranceStatus: account.employmentInsuranceStatus || '未加入',
    employmentInsuranceNumber: account.employmentInsuranceNumber || '',
    employmentInsuranceAcquiredDate: account.employmentInsuranceAcquiredDate || '',
    employmentInsuranceLostDate: account.employmentInsuranceLostDate || '',
    spouseStatus: account.spouseStatus || '無',
    spouseAnnualIncome: account.spouseAnnualIncome != null ? String(account.spouseAnnualIncome) : '',
    spouseMonthlyIncome: account.spouseMonthlyIncome != null ? String(account.spouseMonthlyIncome) : '',
    familyMembers: account.familyMembers || [],
    residentTaxMunicipalityCode: account.residentTaxMunicipalityCode || '',
    residentTaxMunicipality: account.residentTaxMunicipality || '',
    residentTaxCollectionMethod: account.residentTaxCollectionMethod || '特別徴収',
    taxTableType: account.taxTableType || '甲欄',
    isNonResident: !!account.isNonResident,
    disabilityClassification: account.disabilityClassification || '対象外',
    isWorkingStudent: !!account.isWorkingStudent,
    singleParentClassification: account.singleParentClassification || '対象外',
  });
  const [saving, setSaving] = useState(false);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const setCheck = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.checked }));

  const addFamilyMember = () => setForm((f) => ({ ...f, familyMembers: [...f.familyMembers, { name: '', relation: '', birthDate: '' }] }));
  const updateFamilyMember = (i, key, value) => setForm((f) => {
    const next = [...f.familyMembers];
    next[i] = { ...next[i], [key]: value };
    return { ...f, familyMembers: next };
  });
  const removeFamilyMember = (i) => setForm((f) => ({ ...f, familyMembers: f.familyMembers.filter((_, idx) => idx !== i) }));

  const save = async () => {
    setSaving(true);
    // 日付項目は空欄のままだと DB が "" を日付として受け付けずエラーになるため、null に変換する
    const DATE_FIELDS = ['birthDate', 'resignationDate', 'contractStart', 'contractEnd', 'healthInsuranceAcquiredDate', 'healthInsuranceLostDate', 'pensionAcquiredDate', 'pensionLostDate', 'employmentInsuranceAcquiredDate', 'employmentInsuranceLostDate'];
    const normalizedDates = {};
    DATE_FIELDS.forEach((k) => { normalizedDates[k] = form[k] === '' ? null : form[k]; });
    await onSave(account.id, {
      ...form,
      ...normalizedDates,
      commuteAllowance: Number(form.commuteAllowance) || 0,
      deemedOvertimeHours: form.deemedOvertimeHours === '' ? null : Number(form.deemedOvertimeHours),
      leaveAdjustment: Number(form.leaveAdjustment) || 0,
      scheduledWeeklyDays: form.scheduledWeeklyDays === '' ? null : Number(form.scheduledWeeklyDays),
      standardRemunerationHealth: form.standardRemunerationHealth === '' ? null : Number(form.standardRemunerationHealth),
      standardRemunerationPension: form.standardRemunerationPension === '' ? null : Number(form.standardRemunerationPension),
      spouseAnnualIncome: form.spouseAnnualIncome === '' ? null : Number(form.spouseAnnualIncome),
      spouseMonthlyIncome: form.spouseMonthlyIncome === '' ? null : Number(form.spouseMonthlyIncome),
    });
    setSaving(false);
    onClose();
  };

  const tabs = isMasterAdmin ? [...PROFILE_MODAL_TABS, { key: 'mynumber', label: 'マイナンバー' }] : PROFILE_MODAL_TABS;

  return createPortal(
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-40 p-0 sm:p-4">
      <div ref={containerRef} onScroll={handleScroll} className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[92vh] overflow-y-auto">
        <div className="px-5 pt-5 pb-3 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white z-10">
          <div>
            <div className="text-[11px] text-slate-400 font-medium">{account.name}</div>
            <h3 className="font-bold text-[15px]">アカウント詳細情報</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 text-xl leading-none px-1">×</button>
        </div>

        <div className="px-5 pt-3 flex items-center gap-1 flex-wrap sticky top-[57px] bg-white z-10 border-b border-slate-100 pb-2">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => goToTab(t.key)}
              className={`text-[11.5px] font-bold px-2.5 py-1.5 rounded-lg transition-colors ${activeTab === t.key ? 'bg-slate-800 text-white' : 'text-slate-500 bg-slate-100'}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="px-5 py-4 space-y-4">
          {activeTab !== 'mynumber' && (
          <>
          <div ref={(el) => (sectionRefs.current.basic = el)} className="space-y-4">
            <div className="text-[12px] font-bold text-slate-500 border-b border-slate-100 pb-2">基本</div>
              <Field label="ふりがな">
                <input value={form.furigana} onChange={set('furigana')} placeholder="例）タナカ ハナコ" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13.5px]" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="入職日">
                  <input type="date" value={form.hireDate} onChange={set('hireDate')} className="w-full border border-slate-200 rounded-lg px-3 py-2 font-mono text-[13.5px]" />
                </Field>
                <Field label="退職日（在籍中は空欄）">
                  <input type="date" value={form.resignationDate} onChange={set('resignationDate')} className="w-full border border-slate-200 rounded-lg px-3 py-2 font-mono text-[13.5px]" />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="生年月日">
                  <input type="date" value={form.birthDate} onChange={set('birthDate')} className="w-full border border-slate-200 rounded-lg px-3 py-2 font-mono text-[13.5px]" />
                </Field>
                <Field label="スタッフ種別">
                  <select value={form.staffType} onChange={set('staffType')} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13.5px] bg-white">
                    <option value="役員">役員</option>
                    <option value="社員">社員</option>
                    <option value="契約社員">契約社員</option>
                    <option value="パート">パート</option>
                    <option value="アルバイト">アルバイト</option>
                  </select>
                </Field>
              </div>
              {(form.staffType === 'パート' || form.staffType === 'アルバイト') && (
                <Field label="週の所定労働日数（比例付与の計算に使用）">
                  <select value={form.scheduledWeeklyDays} onChange={set('scheduledWeeklyDays')} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13.5px] bg-white">
                    <option value="">未設定（通常の法定計算を使用）</option>
                    <option value="4">週4日</option>
                    <option value="3">週3日</option>
                    <option value="2">週2日</option>
                    <option value="1">週1日</option>
                  </select>
                </Field>
              )}
              <div className="text-[11px] font-bold text-slate-400 pt-2">連絡先</div>
              <Field label="連絡用メールアドレス">
                <input type="email" value={form.contactEmail} onChange={set('contactEmail')} placeholder="example@brown-kyoto.com" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[14px]" />
              </Field>
              <Field label="スタッフナンバー">
                <input value={form.staffNumber} onChange={set('staffNumber')} placeholder="例）00016" className="w-full border border-slate-200 rounded-lg px-3 py-2 font-mono text-[14px]" />
              </Field>
              <Field label="住所">
                <input value={form.address} onChange={set('address')} placeholder="例）京都府京都市〇〇区..." className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[14px]" />
              </Field>
              <Field label="最寄り駅">
                <input value={form.nearestStation} onChange={set('nearestStation')} placeholder="例）京都駅" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[14px]" />
              </Field>
              <Field label="電話番号">
                <input value={form.phone} onChange={set('phone')} placeholder="例）090-1234-5678" className="w-full border border-slate-200 rounded-lg px-3 py-2 font-mono text-[14px]" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="緊急連絡先（氏名）">
                  <input value={form.emergencyContactName} onChange={set('emergencyContactName')} placeholder="例）田中 一郎" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13.5px]" />
                </Field>
                <Field label="緊急連絡先（電話）">
                  <input value={form.emergencyContactPhone} onChange={set('emergencyContactPhone')} placeholder="090-xxxx-xxxx" className="w-full border border-slate-200 rounded-lg px-3 py-2 font-mono text-[13.5px]" />
                </Field>
              </div>
              <Field label="スタッフ備考1"><input value={form.staffNote1} onChange={set('staffNote1')} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13.5px]" /></Field>
              <Field label="スタッフ備考2"><input value={form.staffNote2} onChange={set('staffNote2')} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13.5px]" /></Field>
              <Field label="スタッフ備考3"><input value={form.staffNote3} onChange={set('staffNote3')} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13.5px]" /></Field>
          </div>

          <div ref={(el) => (sectionRefs.current.group = el)} className="space-y-4 pt-1">
            <div className="text-[12px] font-bold text-slate-500 border-b border-slate-100 pb-2">グループ</div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="メイングループ">
                  <select value={form.mainGroup} onChange={set('mainGroup')} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13.5px] bg-white">
                    <option value="">グループなし（個人設定）</option>
                    {knownGroups.map((g) => <option key={g} value={g}>{g}</option>)}
                  </select>
                </Field>
                <Field label="サブグループ">
                  <input value={form.subGroup} onChange={set('subGroup')} placeholder="任意" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13.5px]" />
                </Field>
              </div>
              <div className="text-[10.5px] text-slate-400 -mt-2">
                メイングループを選択すると、そのグループに設定された「出勤規定日数」（給与タブ →出勤規定日数設定 で管理）が月給の日割り計算に使われます。一覧に無いグループ名は、先に給与タブの「出勤規定日数設定」で新規追加してください。
              </div>

              {form.mainGroup ? (
                <div className="bg-slate-50 rounded-xl p-4 space-y-2">
                  <div className="text-[12px] font-bold text-slate-600">「{form.mainGroup}」の出勤規定日数（月別・参照のみ）</div>
                  <div className="grid grid-cols-4 gap-2">
                    {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                      <div key={m} className="bg-white rounded-lg border border-slate-200 px-2 py-1.5 text-center">
                        <div className="text-[9.5px] text-slate-400">{m}月</div>
                        <div className="font-mono text-[12.5px] font-bold text-slate-700">{(groupAttendanceSchedules?.[form.mainGroup] || {})[m] || 0}</div>
                      </div>
                    ))}
                  </div>
                  <div className="text-[10.5px] text-slate-400">日数の変更は「出勤規定日数設定」タブから行ってください。</div>
                </div>
              ) : (
                <div className="bg-slate-50 rounded-xl p-4 space-y-3">
                  <div className="text-[12px] font-bold text-slate-600">個人別の出勤規定日数（月別）</div>
                  <div className="text-[10.5px] text-slate-400 -mt-1">グループ未設定のため、月ごとの出勤規定日数をここで入力してください。給与計算（月給制）で日割りの基準として使われます。</div>
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                    {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                      <Field key={m} label={`${m}月`}>
                        <input type="number" step="0.5" value={personalMonths[m]} onChange={setPersonalMonth(m)} className="w-full border border-slate-200 rounded-lg px-2.5 py-2 font-mono text-[13px] bg-white" />
                      </Field>
                    ))}
                  </div>
                  <button onClick={savePersonalAttendance} disabled={savingAttendance} className="w-full py-2.5 rounded-lg bg-slate-800 text-white text-[13px] font-bold disabled:opacity-50">
                    {savingAttendance ? '保存中…' : '出勤規定日数を保存する'}
                  </button>
                </div>
              )}
          </div>

          <div ref={(el) => (sectionRefs.current.work = el)} className="space-y-4 pt-1">
            <div className="text-[12px] font-bold text-slate-500 border-b border-slate-100 pb-2">業務・契約</div>
              <Field label="役職">
                <input value={form.jobTitle} onChange={set('jobTitle')} placeholder="例）代表取締役" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[14px]" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="契約期間（開始）">
                  <input type="date" value={form.contractStart} onChange={set('contractStart')} className="w-full border border-slate-200 rounded-lg px-3 py-2 font-mono text-[13.5px]" />
                </Field>
                <Field label="契約期間（終了・更新確認日）">
                  <input type="date" value={form.contractEnd} onChange={set('contractEnd')} className="w-full border border-slate-200 rounded-lg px-3 py-2 font-mono text-[13.5px]" />
                </Field>
              </div>
              <div className="text-[10.5px] text-slate-400">契約社員・パート・アルバイトなど、契約更新が必要な方はここに終了日を入れておくと、期限が近づいた際にダッシュボードでお知らせします。</div>
              <div className="text-[11px] font-bold text-slate-400 pt-2">勤務条件</div>
              <Field label="交通費（月額・円）">
                <input type="number" value={form.commuteAllowance} onChange={set('commuteAllowance')} placeholder="0" className="w-full border border-slate-200 rounded-lg px-3 py-2 font-mono text-[14px]" />
              </Field>
              <Field label="みなし残業時間（月あたり・時間）">
                <input type="number" step="0.5" value={form.deemedOvertimeHours} onChange={set('deemedOvertimeHours')} placeholder="未設定" className="w-full border border-slate-200 rounded-lg px-3 py-2 font-mono text-[14px]" />
              </Field>
              <Field label="有休の手動調整（日・マイナス可）">
                <input type="number" value={form.leaveAdjustment} onChange={set('leaveAdjustment')} placeholder="0" className="w-full border border-slate-200 rounded-lg px-3 py-2 font-mono text-[14px]" />
              </Field>
              <div className="text-[10.5px] text-slate-400 -mt-2">自動計算された有休日数に、この日数を加算（マイナスなら減算）します。</div>
          </div>

          <div ref={(el) => (sectionRefs.current.pay = el)} className="space-y-4 pt-1">
            <div className="text-[12px] font-bold text-slate-500 border-b border-slate-100 pb-2">給与・口座</div>
              <div className="text-[11px] font-bold text-slate-400">口座情報（給与振込先）</div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="銀行コード"><input value={form.bankCode} onChange={set('bankCode')} className="w-full border border-slate-200 rounded-lg px-3 py-2 font-mono text-[13.5px]" /></Field>
                <Field label="銀行名"><input value={form.bankName} onChange={set('bankName')} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13.5px]" /></Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="支店コード"><input value={form.branchCode} onChange={set('branchCode')} className="w-full border border-slate-200 rounded-lg px-3 py-2 font-mono text-[13.5px]" /></Field>
                <Field label="支店名"><input value={form.branchName} onChange={set('branchName')} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13.5px]" /></Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="預金種別">
                  <select value={form.accountType} onChange={set('accountType')} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13.5px] bg-white">
                    <option value="普通">普通</option>
                    <option value="当座">当座</option>
                  </select>
                </Field>
                <Field label="口座名義（カナ）"><input value={form.accountHolder} onChange={set('accountHolder')} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13.5px]" /></Field>
              </div>
              <Field label="口座番号"><input value={form.accountNumber} onChange={set('accountNumber')} className="w-full border border-slate-200 rounded-lg px-3 py-2 font-mono text-[14px]" /></Field>

              <div className="text-[11px] font-bold text-slate-400 pt-2">標準報酬月額</div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="健康保険（円）"><input type="number" value={form.standardRemunerationHealth} onChange={set('standardRemunerationHealth')} className="w-full border border-slate-200 rounded-lg px-3 py-2 font-mono text-[13.5px]" /></Field>
                <Field label="厚生年金保険（円）"><input type="number" value={form.standardRemunerationPension} onChange={set('standardRemunerationPension')} className="w-full border border-slate-200 rounded-lg px-3 py-2 font-mono text-[13.5px]" /></Field>
              </div>
              <div className="text-[10.5px] text-slate-400">実際の時給・月給・給与計算の設定は「給与」タブから行ってください。ここは社会保険の届出に使う標準報酬月額のみです。</div>
          </div>

          <div ref={(el) => (sectionRefs.current.insurance = el)} className="space-y-4 pt-1">
            <div className="text-[12px] font-bold text-slate-500 border-b border-slate-100 pb-2">社会保険</div>
              <div className="text-[11px] font-bold text-slate-400">健康保険</div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="加入状況">
                  <select value={form.healthInsuranceStatus} onChange={set('healthInsuranceStatus')} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13.5px] bg-white">
                    <option value="未加入">未加入</option>
                    <option value="加入">加入</option>
                  </select>
                </Field>
                <Field label="被保険者整理番号"><input value={form.healthInsuranceNumber} onChange={set('healthInsuranceNumber')} className="w-full border border-slate-200 rounded-lg px-3 py-2 font-mono text-[13.5px]" /></Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="資格取得日"><input type="date" value={form.healthInsuranceAcquiredDate} onChange={set('healthInsuranceAcquiredDate')} className="w-full border border-slate-200 rounded-lg px-3 py-2 font-mono text-[13px]" /></Field>
                <Field label="資格喪失日"><input type="date" value={form.healthInsuranceLostDate} onChange={set('healthInsuranceLostDate')} className="w-full border border-slate-200 rounded-lg px-3 py-2 font-mono text-[13px]" /></Field>
              </div>

              <div className="text-[11px] font-bold text-slate-400 pt-2">厚生年金保険</div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="加入状況">
                  <select value={form.pensionStatus} onChange={set('pensionStatus')} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13.5px] bg-white">
                    <option value="未加入">未加入</option>
                    <option value="加入">加入</option>
                  </select>
                </Field>
                <Field label="基礎年金番号"><input value={form.pensionBasicNumber} onChange={set('pensionBasicNumber')} className="w-full border border-slate-200 rounded-lg px-3 py-2 font-mono text-[13.5px]" /></Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="資格取得日"><input type="date" value={form.pensionAcquiredDate} onChange={set('pensionAcquiredDate')} className="w-full border border-slate-200 rounded-lg px-3 py-2 font-mono text-[13px]" /></Field>
                <Field label="資格喪失日"><input type="date" value={form.pensionLostDate} onChange={set('pensionLostDate')} className="w-full border border-slate-200 rounded-lg px-3 py-2 font-mono text-[13px]" /></Field>
              </div>

              <div className="text-[11px] font-bold text-slate-400 pt-2">雇用保険</div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="加入状況">
                  <select value={form.employmentInsuranceStatus} onChange={set('employmentInsuranceStatus')} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13.5px] bg-white">
                    <option value="未加入">未加入</option>
                    <option value="加入">加入</option>
                  </select>
                </Field>
                <Field label="被保険者番号"><input value={form.employmentInsuranceNumber} onChange={set('employmentInsuranceNumber')} className="w-full border border-slate-200 rounded-lg px-3 py-2 font-mono text-[13.5px]" /></Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="資格取得日"><input type="date" value={form.employmentInsuranceAcquiredDate} onChange={set('employmentInsuranceAcquiredDate')} className="w-full border border-slate-200 rounded-lg px-3 py-2 font-mono text-[13px]" /></Field>
                <Field label="離職等年月日"><input type="date" value={form.employmentInsuranceLostDate} onChange={set('employmentInsuranceLostDate')} className="w-full border border-slate-200 rounded-lg px-3 py-2 font-mono text-[13px]" /></Field>
              </div>
          </div>

          <div ref={(el) => (sectionRefs.current.family = el)} className="space-y-4 pt-1">
            <div className="text-[12px] font-bold text-slate-500 border-b border-slate-100 pb-2">家族・配偶者</div>
              <div className="text-[11px] font-bold text-slate-400">配偶者情報</div>
              <Field label="配偶者の有無">
                <select value={form.spouseStatus} onChange={set('spouseStatus')} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13.5px] bg-white">
                  <option value="無">無</option>
                  <option value="有">有</option>
                </select>
              </Field>
              {form.spouseStatus === '有' && (
                <div className="grid grid-cols-2 gap-3">
                  <Field label="配偶者の年間収入（去年・円）"><input type="number" value={form.spouseAnnualIncome} onChange={set('spouseAnnualIncome')} className="w-full border border-slate-200 rounded-lg px-3 py-2 font-mono text-[13.5px]" /></Field>
                  <Field label="配偶者の月額収入（現在・円）"><input type="number" value={form.spouseMonthlyIncome} onChange={set('spouseMonthlyIncome')} className="w-full border border-slate-200 rounded-lg px-3 py-2 font-mono text-[13.5px]" /></Field>
                </div>
              )}

              <div className="flex items-center justify-between pt-2">
                <div className="text-[11px] font-bold text-slate-400">家族情報</div>
                <button onClick={addFamilyMember} className="text-[11px] font-bold text-amber-600 flex items-center gap-1"><Plus size={12} />追加</button>
              </div>
              {form.familyMembers.length === 0 ? (
                <div className="text-[12px] text-slate-300 text-center py-4 bg-slate-50 rounded-lg">家族情報の登録はありません</div>
              ) : (
                <div className="space-y-2">
                  {form.familyMembers.map((m, i) => (
                    <div key={i} className="border border-slate-200 rounded-lg p-3 space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <input value={m.name} onChange={(e) => updateFamilyMember(i, 'name', e.target.value)} placeholder="氏名" className="border border-slate-200 rounded-md px-2 py-1.5 text-[12.5px]" />
                        <input value={m.relation} onChange={(e) => updateFamilyMember(i, 'relation', e.target.value)} placeholder="続柄（例：子）" className="border border-slate-200 rounded-md px-2 py-1.5 text-[12.5px]" />
                      </div>
                      <div className="flex items-center gap-2">
                        <input type="date" value={m.birthDate} onChange={(e) => updateFamilyMember(i, 'birthDate', e.target.value)} className="flex-1 border border-slate-200 rounded-md px-2 py-1.5 font-mono text-[12.5px]" />
                        <button onClick={() => removeFamilyMember(i)} className="text-slate-300 hover:text-rose-500"><Trash2 size={14} /></button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
          </div>

          <div ref={(el) => (sectionRefs.current.tax = el)} className="space-y-4 pt-1">
            <div className="text-[12px] font-bold text-slate-500 border-b border-slate-100 pb-2">住民税・税区分</div>
              <div className="text-[11px] font-bold text-slate-400">住民税</div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="給与支払報告書提出先 市区町村コード"><input value={form.residentTaxMunicipalityCode} onChange={set('residentTaxMunicipalityCode')} className="w-full border border-slate-200 rounded-lg px-3 py-2 font-mono text-[13px]" /></Field>
                <Field label="提出先 市区町村"><input value={form.residentTaxMunicipality} onChange={set('residentTaxMunicipality')} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px]" /></Field>
              </div>
              <Field label="住民税徴収方法">
                <select value={form.residentTaxCollectionMethod} onChange={set('residentTaxCollectionMethod')} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13.5px] bg-white">
                  <option value="特別徴収">特別徴収</option>
                  <option value="普通徴収">普通徴収</option>
                </select>
              </Field>

              <div className="text-[11px] font-bold text-slate-400 pt-2">税区分情報</div>
              <Field label="税額表区分">
                <select value={form.taxTableType} onChange={set('taxTableType')} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13.5px] bg-white">
                  <option value="甲欄">甲欄</option>
                  <option value="乙欄">乙欄</option>
                </select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="障害者区分">
                  <select value={form.disabilityClassification} onChange={set('disabilityClassification')} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] bg-white">
                    <option value="対象外">対象外</option>
                    <option value="一般障害者">一般障害者</option>
                    <option value="特別障害者">特別障害者</option>
                  </select>
                </Field>
                <Field label="ひとり親・寡婦区分">
                  <select value={form.singleParentClassification} onChange={set('singleParentClassification')} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13px] bg-white">
                    <option value="対象外">対象外</option>
                    <option value="ひとり親">ひとり親</option>
                    <option value="寡婦">寡婦</option>
                  </select>
                </Field>
              </div>
              <label className="flex items-center gap-2 text-[12.5px] text-slate-600"><input type="checkbox" checked={form.isNonResident} onChange={setCheck('isNonResident')} />非居住者</label>
              <label className="flex items-center gap-2 text-[12.5px] text-slate-600"><input type="checkbox" checked={form.isWorkingStudent} onChange={setCheck('isWorkingStudent')} />勤労学生</label>
          </div>
          </>
          )}

          {activeTab === 'mynumber' && isMasterAdmin && (
            <MyNumberSection account={account} onFetch={onFetchMyNumber} onSave={onSaveMyNumber} />
          )}

          {activeTab !== 'mynumber' && (
            <div className="text-[10.5px] text-slate-400 pt-2">ログイン用のID・パスワードとは別の情報です。緊急連絡や書類送付、給与計算などに使用してください。</div>
          )}
        </div>
        {activeTab !== 'mynumber' && (
          <div className="px-5 pb-5 pt-1 flex gap-2 sticky bottom-0 bg-white">
            <button onClick={onClose} className="flex-1 py-2.5 rounded-lg border border-slate-200 text-[13.5px] font-medium text-slate-500">キャンセル</button>
            <button onClick={save} disabled={saving} className="flex-1 py-2.5 rounded-lg bg-slate-800 disabled:bg-slate-300 text-white text-[13.5px] font-bold">
              {saving ? '保存中…' : '保存する'}
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

const MY_NUMBER_PURPOSES = ['源泉徴収票・給与支払報告書の作成', '健康保険・厚生年金保険関係届出', '雇用保険関係届出', '労働者災害補償保険法関係届出'];

function MyNumberSection({ account, onFetch, onSave }) {
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [number, setNumber] = useState('');
  const [purposes, setPurposes] = useState([]);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const result = await onFetch(account.id);
    if (result) {
      setNumber(result.number);
      setPurposes(result.purposes);
      setLoaded(true);
      setRevealed(true);
    }
    setLoading(false);
  };

  const togglePurpose = (p) => setPurposes((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));

  const save = async () => {
    setSaving(true);
    await onSave(account.id, { number, purposes });
    setSaving(false);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 bg-rose-50 border border-rose-200 rounded-xl px-4 py-3 text-[11.5px] text-rose-700">
        <ShieldCheck size={14} className="mt-0.5 shrink-0" />
        <span>マイナンバーは特定個人情報として、法律で利用目的の限定・アクセス制限が求められています。この画面はマスター管理者のみアクセスでき、閲覧・保存のたびに監査ログへ記録されます。</span>
      </div>

      {!loaded ? (
        <button onClick={load} disabled={loading} className="w-full py-2.5 rounded-lg border border-slate-200 text-[13px] font-bold text-slate-600">
          {loading ? '読み込み中…' : 'マイナンバーを表示する'}
        </button>
      ) : (
        <>
          <Field label="マイナンバー（12桁）">
            <div className="flex items-center gap-2">
              <input
                type={revealed ? 'text' : 'password'}
                value={number}
                onChange={(e) => setNumber(e.target.value.replace(/[^0-9]/g, '').slice(0, 12))}
                className="flex-1 border border-slate-200 rounded-lg px-3 py-2 font-mono text-[14px]"
                placeholder="123456789012"
              />
              <button onClick={() => setRevealed((v) => !v)} className="text-[11px] font-bold text-slate-500 border border-slate-200 rounded-lg px-2.5 py-2">
                {revealed ? '隠す' : '表示'}
              </button>
            </div>
          </Field>
          <Field label="利用目的（該当するものにチェック）">
            <div className="space-y-1.5">
              {MY_NUMBER_PURPOSES.map((p) => (
                <label key={p} className="flex items-center gap-2 text-[12.5px] text-slate-600 border border-slate-200 rounded-lg px-3 py-2">
                  <input type="checkbox" checked={purposes.includes(p)} onChange={() => togglePurpose(p)} />
                  {p}
                </label>
              ))}
            </div>
          </Field>
          <button onClick={save} disabled={saving} className="w-full py-2.5 rounded-lg bg-rose-600 disabled:bg-slate-200 text-white text-[13.5px] font-bold">
            {saving ? '保存中…' : 'マイナンバーを保存する'}
          </button>
        </>
      )}
    </div>
  );
}
