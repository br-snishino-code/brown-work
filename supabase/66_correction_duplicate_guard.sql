-- 66_correction_duplicate_guard.sql
--
-- 勤怠修正申請の二重送信を、データベース側で止める
--
-- 直す問題：
--   申請ボタンを押してから画面が切り替わるまで数秒かかることがあり、
--   その間にもう一度押せてしまうため、まったく同じ内容の申請が
--   何件も並ぶことがありました。
--
-- 画面側でも対策済みです（このSQLと合わせて二重に守ります）：
--   ・送信中はボタンを押せないようにした（「送信中…」の表示に変わる）
--   ・同じ日の未処理の申請があるときは、新しく作らずその申請を書き換える
--
-- このSQLで足すもの：
--   同じスタッフ・同じ日付で、未処理（pending）の申請が2件以上にならないようにする判定。
--   画面を通らない操作や、ごく短い間隔の連打で画面側の判定をすり抜けた場合に効きます。
--
-- 止めないもの：
--   ・すでに承認・却下された日に、あらためて申請し直すこと
--     （未処理の申請だけを数えます）
--   ・管理者による申請内容の書き換え（更新は対象外。判定は新規作成のときだけ）
--
-- 何度流しても同じ結果になります。
-- 既存のデータは変更しません。


-- ========================================================
-- 1. いま重複している申請があるか確認する（読み取りのみ）
-- ========================================================
-- 下の判定を入れても、すでに入ってしまった重複は消えません。
-- 管理者画面でどれか1件を承認し、残りを却下してください。
select '重複している未処理の申請' as 確認項目,
       coalesce(string_agg(d.説明, '、' order by d.date), 'なし') as 結果,
       'なし であれば重複なし' as 期待値
from (
  select c.date,
         coalesce(e.name, '（氏名不明）') || ' ' || c.date::text
           || '（' || count(*)::text || '件）' as 説明
  from public.corrections c
  left join public.employees e on e.id = c.employee_id
  where c.status = 'pending'
  group by c.employee_id, e.name, c.date
  having count(*) > 1
) d;


-- ========================================================
-- 2. 判定の中身
-- ========================================================
create or replace function public.guard_correction_duplicate()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $func$
declare
  existing_count integer;
begin
  select count(*) into existing_count
  from public.corrections c
  where c.employee_id = new.employee_id
    and c.date = new.date
    and c.status = 'pending';

  if existing_count > 0 then
    raise exception '% の勤怠修正申請はすでに送信済みです。内容を変えるときは、送信済みの申請を直してください',
      to_char(new.date, 'YYYY年MM月DD日')
      using errcode = '23505';   -- 重複を表すコード
  end if;

  return new;
end;
$func$;


-- ========================================================
-- 3. トリガーの設定（新規作成のときだけ判定する）
-- ========================================================
drop trigger if exists guard_correction_duplicate on public.corrections;
create trigger guard_correction_duplicate
  before insert on public.corrections
  for each row execute function public.guard_correction_duplicate();


notify pgrst, 'reload schema';


-- ========================================================
-- 確認
-- ========================================================
select '判定の関数' as 確認項目,
       case when exists (
         select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'guard_correction_duplicate'
       ) then '作成済み' else '未作成' end as 結果,
       '作成済み であれば正常' as 期待値

union all

select 'トリガー',
       case when exists (
         select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
         where not t.tgisinternal
           and c.relname = 'corrections'
           and t.tgname = 'guard_correction_duplicate'
       ) then '設定済み' else '未設定' end,
       '設定済み であれば正常'

union all

select '重複している未処理の申請の組',
       count(*)::text || '組',
       '0組 であれば正常（1組以上あれば上の一覧を参照）'
from (
  select 1 from public.corrections
  where status = 'pending'
  group by employee_id, date
  having count(*) > 1
) dup;
