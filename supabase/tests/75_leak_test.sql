-- SECURITY DEFINER ビューから情報が漏れないかを確かめる。
-- 細工した述語（leaky な関数）をビューに当てると、ビュー自身の絞り込みより
-- 先に評価され、本来見えない行の値が覗けることがある（古典的な抜け道）。
\set ON_ERROR_STOP on

create or replace function public.leak(label text, v text) returns boolean
language plpgsql cost 0.0000001 as $$
begin
  raise notice '  [のぞき見] % = %', label, coalesce(v, 'null');
  return true;
end $$;
grant execute on function public.leak(text,text) to tester;

set role tester;
select public.be('staff');   -- 本人のみ見えるはずの立場

\echo '--- スタッフが、細工した述語で他人の行を覗けるか ---'
select count(*) from public.employees_visible where public.leak('氏名', name);

\echo '--- スタッフが、細工した述語で他人の住所を覗けるか ---'
select count(*) from public.employees_visible where public.leak('住所', address);

reset role;
