-- 97: 過去の記録（ジョブカン）の書庫
--
-- 【何のための表か】
--   ジョブカンで記録していた過去の勤怠を、Brown Work の画面で見られるようにします。
--   いまの勤怠データ（attendance_records）とは別の表に入れます。
--
-- 【なぜ別の表にするのか】
--   1. 当時の数字をそのまま見せるため。
--      Brown Work はいまの設定で残業を計算し直すため、同じ表に入れると
--      当時の給与明細と食い違います。別の表なら、ジョブカンが出した数字を
--      そのまま出せます。
--   2. 源泉徴収票・給与計算・月次確定に混ざらないため。
--      これらの処理はこの表を一切見ません。過去分で誤って明細を作る事故が
--      起きません。
--   3. 有休の残日数に影響しないため。
--
-- 【見られる人】
--   本人・管理者・マスター管理者。書き込めるのはマスター管理者だけです。
--
-- 【何度流しても同じ結果になります】

-- ---- 1. 月ごとのまとめ ----
create table if not exists public.legacy_attendance_months (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  year int not null,
  month int not null check (month between 1 and 12),

  -- 取り込んだファイルにあった値（突き合わせの記録として残します）
  source_staff_name text,
  source_staff_number text,
  source_group_path text,
  source_staff_type text,

  -- 出勤日数など
  work_days numeric,
  weekday_days numeric,
  holiday_days numeric,
  absent_days numeric,
  late_count numeric,
  early_count numeric,

  -- 労働時間（総合・平日・休日）
  work_hours numeric,
  overtime_hours numeric,
  night_hours numeric,
  weekday_work_hours numeric,
  weekday_overtime_hours numeric,
  weekday_night_hours numeric,
  holiday_work_hours numeric,
  holiday_overtime_hours numeric,
  holiday_night_hours numeric,

  -- みなし残業
  deemed_overtime_hours numeric,
  over_deemed_hours numeric,

  -- 消化した休暇。見出しをそのまま名前にして入れます（例：{"有休(全休)": 1}）。
  -- ジョブカンの出力では、休暇を取った方のシートにだけこの列が現れます。
  -- 休暇の種類が増えても表を変えずに済むよう、jsonb で持ちます。
  leave_used jsonb not null default '{}'::jsonb,

  source text not null default 'jobcan',
  imported_at timestamptz not null default now(),
  imported_by uuid references public.employees(id) on delete set null,
  unique (employee_id, year, month)
);

-- ---- 2. 日ごとの明細 ----
create table if not exists public.legacy_attendance_days (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  date date not null,
  weekday text,
  status text,              -- 勤怠状況（有給・欠勤など）
  holiday_kind text,        -- 休日区分（祝日など）
  clock_in_actual text,     -- 出勤実時刻（実際に打刻した時刻）
  clock_out_actual text,    -- 退勤実時刻
  clock_in text,            -- 出勤時刻（計算に使われた時刻）
  clock_out text,           -- 退勤時刻
  break_hours numeric,
  work_hours numeric,
  note text,
  source text not null default 'jobcan',
  imported_at timestamptz not null default now(),
  unique (employee_id, date)
);

-- 先に97番を流したあとで足した列。もう一度流すとここで追加されます
alter table public.legacy_attendance_months
  add column if not exists leave_used jsonb not null default '{}'::jsonb;

-- ---- 2b. 有休の取得履歴 ----
-- ジョブカンの「休暇取得履歴」CSVを入れます。
-- 有休の残日数の計算には入りません（移行日より前の取得は計算に入れない作りです）。
create table if not exists public.legacy_leave_days (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  date date not null,
  leave_type text,            -- 有休 など
  start_time text,            -- 時間休のときだけ
  end_time text,
  source_staff_name text,
  source_staff_number text,
  source text not null default 'jobcan',
  imported_at timestamptz not null default now(),
  unique (employee_id, date, leave_type)
);

-- 休暇理由だけを別の表に分けます。
-- 理由には「体調不良」「健康診断受診のため」など健康に関わる内容が含まれるため、
-- 本人とマスター管理者だけが読めるようにします。
-- 同じ表の列にしてRLSで隠すことはできない（行単位でしか効かない）ので、
-- 表を分けることでデータベース側から守ります。
create table if not exists public.legacy_leave_reasons (
  leave_id uuid primary key references public.legacy_leave_days(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  reason text not null
);

-- ---- 2c. 過去の給与明細 ----
-- ジョブカンの「支給・控除等一覧表」を入れます。
-- いまの給与明細（payroll_records）とは別です。源泉徴収票・年末調整・
-- 給与計算はこの表を一切見ません。
--
-- 【合計をそのまま持ちます】
--   実物を検算したところ、内訳を足しても支給合計に届かない方がいました
--   （時間外手当などの列が出力に含まれていない月があるためです）。
--   合計は読み取った値をそのまま持ち、内訳との差は *_gap に残します。
--   画面では「内訳に出ていない支給 ◯円」と正直に出します。
create table if not exists public.legacy_payslips (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  year int not null,
  month int not null check (month between 1 and 12),

  -- 合計（読み取った値そのまま）
  pay_total numeric,              -- 支給合計
  insurance_total numeric,        -- 社会保険料合計
  deduction_total numeric,        -- 実際に引かれた額（社会保険料合計＋その他の控除）
  net_pay numeric,                -- 差引支給額

  -- 内訳との差。0 でなければ、出力に出ていない項目があります
  pay_gap numeric not null default 0,
  deduction_gap numeric not null default 0,
  insurance_gap numeric not null default 0,

  -- 勤怠（参考）
  work_days numeric,
  work_minutes int,
  paid_leave_days numeric,
  note text,

  source_staff_code text,
  source_staff_name text,
  source text not null default 'jobcan',
  imported_at timestamptz not null default now(),
  imported_by uuid references public.employees(id) on delete set null,
  unique (employee_id, year, month)
);

-- 支給・控除の内訳。1行1項目
create table if not exists public.legacy_payslip_items (
  id uuid primary key default gen_random_uuid(),
  payslip_id uuid not null references public.legacy_payslips(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  -- pay＝支給、deduction＝控除、insurance_part＝社会保険料の内訳
  kind text not null check (kind in ('pay', 'deduction', 'insurance_part')),
  label text not null,
  amount numeric not null,
  -- true なら引く向き（遅刻早退控除・欠勤控除・貸付金回収）
  minus boolean not null default false,
  sort_order int not null default 0
);

create index if not exists legacy_payslips_employee_idx
  on public.legacy_payslips (employee_id, year, month);
create index if not exists legacy_payslip_items_payslip_idx
  on public.legacy_payslip_items (payslip_id);

create index if not exists legacy_leave_employee_date_idx
  on public.legacy_leave_days (employee_id, date);
create index if not exists legacy_leave_reasons_employee_idx
  on public.legacy_leave_reasons (employee_id);

create index if not exists legacy_days_employee_date_idx
  on public.legacy_attendance_days (employee_id, date);
create index if not exists legacy_months_employee_idx
  on public.legacy_attendance_months (employee_id, year, month);

-- ---- 3. 見られる人の決まり ----
alter table public.legacy_attendance_months enable row level security;
alter table public.legacy_attendance_days enable row level security;

drop policy if exists legacy_months_select on public.legacy_attendance_months;
create policy legacy_months_select on public.legacy_attendance_months
  for select using (employee_id = auth.uid() or public.is_admin());

drop policy if exists legacy_months_write on public.legacy_attendance_months;
create policy legacy_months_write on public.legacy_attendance_months
  for all using (public.is_master_admin()) with check (public.is_master_admin());

drop policy if exists legacy_days_select on public.legacy_attendance_days;
create policy legacy_days_select on public.legacy_attendance_days
  for select using (employee_id = auth.uid() or public.is_admin());

drop policy if exists legacy_days_write on public.legacy_attendance_days;
create policy legacy_days_write on public.legacy_attendance_days
  for all using (public.is_master_admin()) with check (public.is_master_admin());

-- 有休の取得履歴。日付と種別は管理者も見られます
alter table public.legacy_leave_days enable row level security;
drop policy if exists legacy_leave_select on public.legacy_leave_days;
create policy legacy_leave_select on public.legacy_leave_days
  for select using (employee_id = auth.uid() or public.is_admin());

drop policy if exists legacy_leave_write on public.legacy_leave_days;
create policy legacy_leave_write on public.legacy_leave_days
  for all using (public.is_master_admin()) with check (public.is_master_admin());

-- 過去の給与明細。賃金のため、本人とマスター管理者だけが見られます
-- （管理者には見せない、といういまの給与明細と同じ扱いです）
alter table public.legacy_payslips enable row level security;
drop policy if exists legacy_payslips_select on public.legacy_payslips;
create policy legacy_payslips_select on public.legacy_payslips
  for select using (employee_id = auth.uid() or public.is_master_admin());

drop policy if exists legacy_payslips_write on public.legacy_payslips;
create policy legacy_payslips_write on public.legacy_payslips
  for all using (public.is_master_admin()) with check (public.is_master_admin());

alter table public.legacy_payslip_items enable row level security;
drop policy if exists legacy_payslip_items_select on public.legacy_payslip_items;
create policy legacy_payslip_items_select on public.legacy_payslip_items
  for select using (employee_id = auth.uid() or public.is_master_admin());

drop policy if exists legacy_payslip_items_write on public.legacy_payslip_items;
create policy legacy_payslip_items_write on public.legacy_payslip_items
  for all using (public.is_master_admin()) with check (public.is_master_admin());

-- 休暇理由は本人とマスター管理者だけ。管理者には見せません
alter table public.legacy_leave_reasons enable row level security;
drop policy if exists legacy_leave_reasons_select on public.legacy_leave_reasons;
create policy legacy_leave_reasons_select on public.legacy_leave_reasons
  for select using (employee_id = auth.uid() or public.is_master_admin());

drop policy if exists legacy_leave_reasons_write on public.legacy_leave_reasons;
create policy legacy_leave_reasons_write on public.legacy_leave_reasons
  for all using (public.is_master_admin()) with check (public.is_master_admin());

-- ---- 4. 書き換えを防ぐ ----
-- 過去の記録は「当時こうだった」という記録です。
-- 取り込み直し（同じ月をもう一度入れる）はできますが、
-- 1行だけこっそり書き換えることはできないようにします。
create or replace function public.guard_legacy_update()
returns trigger
language plpgsql
as $$
begin
  raise exception '過去の記録は書き換えられません。取り込み直してください';
end;
$$;

drop trigger if exists guard_legacy_months_update on public.legacy_attendance_months;
create trigger guard_legacy_months_update
  before update on public.legacy_attendance_months
  for each row execute function public.guard_legacy_update();

drop trigger if exists guard_legacy_days_update on public.legacy_attendance_days;
create trigger guard_legacy_days_update
  before update on public.legacy_attendance_days
  for each row execute function public.guard_legacy_update();

drop trigger if exists guard_legacy_leave_update on public.legacy_leave_days;
create trigger guard_legacy_leave_update
  before update on public.legacy_leave_days
  for each row execute function public.guard_legacy_update();

drop trigger if exists guard_legacy_payslips_update on public.legacy_payslips;
create trigger guard_legacy_payslips_update
  before update on public.legacy_payslips
  for each row execute function public.guard_legacy_update();

drop trigger if exists guard_legacy_payslip_items_update on public.legacy_payslip_items;
create trigger guard_legacy_payslip_items_update
  before update on public.legacy_payslip_items
  for each row execute function public.guard_legacy_update();

drop trigger if exists guard_legacy_leave_reasons_update on public.legacy_leave_reasons;
create trigger guard_legacy_leave_reasons_update
  before update on public.legacy_leave_reasons
  for each row execute function public.guard_legacy_update();

-- ---- 5. 確認 ----
-- 流したあと、ここで出来ているか見られます
select
  (select count(*) from information_schema.tables
    where table_schema = 'public' and table_name = 'legacy_attendance_months') as "月ごとの表",
  (select count(*) from information_schema.tables
    where table_schema = 'public' and table_name = 'legacy_attendance_days') as "日ごとの表",
  (select count(*) from information_schema.tables
    where table_schema = 'public' and table_name = 'legacy_leave_days') as "有休の表",
  (select count(*) from information_schema.tables
    where table_schema = 'public' and table_name = 'legacy_leave_reasons') as "休暇理由の表",
  (select count(*) from information_schema.tables
    where table_schema = 'public' and table_name = 'legacy_payslips') as "給与明細の表",
  (select count(*) from information_schema.tables
    where table_schema = 'public' and table_name = 'legacy_payslip_items') as "明細の内訳の表",
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename in
      ('legacy_attendance_months', 'legacy_attendance_days',
       'legacy_leave_days', 'legacy_leave_reasons',
       'legacy_payslips', 'legacy_payslip_items')) as "決まりの数";
