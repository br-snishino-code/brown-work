-- 93_late_deduction_exempt.sql
--
-- 遅刻早退控除を、打刻の区分で引かないようにします。
-- あわせて、本人が自分の区分を書き換えられないようにします。
--
-- 【なぜ要るか】
--   御社の決まり（2026年11月4日に確認）
--     出勤：イベント（会議・研修など）… 遅刻早退控除を引かない
--     出勤：遅刻                      … 引く
--     退勤：イベント・研修            … 引かない
--     退勤：自己都合／その他          … 引く
--     区分の記録がない日              … 引く
--   そのうえで、承認のときに1件ずつ上書きできるようにします。
--
--   いまある clock_in_pay_deduction（画面の「減給あり」）は使いません。
--   このチェックは既定が「オフ」のまま承認されてきたため、
--   これを「控除しない」の意味に変えると、
--   過去に承認した遅刻がすべて控除なしに変わってしまいます。
--   過去の月を作り直したときに金額が変わるのを避けるため、列を分けます。
--
-- 【このSQLでやること】
--   ① attendance_records に上書き用の2列を足す
--        clock_in_late_deduction  … 出勤側（true=引く／false=引かない／null=区分のとおり）
--        clock_out_late_deduction … 退勤側（同じ）
--      既定は null なので、いまあるデータの扱いは変わりません。
--
--   ② 本人では変えられない列を増やす（guard_attendance_self_update）
--      ・clock_in_status / clock_out_status
--          打刻のときに null → 値 を入れるのは本人。
--          一度入った区分を本人が書き換えることはできません。
--          （これまでは書き換えられました。表示だけだったので影響は
--            ありませんでしたが、金額に効くようになるため閉じます）
--      ・clock_in_late_deduction / clock_out_late_deduction … 管理者のみ
--      ・clock_in_pay_deduction / clock_out_pay_deduction とそのメモ … 管理者のみ
--          （もともと管理者しか書いていませんが、決まりとして明記します）
--
-- 実行方法：Supabase → SQL Editor に貼り付けて Run
-- 何度流しても同じ結果になります。
--
-- ⚠ 先に流しても古いアプリは壊れません（列が増え、本人の書き換えが止まるだけです）。
--   アプリを更新する前に流していただくほうが安全です。

begin;

-- ============================================================
-- ① 上書き用の列
-- ============================================================
alter table public.attendance_records
  add column if not exists clock_in_late_deduction boolean;

alter table public.attendance_records
  add column if not exists clock_out_late_deduction boolean;

comment on column public.attendance_records.clock_in_late_deduction is
  '出勤側の遅刻早退控除の上書き。true=引く／false=引かない／null=打刻の区分のとおり';
comment on column public.attendance_records.clock_out_late_deduction is
  '退勤側の遅刻早退控除の上書き。true=引く／false=引かない／null=打刻の区分のとおり';


-- ============================================================
-- ② 本人では変えられない列を増やす
-- ============================================================
-- 51番の関数を作り直します。中身は51番と同じで、
-- status_cols の追加と admin_only_cols の追加だけが違います。
--
-- 列の有無に左右されないよう、jsonb に変換して名前で見ています。
-- （本番にだけある列、今後増える列があっても落ちません）
create or replace function public.guard_attendance_self_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $func$
declare
  today_jst date := (now() at time zone 'Asia/Tokyo')::date;
  old_row jsonb;
  new_row jsonb;
  col     text;

  -- 一度入ったら本人では変えられない（打ち間違いは勤怠修正申請から）
  set_once_cols text[] := array[
    'clock_in', 'clock_out', 'clock_in_actual', 'clock_out_actual'
  ];
  -- 本人では一切変えられない
  admin_only_cols text[] := array[
    'scheduled_start', 'scheduled_end', 'break_minutes_override',
    -- 遅刻早退控除の上書き（93番で追加）
    'clock_in_late_deduction', 'clock_out_late_deduction',
    -- 減給の記録（もともと管理者だけが書いています）
    'clock_in_pay_deduction', 'clock_out_pay_deduction',
    'clock_in_pay_deduction_note', 'clock_out_pay_deduction_note',
    -- 出勤・退勤に分かれる前の古い列。いまのアプリは読み書きしていませんが、
    -- 残っているので同じく管理者のみにします
    'pay_deduction', 'pay_deduction_note'
  ];
  -- 打刻時に null → 'pending' を入れるのは本人。それ以外の変更は管理者のみ
  approval_cols text[] := array[
    'clock_in_approval', 'clock_out_approval'
  ];
  -- 打刻時に null → 値 を入れるのは本人。入ったあとの書き換えは管理者のみ（93番で追加）
  status_cols text[] := array[
    'clock_in_status', 'clock_out_status'
  ];
begin
  if auth.uid() is null or public.caller_is_admin() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- 出勤していない日の記録をあとから作れないようにする。
    -- 日付をまたぐ勤務や時差を考えて、前後に少し余裕を持たせている。
    if new.date < today_jst - 2 or new.date > today_jst + 1 then
      raise exception '過去・未来の日付の勤怠はご自身では作成できません。勤怠修正申請をご利用ください'
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- ここから UPDATE
  if new.employee_id is distinct from old.employee_id
     or new.date is distinct from old.date then
    raise exception '勤怠の対象者と日付は変更できません' using errcode = '42501';
  end if;

  old_row := to_jsonb(old);
  new_row := to_jsonb(new);

  foreach col in array set_once_cols loop
    if (old_row ? col)
       and (old_row -> col) is distinct from 'null'::jsonb
       and (new_row -> col) is distinct from (old_row -> col) then
      raise exception '記録済みの打刻時刻はご自身では変更できません。勤怠修正申請をご利用ください（%）', col
        using errcode = '42501';
    end if;
  end loop;

  foreach col in array admin_only_cols loop
    if (old_row ? col) and (new_row -> col) is distinct from (old_row -> col) then
      raise exception 'この項目は管理者のみ変更できます（%）', col
        using errcode = '42501';
    end if;
  end loop;

  foreach col in array approval_cols loop
    if (old_row ? col) and (new_row -> col) is distinct from (old_row -> col) then
      -- 打刻のときに「承認待ち」を立てるのだけは本人に許す
      if not ((old_row -> col) in ('null'::jsonb) and (new_row ->> col) = 'pending') then
        raise exception '承認の状態は管理者のみ変更できます（%）', col
          using errcode = '42501';
      end if;
    end if;
  end loop;

  foreach col in array status_cols loop
    if (old_row ? col)
       and (old_row -> col) is distinct from 'null'::jsonb
       and (new_row -> col) is distinct from (old_row -> col) then
      raise exception '記録済みの打刻の区分はご自身では変更できません。勤怠修正申請をご利用ください（%）', col
        using errcode = '42501';
    end if;
  end loop;

  return new;
end;
$func$;

drop trigger if exists guard_attendance_self_update on public.attendance_records;
create trigger guard_attendance_self_update
  before insert or update on public.attendance_records
  for each row execute function public.guard_attendance_self_update();

notify pgrst, 'reload schema';

commit;


-- ============================================================
-- 確認
-- ============================================================
-- ① 列が足されたか（2行返れば足されています）
--   select column_name as 列, data_type as 型, is_nullable as 空を許すか
--     from information_schema.columns
--    where table_schema = 'public'
--      and table_name = 'attendance_records'
--      and column_name in ('clock_in_late_deduction', 'clock_out_late_deduction');
--
-- ② 上書きが入っている日（はじめは0行です）
--   select employee_id, date,
--          clock_in_status  as 出勤の区分, clock_in_late_deduction  as 出勤の上書き,
--          clock_out_status as 退勤の区分, clock_out_late_deduction as 退勤の上書き
--     from public.attendance_records
--    where clock_in_late_deduction is not null
--       or clock_out_late_deduction is not null
--    order by date desc
--    limit 50;
--
-- ③ トリガーが付いているか
--   select tgname as トリガー名
--     from pg_trigger t join pg_class c on c.oid = t.tgrelid
--    where not t.tgisinternal
--      and c.relname = 'attendance_records';
