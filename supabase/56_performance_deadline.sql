-- 56_performance_deadline.sql
--
-- 実績の入力期限（翌月○日まで）をデータベース側でも効かせる
--
-- 背景：
--   55番で管理者がスタッフの実績を直せるようにしましたが、そのあとで
--   本人がもう一度入力すると、管理者の修正が上書きされてしまいます。
--   そこで「対象月の翌月○日まで」を本人の入力期限とし、それを過ぎたら
--   本人は見るだけ・修正は管理者だけ、という形にします。
--
--   画面側（App.tsx）でも入力欄を閉じていますが、ブラウザの開発者ツールから
--   API を直接呼べば書けてしまうため、ここで同じ判定を入れます。
--
-- 期限の決め方：
--   app_settings の 'performance_deadline_day' に数字を1つ入れます。
--     5  … 対象月の翌月5日のおわり（日本時間）まで本人が入力できる
--     0  … 締切を設けない（これまでどおり、いつでも本人が直せる）
--   未設定のときは 0（締切なし）として扱います。
--   この値は画面の「実績の確認」タブから、マスター管理者が変更できます。
--
-- 判定の時刻：
--   データベースは UTC で動いているため、日本時間に直してから日付で比べます。
--   「翌月5日まで」なら、日本時間の翌月6日 0:00 から書けなくなります。
--
-- 制限されるのは本人だけです：
--   管理者・マスター管理者と、サーバー側（service_role）は、
--   期限を過ぎても実績を直せます。
--
-- 実行方法：Supabase → SQL Editor にこの中身を貼り付けて Run
--           ※ 55_performance_admin_edit.sql を先に実行してください


-- ============================================================
-- ① 設定値を読む関数
-- ============================================================
-- 数字以外が入っていても落ちないように、数字だけを取り出して読む。
create or replace function public.perf_deadline_day()
returns int
language sql
stable
security definer
set search_path = public, pg_temp
as $func$
  select coalesce(
    nullif(
      regexp_replace(
        coalesce((select value from public.app_settings where key = 'performance_deadline_day'), ''),
        '[^0-9]', '', 'g'
      ),
      ''
    )::int,
    0
  );
$func$;

-- 対象月（y年m月分）について、本人が入力できる最後の日（日本時間の日付）
-- 締切を設けていないときは null を返す
create or replace function public.perf_deadline_date(y int, m int)
returns date
language sql
stable
security definer
set search_path = public, pg_temp
as $func$
  select case
    when dd.d between 1 and 28
      then (make_date(y, m, 1) + interval '1 month' + (dd.d - 1) * interval '1 day')::date
    else null
  end
  from (select public.perf_deadline_day() as d) as dd;
$func$;


-- ============================================================
-- ② 本人の入力を期限で止める（55番のトリガー関数に判定を足す）
-- ============================================================
-- 55番の内容（他人の行を触れない／修正記録を書き換えられない）はそのまま残し、
-- 期限の判定を最後に足した形です。この関数を入れ替えるだけで有効になります。
create or replace function public.guard_performance_self_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $func$
declare
  limit_date date;
begin
  -- ログインしていない呼び出し（service_role / サーバー処理）は素通し
  if auth.uid() is null then
    return new;
  end if;

  -- 管理者は何でも変更できる（期限も関係なし）
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
select '設定されている期限' as 確認項目,
       case when public.perf_deadline_day() = 0
            then '締切なし（本人はいつでも直せます）'
            else '翌月' || public.perf_deadline_day()::text || '日まで' end as 結果,
       '画面の「実績の確認」タブで変更できます' as 備考
union all
select '今日（日本時間）',
       to_char((timezone('Asia/Tokyo', now()))::date, 'YYYY年MM月DD日'),
       ''
union all
select '先月分の期限',
       coalesce(
         to_char(public.perf_deadline_date(
           extract(year from (timezone('Asia/Tokyo', now()) - interval '1 month'))::int,
           extract(month from (timezone('Asia/Tokyo', now()) - interval '1 month'))::int
         ), 'YYYY年MM月DD日'),
         '締切なし'),
       ''
union all
select 'ガードの有無',
       (select count(*)::text || '件' from pg_trigger
         where tgname = 'guard_performance_self_update' and not tgisinternal),
       '2件 であれば正常';


-- ============================================================
-- 締切をやめたいとき（この下だけを選んで実行）
-- ============================================================
-- insert into public.app_settings (key, value, updated_at)
-- values ('performance_deadline_day', '0', now())
-- on conflict (key) do update set value = '0', updated_at = now();
-- notify pgrst, 'reload schema';
