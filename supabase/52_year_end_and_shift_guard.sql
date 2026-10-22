-- 52_year_end_and_shift_guard.sql
--
-- 【セキュリティ修正】年末調整の自己承認と、シフト希望の他人書き換えをふさぐ
--
-- 経緯：
--   51番で交通費・月次勤怠・勤怠打刻をふさいだあと、残りのポリシーを
--   本番で確認したところ、同じ種類の穴が2つ残っていた。
--
--   ① 年末調整（year_end_adjustments）
--      update が「本人または管理者」で、status を守るトリガーが無い。
--      自分の申告を自分で承認でき、承認後に扶養や保険料の金額を
--      書き換えることもできた。年末調整は給与計算に直結する。
--
--   ② シフト希望（shift_requests）
--      "shift request update" の書き込み条件が true のままだった。
--      許可ポリシーは複数あると OR で「緩いほう」が通るため、
--      同じ表の "shift update own or admin" があっても効かない。
--      結果、自分の行の employee_id を他人に書き換えて、
--      その人のシフト希望を上書きできた。
--      同じ内容の INSERT ポリシーも2つ重複していた。
--
--   どちらも画面からはできないが、開発者ツールから API を
--   直接呼べば実行できる状態だった。
--
-- 管理者・マスター管理者と、サーバー側（service_role）は
-- これまでどおり何でも変更できる。制限されるのは本人だけ。
--
-- 画面の動きは変わりません：
--   年末調整の入力・提出・修正、シフト希望の提出・出し直し、
--   管理者の承認・却下はすべてこれまでどおりです。
--
-- 実行方法：Supabase → SQL Editor に貼り付けて Run
--   ※ 51番（caller_is_admin を作るSQL）を先に実行しておいてください。


-- ============================================================
-- ① 年末調整：本人は承認の記録を変えられない。承認後は編集もできない
-- ============================================================
-- 列の名前は環境によって違う可能性があるため、jsonb に変換して
-- 名前で見ている（無い列は読み飛ばすので、落ちない）。
create or replace function public.guard_year_end_decision()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $func$
declare
  old_row jsonb;
  new_row jsonb;
  col     text;
  -- 承認にかかわる列（本人は変更できない）
  decision_cols text[] := array[
    'status',
    'decided_at', 'decided_by',
    'admin_comment', 'admin_decided_at', 'admin_decided_by',
    'master_comment', 'master_decided_at', 'master_decided_by',
    'approved_at', 'approved_by'
  ];
  -- 申告者と対象年（本人は変更できない）
  key_cols text[] := array['employee_id', 'year', 'target_year'];
  -- 「もう決裁された」と判断する手がかり
  decided_marks text[] := array[
    'decided_at', 'admin_decided_at', 'master_decided_at', 'approved_at'
  ];
  already_decided boolean := false;
begin
  if auth.uid() is null or public.caller_is_admin() then
    return new;
  end if;

  old_row := to_jsonb(old);
  new_row := to_jsonb(new);

  foreach col in array key_cols loop
    if (old_row ? col) and (new_row -> col) is distinct from (old_row -> col) then
      raise exception '申告者と対象年は変更できません（%）', col using errcode = '42501';
    end if;
  end loop;

  foreach col in array decision_cols loop
    if (old_row ? col) and (new_row -> col) is distinct from (old_row -> col) then
      raise exception '承認・却下は管理者のみ行えます（%）', col using errcode = '42501';
    end if;
  end loop;

  -- 承認が済んだあとに中身を書き換えられないようにする
  foreach col in array decided_marks loop
    if (old_row ? col) and (old_row -> col) is distinct from 'null'::jsonb then
      already_decided := true;
    end if;
  end loop;

  if already_decided and new_row is distinct from old_row then
    raise exception '承認済みの年末調整はご自身では変更できません。管理者にご連絡ください'
      using errcode = '42501';
  end if;

  return new;
end;
$func$;

drop trigger if exists guard_year_end_decision on public.year_end_adjustments;
create trigger guard_year_end_decision
  before update on public.year_end_adjustments
  for each row execute function public.guard_year_end_decision();


-- ============================================================
-- ② シフト希望：重複したポリシーを整理し、書き込み条件を絞る
-- ============================================================
-- 許可ポリシーは複数あると OR で評価されるため、
-- 緩いものが1つ残っているだけで効かなくなる。
-- 同じ意味のものをまとめて、条件を1組にそろえる。

-- 緩いほう・重複しているものを削除
drop policy if exists "shift request update" on public.shift_requests;
drop policy if exists "shift request insert" on public.shift_requests;
drop policy if exists "shift request select" on public.shift_requests;
drop policy if exists "shift insert own or admin" on public.shift_requests;
drop policy if exists "shift select own or admin" on public.shift_requests;
drop policy if exists "shift update own or admin" on public.shift_requests;

create policy "shift select own or admin" on public.shift_requests
  for select to authenticated
  using (employee_id = auth.uid() or public.caller_is_admin());

create policy "shift insert own or admin" on public.shift_requests
  for insert to authenticated
  with check (employee_id = auth.uid() or public.caller_is_admin());

create policy "shift update own or admin" on public.shift_requests
  for update to authenticated
  using (employee_id = auth.uid() or public.caller_is_admin())
  with check (employee_id = auth.uid() or public.caller_is_admin());

-- status を守るトリガー（01_schema.sql で作成済み）が
-- 付いているかを念のため確認し、無ければ付け直す
do $do$
begin
  if not exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    where not t.tgisinternal
      and c.relname = 'shift_requests'
      and t.tgname = 'guard_shift_requests'
  ) then
    execute 'create trigger guard_shift_requests before update on public.shift_requests
             for each row execute function public.guard_decision_fields()';
    raise notice 'guard_shift_requests を作成しました';
  end if;
end $do$;


notify pgrst, 'reload schema';

-- ============================================================
-- 確認
-- ============================================================
select 'シフト希望のポリシー' as 区分,
       policyname as 項目,
       cmd || ' ｜書:' || coalesce(with_check, '-') as 内容
from pg_policies
where schemaname = 'public' and tablename = 'shift_requests'
union all
select 'トリガー', tgname, c.relname
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
where not t.tgisinternal
  and t.tgname in ('guard_year_end_decision', 'guard_shift_requests')
order by 1, 2;
