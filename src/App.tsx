import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Clock, MapPin, CheckCircle2, XCircle, AlertTriangle, LogIn, LogOut, FileEdit, Users, Bell, Calendar, Mail, LogOut as LogoutIcon, UserPlus, Lock, User, Monitor, Smartphone, Palmtree, Plus, Pencil, CalendarDays, ListChecks, ClipboardList, MessageSquare, Coffee, BarChart3, Home, Download, ChevronRight, LayoutGrid, Wallet, Briefcase, UserCog, Construction, Megaphone, Paperclip, FileText, Pin, Trash2 } from 'lucide-react';
import { supabase, CLOUD_ENABLED, usernameToEmail } from './supabaseClient';

// ---- constants ----
const SCHEDULED_START = '09:00';
const SCHEDULED_END = '18:00';
const BREAK_MINUTES_DEFAULT = 60;

const pad = (n) => String(n).padStart(2, '0');
const todayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
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

// グループ別の月次休暇規定日数（当年1月からその月までの累計、入職月より前は含めない）
function computeGroupScheduleLeaveDays(hireDateStr, groupName, monthlyDaysByMonth, asOf = new Date()) {
  if (!groupName || !monthlyDaysByMonth) return null;
  const currentMonth = asOf.getMonth() + 1;
  const currentYear = asOf.getFullYear();
  const hire = hireDateStr ? new Date(hireDateStr + 'T00:00:00') : null;
  let total = 0;
  for (let m = 1; m <= currentMonth; m++) {
    if (hire && hire.getFullYear() === currentYear && hire.getMonth() + 1 > m) continue;
    if (hire && hire.getFullYear() > currentYear) continue;
    total += Number(monthlyDaysByMonth[m] || 0);
  }
  return total;
}

// 社員1人分の有休付与日数（優先順位：パート/アルバイトは比例付与 → グループ規定 → 法定自動計算）＋手動調整
function computeLeaveTotal(employee, now, groupLeaveSchedules) {
  if (!employee) return 0;
  const isPartTime = employee.staffType === 'パート' || employee.staffType === 'アルバイト';
  let base;
  if (isPartTime) {
    base = employee.scheduledWeeklyDays
      ? computeProportionalLeaveDays(employee.hireDate, employee.scheduledWeeklyDays, now)
      : computeStatutoryPaidLeaveDays(employee.hireDate, now);
  } else {
    const groupSchedule = employee.mainGroup ? groupLeaveSchedules?.[employee.mainGroup] : null;
    const groupTotal = groupSchedule ? computeGroupScheduleLeaveDays(employee.hireDate, employee.mainGroup, groupSchedule, now) : null;
    base = groupTotal != null ? groupTotal : computeStatutoryPaidLeaveDays(employee.hireDate, now);
  }
  return Math.max(0, base + (Number(employee.leaveAdjustment) || 0));
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

// ---- Monthly shift request ----
const nextMonthKey = (from = new Date()) => {
  const y = from.getFullYear();
  const m = from.getMonth() + 1;
  const targetYear = m > 12 ? y + 1 : y;
  const targetMonth = m > 12 ? 1 : m;
  return `${targetYear}-${pad(targetMonth)}`;
};
const monthKeyLabel = (yearMonth) => {
  const [y, m] = yearMonth.split('-').map(Number);
  return `${y}年${m}月`;
};
const daysInMonthList = (yearMonth) => {
  const [y, m] = yearMonth.split('-').map(Number);
  const count = lastDayOfMonth(y, m);
  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
  const list = [];
  for (let d = 1; d <= count; d++) {
    const dateObj = new Date(y, m - 1, d);
    list.push({ date: `${y}-${pad(m)}-${pad(d)}`, day: d, weekday: weekdays[dateObj.getDay()], isWeekend: dateObj.getDay() === 0 || dateObj.getDay() === 6 });
  }
  return list;
};
const DAY_TYPE_META = {
  work: { label: '○', color: 'emerald' },
  off: { label: '×', color: 'slate' },
  paid_leave: { label: '有休', color: 'amber' },
};
const isPastShiftDeadline = () => new Date().getDate() > 15;

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
  if (record.breakMinutesOverride != null) return Number(record.breakMinutesOverride);
  if (Array.isArray(record.breakPeriods)) {
    const completed = record.breakPeriods.reduce((sum, p) => {
      if (!p?.start || !p?.end) return sum;
      return sum + Math.max(0, Math.round((new Date(p.end).getTime() - new Date(p.start).getTime()) / 60000));
    }, 0);
    const active = record.breakStartedAt
      ? Math.max(0, Math.round((asOf.getTime() - new Date(record.breakStartedAt).getTime()) / 60000))
      : 0;
    return completed + active;
  }
  return record.breakMinutes ?? BREAK_MINUTES_DEFAULT;
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

const EMPTY_DATA = { accounts: [], records: {}, corrections: [], notifications: [], leaveRequests: [], leaveBalances: {}, shiftRequests: [], performanceReports: [], payrollRecords: [], auditLogs: [], profileUpdateRequests: [], groupLeaveSchedules: {}, announcements: [] };

// ---- row(snake_case) → app(camelCase) 変換 ----
const rowToAccount = (row) => ({
  id: row.id,
  username: row.username,
  name: row.name,
  role: row.role,
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
  nearestStation: row.nearest_station || '',
  staffNote1: row.staff_note1 || '',
  staffNote2: row.staff_note2 || '',
  staffNote3: row.staff_note3 || '',
  leaveAdjustment: row.leave_adjustment != null ? Number(row.leave_adjustment) : 0,
  scheduledWeeklyDays: row.scheduled_weekly_days != null ? Number(row.scheduled_weekly_days) : null,
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

const rowToShift = (row) => ({
  id: row.id,
  employeeId: row.employee_id,
  employeeName: row.employees?.name || '',
  batchId: row.batch_id,
  targetMonth: row.target_month,
  date: row.date,
  dayType: row.day_type,
  startTime: row.start_time,
  endTime: row.end_time,
  note: row.note,
  status: row.status,
  source: row.source,
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
    shiftRes,
    perfRes,
    notifRes,
    payrollRes,
    auditRes,
    profileReqRes,
    groupLeaveRes,
    announcementsRes,
  ] = await Promise.all([
    supabase.from('employees').select('*'),
    supabase.from('attendance_records').select('*'),
    supabase.from('corrections').select('*, employees(name)'),
    supabase.from('leave_requests').select('*, employees(name)'),
    supabase.from('shift_requests').select('*, employees(name)'),
    supabase.from('performance_reports').select('*, employees(name)'),
    supabase.from('notifications').select('*').order('sent_at', { ascending: false }).limit(50),
    supabase.from('payroll_records').select('*, employees(name)'),
    supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(100),
    supabase.from('profile_update_requests').select('*, employees(name)').order('submitted_at', { ascending: false }),
    supabase.from('group_leave_schedules').select('*'),
    supabase.from('announcements').select('*').order('is_pinned', { ascending: false }).order('created_at', { ascending: false }),
  ]);

  for (const res of [employeesRes, recordsRes, correctionsRes, leaveRes, shiftRes, perfRes, notifRes, payrollRes, auditRes, profileReqRes, groupLeaveRes, announcementsRes]) {
    if (res.error) throw res.error;
  }

  const records = {};
  (recordsRes.data || []).forEach((row) => {
    records[row.employee_id] = records[row.employee_id] || {};
    records[row.employee_id][row.date] = rowToRecord(row);
  });

  const groupLeaveSchedules = {};
  (groupLeaveRes.data || []).forEach((row) => {
    groupLeaveSchedules[row.group_name] = groupLeaveSchedules[row.group_name] || {};
    groupLeaveSchedules[row.group_name][row.month] = Number(row.days);
  });

  return {
    accounts: (employeesRes.data || []).map(rowToAccount),
    records,
    corrections: (correctionsRes.data || []).map(rowToCorrection),
    leaveRequests: (leaveRes.data || []).map(rowToLeave),
    leaveBalances: {},
    payrollRecords: (payrollRes.data || []).map(rowToPayroll),
    shiftRequests: (shiftRes.data || []).map(rowToShift),
    performanceReports: (perfRes.data || []).map(rowToPerf),
    notifications: (notifRes.data || []).map(rowToNotif),
    auditLogs: (auditRes.data || []).map(rowToAudit),
    profileUpdateRequests: (profileReqRes.data || []).map(rowToProfileRequest),
    groupLeaveSchedules,
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
  const [shiftModalOpen, setShiftModalOpen] = useState(false);
  const [performanceModal, setPerformanceModal] = useState(null);
  const [employeeTab, setEmployeeTab] = useState('attendance');
  const [topTab, setTopTab] = useState('attendance'); // attendance | labor | hr | payroll
  const [viewMode, setViewMode] = useState(() => (typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches ? 'desktop' : 'mobile'));
  const now = useNow();
  const geo = useGeolocation();
  const { toast, show } = useToast();

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
        body: { username: payload.username, password: payload.password, name: payload.name, hireDate: payload.hireDate },
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
      });
      if (error || fnData?.error) {
        show(fnData?.error || 'アカウント作成に失敗しました', 'warn');
        return false;
      }
      await refreshData();
      await logAudit(session, '社員アカウントを作成', `username: ${payload.username}`, fnData?.id || null, payload.name);
      show(`${payload.name}さんのアカウントを作成しました`, 'success');
      return true;
    } catch (e) {
      show('アカウント作成に失敗しました', 'warn');
      return false;
    }
  };

  const today = todayKey();
  const employeeId = session?.id;
  const employeeRecords = (employeeId && data.records[employeeId]) || {};
  const todayRecord = employeeRecords[today];

  const handleClockIn = async () => {
    const loc = await geo.capture();
    const { error } = await supabase.from('attendance_records').upsert(
      {
        employee_id: employeeId,
        date: today,
        clock_in: new Date().toISOString(),
        clock_out: null,
        break_periods: [],
        break_started_at: null,
        scheduled_start: SCHEDULED_START,
        scheduled_end: SCHEDULED_END,
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
    show(loc ? '出勤を記録しました（位置情報を取得）' : '出勤を記録しました（位置情報の取得に失敗）', loc ? 'success' : 'warn');
  };

  const handleClockOut = async () => {
    const loc = await geo.capture();
    const existing = employeeRecords[today] || { breakPeriods: [] };
    const nowIso = new Date().toISOString();
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
        clock_out: nowIso,
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
      nearestStation: 'nearest_station',
      staffNote1: 'staff_note1',
      staffNote2: 'staff_note2',
      staffNote3: 'staff_note3',
      leaveAdjustment: 'leave_adjustment',
      scheduledWeeklyDays: 'scheduled_weekly_days',
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
    const { error } = await supabase.from('group_leave_schedules').upsert(rows, { onConflict: 'group_name,month' });
    if (error) {
      show('グループ休暇設定の保存に失敗しました', 'warn');
      return;
    }
    await refreshData();
    await logAudit(session, 'グループ休暇規定日数を更新', groupName);
    show(`「${groupName}」の休暇規定日数を保存しました`, 'success');
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

  const submitShiftRequest = async (payload) => {
    const batchId = `batch-${Date.now()}`;
    const shiftRows = payload.days.map((d) => ({
      employee_id: employeeId,
      batch_id: batchId,
      target_month: payload.targetMonth,
      date: d.date,
      day_type: d.dayType,
      start_time: d.dayType === 'work' ? d.startTime : null,
      end_time: d.dayType === 'work' ? d.endTime : null,
      note: '',
      status: 'pending',
      source: 'employee',
    }));
    const { error: shiftError } = await supabase.from('shift_requests').insert(shiftRows);
    if (shiftError) {
      show('シフト希望の送信に失敗しました', 'warn');
      return;
    }

    const paidLeaveDays = payload.days.filter((d) => d.dayType === 'paid_leave');
    if (paidLeaveDays.length > 0) {
      const leaveRows = paidLeaveDays.map((d) => ({
        employee_id: employeeId,
        type: '有休',
        half_day: false,
        start_date: d.date,
        end_date: d.date,
        days: 1,
        reason: `${monthKeyLabel(payload.targetMonth)}シフト希望による有休申請`,
        status: 'pending',
      }));
      const { error: leaveError } = await supabase.from('leave_requests').insert(leaveRows);
      if (leaveError) console.error('有休申請の自動作成に失敗しました', leaveError);
    }

    await notifyAdmin(
      `【シフト希望】${session.name} - ${monthKeyLabel(payload.targetMonth)}分`,
      `${session.name}さんより ${monthKeyLabel(payload.targetMonth)}分のシフト希望（${shiftRows.length}日分、うち有休${paidLeaveDays.length}日）が届きました。内容をご確認のうえ確定してください。`,
      batchId
    );
    await refreshData();
    setShiftModalOpen(false);
    show(`${monthKeyLabel(payload.targetMonth)}分のシフト希望（${shiftRows.length}日分）を送信しました`, 'success');
  };

  const decideShiftRequest = async (id, decision) => {
    const shift = data.shiftRequests.find((s) => s.id === id);
    const { error } = await supabase
      .from('shift_requests')
      .update({ status: decision, decided_at: new Date().toISOString() })
      .eq('id', id);
    if (error) {
      show('処理に失敗しました', 'warn');
      return;
    }
    await refreshData();
    if (shift) await logAudit(session, decision === 'confirmed' ? 'シフトを確定' : 'シフト希望を却下', dateLabel(shift.date), shift.employeeId, shift.employeeName);
    show(decision === 'confirmed' ? 'シフトを確定しました' : 'シフト希望を却下しました', decision === 'confirmed' ? 'success' : 'warn');
  };

  const decideShiftBatch = async (batchId, decision) => {
    const rows = data.shiftRequests.filter((s) => s.batchId === batchId);
    const { error } = await supabase
      .from('shift_requests')
      .update({ status: decision, decided_at: new Date().toISOString() })
      .eq('batch_id', batchId)
      .eq('status', 'pending');
    if (error) {
      show('処理に失敗しました', 'warn');
      return;
    }
    await refreshData();
    if (rows[0]) await logAudit(session, decision === 'confirmed' ? 'シフトをまとめて確定' : 'シフト希望をまとめて却下', `${monthKeyLabel(rows[0].targetMonth)}分・${rows.length}日分`, rows[0].employeeId, rows[0].employeeName);
    show(decision === 'confirmed' ? 'まとめて確定しました' : 'まとめて却下しました', decision === 'confirmed' ? 'success' : 'warn');
  };

  const addShiftDirect = async (payload) => {
    const targetAccount = data.accounts.find((a) => a.id === payload.employeeId);
    const { error } = await supabase.from('shift_requests').insert({
      employee_id: payload.employeeId,
      batch_id: null,
      day_type: 'work',
      date: payload.date,
      start_time: payload.startTime,
      end_time: payload.endTime,
      note: payload.note,
      status: 'confirmed',
      source: 'admin',
      decided_at: new Date().toISOString(),
    });
    if (error) {
      show('シフト登録に失敗しました', 'warn');
      return;
    }
    await refreshData();
    show(`${targetAccount ? targetAccount.name : ''}さんの${dateLabel(payload.date)}のシフトを登録しました`, 'success');
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
  const myShiftRequests = data.shiftRequests.filter((s) => s.employeeId === employeeId);
  const myConfirmedShifts = myShiftRequests.filter((s) => s.status === 'confirmed' && s.date >= today).sort((a, b) => (a.date > b.date ? 1 : -1));
  const myPerformanceReports = data.performanceReports.filter((r) => r.employeeId === employeeId);

  const employeeAccounts = data.accounts.filter((a) => a.role === 'employee');
  const pendingCorrectionCount = data.corrections.filter((c) => c.status === 'pending').length;
  const pendingLeaveCount = data.leaveRequests.filter((l) => l.status === 'pending').length;
  const pendingShiftCount = data.shiftRequests.filter((s) => s.status === 'pending').length;
  const pendingPerformanceCount = data.performanceReports.filter((r) => r.status === 'pending').length;
  const missingPunchCount = employeeAccounts.reduce((sum, acc) => {
    const recs = data.records[acc.id] || {};
    return sum + Object.keys(recs).filter((k) => k !== today && recs[k]?.clockIn && !recs[k]?.clockOut).length;
  }, 0);

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900">
      <div className={`fixed top-3 right-3 z-[60] rounded-full border px-2.5 py-1 text-[11px] font-semibold shadow-sm ${cloudStatusClass}`}>{cloudStatusLabel}</div>
      <GlobalTopTabs topTab={topTab} setTopTab={setTopTab} />
      <Header session={session} onLogout={handleLogout} pendingCount={pendingCorrectionCount + pendingLeaveCount + pendingShiftCount + pendingPerformanceCount} missingPunchCount={missingPunchCount} viewMode={viewMode} />
      <main className={isDesktop ? 'max-w-6xl mx-auto px-6 pb-16 pt-8' : 'max-w-3xl mx-auto px-4 pb-24 pt-6'}>
        {topTab === 'labor' && (
          <AnnouncementsView
            announcements={data.announcements}
            isAdmin={session.role === 'admin'}
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
                  ['attendance','勤怠'],['leave','休暇申請'],['shift','シフト'],['performance','実績']
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
            {employeeTab === 'shift' && (
              <ShiftView
                confirmedShifts={myConfirmedShifts}
                shiftRequests={myShiftRequests}
                onOpenShiftModal={() => setShiftModalOpen(true)}
                isDesktop={isDesktop}
              />
            )}
            {employeeTab === 'performance' && (
              <PerformanceView
                reports={myPerformanceReports}
                onOpenModal={(type) => setPerformanceModal(type)}
                isDesktop={isDesktop}
              />
            )}
          </div>
        ) : (
          <AdminView
            data={data}
            employeeAccounts={employeeAccounts}
            onDecide={decideCorrection}
            onDecideLeave={decideLeaveRequest}
            onDecideShift={decideShiftRequest}
            onDecideShiftBatch={decideShiftBatch}
            onAddShift={addShiftDirect}
            onDecidePerformance={decidePerformanceReport}
            onAddAccount={handleAddAccount}
            onUpdateDates={updateEmployeeDates}
            onSaveGroupLeave={saveGroupLeaveSchedule}
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
      {shiftModalOpen && (
        <MonthlyShiftModal
          leaveRemaining={myLeaveTotal - myLeaveUsed}
          onClose={() => setShiftModalOpen(false)}
          onSubmit={submitShiftRequest}
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
              ['attendance','勤怠',Clock],['leave','休暇',Palmtree],['shift','シフト',CalendarDays],['performance','実績',BarChart3]
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
            <label className="block text-[12.5px] font-bold text-slate-800 mb-1.5">ユーザー名</label>
            <div className="flex items-center border-2 border-slate-200 rounded-xl px-3.5 gap-2 focus-within:border-slate-900 transition-colors">
              <User size={16} className="text-slate-400 shrink-0" />
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full py-3 text-[15px] outline-none bg-transparent text-slate-800"
                placeholder="ユーザー名を入力"
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
        <div className="mt-5 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-center text-[11.5px] text-slate-600 leading-relaxed">
          <div className="font-bold text-slate-800 mb-1">デモ用アカウント</div>
          社員：yamada / pass123　　管理者：admin / admin123
        </div>
      </div>
      <ToastView toast={toast} />
    </div>
  );
}

function GlobalTopTabs({ topTab, setTopTab }) {
  const tabs = [
    { key: 'attendance', label: '勤怠', icon: <Clock size={14} /> },
    { key: 'labor', label: '労務', icon: <Briefcase size={14} /> },
    { key: 'hr', label: '人材', icon: <UserCog size={14} /> },
    { key: 'payroll', label: '給与', icon: <Wallet size={14} /> },
  ];
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

  return (
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
    </div>
  );
}

function Header({ session, onLogout, pendingCount, missingPunchCount, viewMode }) {
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
            <div className="text-[10.5px] text-slate-400 leading-tight">{session.name}（{session.role === 'admin' ? '管理者' : '社員'}）</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {session.role === 'admin' && alertCount > 0 && (
            <span className="w-5 h-5 bg-amber-600 rounded-full text-[10px] flex items-center justify-center text-white font-bold">
              {alertCount}
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
    </header>
  );
}

function EmployeeView({ now, todayRecord, onClockIn, onClockOut, onBreakStart, onBreakEnd, geoStatus, historyDates, records, corrections, onOpenCorrection, notifications, onMarkNotificationRead, isDesktop }) {
  const status = computeDayStatus(todayRecord);
  const canClockIn = !todayRecord?.clockIn;
  const canClockOut = todayRecord?.clockIn && !todayRecord?.clockOut;
  const isOnBreak = !!todayRecord?.breakStartedAt && !todayRecord?.clockOut;
  const doneToday = todayRecord?.clockIn && todayRecord?.clockOut;
  const monthly = computeMonthlySummary(records, now);
  const todayBreak = todayRecord ? getRecordedBreakMinutes(todayRecord, now) : 0;
  const todayKeyStr = todayKey();
  const missingCount = historyDates.filter((k) => k !== todayKeyStr && records[k]?.clockIn && !records[k]?.clockOut).length;
  const primaryLabel = doneToday ? '退勤済み' : canClockIn ? '出勤' : '退勤';
  const primaryAction = canClockIn ? onClockIn : canClockOut ? onClockOut : undefined;
  const primaryDisabled = doneToday;

  const clockSection = (
    <div className="space-y-4">
      <div className="rounded-[22px] bg-white border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-3 bg-slate-100 flex items-center justify-between">
          <span className="text-[12.5px] font-bold text-slate-500">
            {now.getFullYear()}年{now.getMonth() + 1}月{now.getDate()}日（{['日','月','火','水','木','金','土'][now.getDay()]}）
          </span>
          <span className={`rounded-full px-3 py-1 text-[11px] font-bold ${isOnBreak ? 'bg-amber-100 text-amber-700' : status.tone === 'active' ? 'bg-emerald-100 text-emerald-700' : status.tone === 'danger' ? 'bg-rose-100 text-rose-700' : 'bg-slate-200 text-slate-600'}`}>
            {isOnBreak ? '休憩中' : status.label}
          </span>
        </div>

        <div className="px-6 pt-6 pb-5 text-center">
          <div className="font-mono text-[46px] sm:text-[52px] font-bold leading-none tracking-tight tabular-nums text-slate-900">{timeStr(now)}</div>
        </div>

        <div className="px-6 pb-5">
          <button
            onClick={primaryAction}
            disabled={primaryDisabled || !primaryAction}
            className="w-full rounded-xl bg-amber-500 disabled:bg-slate-200 disabled:text-slate-400 text-white py-4 text-[16px] font-bold tracking-wide shadow-sm active:brightness-95 transition"
          >
            {primaryLabel}
          </button>
          <button
            onClick={isOnBreak ? onBreakEnd : onBreakStart}
            disabled={!canClockOut}
            className={`mt-2.5 w-full rounded-xl py-3 text-[13px] font-bold flex items-center justify-center gap-2 border-2 transition disabled:opacity-30 ${isOnBreak ? 'border-amber-400 bg-amber-50 text-amber-700' : 'border-slate-200 text-slate-600'}`}
          >
            <Coffee size={16} />{isOnBreak ? '休憩を終了' : '休憩を開始'}
          </button>
        </div>

        <div className="px-6 pb-4 grid grid-cols-3 gap-2 border-t border-slate-100 pt-4">
          <div className="text-center"><div className="text-[10px] text-slate-400">出勤</div><div className="mt-1 font-mono text-[14px] font-bold text-slate-800">{todayRecord?.clockIn ? hhmm(new Date(todayRecord.clockIn)) : '--:--'}</div></div>
          <div className="text-center border-x border-slate-100"><div className="text-[10px] text-slate-400">退勤</div><div className="mt-1 font-mono text-[14px] font-bold text-slate-800">{todayRecord?.clockOut ? hhmm(new Date(todayRecord.clockOut)) : '--:--'}</div></div>
          <div className="text-center"><div className="text-[10px] text-slate-400">休憩</div><div className="mt-1 font-mono text-[14px] font-bold text-slate-800">{todayRecord?.clockIn ? `${todayBreak}分` : '--'}</div></div>
        </div>
        <div className="px-6 pb-4 flex items-center justify-center gap-1.5 text-[10.5px] text-slate-400">
          <MapPin size={11} />{geoStatus === 'loading' ? '位置情報を取得中…' : geoStatus === 'denied' ? '位置情報が許可されていません' : '打刻時に位置情報を記録'}
        </div>
      </div>

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
                {metrics && (metrics.lateMin > 0 || metrics.earlyLeaveMin > 0 || metrics.overtimeMin > 0) && <div className="mt-1 text-[10.5px] font-medium"><span className="text-rose-500">{metrics.lateMin > 0 ? `遅刻 ${metrics.lateMin}分 ` : ''}{metrics.earlyLeaveMin > 0 ? `早退 ${metrics.earlyLeaveMin}分` : ''}</span>{metrics.overtimeMin > 0 && <span className="ml-2 text-amber-600">残業 {minutesToHHMM(metrics.overtimeMin)}</span>}</div>}
              </div>
              <button onClick={() => onOpenCorrection(dateKey)} className="shrink-0 rounded-xl border border-slate-200 p-2.5 text-slate-500 hover:bg-white"><FileEdit size={15}/></button>
            </div>
          );
        })}
      </div>
    </div>
  );

  if (isDesktop) return <div className="grid grid-cols-[420px_1fr] gap-6 items-start">{clockSection}{historySection}</div>;
  return <div className="space-y-5">{clockSection}{historySection}</div>;
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

function CorrectionModal({ dateKey, record, onClose, onSubmit }) {
  const [clockIn, setClockIn] = useState(record?.clockIn ? hhmm(new Date(record.clockIn)) : '');
  const [clockOut, setClockOut] = useState(record?.clockOut ? hhmm(new Date(record.clockOut)) : '');
  const [breakMinutes, setBreakMinutes] = useState(record?.breakMinutes ?? BREAK_MINUTES_DEFAULT);
  const [reason, setReason] = useState('');
  const canSubmit = reason.trim().length > 0 && (clockIn || clockOut);

  return (
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
    </div>
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

  return (
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
    </div>
  );
}

function ShiftView({ confirmedShifts, shiftRequests, onOpenShiftModal, isDesktop }) {
  const pendingRequests = shiftRequests.filter((s) => s.status === 'pending');
  const batches = Array.from(new Set(shiftRequests.map((s) => s.batchId).filter(Boolean)))
    .map((batchId) => {
      const rows = shiftRequests.filter((s) => s.batchId === batchId).sort((a, b) => (a.date > b.date ? 1 : -1));
      return { batchId, targetMonth: rows[0]?.targetMonth, rows };
    })
    .sort((a, b) => (a.targetMonth < b.targetMonth ? 1 : -1));

  const upcomingCard = (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
      <div className="px-5 py-3.5 border-b border-slate-100 flex items-center gap-2">
        <CalendarDays size={15} className="text-slate-400" />
        <h2 className="font-bold text-[13.5px]">確定シフト</h2>
        <button
          onClick={onOpenShiftModal}
          className="ml-auto flex items-center gap-1.5 bg-amber-600 text-white text-[12.5px] font-bold px-3 py-1.5 rounded-lg shadow-sm active:brightness-95"
        >
          <Plus size={13} strokeWidth={2.5} /> 月間シフト希望
        </button>
      </div>
      {confirmedShifts.length === 0 ? (
        <div className="px-5 py-10 text-center text-[12.5px] text-slate-300">確定しているシフトはまだありません</div>
      ) : (
        <div className="divide-y divide-slate-100 max-h-80 overflow-y-auto">
          {confirmedShifts.map((s) => (
            <div key={s.id} className="px-5 py-2.5 flex items-center justify-between">
              <span className="text-[13px] font-semibold text-slate-800">{dateLabel(s.date)}</span>
              {s.dayType === 'work' ? (
                <span className="font-mono text-[13px] text-slate-600">{s.startTime} - {s.endTime}</span>
              ) : (
                <span className={`text-[12px] font-bold ${s.dayType === 'paid_leave' ? 'text-amber-600' : 'text-slate-400'}`}>
                  {DAY_TYPE_META[s.dayType]?.label || '×'}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const requestsCard = (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
      <div className="px-5 py-3.5 border-b border-slate-100 flex items-center gap-2">
        <ListChecks size={15} className="text-slate-400" />
        <h2 className="font-bold text-[13.5px]">希望シフトの状況</h2>
        {pendingRequests.length > 0 && <span className="ml-auto text-[11px] bg-amber-600 text-white rounded-full px-2 py-0.5 font-bold">{pendingRequests.length}</span>}
      </div>
      {batches.length === 0 ? (
        <div className="px-5 py-10 text-center text-[12.5px] text-slate-300">まだシフト希望を出していません</div>
      ) : (
        <div className="divide-y divide-slate-100">
          {batches.map((b) => {
            const confirmedCount = b.rows.filter((r) => r.status === 'confirmed').length;
            const pendingCount = b.rows.filter((r) => r.status === 'pending').length;
            const rejectedCount = b.rows.filter((r) => r.status === 'rejected').length;
            return (
              <div key={b.batchId} className="px-5 py-3.5">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[13px] font-bold text-slate-800">{monthKeyLabel(b.targetMonth)}分（{b.rows.length}日）</span>
                  {pendingCount > 0 ? (
                    <LeaveStatusBadge status="pending" />
                  ) : rejectedCount > 0 && confirmedCount === 0 ? (
                    <LeaveStatusBadge status="rejected" />
                  ) : (
                    <LeaveStatusBadge status="approved" />
                  )}
                </div>
                <div className="text-[11.5px] text-slate-400">
                  確定 {confirmedCount}日　承認待ち {pendingCount}日{rejectedCount > 0 && `　却下 ${rejectedCount}日`}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  if (isDesktop) {
    return (
      <div className="grid grid-cols-2 gap-5 items-start">
        {upcomingCard}
        {requestsCard}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {upcomingCard}
      {requestsCard}
    </div>
  );
}

function MonthlyShiftModal({ leaveRemaining, onClose, onSubmit }) {
  const targetMonth = nextMonthKey();
  const dayList = daysInMonthList(targetMonth);
  const [days, setDays] = useState<Record<string, any>>(() =>
    dayList.reduce((acc, d) => {
      acc[d.date] = { dayType: 'work', startTime: '09:00', endTime: '18:00' };
      return acc;
    }, {})
  );

  const setDayType = (date, dayType) => {
    setDays((prev) => ({ ...prev, [date]: { ...prev[date], dayType } }));
  };
  const setDayTime = (date, field, value) => {
    setDays((prev) => ({ ...prev, [date]: { ...prev[date], [field]: value } }));
  };

  const paidLeaveCount = Object.values(days).filter((d) => d.dayType === 'paid_leave').length;
  const workCount = Object.values(days).filter((d) => d.dayType === 'work').length;
  const offCount = Object.values(days).filter((d) => d.dayType === 'off').length;
  const exceedsLeave = paidLeaveCount > leaveRemaining;
  const canSubmit = !exceedsLeave;

  const submit = () => {
    if (!canSubmit) return;
    const payload = {
      targetMonth,
      days: dayList.map((d) => ({
        date: d.date,
        dayType: days[d.date].dayType,
        startTime: days[d.date].startTime,
        endTime: days[d.date].endTime,
      })),
    };
    onSubmit(payload);
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-40 p-0 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[92vh] overflow-y-auto flex flex-col">
        <div className="px-5 pt-5 pb-3 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white z-10">
          <div>
            <h3 className="font-bold text-[15px]">{monthKeyLabel(targetMonth)}分のシフト希望</h3>
            <p className="text-[11px] text-slate-400 mt-0.5">毎月15日までに翌月分を提出してください</p>
          </div>
          <button onClick={onClose} className="text-slate-400 text-xl leading-none px-1">×</button>
        </div>

        {isPastShiftDeadline() && (
          <div className="mx-5 mt-3 flex items-start gap-2 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 text-[11.5px] text-rose-700">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            <span>提出期限（毎月15日）を過ぎています。念のため管理者にも直接ご連絡ください。</span>
          </div>
        )}

        <div className="px-5 py-3 flex items-center gap-4 text-[11.5px] text-slate-500 border-b border-slate-100">
          <span>○ 出勤 <b className="text-slate-700">{workCount}日</b></span>
          <span>× 休み <b className="text-slate-700">{offCount}日</b></span>
          <span className={exceedsLeave ? 'text-rose-600 font-bold' : ''}>有休 <b>{paidLeaveCount}日</b> / 残{leaveRemaining}日</span>
        </div>
        {exceedsLeave && (
          <div className="mx-5 mt-2 text-[11.5px] text-rose-600 font-medium">有休の残日数を超えています。有休の選択日数を減らしてください</div>
        )}

        <div className="px-5 py-3 divide-y divide-slate-100">
          {dayList.map((d) => {
            const entry = days[d.date];
            return (
              <div key={d.date} className="py-2.5 flex items-center gap-2">
                <div className={`w-14 shrink-0 text-[12.5px] font-mono ${d.isWeekend ? 'text-rose-500' : 'text-slate-600'}`}>
                  {d.day}日({d.weekday})
                </div>
                <div className="flex gap-1 shrink-0">
                  {['work', 'off', 'paid_leave'].map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setDayType(d.date, t)}
                      className={`w-9 h-8 rounded-md text-[11px] font-bold border-2 transition-colors ${
                        entry.dayType === t
                          ? t === 'work' ? 'border-emerald-500 bg-emerald-50 text-emerald-600'
                          : t === 'off' ? 'border-slate-400 bg-slate-100 text-slate-600'
                          : 'border-amber-600 bg-amber-50 text-amber-600'
                          : 'border-slate-200 text-slate-300'
                      }`}
                    >
                      {DAY_TYPE_META[t].label}
                    </button>
                  ))}
                </div>
                {entry.dayType === 'work' && (
                  <div className="flex items-center gap-1 flex-1 min-w-0">
                    <input
                      type="time"
                      value={entry.startTime}
                      onChange={(e) => setDayTime(d.date, 'startTime', e.target.value)}
                      className="w-full border border-slate-200 rounded-md px-1.5 py-1 font-mono text-[11.5px] min-w-0"
                    />
                    <span className="text-slate-300 text-[11px]">-</span>
                    <input
                      type="time"
                      value={entry.endTime}
                      onChange={(e) => setDayTime(d.date, 'endTime', e.target.value)}
                      className="w-full border border-slate-200 rounded-md px-1.5 py-1 font-mono text-[11.5px] min-w-0"
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="px-5 py-3 border-t border-slate-100 flex items-start gap-2 bg-slate-50 text-[11.5px] text-slate-500">
          <Mail size={13} className="mt-0.5 shrink-0" />
          <span>提出すると管理者にメール通知が送信されます。有休として選んだ日は、休暇申請としても自動で登録されます</span>
        </div>
        <div className="px-5 pb-5 pt-3 flex gap-2 sticky bottom-0 bg-white border-t border-slate-100">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-lg border border-slate-200 text-[13.5px] font-medium text-slate-500">キャンセル</button>
          <button
            onClick={submit}
            disabled={!canSubmit}
            className="flex-1 py-2.5 rounded-lg bg-amber-600 disabled:bg-slate-200 text-white text-[13.5px] font-bold"
          >
            {monthKeyLabel(targetMonth)}分を提出
          </button>
        </div>
      </div>
    </div>
  );
}

function PerformanceView({ reports, onOpenModal, isDesktop }) {
  const actionsCard = (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
      <div className="px-5 py-3.5 border-b border-slate-100 flex items-center gap-2">
        <ClipboardList size={15} className="text-slate-400" />
        <h2 className="font-bold text-[13.5px]">実績を提出</h2>
      </div>
      <div className="p-5 grid grid-cols-2 gap-3">
        <button
          onClick={() => onOpenModal('half')}
          className="py-4 rounded-xl border-2 border-slate-200 hover:border-amber-600 flex flex-col items-center gap-1.5 transition-colors"
        >
          <CalendarDays size={18} className="text-amber-600" />
          <span className="text-[12.5px] font-bold text-slate-800">半月実績</span>
          <span className="text-[10px] text-slate-400">前半・後半ごと</span>
        </button>
        <button
          onClick={() => onOpenModal('month')}
          className="py-4 rounded-xl border-2 border-slate-200 hover:border-amber-600 flex flex-col items-center gap-1.5 transition-colors"
        >
          <ClipboardList size={18} className="text-amber-600" />
          <span className="text-[12.5px] font-bold text-slate-800">月末まとめ</span>
          <span className="text-[10px] text-slate-400">月全体の集計</span>
        </button>
      </div>
    </div>
  );

  const listCard = (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
      <div className="px-5 py-3.5 border-b border-slate-100 flex items-center gap-2">
        <Calendar size={15} className="text-slate-400" />
        <h2 className="font-bold text-[13.5px]">提出履歴</h2>
      </div>
      {reports.length === 0 ? (
        <div className="px-5 py-10 text-center text-[12.5px] text-slate-300">まだ実績を提出していません</div>
      ) : (
        <div className="divide-y divide-slate-100">
          {reports.map((r) => (
            <div key={r.id} className="px-5 py-3.5">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md">{r.type === 'half' ? '半月' : '月末'}</span>
                  <span className="text-[13px] font-semibold text-slate-800">{r.periodLabel}</span>
                </div>
                <LeaveStatusBadge status={r.status === 'approved' ? 'approved' : r.status} />
              </div>
              <div className="text-[12px] text-slate-500 whitespace-pre-wrap">{r.summary}</div>
              {r.numericValue !== null && r.numericValue !== '' && (
                <div className="text-[11.5px] text-slate-400 mt-1">{r.numericLabel || '実績値'}：<span className="font-mono font-semibold text-slate-600">{r.numericValue}</span></div>
              )}
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
  );

  if (isDesktop) {
    return (
      <div className="grid grid-cols-[300px_1fr] gap-5 items-start">
        {actionsCard}
        {listCard}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {actionsCard}
      {listCard}
    </div>
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

  return (
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
    </div>
  );
}

function AdminDashboardTab({ missingCount, correctionCount, leaveCount, shiftCount, performanceCount, gpsAlertCount, employeeCount, onNavigate, isDesktop }) {
  const alertRows = [
    { label: '打刻漏れ・打刻間違い', count: missingCount, tab: 'requests', icon: <AlertTriangle size={14} /> },
    { label: '位置情報が5回以上連続で未記録', count: gpsAlertCount, tab: 'attendance', icon: <MapPin size={14} /> },
  ];
  const unapprovedRows = [
    { label: '未承認の勤怠修正申請', count: correctionCount, tab: 'requests', icon: <FileEdit size={14} /> },
    { label: '未承認の休暇申請', count: leaveCount, tab: 'leave', icon: <Palmtree size={14} /> },
    { label: '未承認のシフト希望', count: shiftCount, tab: 'shift', icon: <CalendarDays size={14} /> },
    { label: '未承認の実績報告', count: performanceCount, tab: 'performance', icon: <ClipboardList size={14} /> },
  ];
  const quickLinks = [
    { label: '勤怠一覧', tab: 'attendance', icon: <Clock size={17} /> },
    { label: '社員管理', tab: 'accounts', icon: <Users size={17} /> },
    { label: '休暇申請', tab: 'leave', icon: <Palmtree size={17} /> },
    { label: 'シフト', tab: 'shift', icon: <CalendarDays size={17} /> },
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

function computePayrollPreview({ wageType, hourlyWage, monthlySalary, workedMinutes, overtimeMinutes, commuteAllowance = 0 }) {
  const regularMinutes = Math.max(0, workedMinutes - overtimeMinutes);
  let baseAmount = 0;
  let overtimeAmount = 0;
  let wageRate = 0;
  if (wageType === 'hourly') {
    wageRate = Number(hourlyWage) || 0;
    baseAmount = Math.round((regularMinutes / 60) * wageRate);
    overtimeAmount = Math.round((overtimeMinutes / 60) * wageRate * OVERTIME_MULTIPLIER);
  } else {
    wageRate = Number(monthlySalary) || 0;
    baseAmount = Math.round(wageRate);
    const hourlyEquivalent = wageRate / MONTHLY_STANDARD_HOURS;
    overtimeAmount = Math.round((overtimeMinutes / 60) * hourlyEquivalent * OVERTIME_MULTIPLIER);
  }
  const allowanceAmount = Math.round(Number(commuteAllowance) || 0);
  return { wageRate, regularMinutes, baseAmount, overtimeAmount, allowanceAmount, totalAmount: baseAmount + overtimeAmount + allowanceAmount };
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

function PayrollAdminTab({ employeeAccounts, records, payrollRecords, onSaveDraft, onPublish, onUpdateWage, isDesktop }) {
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
  const preview = computePayrollPreview({
    wageType,
    hourlyWage,
    monthlySalary,
    workedMinutes: monthly.workedMin,
    overtimeMinutes: monthly.overtimeMin,
    commuteAllowance: employee.commuteAllowance || 0,
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
      notes: preview.allowanceAmount > 0 ? `交通費 ${formatYen(preview.allowanceAmount)} を基本給に含む` : null,
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
            <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[14px] bg-white">
              {employeeAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
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

function AdminTopNav({ tab, setTab, correctionCount, leaveCount, shiftCount, performanceCount }) {
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
      tabs: ['leave', 'shift', 'performance', 'groupleave'],
      items: [
        { tab: 'leave', label: '休暇申請', sub: '承認・却下', badge: leaveCount },
        { tab: 'shift', label: 'シフト希望', sub: '確定・却下', badge: shiftCount },
        { tab: 'performance', label: '実績報告', sub: '承認・却下', badge: performanceCount },
        { tab: 'groupleave', label: 'グループ休暇設定', sub: '月別規定日数' },
      ],
    },
    {
      key: 'staff-group',
      label: 'スタッフ管理',
      tabs: ['accounts', 'auditlog'],
      items: [
        { tab: 'accounts', label: '社員一覧・登録', sub: '入退職日・有休管理' },
        { tab: 'auditlog', label: '監査ログ', sub: '承認・操作の履歴' },
      ],
    },
  ];

  const totalBadge = correctionCount + leaveCount + shiftCount + performanceCount;

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

function AdminView({ data, employeeAccounts, onDecide, onDecideLeave, onDecideShift, onDecideShiftBatch, onAddShift, onDecidePerformance, onAddAccount, onUpdateDates, onSaveGroupLeave, isDesktop }) {
  const [tab, setTab] = useState('dashboard'); // dashboard | attendance | requests | leave | shift | performance | accounts
  const pending = data.corrections.filter((c) => c.status === 'pending');
  const decided = data.corrections.filter((c) => c.status !== 'pending').slice(0, 8);
  const leavePending = data.leaveRequests.filter((l) => l.status === 'pending');
  const leaveDecided = data.leaveRequests.filter((l) => l.status !== 'pending').slice(0, 8);
  const shiftPending = data.shiftRequests.filter((s) => s.status === 'pending');
  const shiftConfirmed = data.shiftRequests.filter((s) => s.status === 'confirmed' && s.date >= todayKey()).sort((a, b) => (a.date > b.date ? 1 : -1)).slice(0, 12);
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

  const notifications = (data.notifications || []).slice(0, 6);

  return (
    <div className="space-y-5">
      {isDesktop ? (
        <AdminTopNav
          tab={tab}
          setTab={setTab}
          correctionCount={pending.length}
          leaveCount={leavePending.length}
          shiftCount={shiftPending.length}
          performanceCount={performancePending.length}
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
          <button onClick={() => setTab('shift')} className={`relative flex-1 py-2 rounded-lg transition-colors whitespace-nowrap px-2 ${tab === 'shift' ? 'bg-slate-800 text-white' : 'text-slate-500'}`}>
            シフト
            {shiftPending.length > 0 && tab !== 'shift' && (
              <span className="absolute -top-1 -right-0.5 w-4 h-4 bg-amber-600 rounded-full text-[9px] flex items-center justify-center text-white font-bold">
                {shiftPending.length}
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
            休暇設定
          </button>
          <button onClick={() => setTab('auditlog')} className={`flex-1 py-2 rounded-lg transition-colors whitespace-nowrap px-2 ${tab === 'auditlog' ? 'bg-slate-800 text-white' : 'text-slate-500'}`}>
            監査ログ
          </button>
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
          shiftCount={shiftPending.length}
          performanceCount={performancePending.length}
          gpsAlertCount={gpsAlerts.length}
          employeeCount={employeeAccounts.length}
          onNavigate={setTab}
          isDesktop={isDesktop}
        />
      )}

      {tab === 'attendance' && (
        <AttendanceAdminTab data={data} employeeAccounts={employeeAccounts} gpsAlerts={gpsAlerts} isDesktop={isDesktop} />
      )}

      {tab === 'accounts' && (
        <AccountManagement employeeAccounts={employeeAccounts} onAddAccount={onAddAccount} onUpdateDates={onUpdateDates} groupLeaveSchedules={data.groupLeaveSchedules} isDesktop={isDesktop} />
      )}

      {tab === 'auditlog' && (
        <AdminAuditLogTab logs={data.auditLogs} isDesktop={isDesktop} />
      )}

      {tab === 'groupleave' && (
        <GroupLeaveScheduleTab
          employeeAccounts={employeeAccounts}
          groupLeaveSchedules={data.groupLeaveSchedules}
          onSave={onSaveGroupLeave}
          isDesktop={isDesktop}
        />
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

      {tab === 'shift' && (
        <ShiftAdminTab
          employeeAccounts={employeeAccounts}
          shiftPending={shiftPending}
          shiftConfirmed={shiftConfirmed}
          onDecideShift={onDecideShift}
          onDecideShiftBatch={onDecideShiftBatch}
          onAddShift={onAddShift}
          isDesktop={isDesktop}
        />
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

function ShiftAdminTab({ employeeAccounts, shiftPending, shiftConfirmed, onDecideShift, onDecideShiftBatch, onAddShift, isDesktop }) {
  const [empId, setEmpId] = useState(employeeAccounts[0]?.id || '');
  const [date, setDate] = useState(todayKey());
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('18:00');
  const [note, setNote] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const canSubmit = empId && date && startTime && endTime && startTime < endTime;

  const submit = (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    onAddShift({ employeeId: empId, date, startTime, endTime, note });
    setNote('');
  };

  const batchGroups = Array.from(new Set<string>(shiftPending.map((s) => String(s.batchId || s.id)))).map((key) => {
    const rows = shiftPending.filter((s) => (s.batchId || s.id) === key).sort((a, b) => (a.date > b.date ? 1 : -1));
    return { key, batchId: rows[0]?.batchId, employeeName: rows[0]?.employeeName, targetMonth: rows[0]?.targetMonth, rows };
  });

  const pendingCard = (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
      <div className="px-5 py-3.5 border-b border-slate-100 flex items-center gap-2">
        <ListChecks size={15} className="text-slate-400" />
        <h2 className="font-bold text-[13.5px]">シフト希望</h2>
        {shiftPending.length > 0 && <span className="ml-auto text-[11px] bg-amber-600 text-white rounded-full px-2 py-0.5 font-bold">{shiftPending.length}</span>}
      </div>
      {batchGroups.length === 0 ? (
        <div className="px-5 py-8 text-center text-[12.5px] text-slate-300">届いている希望はありません</div>
      ) : (
        <div className="divide-y divide-slate-100">
          {batchGroups.map((g) => {
            const isOpen = expanded[g.key];
            return (
              <div key={g.key} className="px-5 py-4">
                <div className="flex items-center justify-between mb-2">
                  <button onClick={() => setExpanded((e) => ({ ...e, [g.key]: !e[g.key] }))} className="text-left">
                    <div className="text-[13px] font-semibold text-slate-800">
                      {g.employeeName} {g.targetMonth ? `— ${monthKeyLabel(g.targetMonth)}分` : `— ${dateLabel(g.rows[0].date)}`}
                    </div>
                    <div className="text-[11px] text-slate-400">{g.rows.length}日分 ・タップで詳細{isOpen ? 'を閉じる' : 'を表示'}</div>
                  </button>
                  <div className="text-[10.5px] text-slate-400">{new Date(g.rows[0].submittedAt).toLocaleString('ja-JP')}</div>
                </div>

                {isOpen && (
                  <div className="mb-3 max-h-56 overflow-y-auto rounded-lg border border-slate-100 divide-y divide-slate-100">
                    {g.rows.map((s) => (
                      <div key={s.id} className="px-3 py-1.5 flex items-center justify-between text-[12px]">
                        <span className="font-mono text-slate-600">{dateLabel(s.date)}</span>
                        {s.dayType === 'work' ? (
                          <span className="font-mono text-slate-500">{s.startTime} - {s.endTime}</span>
                        ) : (
                          <span className={`font-bold ${s.dayType === 'paid_leave' ? 'text-amber-600' : 'text-slate-400'}`}>
                            {DAY_TYPE_META[s.dayType]?.label || '×'}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex gap-2">
                  <button
                    onClick={() => g.batchId ? onDecideShiftBatch(g.batchId, 'rejected') : onDecideShift(g.rows[0].id, 'rejected')}
                    className="flex-1 flex items-center justify-center gap-1 py-2 rounded-lg border border-slate-200 text-[12.5px] font-medium text-slate-500"
                  >
                    <XCircle size={13} /> まとめて却下
                  </button>
                  <button
                    onClick={() => g.batchId ? onDecideShiftBatch(g.batchId, 'confirmed') : onDecideShift(g.rows[0].id, 'confirmed')}
                    className="flex-1 flex items-center justify-center gap-1 py-2 rounded-lg bg-emerald-600 text-white text-[12.5px] font-bold"
                  >
                    <CheckCircle2 size={13} /> まとめて確定
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  const confirmedCard = (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
      <div className="px-5 py-3.5 border-b border-slate-100">
        <h2 className="font-bold text-[13.5px]">確定シフト（直近）</h2>
      </div>
      {shiftConfirmed.length === 0 ? (
        <div className="px-5 py-8 text-center text-[12.5px] text-slate-300">確定しているシフトはありません</div>
      ) : (
        <div className="divide-y divide-slate-100">
          {shiftConfirmed.map((s) => (
            <div key={s.id} className="px-5 py-2.5 flex items-center justify-between text-[12.5px]">
              <span>{s.employeeName} — {dateLabel(s.date)}</span>
              {s.dayType === 'work' || !s.dayType ? (
                <span className="font-mono text-slate-500">{s.startTime} - {s.endTime}</span>
              ) : (
                <span className={`font-bold ${s.dayType === 'paid_leave' ? 'text-amber-600' : 'text-slate-400'}`}>
                  {DAY_TYPE_META[s.dayType]?.label || '×'}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const formCard = (
    <form onSubmit={submit} className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 space-y-3.5 h-fit">
      <h3 className="font-bold text-[13.5px] mb-1">シフトを直接登録</h3>
      <Field label="社員">
        <select value={empId} onChange={(e) => setEmpId(e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[14px] bg-white">
          {employeeAccounts.map((acc) => (
            <option key={acc.id} value={acc.id}>{acc.name}</option>
          ))}
        </select>
      </Field>
      <Field label="日付">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 font-mono text-[14px]" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="開始時刻">
          <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 font-mono text-[14px]" />
        </Field>
        <Field label="終了時刻">
          <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 font-mono text-[14px]" />
        </Field>
      </div>
      <Field label="メモ（任意）">
        <input value={note} onChange={(e) => setNote(e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13.5px]" placeholder="例）応援シフト" />
      </Field>
      <button type="submit" disabled={!canSubmit} className="w-full py-2.5 rounded-lg bg-slate-800 disabled:bg-slate-200 text-white text-[13.5px] font-bold">
        登録する
      </button>
    </form>
  );

  if (isDesktop) {
    return (
      <div className="grid grid-cols-2 gap-5 items-start">
        <div className="space-y-5">{pendingCard}{confirmedCard}</div>
        {formCard}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {pendingCard}
      {formCard}
      {confirmedCard}
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


function AttendanceAdminTab({ data, employeeAccounts, gpsAlerts = [], isDesktop }) {
  const now = new Date();
  const [month, setMonth] = useState(`${now.getFullYear()}-${pad(now.getMonth() + 1)}`);
  const [employeeFilter, setEmployeeFilter] = useState('all');
  const [groupFilter, setGroupFilter] = useState('all');
  const gpsAlertIds = new Set(gpsAlerts.map((g) => g.employeeId));
  const groups = Array.from(new Set(employeeAccounts.map((a) => a.mainGroup).filter(Boolean)));

  const filteredAccounts = employeeAccounts.filter((acc) => {
    if (groupFilter !== 'all' && acc.mainGroup !== groupFilter) return false;
    if (employeeFilter !== 'all' && acc.id !== employeeFilter) return false;
    return true;
  });

  const rows = [];
  filteredAccounts.forEach((acc) => {
    const recs = data.records[acc.id] || {};
    Object.values(recs).forEach((record) => {
      if (!record?.date || !record.date.startsWith(month)) return;
      const metrics = computeMetrics(record);
      rows.push({
        employeeId: acc.id,
        employeeName: acc.name,
        date: record.date,
        clockIn: record.clockIn ? hhmm(new Date(record.clockIn)) : '',
        clockOut: record.clockOut ? hhmm(new Date(record.clockOut)) : '',
        breakMin: getRecordedBreakMinutes(record, record.clockOut ? new Date(record.clockOut) : new Date()),
        workedMin: metrics?.workedMin ?? 0,
        overtimeMin: metrics?.overtimeMin ?? 0,
        lateMin: metrics?.lateMin ?? 0,
        earlyLeaveMin: metrics?.earlyLeaveMin ?? 0,
        status: computeDayStatus(record).label,
      });
    });
  });
  rows.sort((a, b) => a.date === b.date ? a.employeeName.localeCompare(b.employeeName, 'ja') : (a.date < b.date ? 1 : -1));

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
    const header = ['社員名','日付','出勤','退勤','休憩(分)','実働','残業','遅刻(分)','早退(分)','状態'];
    const body = rows.map((r) => [r.employeeName,r.date,r.clockIn,r.clockOut,r.breakMin,minutesToHHMM(r.workedMin),minutesToHHMM(r.overtimeMin),r.lateMin,r.earlyLeaveMin,r.status]);
    const csv = '\uFEFF' + [header, ...body].map((line) => line.map(escapeCsv).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `brown-work-attendance-${month}${employeeFilter === 'all' ? '-all' : ''}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">
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
        <Field label="対象月">
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="border border-slate-200 rounded-lg px-3 py-2 font-mono text-[13px] bg-white" />
        </Field>
        {groups.length > 0 && (
          <Field label="グループ">
            <select value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)} className="border border-slate-200 rounded-lg px-3 py-2 text-[13px] bg-white min-w-[140px]">
              <option value="all">全グループ</option>
              {groups.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </Field>
        )}
        <Field label="社員">
          <select value={employeeFilter} onChange={(e) => setEmployeeFilter(e.target.value)} className="border border-slate-200 rounded-lg px-3 py-2 text-[13px] bg-white min-w-[180px]">
            <option value="all">全社員</option>
            {employeeAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>
        <button onClick={exportCsv} disabled={rows.length === 0} className="ml-auto flex items-center gap-1.5 rounded-lg bg-slate-900 disabled:bg-slate-200 text-white px-4 py-2.5 text-[12.5px] font-bold">
          <Download size={14} /> CSV出力
        </button>
      </div>

      <div className={`grid gap-3 ${isDesktop ? 'grid-cols-4' : 'grid-cols-2'}`}>
        <StatMini label="対象社員" value={`${summaryByEmployee.length}名`} />
        <StatMini label="出勤日数" value={`${summaryByEmployee.reduce((s, x) => s + x.days, 0)}日`} />
        <StatMini label="総実働" value={minutesToHHMM(summaryByEmployee.reduce((s, x) => s + x.workedMin, 0))} />
        <StatMini label="総残業" value={minutesToHHMM(summaryByEmployee.reduce((s, x) => s + x.overtimeMin, 0))} />
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-100 flex items-center gap-2">
          <Clock size={15} className="text-slate-400" />
          <h2 className="font-bold text-[13.5px]">月次勤怠一覧</h2>
          <span className="ml-auto text-[11px] text-slate-400">{rows.length}件</span>
        </div>
        {rows.length === 0 ? (
          <div className="px-5 py-10 text-center text-[12.5px] text-slate-300">対象月の勤怠データはありません</div>
        ) : isDesktop ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-[12.5px]">
              <thead><tr className="text-left text-[10.5px] text-slate-400 border-b border-slate-100">
                {['社員','日付','出勤','退勤','休憩','実働','残業','遅刻','早退','状態'].map((h) => <th key={h} className="px-4 py-2 font-medium">{h}</th>)}
              </tr></thead>
              <tbody>{rows.map((r) => <tr key={`${r.employeeId}-${r.date}`} className="border-b border-slate-100 last:border-0">
                <td className="px-4 py-2.5 font-semibold">{r.employeeName}</td><td className="px-4 py-2.5 font-mono">{r.date}</td><td className="px-4 py-2.5 font-mono">{r.clockIn || '--:--'}</td><td className="px-4 py-2.5 font-mono">{r.clockOut || '--:--'}</td><td className="px-4 py-2.5">{r.breakMin}分</td><td className="px-4 py-2.5 font-mono font-semibold">{minutesToHHMM(r.workedMin)}</td><td className="px-4 py-2.5 font-mono">{minutesToHHMM(r.overtimeMin)}</td><td className="px-4 py-2.5">{r.lateMin}分</td><td className="px-4 py-2.5">{r.earlyLeaveMin}分</td><td className="px-4 py-2.5">{r.status}</td>
              </tr>)}</tbody>
            </table>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">{rows.map((r) => <div key={`${r.employeeId}-${r.date}`} className="px-4 py-3">
            <div className="flex items-center justify-between"><div className="font-semibold text-[13px]">{r.employeeName}</div><div className="font-mono text-[11.5px] text-slate-400">{r.date}</div></div>
            <div className="mt-1.5 grid grid-cols-4 gap-2 text-center"><MiniValue label="出勤" value={r.clockIn || '--:--'} /><MiniValue label="退勤" value={r.clockOut || '--:--'} /><MiniValue label="休憩" value={`${r.breakMin}分`} /><MiniValue label="実働" value={minutesToHHMM(r.workedMin)} /></div>
            <div className="mt-2 text-[11px] text-slate-400">{r.status}{r.overtimeMin > 0 ? ` ・ 残業 ${minutesToHHMM(r.overtimeMin)}` : ''}{r.lateMin > 0 ? ` ・ 遅刻 ${r.lateMin}分` : ''}{r.earlyLeaveMin > 0 ? ` ・ 早退 ${r.earlyLeaveMin}分` : ''}</div>
          </div>)}</div>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-100 font-bold text-[13.5px]">社員別集計</div>
        <div className="divide-y divide-slate-100">{summaryByEmployee.map((s) => <div key={s.id} className="px-5 py-3 flex items-center justify-between gap-3 text-[12px]">
          <span className="font-semibold text-slate-800 flex items-center gap-1.5">{s.name}{s.gpsAlert && <MapPin size={12} className="text-rose-500" />}</span><span className="text-slate-500 text-right">{s.days}日 / 実働 <b className="font-mono text-slate-800">{minutesToHHMM(s.workedMin)}</b> / 残業 <b className="font-mono text-slate-800">{minutesToHHMM(s.overtimeMin)}</b>{s.missingCount > 0 ? ` / 未退勤 ${s.missingCount}件` : ''}</span>
        </div>)}</div>
      </div>
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

  return (
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
    </div>
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
        メイングループごとに、月ごとの休暇付与日数を設定できます（1月〜12月の累計で当年分を計算）。対象は社員・契約社員のみで、パート・アルバイトには適用されません（比例付与が優先されます）。設定が無いグループは、これまで通り法定の自動計算が使われます。
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
              <p className="text-[11px] text-slate-400 mt-0.5">月ごとの付与日数（累計 {total}日／年）</p>
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

function AccountManagement({ employeeAccounts, onAddAccount, onUpdateDates, groupLeaveSchedules, isDesktop }) {
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [hireDate, setHireDate] = useState(todayKey());
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editHire, setEditHire] = useState('');
  const [editResign, setEditResign] = useState('');
  const [profileModalAccount, setProfileModalAccount] = useState(null);
  const [csvModalOpen, setCsvModalOpen] = useState(false);

  const canSubmit = name.trim() && username.trim() && password.trim().length >= 4 && hireDate;

  const submit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    const ok = await onAddAccount({ name: name.trim(), username: username.trim(), password: password.trim(), hireDate });
    if (ok) {
      setName('');
      setUsername('');
      setPassword('');
      setHireDate(todayKey());
      setShowForm(false);
    }
  };

  const startEdit = (acc) => {
    setEditingId(acc.id);
    setEditHire(acc.hireDate || todayKey());
    setEditResign(acc.resignationDate || '');
  };

  const saveEdit = (id) => {
    onUpdateDates(id, { hireDate: editHire, resignationDate: editResign || null });
    setEditingId(null);
  };

  const employeeRow = (acc) => {
    const isEditing = editingId === acc.id;
    const granted = computeLeaveTotal(acc, new Date(), groupLeaveSchedules);
    const retired = acc.resignationDate && acc.resignationDate <= todayKey();
    return { acc, isEditing, granted, retired };
  };

  const listCard = (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
      <div className="px-5 py-3.5 border-b border-slate-100 flex items-center gap-2">
        <Users size={15} className="text-slate-400" />
        <h2 className="font-bold text-[13.5px]">社員一覧</h2>
        <span className="text-[11px] text-slate-400">{employeeAccounts.length}名</span>
        <button onClick={() => setCsvModalOpen(true)} className="ml-auto flex items-center gap-1 text-[12px] font-bold text-slate-500 border border-slate-200 rounded-lg px-2.5 py-1.5">
          <Download size={13} className="rotate-180" /> CSV一括登録
        </button>
        {!isDesktop && (
          <button onClick={() => setShowForm((v) => !v)} className="flex items-center gap-1 text-[12px] font-bold text-amber-600">
            <UserPlus size={14} /> 追加
          </button>
        )}
      </div>
      {isDesktop ? (
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left text-[11px] text-slate-400 border-b border-slate-100">
              <th className="px-5 py-2 font-medium">氏名</th>
              <th className="px-5 py-2 font-medium">ログインID</th>
              <th className="px-5 py-2 font-medium">入職日</th>
              <th className="px-5 py-2 font-medium">退職日</th>
              <th className="px-5 py-2 font-medium">法定有休（自動計算）</th>
              <th className="px-5 py-2 font-medium"></th>
              <th className="px-5 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {employeeAccounts.map((acc) => {
              const { isEditing, granted, retired } = employeeRow(acc);
              return (
                <tr key={acc.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-5 py-2.5 font-semibold text-slate-800">
                    {acc.name}
                    {retired && <span className="ml-1.5 text-[10px] font-bold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">退職済み</span>}
                  </td>
                  <td className="px-5 py-2.5 font-mono text-slate-500">{acc.username}</td>
                  {isEditing ? (
                    <>
                      <td className="px-5 py-2.5"><input type="date" value={editHire} onChange={(e) => setEditHire(e.target.value)} className="border border-slate-200 rounded-md px-2 py-1 font-mono text-[12px]" /></td>
                      <td className="px-5 py-2.5"><input type="date" value={editResign} onChange={(e) => setEditResign(e.target.value)} className="border border-slate-200 rounded-md px-2 py-1 font-mono text-[12px]" /></td>
                      <td className="px-5 py-2.5 font-mono text-slate-400">{computeStatutoryPaidLeaveDays(editHire)}日</td>
                      <td className="px-5 py-2.5"><button onClick={() => saveEdit(acc.id)} className="text-[11px] font-bold text-amber-600">保存</button></td>
                      <td className="px-5 py-2.5"></td>
                    </>
                  ) : (
                    <>
                      <td className="px-5 py-2.5 font-mono text-slate-500">{acc.hireDate || '未設定'}</td>
                      <td className="px-5 py-2.5 font-mono text-slate-400">{acc.resignationDate || '在籍中'}</td>
                      <td className="px-5 py-2.5 font-mono font-semibold text-slate-800">{granted}日</td>
                      <td className="px-5 py-2.5"><button onClick={() => startEdit(acc)} className="text-slate-400"><Pencil size={13} /></button></td>
                      <td className="px-5 py-2.5"><button onClick={() => setProfileModalAccount(acc)} className="text-[11px] font-bold text-slate-500 border border-slate-200 rounded-md px-2 py-1">詳細</button></td>
                    </>
                  )}
                </tr>
              );
            })}
            {employeeAccounts.length === 0 && (
              <tr><td colSpan={7} className="px-5 py-8 text-center text-[12.5px] text-slate-300">社員アカウントがありません</td></tr>
            )}
          </tbody>
        </table>
      ) : (
        <div className="divide-y divide-slate-100">
          {employeeAccounts.map((acc) => {
            const { isEditing, granted, retired } = employeeRow(acc);
            return (
              <div key={acc.id} className="px-5 py-3.5">
                <div className="flex items-center justify-between mb-1.5">
                  <div>
                    <div className="text-[13px] font-semibold text-slate-800 flex items-center gap-1.5">
                      {acc.name}
                      {retired && <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">退職済み</span>}
                    </div>
                    <div className="text-[11.5px] text-slate-400 font-mono">ID: {acc.username}</div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => setProfileModalAccount(acc)} className="text-[11px] font-bold text-slate-500 border border-slate-200 rounded-md px-2 py-1">詳細</button>
                    {!isEditing && (
                      <button onClick={() => startEdit(acc)} className="text-slate-400 p-1"><Pencil size={13} /></button>
                    )}
                  </div>
                </div>
                {isEditing ? (
                  <div className="space-y-2 bg-slate-50 rounded-lg p-3">
                    <Field label="入職日">
                      <input type="date" value={editHire} onChange={(e) => setEditHire(e.target.value)} className="w-full border border-slate-200 rounded-md px-2 py-1.5 font-mono text-[13px] bg-white" />
                    </Field>
                    <Field label="退職日（在籍中は空欄）">
                      <input type="date" value={editResign} onChange={(e) => setEditResign(e.target.value)} className="w-full border border-slate-200 rounded-md px-2 py-1.5 font-mono text-[13px] bg-white" />
                    </Field>
                    <div className="flex gap-2 pt-1">
                      <button onClick={() => setEditingId(null)} className="flex-1 py-1.5 rounded-md border border-slate-200 text-[12px] font-medium text-slate-500">キャンセル</button>
                      <button onClick={() => saveEdit(acc.id)} className="flex-1 py-1.5 rounded-md bg-amber-600 text-white text-[12px] font-bold">保存</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-3 text-[11.5px] text-slate-500 font-mono">
                    <span>入職 {acc.hireDate || '未設定'}</span>
                    <span className="text-amber-600 font-bold">法定有休 {granted}日</span>
                  </div>
                )}
              </div>
            );
          })}
          {employeeAccounts.length === 0 && (
            <div className="px-5 py-8 text-center text-[12.5px] text-slate-300">社員アカウントがありません</div>
          )}
        </div>
      )}
    </div>
  );

  const formCard = (showForm || isDesktop) && (
    <form onSubmit={submit} className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 space-y-3.5 h-fit">
      <h3 className="font-bold text-[13.5px] mb-1">新しい社員アカウントを作成</h3>
      <Field label="氏名">
        <input value={name} onChange={(e) => setName(e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[14px]" placeholder="例）田中 花子" />
      </Field>
      <Field label="ユーザー名（ログインID）">
        <input value={username} onChange={(e) => setUsername(e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 font-mono text-[14px]" placeholder="tanaka" />
      </Field>
      <Field label="パスワード（4文字以上）">
        <input type="text" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 font-mono text-[14px]" placeholder="仮パスワードを入力" />
      </Field>
      <Field label="入職日">
        <input type="date" value={hireDate} onChange={(e) => setHireDate(e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 font-mono text-[14px]" />
      </Field>
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

  if (isDesktop) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-[1fr_320px] gap-5 items-start">
          {listCard}
          {formCard}
        </div>
        {disclaimer}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {listCard}
      {formCard}
      {disclaimer}
      {profileModalAccount && (
        <EmployeeProfileModal
          account={profileModalAccount}
          onClose={() => setProfileModalAccount(null)}
          onSave={onUpdateDates}
        />
      )}
      {csvModalOpen && (
        <CsvImportModal
          onClose={() => setCsvModalOpen(false)}
          onAddAccount={onAddAccount}
        />
      )}
    </div>
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

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-40 p-0 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[92vh] overflow-y-auto">
        <div className="px-5 pt-5 pb-3 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white">
          <h3 className="font-bold text-[15px]">CSVで社員を一括登録</h3>
          <button onClick={onClose} className="text-slate-400 text-xl leading-none px-1">×</button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div className="text-[11.5px] text-slate-500 bg-slate-50 rounded-lg p-3">
            1行目は見出し（<code className="font-mono">name,username,password,hireDate</code>）にしてください。<br />
            2行目以降に1人ずつ、カンマ区切りで入力します。<code className="font-mono">hireDate</code>は省略可（形式：YYYY-MM-DD）。パスワードは4文字以上にしてください。
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
    </div>
  );
}

function EmployeeProfileModal({ account, onClose, onSave }) {
  const [form, setForm] = useState({
    contactEmail: account.contactEmail || '',
    staffNumber: account.staffNumber || '',
    address: account.address || '',
    phone: account.phone || '',
    emergencyContactName: account.emergencyContactName || '',
    emergencyContactPhone: account.emergencyContactPhone || '',
    birthDate: account.birthDate || '',
    staffType: account.staffType || '社員',
    mainGroup: account.mainGroup || '',
    subGroup: account.subGroup || '',
    commuteAllowance: String(account.commuteAllowance || 0),
    nearestStation: account.nearestStation || '',
    staffNote1: account.staffNote1 || '',
    staffNote2: account.staffNote2 || '',
    staffNote3: account.staffNote3 || '',
    leaveAdjustment: String(account.leaveAdjustment || 0),
    scheduledWeeklyDays: account.scheduledWeeklyDays != null ? String(account.scheduledWeeklyDays) : '',
  });
  const [saving, setSaving] = useState(false);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const save = async () => {
    setSaving(true);
    await onSave(account.id, {
      ...form,
      commuteAllowance: Number(form.commuteAllowance) || 0,
      leaveAdjustment: Number(form.leaveAdjustment) || 0,
      scheduledWeeklyDays: form.scheduledWeeklyDays === '' ? null : Number(form.scheduledWeeklyDays),
    });
    setSaving(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-40 p-0 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md max-h-[92vh] overflow-y-auto">
        <div className="px-5 pt-5 pb-3 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white">
          <div>
            <div className="text-[11px] text-slate-400 font-medium">{account.name}</div>
            <h3 className="font-bold text-[15px]">アカウント詳細情報</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 text-xl leading-none px-1">×</button>
        </div>
        <div className="px-5 py-4 space-y-5">
          <div className="space-y-3">
            <div className="text-[11px] font-bold text-slate-400">基本情報</div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="生年月日">
                <input type="date" value={form.birthDate} onChange={set('birthDate')} className="w-full border border-slate-200 rounded-lg px-3 py-2 font-mono text-[13.5px]" />
              </Field>
              <Field label="スタッフ種別">
                <select value={form.staffType} onChange={set('staffType')} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13.5px] bg-white">
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
            <div className="grid grid-cols-2 gap-3">
              <Field label="メイングループ">
                <input value={form.mainGroup} onChange={set('mainGroup')} placeholder="例）第一営業部" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13.5px]" />
              </Field>
              <Field label="サブグループ">
                <input value={form.subGroup} onChange={set('subGroup')} placeholder="任意" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13.5px]" />
              </Field>
            </div>
          </div>

          <div className="space-y-3 pt-1 border-t border-slate-100">
            <div className="text-[11px] font-bold text-slate-400 pt-3">連絡先</div>
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
          </div>

          <div className="space-y-3 pt-1 border-t border-slate-100">
            <div className="text-[11px] font-bold text-slate-400 pt-3">勤務条件・備考</div>
            <Field label="交通費（月額・円）">
              <input type="number" value={form.commuteAllowance} onChange={set('commuteAllowance')} placeholder="0" className="w-full border border-slate-200 rounded-lg px-3 py-2 font-mono text-[14px]" />
            </Field>
            <Field label="有休の手動調整（日・マイナス可）">
              <input type="number" value={form.leaveAdjustment} onChange={set('leaveAdjustment')} placeholder="0" className="w-full border border-slate-200 rounded-lg px-3 py-2 font-mono text-[14px]" />
            </Field>
            <div className="text-[10.5px] text-slate-400 -mt-2">自動計算された有休日数に、この日数を加算（マイナスなら減算）します。特別な事情での付与・調整に使用してください。</div>
            <Field label="スタッフ備考1">
              <input value={form.staffNote1} onChange={set('staffNote1')} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13.5px]" />
            </Field>
            <Field label="スタッフ備考2">
              <input value={form.staffNote2} onChange={set('staffNote2')} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13.5px]" />
            </Field>
            <Field label="スタッフ備考3">
              <input value={form.staffNote3} onChange={set('staffNote3')} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-[13.5px]" />
            </Field>
          </div>

          <div className="text-[10.5px] text-slate-400">ログイン用のID・パスワードとは別の情報です。緊急連絡や書類送付、給与計算などに使用してください。</div>
        </div>
        <div className="px-5 pb-5 pt-1 flex gap-2 sticky bottom-0 bg-white">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-lg border border-slate-200 text-[13.5px] font-medium text-slate-500">キャンセル</button>
          <button onClick={save} disabled={saving} className="flex-1 py-2.5 rounded-lg bg-slate-800 disabled:bg-slate-300 text-white text-[13.5px] font-bold">
            {saving ? '保存中…' : '保存する'}
          </button>
        </div>
      </div>
    </div>
  );
}
