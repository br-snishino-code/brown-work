-- 31_commute_claim_master_only.sql
--
-- 交通費精算の承認をマスター管理者のみに限定する。
--
-- 現状の UPDATE 権限：
--   commute_expense_claims_update … 本人 または 管理者（is_admin）
--   own commute claim update      … 本人（承認済みを除く）
-- 前者で管理者も承認できてしまうため、マスター管理者のみに置き換える。
-- 本人による修正は「own commute claim update」が引き続き担う。
--
-- 実行方法：Supabase の SQL Editor に貼り付けて Run

drop policy if exists "commute_expense_claims_update" on public.commute_expense_claims;
create policy "commute_expense_claims_update"
  on public.commute_expense_claims
  for update
  to authenticated
  using (
    exists (select 1 from public.employees e where e.id = auth.uid() and e.role = 'master_admin')
  )
  with check (true);

-- 本人の修正（承認済みは不可）は、これまでどおり残す
drop policy if exists "own commute claim update" on public.commute_expense_claims;
create policy "own commute claim update"
  on public.commute_expense_claims
  for update
  to authenticated
  using (employee_id = auth.uid() and status <> 'approved')
  with check (employee_id = auth.uid());

notify pgrst, 'reload schema';
