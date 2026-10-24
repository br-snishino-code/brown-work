-- 各段階で「古いアプリ」「新しいアプリ」が動くかを確かめる
\set ON_ERROR_STOP on
set role tester;
select public.be('admin_all');
do $$
declare ok boolean;
begin
  -- 古いアプリの読み方（employees を select *）
  begin
    perform * from public.employees limit 1;
    raise notice '  古いアプリ（employees を select *）… 動く';
  exception when others then
    raise notice '  古いアプリ（employees を select *）… ★止まる（%）', sqlerrm;
  end;
  -- 新しいアプリの読み方（ビューを select *）
  begin
    perform * from public.employees_visible limit 1;
    raise notice '  新しいアプリ（ビューを select *）… 動く';
  exception when others then
    raise notice '  新しいアプリ（ビューを select *）… ★止まる（%）', sqlerrm;
  end;
end $$;
reset role;
