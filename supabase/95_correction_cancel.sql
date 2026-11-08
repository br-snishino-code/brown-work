-- 95_correction_cancel.sql
--
-- 【機能の追加】勤怠修正申請を、出した本人が取り消せるようにする
--
-- 経緯：
--   誤った内容で勤怠修正申請を出してしまったとき、本人には取り消す手立てが
--   ありませんでした。管理者に却下してもらうしかなく、却下の記録が残ります。
--   「誤って出した申請は本人が取り消せるようにしたい」とのご要望です。
--
-- いまの作り：
--   corrections.status は 'pending' / 'approved' / 'rejected' の3つだけで、
--   さらに guard_corrections トリガー（guard_decision_fields）が
--   「管理者以外は status と decided_at を変えられない」としています。
--   これは本人が自分の申請を承認済みにするのを防ぐための大事なガードです。
--
-- この修正：
--   ① status に 'cancelled'（本人が取り消した）を足します。
--   ② corrections 専用のガードに差し替え、
--      「本人が 承認待ち → 取り消し済み にする」ときだけ通します。
--      それ以外は今までどおり管理者だけです。
--   ③ 処理済み（承認済み・却下・取り消し済み）の申請の中身は、
--      本人が書き換えられないようにします。取り消したあとに中身だけ
--      差し替えられると、記録として意味がなくなるためです。
--      直すときは新しく申請してください。
--
--   本人が自分の申請を承認済み・却下にすることは、これまでどおりできません。
--
-- 影響：
--   ・勤怠修正申請の画面に「この申請を取り消す」が出ます（本人のみ）。
--   ・取り消した申請は、管理者の「承認待ちの修正申請」から外れ、
--     「処理済みの申請」に「取り消し済み」として並びます。
--   ・取り消すと、その日の退勤打刻漏れの扱いは申請前に戻ります
--     （未退勤の日は、出勤できなくなる扱いに戻ります）。
--   ・取り消したあと、同じ日に新しく申請できます
--     （66番の重複ガードは承認待ちの申請だけを見ているため）。
--   ・ほかの申請（休暇・交通費・月次勤怠・年末調整・シフト希望）の
--     ガードには触っていません。
--
-- 流す順番：
--   アプリを先、SQLを後でも構いません。
--   SQLを流すまでのあいだ「取り消す」を押すと
--     取り消しの設定がまだ本番に入っていません（95番SQLが未適用です）
--   と出て、申請はそのまま残ります。壊れません。
--
-- 実行方法：Supabase → SQL Editor に貼り付けて Run
-- 何度流しても同じ結果になります。
--
-- 元に戻したいとき：
--   begin;
--   update public.corrections set status = 'rejected' where status = 'cancelled';
--   alter table public.corrections drop constraint if exists corrections_status_check;
--   alter table public.corrections add constraint corrections_status_check
--     check (status in ('pending', 'approved', 'rejected'));
--   drop trigger if exists guard_corrections on public.corrections;
--   create trigger guard_corrections before update on public.corrections
--     for each row execute function public.guard_decision_fields();
--   commit;

begin;

do $do$
begin
  if to_regclass('public.corrections') is null then
    raise exception '勤怠修正申請の表（corrections）がありません。先に 01_schema.sql を適用してください';
  end if;
  if to_regproc('public.is_admin') is null then
    raise exception 'is_admin() がありません。先に 01_schema.sql を適用してください';
  end if;
end $do$;


-- ============================================================
-- ① status に 'cancelled' を足す
-- ============================================================
-- 制約の名前は Postgres が付ける既定の名前（表名_列名_check）です。
-- 名前が違う本番でも拾えるよう、corrections の status に付いている
-- 検査制約をすべて外してから付け直します。
do $do$
declare
  c record;
begin
  for c in
    select con.conname
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace nsp on nsp.oid = rel.relnamespace
     where nsp.nspname = 'public'
       and rel.relname = 'corrections'
       and con.contype = 'c'
       and pg_get_constraintdef(con.oid) like '%status%'
  loop
    execute format('alter table public.corrections drop constraint %I', c.conname);
    raise notice '古い検査制約を外しました: %', c.conname;
  end loop;

  execute $sql$
    alter table public.corrections
      add constraint corrections_status_check
      check (status in ('pending', 'approved', 'rejected', 'cancelled'))
  $sql$;
  raise notice 'status に cancelled を足しました';
end $do$;


-- ============================================================
-- ② corrections 専用のガードに差し替える
-- ============================================================
-- もとは共通の guard_decision_fields() を使っていました。
-- 共通の関数を書き換えると休暇申請などにも影響するため、
-- corrections だけ専用の関数にします。
create or replace function public.guard_correction_decision()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $func$
begin
  if public.is_admin() then
    return new;
  end if;

  -- 本人が status を変えられるのは「承認待ち → 取り消し済み」のときだけ
  if new.status is distinct from old.status then
    if not (old.status = 'pending'
            and new.status = 'cancelled'
            and old.employee_id = auth.uid()) then
      raise exception '承認・却下は管理者のみ行えます';
    end if;
  end if;

  -- decided_at は、取り消しのときだけ本人が入れられる（取り消した時刻を残すため）
  if new.decided_at is distinct from old.decided_at then
    if not (new.status = 'cancelled'
            and old.employee_id = auth.uid()) then
      raise exception '承認・却下は管理者のみ行えます';
    end if;
  end if;

  -- 処理済みの申請の中身は、本人は書き換えられない
  if old.status <> 'pending' then
    if new.requested is distinct from old.requested
       or new.reason is distinct from old.reason
       or new.date is distinct from old.date
       or new.original is distinct from old.original
       or new.employee_id is distinct from old.employee_id then
      raise exception '処理済みの申請は書き換えられません。新しく申請してください';
    end if;
  end if;

  return new;
end;
$func$;

drop trigger if exists guard_corrections on public.corrections;
create trigger guard_corrections before update on public.corrections
  for each row execute function public.guard_correction_decision();

commit;

notify pgrst, 'reload schema';


-- ------------------------------------------------------------
-- 確認（SQL Editor でそれぞれ実行してください）
-- ------------------------------------------------------------
-- ① cancelled が使えるようになったか。1 が返れば成功
--   select count(*) as 取り消しを許す制約
--     from pg_constraint con
--     join pg_class rel on rel.oid = con.conrelid
--     join pg_namespace nsp on nsp.oid = rel.relnamespace
--    where nsp.nspname = 'public'
--      and rel.relname = 'corrections'
--      and con.contype = 'c'
--      and pg_get_constraintdef(con.oid) like '%cancelled%';
--
-- ② ガードが差し替わったか。guard_correction_decision が返れば成功
--   select p.proname as 使っている関数
--     from pg_trigger t
--     join pg_proc p on p.oid = t.tgfoid
--    where t.tgrelid = to_regclass('public.corrections')
--      and t.tgname = 'guard_corrections';
--
-- ③ ほかの申請のガードが変わっていないか。
--    すべて guard_decision_fields になっていれば、巻き添えはありません
--   select c.relname as 表, p.proname as 使っている関数
--     from pg_trigger t
--     join pg_class c on c.oid = t.tgrelid
--     join pg_proc p on p.oid = t.tgfoid
--    where not t.tgisinternal
--      and t.tgname in ('guard_leave_requests', 'guard_shift_requests', 'guard_performance_reports')
--    order by c.relname;
--
-- ④ いまの申請の状態の内訳（取り消し済みが出るのは、スタッフが使ってから）
--   select status as 状態, count(*) as 件数
--     from public.corrections
--    group by status
--    order by status;
