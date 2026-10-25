-- 78_year_end_master_only.sql
--
-- 【権限の修正】年末調整をマスター管理者だけに限る／個別の出勤規定日数の閲覧を絞る
--
-- 経緯：
--   セキュリティの点検で、72番（給与明細のマスター管理者限定）の対象から
--   年末調整（year_end_adjustments）が漏れていることが分かった。
--
--   この表には次が入っている：
--     配偶者の所得、生命保険料、地震保険料、社会保険料、
--     住宅ローン控除額、扶養人数
--
--   給与明細と同じ機微度にもかかわらず、閲覧の条件が
--     employee_id = auth.uid() or is_admin()
--   のままで、「管理者なら誰でも全スタッフの分を読める」状態だった。
--   54番（給与タブの許可が必要）の対象にも入っていなかったため、
--   給与タブを許可していない管理者でも読めた。
--
--   あわせて employee_attendance_schedules（スタッフ個別の月別
--   出勤規定日数）の閲覧が using (true) で、全ログイン利用者から
--   読める状態だった。同じ性質の employee_schedule_patterns は
--   本人と管理者に絞られており、こちらだけ揃っていなかった。
--
-- この修正：
--   ① year_end_adjustments に 72番と同じ restrictive ポリシーを足す。
--      本人は自分の分をこれまでどおり提出・修正できる。
--      管理者（admin）は読めなくなる。
--   ② employee_attendance_schedules の閲覧を
--      「本人または管理者」に絞る。書き込みは従来どおり管理者のみ。
--
-- restrictive ポリシーは既存のポリシーと AND で効くため、
-- いま読めている範囲がさらに狭まるだけ。新しく何かが読めるようには
-- ならない。
--
-- 影響：
--   ・管理者（admin）の「人材」タブの年末調整が空になる。
--     アプリ側でもタブ自体を出さないようにしてある（同時にデプロイすること）。
--   ・スタッフ本人の提出・修正・閲覧は変わらない。
--   ・マスター管理者は変わらない。
--   ・年末調整の入力依頼メールの送信は、もともとマスター管理者のみ。
--
-- 流す順番：
--   どちらが先でも画面は止まらない。
--   SQLを先に流すと、アプリを出すまでのあいだ管理者の年末調整タブが
--   空の一覧として見える。アプリを先に出すと、SQLを流すまでのあいだ
--   管理者にタブが出なくなるだけで、データは従来どおり。
--   混乱が少ないのは「アプリを先、SQLを後」。
--
-- 実行方法：Supabase → SQL Editor に貼り付けて Run
--
-- 元に戻したいとき：
--   drop policy if exists "master admin only" on public.year_end_adjustments;
--   drop policy if exists "employee_attendance_schedules_select"
--     on public.employee_attendance_schedules;
--   create policy "employee_attendance_schedules_select"
--     on public.employee_attendance_schedules for select to authenticated
--     using (true);


begin;

-- ------------------------------------------------------------
-- ① 年末調整をマスター管理者だけに限る（72番と同じ形）
-- ------------------------------------------------------------
do $do$
begin
  if to_regclass('public.year_end_adjustments') is null then
    raise exception '年末調整の表がありません。先に 60番までを適用してください';
  end if;

  drop policy if exists "master admin only" on public.year_end_adjustments;
  create policy "master admin only"
    on public.year_end_adjustments as restrictive to authenticated
    using (employee_id = auth.uid() or public.is_master_admin())
    with check (employee_id = auth.uid() or public.is_master_admin());

  raise notice '適用しました: year_end_adjustments（マスター管理者限定）';
end $do$;


-- ------------------------------------------------------------
-- ② 個別の出勤規定日数の閲覧を「本人または管理者」に絞る
--    （employee_schedule_patterns と同じ条件に揃える）
-- ------------------------------------------------------------
do $do$
begin
  if to_regclass('public.employee_attendance_schedules') is null then
    raise notice 'スキップ（表がありません）: employee_attendance_schedules';
    return;
  end if;

  drop policy if exists "employee_attendance_schedules_select"
    on public.employee_attendance_schedules;
  create policy "employee_attendance_schedules_select"
    on public.employee_attendance_schedules for select to authenticated
    using (employee_id = auth.uid() or public.is_admin());

  raise notice '適用しました: employee_attendance_schedules（本人または管理者）';
end $do$;

commit;


notify pgrst, 'reload schema';


-- ------------------------------------------------------------
-- 確認
-- ------------------------------------------------------------
-- (1) 1 が返れば成功（年末調整に制限ポリシーが付いた）
select count(*) as "年末調整の制限ポリシー（1なら成功）"
from pg_policies
where schemaname = 'public' and tablename = 'year_end_adjustments'
  and policyname = 'master admin only' and permissive = 'RESTRICTIVE';

-- (2) 0 が返れば成功（誰でも読める閲覧ポリシーが残っていない）
select count(*) as "誰でも読める閲覧ポリシー（0なら成功）"
from pg_policies
where schemaname = 'public'
  and tablename in ('year_end_adjustments', 'employee_attendance_schedules')
  and cmd = 'SELECT' and qual = 'true';

-- (3) 機微な表に制限ポリシーが付いているかの一覧（5行出れば成功）
select tablename as "表", policyname as "ポリシー"
from pg_policies
where schemaname = 'public' and policyname = 'master admin only'
order by tablename;
