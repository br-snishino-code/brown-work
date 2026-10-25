-- 72_payslip_master_only.sql
--
-- 【権限の修正】給与明細・賞与明細の閲覧をマスター管理者だけに限る
--
-- 経緯：
--   payroll_records / bonus_records のポリシーはこうなっていた。
--     閲覧（通常） … 本人の公開済み または is_admin()
--     制限         … 本人 または has_admin_tab('payroll')
--     制限         … 2段階認証を通っていること
--   マスター管理者に限る条件がどこにも無く、給与タブを許可された
--   管理者は他のスタッフの給与明細・賞与明細を、下書きも含めて
--   閲覧できていた。
--
-- この修正：
--   下の4つの表に「本人またはマスター管理者」という制限ポリシーを足す。
--     payroll_records                 給与明細
--     bonus_records                   賞与明細
--     employee_salary_items           個人ごとの支給・控除項目
--     employee_standard_remuneration  標準報酬月額
--   支給・控除項目と標準報酬月額は明細の中身そのものなので、
--   明細だけ隠しても意味がない。あわせて限る。
--
--   交通費精算（commute_expense_claims）は変更しない。
--   管理者が従来どおり確認できる必要があるため。
--
-- 既存のポリシーは消さずに足すだけ：
--   制限ポリシー（restrictive）は既存のものと AND で効くため、
--   通れる範囲が狭まるだけで、新しく何かができるようになることはない。
--   61番や54番をもう一度流しても、この制限は外れない。
--
-- 効き方：
--   スタッフ       … 自分の公開済み明細は従来どおり見られる
--   管理者         … 自分の分だけ。他人の明細は見えない。作成・更新もできない
--   マスター管理者 … 従来どおりすべて
--
-- アプリ側：
--   給与明細の作成はすでにマスター管理者限定にしてある（f19de0c）。
--   管理者の給与タブでは、明細の一覧が空になる。
--
-- 前提：
--   01_schema.sql（is_master_admin）が適用済みであること
--
-- 実行方法：Supabase → SQL Editor に貼り付けて Run
--
-- 元に戻したいときは、このファイルの末尾のコメントを参照。


begin;

do $do$
declare
  t text;
  targets text[] := array[
    'payroll_records',
    'bonus_records',
    'employee_salary_items',
    'employee_standard_remuneration'
  ];
begin
  foreach t in array targets loop
    if to_regclass('public.' || t) is null then
      raise notice 'スキップ（表がありません）: %', t;
      continue;
    end if;
    execute format('drop policy if exists "master admin only" on public.%I', t);
    execute format(
      'create policy "master admin only" on public.%I as restrictive to authenticated '
      || 'using (employee_id = auth.uid() or public.is_master_admin()) '
      || 'with check (employee_id = auth.uid() or public.is_master_admin())', t);
    raise notice '適用しました: %', t;
  end loop;
end $do$;

commit;


notify pgrst, 'reload schema';


-- ------------------------------------------------------------
-- 確認：4行とも「制限」で出れば成功
-- ------------------------------------------------------------
select
  tablename  as "表",
  policyname as "ポリシー名",
  case permissive when 'RESTRICTIVE' then '制限' else '通常' end as "種別",
  qual       as "条件"
from pg_policies
where schemaname = 'public'
  and policyname = 'master admin only'
order by tablename;


-- ------------------------------------------------------------
-- 元に戻したいとき（この4行を SQL Editor で流す）
-- ------------------------------------------------------------
--   drop policy if exists "master admin only" on public.payroll_records;
--   drop policy if exists "master admin only" on public.bonus_records;
--   drop policy if exists "master admin only" on public.employee_salary_items;
--   drop policy if exists "master admin only" on public.employee_standard_remuneration;
--
--   これで給与タブを許可された管理者が、従来どおり閲覧できるようになる。
