-- 75_employees_visible_security_barrier.sql
--
-- 【権限の修正】employees_visible に security_barrier を付ける
--
-- 経緯：
--   Supabase の検査（database linter）が
--     security_definer_view: View `public.employees_visible` is defined
--     with the SECURITY DEFINER property
--   を ERROR として報告した。
--
--   このビューが SECURITY DEFINER（security_invoker = false）なのは意図的で、
--   基の表の列権限を越えて読むために必要。security_invoker = true にすると
--   ビュー自身が「権限がありません」で動かなくなる。
--
--   ただし「意図的だから安全」ではなかった。手元で確かめたところ、
--   細工した述語（評価コストを極端に低く申告した関数）をビューに当てると、
--   ビュー自身の where より先に評価され、本来は自分の行しか見えないはずの
--   スタッフが、全員の氏名・所属・スタッフメモなどを読めてしまった。
--
--   住所・口座などの個人情報は漏れない。伏せる処理が select 側の
--   case 式にあり、他人の行では null が返るため。
--   漏れるのは「管理者には見せている列」だけだが、スタッフには
--   見せない前提の情報なので塞ぐ。
--
-- この修正：
--   ビューに security_barrier = true を付ける。
--   これにより、利用者が書いた条件は、ビュー自身の絞り込みより
--   先には評価されなくなる。
--
-- 画面の動きは変わりません：
--   スタッフは自分の行、管理者は全員の行（個人情報は伏せたまま）、
--   マスター管理者はすべて、という見え方は従来どおり。
--
-- 検査の報告について：
--   security_barrier を付けても、linter の security_definer_view は
--   報告され続ける（SECURITY DEFINER であること自体を見ているため）。
--   この構成では意図的なものなので、報告は既知として扱う。
--   報告を消したい場合は、個人情報を別の表に分けて、それぞれに
--   RLS を設ける作りに変えることになる（規模の大きい移行）。
--
-- 前提：
--   71a_employee_visible_view.sql が適用済みであること
--
-- 実行方法：Supabase → SQL Editor に貼り付けて Run


do $do$
begin
  if to_regclass('public.employees_visible') is null then
    raise exception 'public.employees_visible がありません。先に 71a を適用してください';
  end if;
end $do$;

alter view public.employees_visible set (security_barrier = true);

notify pgrst, 'reload schema';


-- ------------------------------------------------------------
-- 確認：security_barrier=true が含まれていれば成功
-- ------------------------------------------------------------
select
  c.relname as "ビュー",
  c.reloptions as "設定"
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'employees_visible';
