-- 51_self_approval_guard.sql
--
-- 【セキュリティ修正】自分で自分を承認できる・打刻を書き換えられる問題をふさぐ
--
-- 経緯：
--   RLS は「どの行を触れるか」は制限していたが、「その行のどの列を
--   どう変えてよいか」までは見ていなかった。
--   承認フローのある表のうち、corrections / leave_requests /
--   shift_requests / performance_reports には status を守るトリガーが
--   あるが、あとから追加された次の表には無かった。
--
--   ① 交通費精算（commute_expense_claims）
--      スタッフは未承認の自分の申請を更新できる。
--      status を 'approved' に書き換えれば、自分で自分の交通費を承認できた。
--      金額（total_amount）も同時に書き換えられた。
--
--   ② 月次勤怠の確定（monthly_attendance_confirmations）
--      同じく、自分の申請の status を 'confirmed' にできた。
--      さらに with check (true) のため、employee_id を他人に
--      書き換えることもできた。
--
--   ③ 勤怠の打刻（attendance_records）
--      「自分の行なら更新できる」だけだったため、出勤時刻・退勤時刻を
--      あとから自由に書き換えられた。遅刻を定刻に直す、残業を増やす、
--      休憩を0分にする、といったことが勤怠修正申請を通さずにできた。
--      出勤していない日の記録を新しく作ることもできた。
--
--   いずれも画面からはできないが、ブラウザの開発者ツールから
--   API を直接呼べば実行できる状態だった。
--
-- この修正：
--   管理者・マスター管理者と、サーバー側（service_role）は
--   これまでどおり何でも変更できる。制限されるのは本人だけ。
--
-- 画面の動きは変わりません：
--   出勤・退勤・休憩の打刻、交通費の下書き保存と提出、
--   月次勤怠の提出、管理者の承認・却下はすべてこれまでどおりです。
--
-- 実行方法：Supabase → SQL Editor に貼り付けて Run

-- ------------------------------------------------------------
-- 共通：呼び出した人が管理者かどうか
--   （is_admin() ではなく role を直接見る。トリガーの中で
--     RLS を迂回して確実に判定するため）
-- ------------------------------------------------------------
create or replace function public.caller_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $func$
  select exists (
    select 1 from public.employees e
     where e.id = auth.uid() and e.role in ('admin', 'master_admin')
  );
$func$;


-- ============================================================
-- ① 交通費精算：本人は status / decided_at / admin_comment を変えられない
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
  if new.status is distinct from old.status
     or new.decided_at is distinct from old.decided_at
     or new.admin_comment is distinct from old.admin_comment then
    raise exception '承認・却下は管理者のみ行えます' using errcode = '42501';
  end if;
  return new;
end;
$func$;

drop trigger if exists guard_commute_claim_decision on public.commute_expense_claims;
create trigger guard_commute_claim_decision
  before update on public.commute_expense_claims
  for each row execute function public.guard_commute_claim_decision();


-- ============================================================
-- ② 月次勤怠の確定：本人は status と承認の記録を変えられない
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

drop trigger if exists guard_monthly_confirm_decision on public.monthly_attendance_confirmations;
create trigger guard_monthly_confirm_decision
  before update on public.monthly_attendance_confirmations
  for each row execute function public.guard_monthly_confirm_decision();

-- あわせて、書き込み条件が true のままだと他人の行に書き換えられるため絞る
drop policy if exists "monthly confirm update" on public.monthly_attendance_confirmations;
create policy "monthly confirm update"
  on public.monthly_attendance_confirmations for update to authenticated
  using (
    (employee_id = auth.uid() and status <> 'confirmed')
    or exists (select 1 from public.employees e
                where e.id = auth.uid() and e.role in ('admin', 'master_admin'))
  )
  with check (
    employee_id = auth.uid()
    or exists (select 1 from public.employees e
                where e.id = auth.uid() and e.role in ('admin', 'master_admin'))
  );


-- ============================================================
-- ③ 勤怠の打刻：本人は一度押した時刻を書き換えられない
-- ============================================================
--   出勤を押す  … clock_in が空のときだけ入れられる
--   退勤を押す  … clock_out が空のときだけ入れられる
--   休憩        … これまでどおり自由（開始・終了を繰り返すため）
--   所定時刻と休憩の手入力（break_minutes_override）… 管理者のみ
--   打ち間違いの訂正 … これまでどおり勤怠修正申請から（管理者が承認して反映）
--
-- 列の有無に左右されないよう、jsonb に変換して名前で見ている。
-- （本番にだけある列、今後増える列があっても落ちない）
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
    'scheduled_start', 'scheduled_end', 'break_minutes_override'
  ];
  -- 打刻時に null → 'pending' を入れるのは本人。それ以外の変更は管理者のみ
  approval_cols text[] := array[
    'clock_in_approval', 'clock_out_approval'
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
      raise exception '所定の勤務時間と休憩の手入力は管理者のみ変更できます（%）', col
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

  return new;
end;
$func$;

drop trigger if exists guard_attendance_self_update on public.attendance_records;
create trigger guard_attendance_self_update
  before insert or update on public.attendance_records
  for each row execute function public.guard_attendance_self_update();


notify pgrst, 'reload schema';

-- ============================================================
-- 確認
-- ============================================================
select
  tgname as トリガー名,
  c.relname as テーブル
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
where not t.tgisinternal
  and tgname in (
    'guard_commute_claim_decision',
    'guard_monthly_confirm_decision',
    'guard_attendance_self_update',
    'guard_employee_self_update'
  )
order by c.relname;
