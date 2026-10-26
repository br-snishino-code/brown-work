-- 80_resident_tax.sql
--
-- 住民税（特別徴収）を給与から自動で控除できるようにする
--
-- 住民税は「計算するもの」ではありません。
-- 市町村から届く「特別徴収税額の決定通知書」に各月の額が書かれていて、
-- 事業主はその額をそのまま控除して納付します。
-- そのため、この表は通知書の数字を写して持つためのものです。
--
-- 年度は6月〜翌5月です（2026年度 ＝ 2026年6月分〜2027年5月分）。
-- 年税額を12で割ると割り切れないため、100円未満の端数は6月分に寄せられます。
-- その結果、6月分だけ額が違い、7月〜翌5月は同じ額になります。
--
-- ⚠ 計算で出さず、必ず通知書の数字を入れてください。
--   計算した額が通知書と1円でも違うと、市町村への納付額が合わなくなります。
--   画面で「6月分 ＋ 月額×11 ＝ 年税額」を検算します。
--
-- 普通徴収の方からは控除しません（employees.resident_tax_collection_method で判定）。
--
-- 何度流しても同じ結果になります（2回目以降は何も起きません）。
--
-- ※ Supabase の SQL Editor にそのまま貼り付けて実行できます。


-- ========================================================
-- 1. 住民税の表
-- ========================================================
create table if not exists public.employee_resident_tax (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,

  -- 住民税の年度。6月始まりです。
  -- 2026 ＝ 2026年6月分〜2027年5月分
  fiscal_year integer not null check (fiscal_year between 2000 and 2100),

  -- 通知書の数字をそのまま入れます
  annual_amount numeric not null check (annual_amount >= 0),   -- 年税額
  june_amount numeric not null check (june_amount >= 0),       -- 6月分
  monthly_amount numeric not null check (monthly_amount >= 0), -- 7月〜翌5月の月額

  note text,
  created_at timestamptz not null default now(),
  created_by uuid references public.employees(id) on delete set null,

  unique (employee_id, fiscal_year)
);

comment on table public.employee_resident_tax is
  '住民税（特別徴収）の年度ごとの税額。通知書の数字を写して持つ。年度は6月〜翌5月。';
comment on column public.employee_resident_tax.june_amount is
  '6月分。年税額の100円未満の端数が寄せられるため、7月以降と額が違う。';


-- ========================================================
-- 2. 権限（給与と同じ重さの情報として扱う）
-- ========================================================
-- 読む：本人と、マスター管理者だけ。
-- 書く：マスター管理者だけ。
-- 標準報酬月額や給与明細（72番・78番）と同じ扱いに揃えています。
alter table public.employee_resident_tax enable row level security;

drop policy if exists "employee_resident_tax_select" on public.employee_resident_tax;
create policy "employee_resident_tax_select"
  on public.employee_resident_tax for select to authenticated
  using (employee_id = auth.uid() or public.is_master_admin());

drop policy if exists "employee_resident_tax_insert" on public.employee_resident_tax;
create policy "employee_resident_tax_insert"
  on public.employee_resident_tax for insert to authenticated
  with check (public.is_master_admin());

drop policy if exists "employee_resident_tax_update" on public.employee_resident_tax;
create policy "employee_resident_tax_update"
  on public.employee_resident_tax for update to authenticated
  using (public.is_master_admin())
  with check (public.is_master_admin());

drop policy if exists "employee_resident_tax_delete" on public.employee_resident_tax;
create policy "employee_resident_tax_delete"
  on public.employee_resident_tax for delete to authenticated
  using (public.is_master_admin());

-- ログインしていない人には表の権限そのものを渡しません（55番と同じ扱い）
revoke all on public.employee_resident_tax from anon;
grant select, insert, update, delete on public.employee_resident_tax to authenticated;

create index if not exists employee_resident_tax_employee_idx
  on public.employee_resident_tax (employee_id, fiscal_year);


-- ========================================================
-- 3. 住民税の「月」の取り方（あとから画面で変えられます）
-- ========================================================
-- next … 「10月分」の給与明細に 11月分の住民税を入れる
--         （特別徴収は「その月に支払う給与から引く」のが原則。
--           当月末締め・翌月25日払いのため、10月分の明細は11月に支払われる）
-- same … 「10月分」の給与明細に 10月分の住民税を入れる
--         （社会保険料と同じ月に揃える運用の場合）
--
-- どちらが御社の運用か分からないため、既定は next にしています。
-- ジョブカンの明細と見比べて、違っていれば画面で切り替えてください。
insert into public.app_settings (key, value)
values ('resident_tax_month_offset', 'next')
on conflict (key) do nothing;


-- ========================================================
-- 4. 確認クエリ（実行後にそれぞれ流して結果を見てください）
-- ========================================================

-- ① 表ができているか（1なら成功）
select count(*) as "表ができているか（1なら成功）"
from information_schema.tables
where table_schema = 'public' and table_name = 'employee_resident_tax';

-- ② 権限がかかっているか（4なら成功）
select count(*) as "ポリシーの数（4なら成功）"
from pg_policies
where schemaname = 'public' and tablename = 'employee_resident_tax';

-- ③ 住民税の月の取り方（1行出れば成功）
select key, value as "月の取り方"
from public.app_settings
where key = 'resident_tax_month_offset';

-- ④ 徴収方法の内訳（普通徴収の方からは控除しません）
select
  coalesce(nullif(e.resident_tax_collection_method, ''), '未設定') as "徴収方法",
  count(*) as "人数"
from public.employees e
where e.resignation_date is null
group by 1
order by 2 desc;

-- ⑤ 住民税の登録が必要な方（在籍中で特別徴収の方）
select e.name as "氏名", e.resident_tax_municipality as "市町村"
from public.employees e
where e.resignation_date is null
  and coalesce(nullif(e.resident_tax_collection_method, ''), '特別徴収') = '特別徴収'
order by e.name;
