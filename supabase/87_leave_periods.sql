-- 87_leave_periods.sql
--
-- 産前産後休業・育児休業を記録できるようにする
--
-- なぜ要るか：
--   Brown Work には、これまで休業を記録する場所がありませんでした。
--   休暇申請は「有休・振休・代休・特別休暇」の4つで、どれも日単位です。
--   数か月にわたる休業はそのままでは入れられません。
--
--   年金事務所に出す「産前産後休業取得者申出書」と
--   「育児休業等取得者申出書」を作るには、この記録が要ります。
--
-- この表でできること（第1段階）：
--   ・休業の登録・修正
--   ・そこから2つの届出のCSVを作る
--
-- この表でまだやらないこと（第2段階・別途）：
--   ・勤怠への反映（休業期間を欠勤に数えない）
--   ・給与への反映（社会保険料の免除）
--   どちらも給与計算に関わるため、テスト運用が落ち着いてから入れます。
--
-- 誰が見られるか：
--   出産予定日・出産日・子の氏名が入るため、住所や家族構成と同じ扱いにします。
--   読む  … ご本人とマスター管理者
--   書く  … マスター管理者のみ
--   管理者（admin）には見せません。
--
-- 実行方法：Supabase → SQL Editor に貼り付けて Run
-- 何度流しても同じ結果になります。


-- ========================================================
-- 1. 休業の記録
-- ========================================================
create table if not exists public.employee_leave_periods (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,

  -- 'maternity' … 産前産後休業
  -- 'childcare' … 育児休業等
  kind text not null check (kind in ('maternity', 'childcare')),

  -- 休業の開始日と終了予定日。
  -- actual_end_date は、予定より早く終わったときだけ入れます
  -- （届出の「終了欄」に当たります）。
  start_date date not null,
  planned_end_date date not null,
  actual_end_date date,

  -- ---- 産前産後休業で使う ----
  -- 出産予定日。出産後に申し出る場合は出産日も入れます。
  due_date date,
  birth_date date,
  -- 多胎（双子以上）かどうか。産前の休業期間が変わります
  multiple_birth boolean not null default false,

  -- ---- 育児休業等で使う ----
  child_name text,              -- 養育する子の氏名（漢字）
  child_furigana text,          -- 同（ふりがな）
  child_birth_date date,        -- 子の生年月日
  -- '実子' か 'その他'（養子など）。その他のときは care_start_date が要ります
  child_relation text check (child_relation is null or child_relation in ('実子', 'その他')),
  care_start_date date,         -- 養育開始年月日（実子以外）
  -- 開始日と終了予定日の翌日が同じ月に入るときだけ使います（届出の決まり）
  leave_days integer check (leave_days is null or (leave_days between 0 and 99)),
  work_days integer check (work_days is null or (work_days between 0 and 99)),
  papa_mama_plus boolean not null default false,

  note text,

  created_at timestamptz not null default now(),
  created_by uuid references public.employees(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.employees(id),

  -- 終了予定日は開始日以降
  constraint leave_periods_order check (planned_end_date >= start_date),
  constraint leave_periods_actual_order
    check (actual_end_date is null or actual_end_date >= start_date)
);

comment on table public.employee_leave_periods is
  '産前産後休業・育児休業の記録。年金事務所への申出書を作るのに使う';
comment on column public.employee_leave_periods.actual_end_date is
  '予定より早く終わったときだけ入れる。届出の「終了欄」に当たる';
comment on column public.employee_leave_periods.leave_days is
  '育児休業等取得日数。開始日と終了予定日の翌日が同一月内のときだけ設定する（14〜30）';
comment on column public.employee_leave_periods.work_days is
  '就業予定日数。同上のときだけ設定する（0〜16）';


-- ========================================================
-- 2. 誰が見られるか
--    住所や家族構成と同じ扱い。管理者（admin）には見せません。
-- ========================================================
alter table public.employee_leave_periods enable row level security;

-- 読む：ご本人とマスター管理者
drop policy if exists "employee_leave_periods_select" on public.employee_leave_periods;
create policy "employee_leave_periods_select"
  on public.employee_leave_periods for select to authenticated
  using (employee_id = auth.uid() or public.is_master_admin());

-- 足す・直す・消す：マスター管理者のみ
drop policy if exists "employee_leave_periods_insert" on public.employee_leave_periods;
create policy "employee_leave_periods_insert"
  on public.employee_leave_periods for insert to authenticated
  with check (public.is_master_admin());

drop policy if exists "employee_leave_periods_update" on public.employee_leave_periods;
create policy "employee_leave_periods_update"
  on public.employee_leave_periods for update to authenticated
  using (public.is_master_admin())
  with check (public.is_master_admin());

drop policy if exists "employee_leave_periods_delete" on public.employee_leave_periods;
create policy "employee_leave_periods_delete"
  on public.employee_leave_periods for delete to authenticated
  using (public.is_master_admin());

-- ログインしていない人には表の権限そのものを渡しません
revoke all on public.employee_leave_periods from anon;
grant select, insert, update, delete on public.employee_leave_periods to authenticated;

create index if not exists employee_leave_periods_employee_idx
  on public.employee_leave_periods (employee_id, start_date desc);


-- ========================================================
-- 3. updated_at を自動で更新する
-- ========================================================
create or replace function public.touch_leave_period()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $func$
begin
  new.updated_at := now();
  return new;
end;
$func$;

drop trigger if exists touch_leave_period on public.employee_leave_periods;
create trigger touch_leave_period
  before update on public.employee_leave_periods
  for each row
  execute function public.touch_leave_period();

notify pgrst, 'reload schema';


-- ========================================================
-- 確認（このSQLを実行したあとで試せます）
-- ========================================================
-- ① 表ができているか
--   select column_name, data_type
--     from information_schema.columns
--    where table_schema = 'public' and table_name = 'employee_leave_periods'
--    order by ordinal_position;
--   → 22行返れば作れています。
--
-- ② 権限が付いているか
--   select policyname, cmd from pg_policies
--    where schemaname = 'public' and tablename = 'employee_leave_periods'
--    order by policyname;
--   → select / insert / update / delete の4つが返ります。
--
-- ③ 管理者（master_admin ではない admin）から見えないか
--   管理者のアカウントでログインした状態で、ブラウザのコンソールから
--     await supabase.from('employee_leave_periods').select('*')
--   を実行すると、data が空の配列で返ります（ご自身の分だけが見えます）。
