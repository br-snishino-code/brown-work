import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Clock, MapPin, CheckCircle2, XCircle, AlertTriangle, LogIn, LogOut, FileEdit, Users, Bell, Calendar, Mail, LogOut as LogoutIcon, UserPlus, Lock, User, Monitor, Smartphone, Palmtree, Plus, Pencil, CalendarDays, ListChecks, ClipboardList, MessageSquare, Coffee, BarChart3, Home, Download } from 'lucide-react';
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

const EMPTY_DATA = { accounts: [], records: {}, corrections: [], notifications: [], leaveRequests: [], leaveBalances: {}, shiftRequests: [], performanceReports: [] };

// ---- row(snake_case) → app(camelCase) 変換 ----
const rowToAccount = (row) => ({
  id: row.id,
  username: row.username,
  name: row.name,
  role: row.role,
  hireDate: row.hire_date,
  resignationDate: row.resignation_date,
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
  subject: row.subject,
  body: row.body,
  sentAt: row.sent_at,
  relatedId: row.related_id,
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
  ] = await Promise.all([
    supabase.from('employees').select('*'),
    supabase.from('attendance_records').select('*'),
    supabase.from('corrections').select('*, employees(name)'),
    supabase.from('leave_requests').select('*, employees(name)'),
    supabase.from('shift_requests').select('*, employees(name)'),
    supabase.from('performance_reports').select('*, employees(name)'),
    supabase.from('notifications').select('*').order('sent_at', { ascending: false }).limit(50),
  ]);

  for (const res of [employeesRes, recordsRes, correctionsRes, leaveRes, shiftRes, perfRes, notifRes]) {
    if (res.error) throw res.error;
  }

  const records = {};
  (recordsRes.data || []).forEach((row) => {
    records[row.employee_id] = records[row.employee_id] || {};
    records[row.employee_id][row.date] = rowToRecord(row);
  });

  return {
    accounts: (employeesRes.data || []).map(rowToAccount),
    records,
    corrections: (correctionsRes.data || []).map(rowToCorrection),
    leaveRequests: (leaveRes.data || []).map(rowToLeave),
    leaveBalances: {},
    shiftRequests: (shiftRes.data || []).map(rowToShift),
    performanceReports: (perfRes.data || []).map(rowToPerf),
    notifications: (notifRes.data || []).map(rowToNotif),
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
    await notify(
      `【勤怠修正申請】${session.name} - ${dateLabel(payload.date)}`,
      `${session.name}さんより ${dateLabel(payload.date)} の勤怠修正申請が届きました。内容をご確認のうえ承認してください。`,
      inserted?.id,
      null,
      'admin'
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
    await notify(
      `【休暇申請】${session.name} - ${typeLabel}（${rangeLabel}）`,
      `${session.name}さんより ${typeLabel} の休暇申請（${rangeLabel}／${days}日間）が届きました。内容をご確認のうえ承認してください。`,
      inserted?.id,
      null,
      'admin'
    );
    await refreshData();
    setLeaveModalOpen(false);
        show('休暇申請を送信しました。管理者に通知しました', 'success');
  };

  const decideLeaveRequest = async (id, decision) => {
    const { error } = await supabase
      .from('leave_requests')
      .update({ status: decision, decided_at: new Date().toISOString() })
      .eq('id', id);
    if (error) {
      show('処理に失敗しました', 'warn');
      return;
    }
    await refreshData();
    show(decision === 'approved' ? '休暇申請を承認しました' : '休暇申請を却下しました', decision === 'approved' ? 'success' : 'warn');
  };

  const updateEmployeeDates = async (targetEmployeeId, { hireDate, resignationDate }) => {
    const patch = /** @type {{ hire_date?: string, resignation_date?: string | null }} */ ({});
    if (hireDate !== undefined) patch.hire_date = hireDate;
    if (resignationDate !== undefined) patch.resignation_date = resignationDate;
    const { error } = await supabase.from('employees').update(patch).eq('id', targetEmployeeId);
    if (error) {
      show('社員情報の更新に失敗しました', 'warn');
      return;
    }
    await refreshData();
    if (session && session.id === targetEmployeeId) {
      setSession((prev) => ({ ...prev, hireDate: hireDate ?? prev.hireDate, resignationDate: resignationDate !== undefined ? resignationDate : prev.resignationDate }));
    }
    show('社員情報を更新しました', 'success');
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

    await notify(
      `【シフト希望】${session.name} - ${monthKeyLabel(payload.targetMonth)}分`,
      `${session.name}さんより ${monthKeyLabel(payload.targetMonth)}分のシフト希望（${shiftRows.length}日分、うち有休${paidLeaveDays.length}日）が届きました。内容をご確認のうえ確定してください。`,
      batchId,
      null,
      'admin'
    );
    await refreshData();
    setShiftModalOpen(false);
    show(`${monthKeyLabel(payload.targetMonth)}分のシフト希望（${shiftRows.length}日分）を送信しました`, 'success');
  };

  const decideShiftRequest = async (id, decision) => {
    const { error } = await supabase
      .from('shift_requests')
      .update({ status: decision, decided_at: new Date().toISOString() })
      .eq('id', id);
    if (error) {
      show('処理に失敗しました', 'warn');
      return;
    }
    await refreshData();
    show(decision === 'confirmed' ? 'シフトを確定しました' : 'シフト希望を却下しました', decision === 'confirmed' ? 'success' : 'warn');
  };

  const decideShiftBatch = async (batchId, decision) => {
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
    await notify(
      `【個人実績】${session.name} - ${periodLabel}`,
      `${session.name}さんより ${periodLabel} の実績報告が届きました。内容をご確認のうえ承認してください。`,
      inserted?.id,
      null,
      'admin'
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
      await notify(
        `【実績${decision === 'approved' ? '承認' : '却下'}】${report.periodLabel}`,
        `${report.periodLabel} の実績報告が${decision === 'approved' ? '承認されました' : '却下されました'}。${memo ? `管理者コメント：${memo}` : ''}`,
        id,
        report.employeeId,
        'employee'
      );
    }
    await refreshData();
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
  const myLeaveTotal = computeStatutoryPaidLeaveDays(session.hireDate, now);
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
      <Header session={session} onLogout={handleLogout} pendingCount={pendingCorrectionCount + pendingLeaveCount + pendingShiftCount + pendingPerformanceCount} missingPunchCount={missingPunchCount} viewMode={viewMode} />
      <main className={isDesktop ? 'max-w-6xl mx-auto px-6 pb-16 pt-8' : 'max-w-3xl mx-auto px-4 pb-24 pt-6'}>
        {session.role === 'employee' ? (
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
            isDesktop={isDesktop}
          />
        )}
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

function EmployeeView({ now, todayRecord, onClockIn, onClockOut, onBreakStart, onBreakEnd, geoStatus, historyDates, records, corrections, onOpenCorrection, isDesktop }) {
  const status = computeDayStatus(todayRecord);
  const canClockIn = !todayRecord?.clockIn;
  const canClockOut = todayRecord?.clockIn && !todayRecord?.clockOut;
  const isOnBreak = !!todayRecord?.breakStartedAt && !todayRecord?.clockOut;
  const doneToday = todayRecord?.clockIn && todayRecord?.clockOut;
  const monthly = computeMonthlySummary(records, now);
  const todayBreak = todayRecord ? getRecordedBreakMinutes(todayRecord, now) : 0;

  const clockSection = (
    <div className="space-y-4">
      <div className="relative overflow-hidden rounded-[28px] bg-slate-950 text-white shadow-xl shadow-slate-200">
        <div className="absolute -right-16 -top-16 h-44 w-44 rounded-full bg-amber-400/20 blur-2xl" />
        <div className="absolute -left-20 bottom-0 h-36 w-36 rounded-full bg-emerald-400/10 blur-2xl" />
        <div className="relative px-6 pt-7 pb-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-[12px] font-medium text-slate-400">
                {now.getFullYear()}年{now.getMonth() + 1}月{now.getDate()}日（{['日','月','火','水','木','金','土'][now.getDay()]}）
              </div>
              <div className="mt-2 font-mono text-[46px] sm:text-[54px] font-bold leading-none tracking-tight tabular-nums">{timeStr(now)}</div>
            </div>
            <div className={`rounded-full px-3 py-1.5 text-[11px] font-bold ${isOnBreak ? 'bg-amber-400 text-slate-950' : status.tone === 'active' ? 'bg-emerald-400 text-slate-950' : 'bg-white/10 text-slate-200'}`}>
              {isOnBreak ? '休憩中' : status.label}
            </div>
          </div>

          <div className="mt-6 grid grid-cols-3 gap-2 rounded-2xl bg-white/5 p-3 ring-1 ring-white/10">
            <div className="text-center"><div className="text-[10px] text-slate-400">出勤</div><div className="mt-1 font-mono text-[15px] font-bold">{todayRecord?.clockIn ? hhmm(new Date(todayRecord.clockIn)) : '--:--'}</div></div>
            <div className="text-center border-x border-white/10"><div className="text-[10px] text-slate-400">退勤</div><div className="mt-1 font-mono text-[15px] font-bold">{todayRecord?.clockOut ? hhmm(new Date(todayRecord.clockOut)) : '--:--'}</div></div>
            <div className="text-center"><div className="text-[10px] text-slate-400">休憩</div><div className="mt-1 font-mono text-[15px] font-bold">{todayRecord?.clockIn ? `${todayBreak}分` : '--'}</div></div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <button onClick={onClockIn} disabled={!canClockIn} className="rounded-2xl bg-emerald-400 px-4 py-4 text-slate-950 disabled:bg-white/10 disabled:text-slate-500 font-bold flex items-center justify-center gap-2 transition active:scale-[.98]"><LogIn size={20}/>出勤</button>
            <button onClick={onClockOut} disabled={!canClockOut} className="rounded-2xl bg-white px-4 py-4 text-slate-950 disabled:bg-white/10 disabled:text-slate-500 font-bold flex items-center justify-center gap-2 transition active:scale-[.98]"><LogOut size={20}/>退勤</button>
          </div>
          <button
            onClick={isOnBreak ? onBreakEnd : onBreakStart}
            disabled={!canClockOut}
            className={`mt-3 w-full rounded-2xl py-3.5 font-bold flex items-center justify-center gap-2 transition active:scale-[.99] disabled:opacity-30 ${isOnBreak ? 'bg-amber-400 text-slate-950' : 'bg-white/10 text-white ring-1 ring-white/10'}`}
          >
            <Coffee size={18}/>{isOnBreak ? '休憩を終了' : '休憩を開始'}
          </button>
          <div className="mt-4 flex items-center justify-center gap-1.5 text-[10.5px] text-slate-400"><MapPin size={11}/>{geoStatus === 'loading' ? '位置情報を取得中…' : geoStatus === 'denied' ? '位置情報が許可されていません' : '打刻時に位置情報を記録'}</div>
        </div>
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
                {metrics && (metrics.lateMin > 0 || metrics.earlyLeaveMin > 0 || metrics.overtimeMin > 0) && <div className="mt-1 text-[10.5px] font-medium"><span className="text-rose-500">{metrics.lateMin > 0 ? `遅刻 ${metrics.lateMin}分 ` : ''}{metrics.earlyLeaveMin > 0 ? `早退 ${metrics.earlyLeaveMin}分` : ''}</span>{metrics.overtimeMin > 0 && <span className="ml-2 text-amber-600">残業 {minutesToHHMM(metrics.overtimeMin)}</span>}</              </div>
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

function AdminView({ data, employeeAccounts, onDecide, onDecideLeave, onDecideShift, onDecideShiftBatch, onAddShift, onDecidePerformance, onAddAccount, onUpdateDates, isDesktop }) {
  const [tab, setTab] = useState('attendance'); // attendance | requests | leave | shift | performance | accounts
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

  const notifications = (data.notifications || []).slice(0, 6);

  return (
    <div className="space-y-5">
      <div className={`flex items-center bg-white rounded-xl border border-slate-200 p-1 text-[11.5px] font-medium overflow-x-auto ${isDesktop ? 'max-w-2xl' : ''}`}>
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
      </div>

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

      {tab === 'attendance' && (
        <AttendanceAdminTab data={data} employeeAccounts={employeeAccounts} isDesktop={isDesktop} />
      )}

      {tab === 'accounts' && (
        <AccountManagement employeeAccounts={employeeAccounts} onAddAccount={onAddAccount} onUpdateDates={onUpdateDates} isDesktop={isDesktop} />
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
      <div className="px-5 py-3.5 border-b border-slate-        <h2 className="font-bold text-[13.5px]">確定シフト（直近）</h2>
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


function AttendanceAdminTab({ data, employeeAccounts, isDesktop }) {
  const now = new Date();
  const [month, setMonth] = useState(`${now.getFullYear()}-${pad(now.getMonth() + 1)}`);
  const [employeeFilter, setEmployeeFilter] = useState('all');

  const rows = [];
  employeeAccounts.forEach((acc) => {
    if (employeeFilter !== 'all' && acc.id !== employeeFilter) return;
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

  const summaryByEmployee = employeeAccounts
    .filter((acc) => employeeFilter === 'all' || acc.id === employeeFilter)
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
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 flex flex-wrap items-end gap-3">
        <Field label="対象月">
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="border border-slate-200 rounded-lg px-3 py-2 font-mono text-[13px] bg-white" />
        </Field>
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
          <span className="font-semibold text-slate-800">{s.name}</span><span className="text-slate-500 text-right">{s.days}日 / 実働 <b className="font-mono text-slate-800">{minutesToHHMM(s.workedMin)}</b> / 残業 <b className="font-mono text-slate-800">{minutesToHHMM(s.overtimeMin)}</b>{s.missingCount > 0 ? ` / 未退勤 ${s.missingCount}件` : ''}</span>
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

function AccountManagement({ employeeAccounts, onAddAccount, onUpdateDates, isDesktop }) {
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [hireDate, setHireDate] = useState(todayKey());
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editHire, setEditHire] = useState('');
  const [editResign, setEditResign] = useState('');

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
    const granted = computeStatutoryPaidLeaveDays(acc.hireDate);
    const retired = acc.resignationDate && acc.resignationDate <= todayKey();
    return { acc, isEditing, granted, retired };
  };

  const listCard = (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
      <div className="px-5 py-3.5 border-b border-slate-100 flex items-center gap-2">
        <Users size={15} className="text-slate-400" />
        <h2 className="font-bold text-[13.5px]">社員一覧</h2>
        <span className="text-[11px] text-slate-400">{employeeAccounts.length}名</span>
        {!isDesktop && (
          <button onClick={() => setShowForm((v) => !v)} className="ml-auto flex items-center gap-1 text-[12px] font-bold text-amber-600">
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
                    </>
                  ) : (
                    <>
                      <td className="px-5 py-2.5 font-mono text-slate-500">{acc.hireDate || '未設定'}</td>
                      <td className="px-5 py-2.5 font-mono text-slate-400">{acc.resignationDate || '在籍中'}</td>
                      <td className="px-5 py-2.5 font-mono font-semibold text-slate-800">{granted}日</td>
                      <td className="px-5 py-2.5"><button onClick={() => startEdit(acc)} className="text-slate-400"><Pencil size={13} /></button></td>
                    </>
                  )}
                </tr>
              );
            })}
            {employeeAccounts.length === 0 && (
              <tr><td colSpan={6} className="px-5 py-8 text-center text-[12.5px] text-slate-300">社員アカウントがありません</td></tr>
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
                  {!isEditing && (
                    <button onClick={() => startEdit(acc)} className="text-slate-400 p-1"><Pencil size={13} /></button>
                  )}
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
    </div>
  );
}


    
