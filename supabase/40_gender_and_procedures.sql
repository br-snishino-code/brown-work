-- 40_gender_and_procedures.sql
--
-- 1. 性別（gender）をスタッフ情報に追加する
-- 2. 各種手続き（退職・産前産後休業・育児休業）のテーブルを作る
--
-- 実行方法：Supabase の SQL Editor に貼り付けて Run

-- ---- 1. 性別 ----
alter table public.employees
  add column if not exists gender text;

-- ---- 2. 各種手続き ----
-- type   : 'resignation'（退職）| 'maternity'（産前産後休業）| 'childcare'（育児休業）
-- status : 'draft'（一時保存）| 'pending'（確認中）| 'in_progress'（対応中）
--          | 'completed'（完了）| 'rejected'（差し戻し）
-- details: 手続きごとの入力内容（種類によって項目が違うため jsonb で持つ）
create table if not exists public.staff_procedures (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  type text not null,
  status text not null default 'draft',
  details jsonb not null default '{}'::jsonb,
  staff_note text,
  admin_comment text,
  requested_by uuid,
  requested_at timestamptz,
  submitted_at timestamptz,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists staff_procedures_employee_idx on public.staff_procedures (employee_id);

alter table public.staff_procedures enable row level security;

-- 本人は自分の分、管理者は全員分
drop policy if exists "procedure select own or admin" on public.staff_procedures;
create policy "procedure select own or admin" on public.staff_procedures
  for select to authenticated
  using (employee_id = auth.uid() or public.is_admin());

-- 本人が始める。管理者が入力依頼として作ることもある
drop policy if exists "procedure insert own or admin" on public.staff_procedures;
create policy "procedure insert own or admin" on public.staff_procedures
  for insert to authenticated
  with check (employee_id = auth.uid() or public.is_admin());

-- 本人は自分の分を直せる。管理者は状態を進められる
drop policy if exists "procedure update own or admin" on public.staff_procedures;
create policy "procedure update own or admin" on public.staff_procedures
  for update to authenticated
  using (employee_id = auth.uid() or public.is_admin())
  with check (employee_id = auth.uid() or public.is_admin());

-- 取り下げは本人と管理者
drop policy if exists "procedure delete own or admin" on public.staff_procedures;
create policy "procedure delete own or admin" on public.staff_procedures
  for delete to authenticated
  using (employee_id = auth.uid() or public.is_admin());

notify pgrst, 'reload schema';
