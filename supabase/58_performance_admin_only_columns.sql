-- 58_performance_admin_only_columns.sql
--
-- タブレット不備件数・キャンセル件数・10G半額の指定を、管理者だけが入力できるようにする
--
-- 背景：
--   この3つはインセンティブの支給額を直接下げる項目です。
--     tablet_issues     … タブレット不備件数（1件あたり -2P）
--     cancellations     … キャンセル件数（1件あたり -3P）
--     g10_half_override … 10G付帯率による半額の指定
--   これまではスタッフ本人の実績入力画面にも入力欄があり、
--   自分で0に書き換えることができました。
--
--   画面側（App.tsx）でもスタッフの入力欄を表示だけに変えていますが、
--   ブラウザの開発者ツールから API を直接呼べば書けてしまうため、
--   ここでも同じ制限をかけます。
--
-- この SQL でやること：
--   55番・56番で作ったガード（他人の行を触れない／修正記録を書き換えられない／
--   入力期限を過ぎたら書けない）はそのまま残したうえで、
--   「本人はこの3つの列を変えられない」を足します。
--
-- 画面の動きで変わらないこと：
--   スタッフの実績入力（日ごとの入力・一時保存・提出）はこれまでどおりです。
--   管理者は「eo業務インセンティブ」の一覧と「実績を直す」から入力できます。
--
-- 実行方法：Supabase → SQL Editor にこの中身を貼り付けて Run
--           ※ 55番・56番を先に実行してください（57番で確認できます）


create or replace function public.guard_performance_self_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $func$
declare
  limit_date date;
  jnew jsonb;
  jold jsonb;
begin
  -- ログインしていない呼び出し（service_role / サーバー処理）は素通し
  if auth.uid() is null then
    return new;
  end if;

  -- 管理者は何でも変更できる
  if public.caller_is_admin() then
    return new;
  end if;

  -- ここから下は本人の操作

  -- 他人の行として作る・他人に付け替えるのを止める
  if new.employee_id is distinct from auth.uid() then
    raise exception '他のスタッフの実績は変更できません';
  end if;
  if tg_op = 'UPDATE' and old.employee_id is distinct from new.employee_id then
    raise exception '実績の持ち主は変更できません';
  end if;

  -- 管理者が直した記録は本人には触らせない
  if tg_op = 'INSERT' then
    if new.admin_edited_at is not null
       or new.admin_edited_by_id is not null
       or coalesce(new.admin_edited_by_name, '') <> '' then
      raise exception '管理者の修正記録は変更できません';
    end if;
  else
    if new.admin_edited_at is distinct from old.admin_edited_at
       or new.admin_edited_by_id is distinct from old.admin_edited_by_id
       or new.admin_edited_by_name is distinct from old.admin_edited_by_name then
      raise exception '管理者の修正記録は変更できません';
    end if;
  end if;

  -- 管理者だけが入力する列は、本人には変えさせない。
  -- この3列は新規実績の表にしかないため、列があるときだけ見る
  -- （to_jsonb を使うと、列が無い表でもエラーにならない）
  jnew := to_jsonb(new);
  if jnew ? 'tablet_issues' then
    if tg_op = 'INSERT' then
      if coalesce((jnew->>'tablet_issues')::int, 0) <> 0
         or coalesce((jnew->>'cancellations')::int, 0) <> 0
         or jnew->>'g10_half_override' is not null then
        raise exception 'タブレット不備件数・キャンセル件数・10G半額の指定は管理者が入力します';
      end if;
    else
      jold := to_jsonb(old);
      if jnew->'tablet_issues' is distinct from jold->'tablet_issues'
         or jnew->'cancellations' is distinct from jold->'cancellations'
         or jnew->'g10_half_override' is distinct from jold->'g10_half_override' then
        raise exception 'タブレット不備件数・キャンセル件数・10G半額の指定は管理者が入力します';
      end if;
    end if;
  end if;

  -- 入力期限を過ぎた月は、本人は変更できない
  limit_date := public.perf_deadline_date(new.year, new.month);
  if limit_date is not null and (timezone('Asia/Tokyo', now()))::date > limit_date then
    raise exception '% 年 % 月分の実績は % で受付を終了しました。修正が必要な場合は管理者にご連絡ください',
      new.year, new.month, to_char(limit_date, 'YYYY年MM月DD日');
  end if;

  -- 対象月を、期限切れの月に付け替えることも止める
  if tg_op = 'UPDATE' and (old.year is distinct from new.year or old.month is distinct from new.month) then
    limit_date := public.perf_deadline_date(old.year, old.month);
    if limit_date is not null and (timezone('Asia/Tokyo', now()))::date > limit_date then
      raise exception '受付を終了した月の実績は変更できません';
    end if;
  end if;

  return new;
end;
$func$;

notify pgrst, 'reload schema';


-- ============================================================
-- 確認
-- ============================================================
select 'ガードの有無' as 確認項目,
       (select count(*)::text || '件' from pg_trigger
         where tgname = 'guard_performance_self_update' and not tgisinternal) as 結果,
       '2件 であれば正常' as 期待値
union all
select '管理者だけの列の制限',
       case when exists (
         select 1 from pg_proc
          where proname = 'guard_performance_self_update'
            and prosrc like '%tablet_issues%'
       ) then '✅ 入っています' else '❌ 入っていません' end,
       '✅ であれば正常';
