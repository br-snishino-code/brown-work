-- 41_bonus_records.sql
--
-- 賞与明細のテーブル。
-- 給与明細（payroll_records）と同じ作りで、年と「第何回」で1件に決まる。
--   seq … 1回目＝夏季、2回目＝冬季 といった通し番号
--   payment_items / deduction_items … [{ label, amount }] の配列
--
-- 実行方法：Supabase の SQL Editor に貼り付けて Run

create table if not exists public.bonus_records (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  year int not null,
  seq int not null default 1,
  title text,
  payment_date date,
  payment_items jsonb,
  deduction_items jsonb,
  total_amount numeric not null default 0,
  status text not null default 'draft',
  notes text,
  generated_at timestamptz not null default now(),
  published_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (employee_id, year, seq)
);

create index if not exists bonus_records_employee_idx on public.bonus_records (employee_id);

alter table public.bonus_records enable row level security;

-- 本人は「公開済み」の自分の分だけ。管理者は全件
drop policy if exists "bonus select own published or admin" on public.bonus_records;
create policy "bonus select own published or admin" on public.bonus_records
  for select to authenticated
  using ((employee_id = auth.uid() and status = 'published') or public.is_admin());

-- 作成・更新・削除は管理者のみ
drop policy if exists "bonus insert admin" on public.bonus_records;
create policy "bonus insert admin" on public.bonus_records
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists "bonus update admin" on public.bonus_records;
create policy "bonus update admin" on public.bonus_records
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "bonus delete admin" on public.bonus_records;
create policy "bonus delete admin" on public.bonus_records
  for delete to authenticated
  using (public.is_admin());

notify pgrst, 'reload schema';
