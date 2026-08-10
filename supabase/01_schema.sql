-- ============================================================
-- Brown Work 本番スキーマ（Supabase Auth + 正規化テーブル + RLS）
-- ============================================================
-- 実行順序：
--   1. 00_emergency_lockdown.sql を先に実行済みであること
--   2. このファイルを Supabase SQL Editor で実行
--   3. supabase/functions/create-employee をデプロイ
--   4. 最初の管理者アカウントを作成（本ファイル末尾の手順を参照）
-- ============================================================

-- ---- 1. 社員テーブル（auth.usersと1:1で紐付く）----
create table if not exists public.employees (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  name text not null,
  role text not null default 'employee' check (role in ('employee', 'admin')),
  hire_date date,
  resignation_date date,
  created_at timestamptz not null default now()
);

-- ---- 2. 勤怠打刻 ----
create table if not exists public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  date date not null,
  clock_in timestamptz,
  clock_out timestamptz,
  break_periods jsonb not null default '[]'::jsonb,
  break_started_at timestamptz,
  break_minutes_override numeric,
  clock_in_location jsonb,
  clock_out_location jsonb,
  scheduled_start text default '09:00',
  scheduled_end text default '18:00',
  updated_at timestamptz not null default now(),
  unique (employee_id, date)
);

-- ---- 3. 勤怠修正申請 ----
create table if not exists public.corrections (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  date date not null,
  original jsonb,
  requested jsonb not null,
  reason text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  submitted_at timestamptz not null default now(),
  decided_at timestamptz
);

-- ---- 4. 休暇申請 ----
create table if not exists public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  type text not null,
  half_day boolean not null default false,
  start_date date not null,
  end_date date not null,
  days numeric not null,
  reason text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  submitted_at timestamptz not null default now(),
  decided_at timestamptz
);

-- ---- 5. シフト希望・確定シフト ----
create table if not exists public.shift_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  batch_id text,
  target_month text,
  date date not null,
  day_type text not null default 'work' check (day_type in ('work', 'off', 'paid_leave')),
  start_time text,
  end_time text,
  note text,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'rejected')),
  source text not null default 'employee' check (source in ('employee', 'admin')),
  submitted_at timestamptz not null default now(),
  decided_at timestamptz
);

-- ---- 6. 個人実績報告 ----
create table if not exists public.performance_reports (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  type text not null check (type in ('half', 'month')),
  year int not null,
  month int not null,
  half int,
  period_label text,
  summary text not null,
  numeric_label text,
  numeric_value numeric,
  notes text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  admin_memo text,
  submitted_at timestamptz not null default now(),
  decided_at timestamptz
);

-- ---- 7. 通知ログ ----
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  to_employee_id uuid references public.employees(id) on delete cascade,
  to_role text,
  subject text not null,
  body text not null,
  related_id text,
  sent_at timestamptz not null default now()
);

-- ============================================================
-- 管理者判定ヘルパー
-- ============================================================
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.employees e
    where e.id = auth.uid() and e.role = 'admin'
  );
$$;

-- ============================================================
-- status列などをRLSだけで守り切れない部分を守るトリガー
-- （承認/却下や管理者コメントは管理者だけが変更できるようにする）
-- ============================================================
create or replace function public.guard_decision_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_admin() then
    return new;
  end if;
  -- 管理者以外は status / decided_at / admin_memo を変更できない
  if new.status is distinct from old.status
     or new.decided_at is distinct from old.decided_at then
    raise exception '承認・却下は管理者のみ行えます';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_corrections on public.corrections;
create trigger guard_corrections before update on public.corrections
  for each row execute function public.guard_decision_fields();

drop trigger if exists guard_leave_requests on public.leave_requests;
create trigger guard_leave_requests before update on public.leave_requests
  for each row execute function public.guard_decision_fields();

drop trigger if exists guard_shift_requests on public.shift_requests;
create trigger guard_shift_requests before update on public.shift_requests
  for each row execute function public.guard_decision_fields();

drop trigger if exists guard_performance_reports on public.performance_reports;
create trigger guard_performance_reports before update on public.performance_reports
  for each row execute function public.guard_decision_fields();

-- ============================================================
-- RLS有効化
-- ============================================================
alter table public.employees enable row level security;
alter table public.attendance_records enable row level security;
alter table public.corrections enable row level security;
alter table public.leave_requests enable row level security;
alter table public.shift_requests enable row level security;
alter table public.performance_reports enable row level security;
alter table public.notifications enable row level security;

-- ---- employees ----
drop policy if exists "employees select own or admin" on public.employees;
create policy "employees select own or admin" on public.employees
  for select to authenticated
  using (id = auth.uid() or public.is_admin());

drop policy if exists "employees update own or admin" on public.employees;
create policy "employees update own or admin" on public.employees
  for update to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());
-- 注意：insertポリシーは意図的に定義していません。
-- 新規社員アカウントの作成は service_role を使う Edge Function
-- （supabase/functions/create-employee）経由でのみ行います。

-- ---- attendance_records ----
drop policy if exists "attendance select own or admin" on public.attendance_records;
create policy "attendance select own or admin" on public.attendance_records
  for select to authenticated
  using (employee_id = auth.uid() or public.is_admin());

drop policy if exists "attendance insert own or admin" on public.attendance_records;
create policy "attendance insert own or admin" on public.attendance_records
  for insert to authenticated
  with check (employee_id = auth.uid() or public.is_admin());

drop policy if exists "attendance update own or admin" on public.attendance_records;
create policy "attendance update own or admin" on public.attendance_records
  for update to authenticated
  using (employee_id = auth.uid() or public.is_admin())
  with check (employee_id = auth.uid() or public.is_admin());

-- ---- corrections ----
drop policy if exists "corrections select own or admin" on public.corrections;
create policy "corrections select own or admin" on public.corrections
  for select to authenticated
  using (employee_id = auth.uid() or public.is_admin());

drop policy if exists "corrections insert own" on public.corrections;
create policy "corrections insert own" on public.corrections
  for insert to authenticated
  with check (employee_id = auth.uid());

drop policy if exists "corrections update own or admin" on public.corrections;
create policy "corrections update own or admin" on public.corrections
  for update to authenticated
  using (employee_id = auth.uid() or public.is_admin())
  with check (employee_id = auth.uid() or public.is_admin());

-- ---- leave_requests ----
drop policy if exists "leave select own or admin" on public.leave_requests;
create policy "leave select own or admin" on public.leave_requests
  for select to authenticated
  using (employee_id = auth.uid() or public.is_admin());

drop policy if exists "leave insert own" on public.leave_requests;
create policy "leave insert own" on public.leave_requests
  for insert to authenticated
  with check (employee_id = auth.uid());

drop policy if exists "leave update own or admin" on public.leave_requests;
create policy "leave update own or admin" on public.leave_requests
  for update to authenticated
  using (employee_id = auth.uid() or public.is_admin())
  with check (employee_id = auth.uid() or public.is_admin());

-- ---- shift_requests ----
drop policy if exists "shift select own or admin" on public.shift_requests;
create policy "shift select own or admin" on public.shift_requests
  for select to authenticated
  using (employee_id = auth.uid() or public.is_admin());

drop policy if exists "shift insert own or admin" on public.shift_requests;
create policy "shift insert own or admin" on public.shift_requests
  for insert to authenticated
  with check (employee_id = auth.uid() or public.is_admin());

drop policy if exists "shift update own or admin" on public.shift_requests;
create policy "shift update own or admin" on public.shift_requests
  for update to authenticated
  using (employee_id = auth.uid() or public.is_admin())
  with check (employee_id = auth.uid() or public.is_admin());

-- ---- performance_reports ----
drop policy if exists "performance select own or admin" on public.performance_reports;
create policy "performance select own or admin" on public.performance_reports
  for select to authenticated
  using (employee_id = auth.uid() or public.is_admin());

drop policy if exists "performance insert own" on public.performance_reports;
create policy "performance insert own" on public.performance_reports
  for insert to authenticated
  with check (employee_id = auth.uid());

drop policy if exists "performance update own or admin" on public.performance_reports;
create policy "performance update own or admin" on public.performance_reports
  for update to authenticated
  using (employee_id = auth.uid() or public.is_admin())
  with check (employee_id = auth.uid() or public.is_admin());

-- ---- notifications ----
drop policy if exists "notifications select own or admin" on public.notifications;
create policy "notifications select own or admin" on public.notifications
  for select to authenticated
  using (to_employee_id = auth.uid() or to_role = 'admin' and public.is_admin() or public.is_admin());

drop policy if exists "notifications insert any authenticated" on public.notifications;
create policy "notifications insert any authenticated" on public.notifications
  for insert to authenticated
  with check (true);

-- ============================================================
-- 最初の管理者アカウントの作り方（SQL Editorではなく手動手順）
-- ============================================================
-- 1. Supabaseダッシュボード → Authentication → Users → "Add user" で
--    メール例: admin@brownwork.local / 任意の初期パスワードを作成
--    （Auto Confirm User を必ずONにする）
-- 2. 作成されたUserのUUIDをコピー
-- 3. 以下をSQL Editorで実行（UUIDと値を置き換える）：
--
-- insert into public.employees (id, username, name, role, hire_date)
-- values ('コピーしたUUID', 'admin', '管理者', 'admin', current_date);
--
-- これで admin@brownwork.local / 設定したパスワード でログインできます。
-- 以降の社員アカウントは、管理者ログイン後に
-- 「社員アカウント管理」画面から作成できます（Edge Function経由）。
