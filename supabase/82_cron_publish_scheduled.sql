-- 82_cron_publish_scheduled.sql
--
-- 予約公開（81番）を動かすための定時実行の設定
--
-- Edge Function publish-scheduled を15分ごとに呼びます。
-- Supabase の画面（Cron）で設定できる場合はそちらでも構いません。
-- どちらか一方だけにしてください。両方入れると二重に呼ばれます。
--
-- ⚠ 実行する前に、下の【書き換える3か所】を必ず直してください。
--   そのまま流すと動きません。
--
-- ⚠ この設定には合言葉が入ります。データベースを見られる人には読めます。
--   （定時実行に鍵を持たせる以上、避けられません）
--   合言葉が漏れた場合は、Edge Function のシークレットを作り直し、
--   この設定も入れ直してください。


-- ========================================================
-- 0. 拡張機能を使えるようにする
-- ========================================================
-- pg_cron … 決まった時刻にSQLを動かす
-- pg_net  … SQLからHTTPで呼び出す
--
-- ここでエラーになる場合は、Supabaseの画面で拡張機能を有効にしてから
-- もう一度流してください（Database → Extensions のあたりにあります）。
create extension if not exists pg_cron;
create extension if not exists pg_net;


-- ========================================================
-- 1. 定時実行の登録
-- ========================================================
do $do$
declare
  -- 【書き換える3か所】-----------------------------------------
  -- ① プロジェクトのURL（末尾のスラッシュは付けない）
  v_url       text := 'https://ここにプロジェクト名.supabase.co';
  -- ② anon キー（公開鍵のほう。service_role は使わないこと）
  v_anon_key  text := 'ここにanonキー';
  -- ③ Edge Function に設定した合言葉
  v_api_key   text := 'ここに合言葉';
  -- -------------------------------------------------------------

  v_job_name  text := 'publish-scheduled';
  v_schedule  text := '*/15 * * * *';   -- 15分ごと
  v_command   text;
begin
  if v_url like '%ここに%' or v_anon_key like '%ここに%' or v_api_key like '%ここに%' then
    raise exception '書き換える3か所がそのままです。URL・anonキー・合言葉を入れてから実行してください。';
  end if;

  -- すでに同じ名前で登録されていれば、いったん外す（二重に呼ばれないように）
  perform cron.unschedule(v_job_name)
  where exists (select 1 from cron.job where jobname = v_job_name);

  v_command := format(
    $cmd$
    select net.http_post(
      url     := %L,
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', %L,
        'x-api-key',     %L
      ),
      body    := '{}'::jsonb
    );
    $cmd$,
    v_url || '/functions/v1/publish-scheduled',
    'Bearer ' || v_anon_key,
    v_api_key
  );

  perform cron.schedule(v_job_name, v_schedule, v_command);
  raise notice '登録しました：% （%）', v_job_name, v_schedule;
end
$do$;


-- ========================================================
-- 2. 確認
-- ========================================================
-- ① 登録できているか（1行出れば成功）
select jobname as "名前", schedule as "実行間隔", active as "動いているか"
from cron.job
where jobname = 'publish-scheduled';

-- ② 直近の実行の結果（15分ほど待ってから見てください）
--    status が 'succeeded' なら呼び出しは成功しています。
select start_time as "開始", status as "結果", return_message as "メッセージ"
from cron.job_run_details
where jobid in (select jobid from cron.job where jobname = 'publish-scheduled')
order by start_time desc
limit 5;

-- ③ Edge Function が何を返したか（pg_net の記録。少し遅れて入ります）
--    200 … 正常。中身に「公開する予約はありません」などが入ります
--    401 … 合言葉かJWTの問題
--    500 … シークレットが未設定
select created as "時刻", status_code as "状態", content as "返事"
from net._http_response
order by created desc
limit 5;


-- ========================================================
-- 3. やめたいとき
-- ========================================================
-- select cron.unschedule('publish-scheduled');
