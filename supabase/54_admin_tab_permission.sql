-- 54_admin_tab_permission.sql
--
-- 【権限の修正】管理者のタブ制限を、データベース側でも効くようにする
--
-- 経緯：
--   管理者には「勤怠・労務・人材・給与」の4タブを個別に許可する設定
--   （employees.admin_permissions）があるが、これは画面の表示を
--   制御しているだけだった。
--   RLS が見ているのは is_admin()（役割だけ）で、admin_permissions を
--   参照するポリシーは1つも無かった。
--   そのため「勤怠のみ許可」にした管理者でも、ブラウザの開発者ツールから
--   API を直接呼べば給与データを読めた。
--
-- この修正：
--   給与に関する表に「制限ポリシー」を足し、
--   給与タブを許可された管理者とマスター管理者だけが他人の分を見られる
--   ようにする。ご本人が自分の明細を見るのはこれまでどおり。
--
-- 対象の表（管理画面の「給与」タブに出るもの）：
--   payroll_records                 給与明細
--   bonus_records                   賞与明細
--   employee_salary_items           個人ごとの支給・控除項目
--   employee_standard_remuneration  標準報酬月額
--   commute_expense_claims          交通費精算
--
-- ※ 勤怠・労務・人材のタブについては、今回は変更していません。
--   必要になったら同じ形で足せます。
--
-- 実行方法：Supabase → SQL Editor に貼り付けて Run


-- ------------------------------------------------------------
-- 判定用の関数
--   マスター管理者            … 常に true
--   管理者で、そのタブが許可  … true
--   管理者で、許可されていない… false
--   スタッフ                  … false（本人の行は別の条件で通る）
--
-- admin_permissions の型（jsonb か text[] か）が環境によって違う
-- 可能性があるため、to_jsonb に通してから判定している。
-- 値が入っていない場合は、画面側と同じく「全タブ許可」として扱う。
-- ------------------------------------------------------------
create or replace function public.has_admin_tab(tab text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $func$
  select exists (
    select 1
      from public.employees e
     where e.id = auth.uid()
       and (
         e.role = 'master_admin'
         or (
           e.role = 'admin'
           and (
             e.admin_permissions is null
             or to_jsonb(e.admin_permissions) ? tab
           )
         )
       )
  );
$func$;


-- ------------------------------------------------------------
-- 給与に関する表に制限ポリシーを足す
--   制限ポリシー（restrictive）は既存のポリシーと AND で効くため、
--   これまで読めていた範囲がさらに狭まるだけ。
--   新しく何かが読めるようになることはない。
-- ------------------------------------------------------------
do $do$
declare
  t text;
  targets text[] := array[
    'payroll_records',
    'bonus_records',
    'employee_salary_items',
    'employee_standard_remuneration',
    'commute_expense_claims'
  ];
begin
  foreach t in array targets loop
    if to_regclass('public.' || t) is null then
      raise notice 'スキップ（表がありません）: %', t;
      continue;
    end if;
    execute format('drop policy if exists "payroll tab required" on public.%I', t);
    execute format(
      'create policy "payroll tab required" on public.%I as restrictive to authenticated '
      || 'using (employee_id = auth.uid() or public.has_admin_tab(''payroll'')) '
      || 'with check (employee_id = auth.uid() or public.has_admin_tab(''payroll''))', t);
    raise notice '適用しました: %', t;
  end loop;
end $do$;

notify pgrst, 'reload schema';

-- ============================================================
-- 確認
-- ============================================================
select
  tablename as テーブル,
  policyname as ポリシー,
  permissive as 種別
from pg_policies
where schemaname = 'public' and policyname = 'payroll tab required'
order by tablename;


-- ============================================================
-- 解除したいとき（この下だけを選んで実行）
-- ============================================================
-- do $do$
-- declare r record;
-- begin
--   for r in select tablename from pg_policies
--             where schemaname = 'public' and policyname = 'payroll tab required'
--   loop
--     execute format('drop policy if exists "payroll tab required" on public.%I', r.tablename);
--   end loop;
-- end $do$;
-- notify pgrst, 'reload schema';
