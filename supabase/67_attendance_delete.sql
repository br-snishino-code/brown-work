-- 67_attendance_delete.sql
--
-- 管理画面から打刻そのものを削除できるようにする
--
-- 背景：
--   休みの日に誤って打刻してしまったときに、その日の記録を丸ごと消したい。
--   これまでは時刻を空にすることはできましたが、記録自体は残っていました。
--   また attendance_records には削除の許可設定が無く、誰も削除できない
--   状態でした（select / insert / update の許可しかありませんでした）。
--
-- 決めたルール：
--   ・削除できるのはマスター管理者のみ。
--   ・月次勤怠が確定済み、またはその月の給与明細が公開済みの場合は削除できない。
--     先に確定または公開を取り消してから削除する。
--   ・スタッフへ知らせるかどうかは、削除のたびに画面で選ぶ（通知の有無は画面側の動き）。
--
-- 入れるもの：
--   1. 削除の許可設定（マスター管理者のみ）
--   2. 確定済み・公開済みの月を守る判定
--
-- 何度流しても同じ結果になります。
-- 既存のデータは変更しません。


-- ========================================================
-- 1. 削除の許可設定（マスター管理者のみ）
-- ========================================================
drop policy if exists "attendance delete master only" on public.attendance_records;
create policy "attendance delete master only" on public.attendance_records
  as permissive
  for delete
  to authenticated
  using (public.is_master_admin());


-- ========================================================
-- 2. 確定済み・公開済みの月を守る判定
-- ========================================================
create or replace function public.guard_attendance_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $func$
-- 変数名は列名とぶつからないよう v_ を付ける
--（target_month のままだと monthly_attendance_confirmations.target_month と
--  区別がつかず「column reference is ambiguous」で止まる）
declare
  v_month text;
  v_year integer;
  v_mon integer;
begin
  -- ログインしていない呼び出し（service_role / サーバー処理）は素通し
  if auth.uid() is null then
    return old;
  end if;

  v_month := to_char(old.date, 'YYYY-MM');
  v_year := extract(year from old.date)::integer;
  v_mon := extract(month from old.date)::integer;

  -- 月次勤怠が確定済みか
  if exists (
    select 1 from public.monthly_attendance_confirmations c
    where c.employee_id = old.employee_id
      and c.target_month = v_month
      and c.status = 'confirmed'
  ) then
    raise exception '% の月次勤怠は確定済みのため、打刻を削除できません。先に「勤怠」→「月次確定」で確定を取り消してください',
      v_month using errcode = '42501';
  end if;

  -- その月の給与明細が公開済みか
  if exists (
    select 1 from public.payroll_records p
    where p.employee_id = old.employee_id
      and p.year = v_year
      and p.month = v_mon
      and p.status = 'published'
  ) then
    raise exception '%年%月分の給与明細は公開済みのため、打刻を削除できません。先に給与タブで明細の公開を取り消してください',
      v_year, v_mon using errcode = '42501';
  end if;

  return old;
end;
$func$;

drop trigger if exists guard_attendance_delete on public.attendance_records;
create trigger guard_attendance_delete
  before delete on public.attendance_records
  for each row execute function public.guard_attendance_delete();


notify pgrst, 'reload schema';


-- ========================================================
-- 確認
-- ========================================================
select '削除の許可設定' as 確認項目,
       case when exists (
         select 1 from pg_policies
         where schemaname = 'public' and tablename = 'attendance_records'
           and policyname = 'attendance delete master only'
       ) then '作成済み' else '未作成' end as 結果,
       '作成済み であれば正常' as 期待値

union all

select '守る判定の関数',
       case when exists (
         select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'guard_attendance_delete'
       ) then '作成済み' else '未作成' end,
       '作成済み であれば正常'

union all

select 'トリガー',
       case when exists (
         select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
         where not t.tgisinternal
           and c.relname = 'attendance_records'
           and t.tgname = 'guard_attendance_delete'
       ) then '設定済み' else '未設定' end,
       '設定済み であれば正常';
