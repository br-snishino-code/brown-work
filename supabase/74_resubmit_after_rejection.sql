-- 74_resubmit_after_rejection.sql
--
-- 【不具合の修正】差し戻された申請を、本人が直して出し直せるようにする
--
-- 症状：
--   差し戻された交通費精算書を直して「この内容で修正する」を押すと
--     交通費精算書の修正に失敗しました：承認・却下は管理者のみ行えます
--   と出て保存できない。月次勤怠の確定申請も同じ。
--
-- 原因：
--   51_self_approval_guard.sql のガードが、本人による status の変更を
--   一律で拒んでいた。本人が自分の申請を承認済みにするのを防ぐためだが、
--   「差し戻し → 承認待ち」に戻す出し直しまで巻き添えになっていた。
--   admin_comment と decided_at を空に戻す動きも同じ理由で拒まれていた。
--
--   承認待ちのものを直す分には status が変わらないため通る。
--   差し戻しのときだけ失敗していた。
--
-- この修正：
--   本人が自分の申請を「下書き／差し戻し → 承認待ち」に戻す場合だけ通す。
--   そのとき、承認の記録（admin_comment・decided_at など）が
--   すべて空になっていることも確かめる。
--
--   承認済み・確定済みからは戻せない。自分を承認することもできない。
--   それ以外のガードは 51番のまま変えていない。
--
-- 対象：
--   commute_expense_claims            交通費精算
--   monthly_attendance_confirmations  月次勤怠の確定申請
--
-- 前提：
--   51_self_approval_guard.sql が適用済みであること
--
-- 実行方法：Supabase → SQL Editor に貼り付けて Run


begin;

-- ============================================================
-- ① 交通費精算
-- ============================================================
create or replace function public.guard_commute_claim_decision()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $func$
begin
  if auth.uid() is null or public.caller_is_admin() then
    return new;
  end if;

  if new.employee_id is distinct from old.employee_id then
    raise exception '申請者は変更できません' using errcode = '42501';
  end if;

  -- 本人が、差し戻し／下書きの自分の申請を出し直す場合だけ通す。
  -- 承認の記録が消えていることも確かめる（承認済みに偽装させないため）。
  if old.employee_id = auth.uid()
     and old.status in ('draft', 'rejected')
     and new.status = 'pending'
     and new.admin_comment is null
     and new.decided_at is null then
    return new;
  end if;

  if new.status is distinct from old.status
     or new.decided_at is distinct from old.decided_at
     or new.admin_comment is distinct from old.admin_comment then
    raise exception '承認・却下は管理者のみ行えます' using errcode = '42501';
  end if;
  return new;
end;
$func$;


-- ============================================================
-- ② 月次勤怠の確定申請
-- ============================================================
create or replace function public.guard_monthly_confirm_decision()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $func$
begin
  if auth.uid() is null or public.caller_is_admin() then
    return new;
  end if;

  if new.employee_id is distinct from old.employee_id
     or new.target_month is distinct from old.target_month then
    raise exception '申請者と対象月は変更できません' using errcode = '42501';
  end if;

  -- 本人が、差し戻し／下書きの自分の申請を出し直す場合だけ通す
  if old.employee_id = auth.uid()
     and old.status in ('draft', 'rejected')
     and new.status = 'pending'
     and new.admin_comment is null
     and new.admin_decided_by is null
     and new.admin_decided_at is null
     and new.master_comment is null
     and new.master_decided_by is null
     and new.master_decided_at is null then
    return new;
  end if;

  if new.status is distinct from old.status
     or new.admin_comment is distinct from old.admin_comment
     or new.admin_decided_by is distinct from old.admin_decided_by
     or new.admin_decided_at is distinct from old.admin_decided_at
     or new.master_comment is distinct from old.master_comment
     or new.master_decided_by is distinct from old.master_decided_by
     or new.master_decided_at is distinct from old.master_decided_at then
    raise exception '承認・却下は管理者のみ行えます' using errcode = '42501';
  end if;
  return new;
end;
$func$;

commit;


notify pgrst, 'reload schema';


-- ------------------------------------------------------------
-- 確認：2行とも出れば成功
-- ------------------------------------------------------------
select
  tgname as "トリガー",
  relname as "表"
from pg_trigger t join pg_class c on c.oid = t.tgrelid
where tgname in ('guard_commute_claim_decision', 'guard_monthly_confirm_decision')
  and not tgisinternal
order by tgname;
