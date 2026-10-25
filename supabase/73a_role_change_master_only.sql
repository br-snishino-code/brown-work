-- 73a_role_change_master_only.sql
--
-- 【権限の修正・急ぎ】権限の変更をマスター管理者だけに限る
--
-- 経緯：
--   45_employees_column_guard.sql は「スタッフが自分の権限や給与を
--   書き換える」のを防いでいるが、管理者はこの条件で素通りしていた。
--
--     if caller_role in ('admin', 'master_admin') then
--       return new;   -- 管理者・マスター管理者はこれまでどおり全列を更新できる
--     end if;
--
--   employees の更新ポリシーも id = auth.uid() or is_admin() のため、
--   管理者はブラウザの開発者ツールから
--     update employees set role = 'master_admin' where id = 自分のID
--   に相当する命令を送るだけで、自分をマスター管理者に昇格できた。
--   昇格すれば、個人情報も給与明細もすべて見える。
--
--   画面の「管理者権限」はマスター管理者専用だが、画面を通さなければ
--   止まらなかった。
--
-- この修正：
--   権限（role）と管理者のタブ許可（admin_permissions）の変更を、
--   マスター管理者だけに限るトリガーを足す。
--
--   45番のトリガーはそのまま残す。2つとも BEFORE UPDATE で動き、
--   どちらか一方でも拒めば更新は通らない。45番を流し直しても
--   この制限は外れない。
--
-- 通るもの（従来どおり）：
--   ・マスター管理者による権限の変更・タブ許可の変更
--   ・Edge Function（アカウント作成など。auth.uid() が null になる）
--   ・権限以外の列の更新。管理者による所属グループやメモの編集は影響なし
--
-- 拒むもの：
--   ・管理者が自分または他人の role を変えること
--   ・管理者が admin_permissions を変えること
--   ・スタッフが同じことをすること（45番でも止まるが、二重の防御）
--
-- 実行方法：Supabase → SQL Editor に貼り付けて Run
--
-- 元に戻したいとき：
--   drop trigger if exists guard_employee_role_change on public.employees;


begin;

create or replace function public.guard_employee_role_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- サーバー側の処理（Edge Function）はそのまま通す
  if auth.uid() is null then
    return new;
  end if;

  -- マスター管理者はそのまま通す
  if public.is_master_admin() then
    return new;
  end if;

  if new.role is distinct from old.role then
    raise exception '権限を変更できるのはマスター管理者だけです'
      using errcode = '42501';
  end if;

  if to_jsonb(new) -> 'admin_permissions' is distinct from to_jsonb(old) -> 'admin_permissions' then
    raise exception '管理者が使えるタブを変更できるのはマスター管理者だけです'
      using errcode = '42501';
  end if;

  return new;
end $$;

drop trigger if exists guard_employee_role_change on public.employees;
create trigger guard_employee_role_change
  before update on public.employees
  for each row execute function public.guard_employee_role_change();

commit;


notify pgrst, 'reload schema';


-- ------------------------------------------------------------
-- 確認：1 が返れば成功
-- ------------------------------------------------------------
select count(*) as "トリガー（1なら成功）"
from pg_trigger
where tgname = 'guard_employee_role_change' and not tgisinternal;
