-- 28_commute_claim_update.sql
--
-- 交通費精算書を、提出したご本人が修正できるようにする。
-- 承認済みのものは修正できない（承認待ち・差し戻しのみ）。
--
-- 実行方法：Supabase の SQL Editor に貼り付けて Run

alter table public.commute_expense_claims enable row level security;

drop policy if exists "own commute claim update" on public.commute_expense_claims;
create policy "own commute claim update"
  on public.commute_expense_claims
  for update
  to authenticated
  using (employee_id = auth.uid() and status <> 'approved')
  with check (employee_id = auth.uid());
