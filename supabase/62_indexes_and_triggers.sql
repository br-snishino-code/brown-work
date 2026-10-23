-- 62_indexes_and_triggers.sql
--
-- 60番で作る17テーブルの「索引」と「トリガー」のうち、
-- これまでリポジトリに定義が無かったぶん
--
-- 経緯：
--   60番（表の形）と 61番（アクセス制限）で、列・制約・RLSは本番と一致しました。
--   残っていた索引とトリガーを 59e / 59f で本番から書き出して照合したところ、
--   トリガー6本のうち4本と、関数4つは既存のSQLファイルと一致していました。
--   一致していなかった下の3つを、このファイルで補います。
--
--     ① resignation_reasons の一意索引
--        … 退職理由の名前が重複しないようにする索引。
--          本番では「制約」ではなく「索引」として作られていたため、
--          60番の create table からは外し、ここで索引として作ります。
--
--     ② profile_update_requests の guard_profile_update_requests
--        … 登録情報の変更申請で、本人が承認結果（status / decided_at）を
--          書き換えられないようにするトリガー。
--          呼ぶ関数 guard_decision_fields() は 01_schema.sql にありますが、
--          トリガー文だけが抜けていました。
--          他の4表（corrections / leave_requests / shift_requests /
--          performance_reports）は 01_schema.sql に書かれています。
--
--     ③ employee_attendance_schedules の set_updated_at
--        … 出勤規定日数を直したときに updated_at を自動で入れるトリガー。
--          トリガー文も、呼ぶ関数も、どちらもありませんでした。
--          関数の中身は 59f で本番から書き出したものをそのまま入れています。
--
-- 出どころ：
--   索引・トリガーの定義 … 59e_export_indexes_and_triggers.sql の結果
--   関数の中身           … 59f_export_trigger_functions.sql の結果
--   （いずれも2026年10月23日時点の本番）
--
-- 使う順番：
--   60_schema_missing_tables.sql → 61_rls_policies_missing_tables.sql → このファイル
--   01_schema.sql（guard_decision_fields が必要）も先に流しておいてください。
--
-- 何度流しても同じ結果になります。
-- すでに本番にあるものは、作り直しても中身が変わりません。


-- ========================================================
-- ① resignation_reasons … 退職理由の名前の重複を防ぐ
-- ========================================================
create unique index if not exists resignation_reasons_label_key
  on public.resignation_reasons using btree (label);


-- ========================================================
-- ② profile_update_requests … 本人が承認結果を書き換えられないようにする
-- ========================================================
drop trigger if exists guard_profile_update_requests on public.profile_update_requests;
create trigger guard_profile_update_requests
  before update on public.profile_update_requests
  for each row execute function public.guard_decision_fields();


-- ========================================================
-- ③ employee_attendance_schedules … 更新日時を自動で入れる
-- ========================================================
-- ※ 本番の定義をそのまま再現しています。
--   本番のこの関数には security definer も set search_path も付いていません。
--   中で呼んでいるのは now() だけなので、現状で情報が漏れる経路は見つかって
--   いませんが、他の guard 関数とは書き方が揃っていません。
--   揃える場合は本番側も合わせて直す必要があるため、ここでは変更していません。
create or replace function public.set_employee_attendance_schedules_updated_at()
returns trigger
language plpgsql
as $func$
begin
  new.updated_at = now();
  return new;
end;
$func$;

drop trigger if exists set_updated_at on public.employee_attendance_schedules;
create trigger set_updated_at
  before update on public.employee_attendance_schedules
  for each row execute function public.set_employee_attendance_schedules_updated_at();


notify pgrst, 'reload schema';


-- ========================================================
-- 確認
-- ========================================================
select '索引（主キー・一意制約を除く）' as 確認項目,
       count(*)::text || '／1' as 結果,
       '1／1 であれば正常' as 期待値
from pg_index i
join pg_class idx on idx.oid = i.indexrelid
join pg_class cls on cls.oid = i.indrelid
join pg_namespace nsp on nsp.oid = cls.relnamespace
where nsp.nspname = 'public'
  and cls.relname in (
    'announcements', 'audit_logs', 'commute_expense_claims', 'employee_attendance_schedules',
    'employee_commute_routes', 'employee_salary_items', 'employee_schedule_patterns',
    'employee_standard_remuneration', 'group_attendance_schedules', 'group_incentive_flags',
    'insurance_rate_settings', 'payroll_records', 'profile_update_requests', 'resignation_reasons',
    'staff_existing_performance', 'staff_new_performance', 'year_end_adjustments'
  )
  and not exists (
    select 1 from pg_constraint c
    where c.conindid = i.indexrelid and c.contype in ('p', 'u')
  )

union all

select 'このファイルで作るトリガー',
       count(*)::text || '／2',
       '2／2 であれば正常'
from pg_trigger tg
join pg_class cls on cls.oid = tg.tgrelid
join pg_namespace nsp on nsp.oid = cls.relnamespace
where nsp.nspname = 'public'
  and not tg.tgisinternal
  and (cls.relname, tg.tgname) in (
    ('profile_update_requests', 'guard_profile_update_requests'),
    ('employee_attendance_schedules', 'set_updated_at')
  )

union all

-- 残り4本は 51 / 52 / 55 が作るもの。
-- 本番で流したときは 6／6 になります。
-- 空のDBで 60→61→62 だけを流した場合は 2／6 で正常です。
select '17テーブルのトリガー合計',
       count(*)::text || '／6',
       '本番では 6／6（51・52・55 の分を含む）'
from pg_trigger tg
join pg_class cls on cls.oid = tg.tgrelid
join pg_namespace nsp on nsp.oid = cls.relnamespace
where nsp.nspname = 'public'
  and not tg.tgisinternal
  and cls.relname in (
    'announcements', 'audit_logs', 'commute_expense_claims', 'employee_attendance_schedules',
    'employee_commute_routes', 'employee_salary_items', 'employee_schedule_patterns',
    'employee_standard_remuneration', 'group_attendance_schedules', 'group_incentive_flags',
    'insurance_rate_settings', 'payroll_records', 'profile_update_requests', 'resignation_reasons',
    'staff_existing_performance', 'staff_new_performance', 'year_end_adjustments'
  );
