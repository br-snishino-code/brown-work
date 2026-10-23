-- 60_schema_missing_tables.sql
--
-- 本番にあってリポジトリに定義が無かった17テーブルの CREATE TABLE 文
--
-- 経緯：
--   これらのテーブルは Supabase の SQL Editor で直接作られており、
--   定義がファイルに残っていませんでした。本番が壊れたときに作り直せず、
--   列の型や制約もコードから確認できない状態だったため、
--   59a/59b/59c で本番から書き出した内容をもとに起こし直しています。
--
-- 出どころ：
--   列の定義・既定値      … 59a_export_columns.sql の結果（2026年10月23日時点の本番）
--   主キー・一意制約      … 索引の一覧から読み取り
--   外部キー・チェック制約 … 59b / 59d の結果（条件式と削除時の動作も反映済み）
--   アクセス制限（RLS）    … 61_rls_policies_missing_tables.sql に分けてあります
--
-- ⚠ このファイルは表の形（列・制約）だけを作ります。
--   アクセス制限（RLSポリシー）は入っていないため、このファイルだけで
--   作り直すと「RLSは有効だがポリシーが1つも無い」状態になります。
--   その状態では誰もデータに触れないので情報は漏れませんが、アプリは動きません。
--   復旧の際は、このファイルのあとに 61番も必ず流してください。
--
-- ⚠ 外部キーの削除時の動作について（本番の設定をそのまま反映しています）
--   employees の行を消すと、下の11表の行も一緒に消えます（on delete cascade）。
--     給与明細 / 交通費精算 / 年末調整 / 固定支給・控除 / 標準報酬 /
--     通勤経路 / 出勤規定日数 / 勤怠パターン / 変更申請 / eo実績2表
--   賃金台帳などは法定の保存期間があるため、退職者は削除せず
--   退職日を入れて残す運用にしてください。
--   （お知らせの作成者と監査ログの2本だけは on delete set null です）
--
-- すでにテーブルがある本番で実行しても、create table if not exists のため
-- 何も起きません（既存の表はそのままです）。


-- ========================================================
-- announcements … 社内のお知らせ
-- ========================================================
create table if not exists public.announcements (
  id uuid default gen_random_uuid() not null,
  title text not null,
  category text default 'お知らせ'::text not null,
  body text,
  file_path text,
  file_name text,
  created_by uuid,
  created_by_name text,
  is_pinned boolean default false not null,
  created_at timestamptz default now() not null,
  primary key (id),
  constraint announcements_created_by_fkey foreign key (created_by) references public.employees(id) on delete set null
);
alter table public.announcements enable row level security;

-- ========================================================
-- audit_logs … 操作の履歴（監査ログ）
-- ========================================================
create table if not exists public.audit_logs (
  id uuid default gen_random_uuid() not null,
  actor_id uuid,
  actor_name text,
  action text not null,
  target_employee_id uuid,
  target_employee_name text,
  detail text,
  created_at timestamptz default now() not null,
  primary key (id),
  constraint audit_logs_actor_id_fkey foreign key (actor_id) references public.employees(id) on delete set null,
  constraint audit_logs_target_employee_id_fkey foreign key (target_employee_id) references public.employees(id) on delete set null
);
alter table public.audit_logs enable row level security;

-- ========================================================
-- commute_expense_claims … 交通費精算の申請
-- ========================================================
create table if not exists public.commute_expense_claims (
  id uuid default gen_random_uuid() not null,
  employee_id uuid not null,
  workplace text,
  submitted_date date default CURRENT_DATE not null,
  items jsonb default '[]'::jsonb not null,
  total_amount numeric default 0 not null,
  status text default 'pending'::text not null,
  admin_comment text,
  created_at timestamptz default now() not null,
  decided_at timestamptz,
  target_month text,
  primary key (id),
  constraint commute_expense_claims_employee_id_fkey foreign key (employee_id) references public.employees(id) on delete cascade
);
alter table public.commute_expense_claims enable row level security;

-- ========================================================
-- employee_attendance_schedules … スタッフ個別の出勤規定日数（月別）
-- ========================================================
create table if not exists public.employee_attendance_schedules (
  id uuid default gen_random_uuid() not null,
  employee_id uuid not null,
  month integer not null,
  days numeric default 0 not null,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  primary key (id),
  unique (employee_id, month),
  constraint employee_attendance_schedules_month_check check (month >= 1 and month <= 12),
  constraint employee_attendance_schedules_employee_id_fkey foreign key (employee_id) references public.employees(id) on delete cascade
);
alter table public.employee_attendance_schedules enable row level security;

-- ========================================================
-- employee_commute_routes … 通勤経路（定期代・片道運賃）
-- ========================================================
create table if not exists public.employee_commute_routes (
  id uuid default gen_random_uuid() not null,
  employee_id uuid not null,
  transport_method text default '電車'::text,
  boarding_station text,
  alighting_station text,
  via_point text,
  payment_unit text default 'monthly_pass'::text,
  one_way_fare numeric default 0,
  pass_fare numeric default 0,
  sort_order integer default 0 not null,
  updated_at timestamptz default now() not null,
  primary key (id),
  constraint employee_commute_routes_employee_id_fkey foreign key (employee_id) references public.employees(id) on delete cascade
);
alter table public.employee_commute_routes enable row level security;

-- ========================================================
-- employee_salary_items … 毎月の固定支給・固定控除
-- ========================================================
create table if not exists public.employee_salary_items (
  id uuid default gen_random_uuid() not null,
  employee_id uuid not null,
  kind text not null,
  label text not null,
  amount numeric default 0 not null,
  sort_order integer default 0 not null,
  updated_at timestamptz default now() not null,
  primary key (id),
  constraint employee_salary_items_kind_check check (kind in ('payment', 'deduction')),
  constraint employee_salary_items_employee_id_fkey foreign key (employee_id) references public.employees(id) on delete cascade
);
alter table public.employee_salary_items enable row level security;

-- ========================================================
-- employee_schedule_patterns … 規定勤怠時間のパターン（月別・最大n件）
-- ========================================================
create table if not exists public.employee_schedule_patterns (
  id uuid default gen_random_uuid() not null,
  employee_id uuid not null,
  year integer not null,
  month integer not null,
  pattern_no integer not null,
  label text,
  start_time text not null,
  end_time text not null,
  updated_at timestamptz default now() not null,
  primary key (id),
  unique (employee_id, year, month, pattern_no),
  constraint employee_schedule_patterns_month_check check (month >= 1 and month <= 12),
  constraint employee_schedule_patterns_pattern_no_check check (pattern_no >= 1 and pattern_no <= 3),
  constraint employee_schedule_patterns_employee_id_fkey foreign key (employee_id) references public.employees(id) on delete cascade
);
alter table public.employee_schedule_patterns enable row level security;

-- ========================================================
-- employee_standard_remuneration … 標準報酬月額と保険料の記録（月別）
-- ========================================================
create table if not exists public.employee_standard_remuneration (
  id uuid default gen_random_uuid() not null,
  employee_id uuid not null,
  year integer not null,
  month integer not null,
  health_insurance_amount numeric,
  pension_amount numeric,
  health_insurance_premium numeric,
  nursing_insurance_premium numeric,
  pension_premium numeric,
  updated_at timestamptz default now() not null,
  primary key (id),
  unique (employee_id, year, month),
  constraint employee_standard_remuneration_month_check check (month >= 1 and month <= 12),
  constraint employee_standard_remuneration_employee_id_fkey foreign key (employee_id) references public.employees(id) on delete cascade
);
alter table public.employee_standard_remuneration enable row level security;

-- ========================================================
-- group_attendance_schedules … グループ別の出勤規定日数（月別）
-- ========================================================
create table if not exists public.group_attendance_schedules (
  id uuid default gen_random_uuid() not null,
  group_name text not null,
  month integer not null,
  days numeric default 0 not null,
  primary key (id),
  unique (group_name, month),
  constraint group_leave_schedules_month_check check (month >= 1 and month <= 12)
);
alter table public.group_attendance_schedules enable row level security;

-- ========================================================
-- group_incentive_flags … インセンティブの目標達成フラグ（業務・月別）
-- ========================================================
create table if not exists public.group_incentive_flags (
  id uuid default gen_random_uuid() not null,
  group_name text not null,
  year integer not null,
  month integer not null,
  cancel_target_met boolean default false not null,
  empake_target_met boolean default false not null,
  upsell_target_met boolean default false not null,
  updated_at timestamptz default now() not null,
  primary key (id),
  unique (group_name, year, month),
  constraint group_incentive_flags_month_check check (month >= 1 and month <= 12)
);
alter table public.group_incentive_flags enable row level security;

-- ========================================================
-- insurance_rate_settings … 保険料率の設定（全社で1行）
-- ========================================================
create table if not exists public.insurance_rate_settings (
  id text default 'default'::text not null,
  health_insurance_rate numeric,
  nursing_insurance_rate numeric default 1.62,
  pension_insurance_rate numeric default 18.3,
  updated_at timestamptz default now() not null,
  primary key (id)
);
alter table public.insurance_rate_settings enable row level security;

-- ========================================================
-- payroll_records … 給与明細
-- ========================================================
create table if not exists public.payroll_records (
  id uuid default gen_random_uuid() not null,
  employee_id uuid not null,
  year integer not null,
  month integer not null,
  wage_type text not null,
  wage_rate numeric default 0 not null,
  worked_minutes integer default 0 not null,
  overtime_minutes integer default 0 not null,
  base_amount numeric default 0 not null,
  overtime_amount numeric default 0 not null,
  total_amount numeric default 0 not null,
  status text default 'draft'::text not null,
  notes text,
  generated_at timestamptz default now() not null,
  published_at timestamptz,
  payment_items jsonb,
  deduction_items jsonb,
  attendance_extra jsonb,
  primary key (id),
  unique (employee_id, year, month),
  constraint payroll_records_status_check check (status in ('draft', 'published')),
  constraint payroll_records_wage_type_check check (wage_type in ('hourly', 'monthly')),
  constraint payroll_records_employee_id_fkey foreign key (employee_id) references public.employees(id) on delete cascade
);
alter table public.payroll_records enable row level security;

-- ========================================================
-- profile_update_requests … 登録情報の変更申請
-- ========================================================
create table if not exists public.profile_update_requests (
  id uuid default gen_random_uuid() not null,
  employee_id uuid not null,
  requested_changes jsonb not null,
  original_values jsonb not null,
  reason text,
  status text default 'pending'::text not null,
  admin_memo text,
  submitted_at timestamptz default now() not null,
  decided_at timestamptz,
  primary key (id),
  constraint profile_update_requests_status_check check (status in ('pending', 'approved', 'rejected')),
  constraint profile_update_requests_employee_id_fkey foreign key (employee_id) references public.employees(id) on delete cascade
);
alter table public.profile_update_requests enable row level security;

-- ========================================================
-- resignation_reasons … 退職理由の選択肢
-- ========================================================
create table if not exists public.resignation_reasons (
  id uuid default gen_random_uuid() not null,
  label text not null,
  category text default 'その他'::text not null,
  sort_order integer default 100 not null,
  is_active boolean default true not null,
  created_at timestamptz default now() not null,
  primary key (id),
  unique (label)
);
alter table public.resignation_reasons enable row level security;

-- ========================================================
-- staff_existing_performance … eo業務の既存実績（アップセルLTV）
-- ========================================================
create table if not exists public.staff_existing_performance (
  id uuid default gen_random_uuid() not null,
  employee_id uuid not null,
  year integer not null,
  month integer not null,
  daily jsonb default '{}'::jsonb not null,
  updated_at timestamptz default now() not null,
  admin_edited_at timestamptz,
  admin_edited_by_id uuid,
  admin_edited_by_name text,
  primary key (id),
  unique (employee_id, year, month),
  constraint staff_existing_performance_month_check check (month >= 1 and month <= 12),
  constraint staff_existing_performance_employee_id_fkey foreign key (employee_id) references public.employees(id) on delete cascade
);
alter table public.staff_existing_performance enable row level security;

-- ========================================================
-- staff_new_performance … eo業務の新規実績
-- ========================================================
create table if not exists public.staff_new_performance (
  id uuid default gen_random_uuid() not null,
  employee_id uuid not null,
  year integer not null,
  month integer not null,
  daily jsonb default '{}'::jsonb not null,
  tablet_issues integer default 0 not null,
  cancellations integer default 0 not null,
  g10_half_override boolean,
  updated_at timestamptz default now() not null,
  submitted_at timestamptz,
  admin_edited_at timestamptz,
  admin_edited_by_id uuid,
  admin_edited_by_name text,
  primary key (id),
  unique (employee_id, year, month),
  constraint staff_new_performance_month_check check (month >= 1 and month <= 12),
  constraint staff_new_performance_employee_id_fkey foreign key (employee_id) references public.employees(id) on delete cascade
);
alter table public.staff_new_performance enable row level security;

-- ========================================================
-- year_end_adjustments … 年末調整の申告内容
-- ========================================================
create table if not exists public.year_end_adjustments (
  id uuid default gen_random_uuid() not null,
  employee_id uuid not null,
  year integer not null,
  spouse_status text default '無'::text,
  spouse_income numeric,
  dependents_count integer default 0,
  life_insurance_premium numeric default 0,
  earthquake_insurance_premium numeric default 0,
  social_insurance_premium_paid numeric default 0,
  has_mortgage_deduction boolean default false,
  mortgage_deduction_amount numeric,
  notes text,
  status text default 'pending'::text not null,
  admin_comment text,
  submitted_at timestamptz default now() not null,
  decided_at timestamptz,
  primary key (id),
  unique (employee_id, year),
  constraint year_end_adjustments_employee_id_fkey foreign key (employee_id) references public.employees(id) on delete cascade
);
alter table public.year_end_adjustments enable row level security;

notify pgrst, 'reload schema';

-- ========================================================
-- 確認
-- ========================================================
select '作成済みのテーブル' as 確認項目,
       count(*)::text || '／17' as 結果,
       '17／17 であれば正常' as 期待値
from information_schema.tables
where table_schema = 'public' and table_name in ('announcements', 'audit_logs', 'commute_expense_claims', 'employee_attendance_schedules', 'employee_commute_routes', 'employee_salary_items', 'employee_schedule_patterns', 'employee_standard_remuneration', 'group_attendance_schedules', 'group_incentive_flags', 'insurance_rate_settings', 'payroll_records', 'profile_update_requests', 'resignation_reasons', 'staff_existing_performance', 'staff_new_performance', 'year_end_adjustments');
