-- 30_monthly_attendance_confirmations.sql
--
-- 月次勤怠の確定フロー。
--   スタッフが前月分を確定申請 → 管理者が内容を確認して承認
--   → マスター管理者が最終承認 → その月の給与計算へ進める
--
-- 実行方法：Supabase の SQL Editor に貼り付けて Run

create table if not exists public.monthly_attendance_confirmations (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  target_month text not null,                 -- 'YYYY-MM'
  status text not null default 'pending',     -- pending / admin_approved / confirmed / rejected
  summary jsonb not null default '{}'::jsonb, -- 提出時点の集計（出勤日数・労働時間など）
  staff_note text,
  admin_comment text,
  admin_decided_by uuid,
  admin_decided_at timestamptz,
  master_comment text,
  master_decided_by uuid,
  master_decided_at timestamptz,
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (employee_id, target_month)
);

alter table public.monthly_attendance_confirmations enable row level security;

-- 本人は自分の分を、管理者は全員分を見られる
drop policy if exists "monthly confirm select" on public.monthly_attendance_confirmations;
create policy "monthly confirm select"
  on public.monthly_attendance_confirmations for select to authenticated
  using (
    employee_id = auth.uid()
    or exists (select 1 from public.employees e where e.id = auth.uid() and e.role in ('admin', 'master_admin'))
  );

-- 本人が自分の分を提出できる
drop policy if exists "monthly confirm insert" on public.monthly_attendance_confirmations;
create policy "monthly confirm insert"
  on public.monthly_attendance_confirmations for insert to authenticated
  with check (employee_id = auth.uid());

-- 本人は確定前の自分の分を出し直せる。管理者は承認処理のため更新できる
drop policy if exists "monthly confirm update" on public.monthly_attendance_confirmations;
create policy "monthly confirm update"
  on public.monthly_attendance_confirmations for update to authenticated
  using (
    (employee_id = auth.uid() and status <> 'confirmed')
    or exists (select 1 from public.employees e where e.id = auth.uid() and e.role in ('admin', 'master_admin'))
  )
  with check (true);

notify pgrst, 'reload schema';
