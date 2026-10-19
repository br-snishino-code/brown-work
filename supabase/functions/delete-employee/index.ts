// supabase/functions/delete-employee/index.ts
//
// 管理者だけが呼び出せる「スタッフアカウント削除」用Edge Function。
// 認証ユーザーを削除すると、employees 行および関連データは
// 外部キーの on delete cascade により自動で削除される。
//
// デプロイ方法：
//   supabase functions deploy delete-employee

import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: '認証情報がありません' }, 401);

    // 呼び出し元が管理者かどうかを、本人のトークンで確認する
    const callerClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await callerClient.auth.getUser();
    if (userError || !userData?.user) return json({ error: '認証に失敗しました' }, 401);

    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: caller } = await adminClient
      .from('employees')
      .select('role')
      .eq('id', userData.user.id)
      .single();
    if (!caller || (caller.role !== 'admin' && caller.role !== 'master_admin')) {
      return json({ error: '管理者のみアカウントを削除できます' }, 403);
    }

    const { employeeId } = (await req.json()) || {};
    if (!employeeId) return json({ error: 'employeeId は必須です' }, 400);

    // 自分自身は削除できない
    if (employeeId === userData.user.id) {
      return json({ error: 'ご自身のアカウントは削除できません' }, 400);
    }

    // マスター管理者は、マスター管理者のみが削除できる
    const { data: target } = await adminClient
      .from('employees')
      .select('role, name')
      .eq('id', employeeId)
      .single();
    if (target?.role === 'master_admin' && caller.role !== 'master_admin') {
      return json({ error: 'マスター管理者を削除できるのはマスター管理者のみです' }, 403);
    }

    const { error: deleteError } = await adminClient.auth.admin.deleteUser(employeeId);
    if (deleteError) {
      return json({ error: deleteError.message || '削除に失敗しました' }, 400);
    }

    // 念のため、残っている場合は employees 行も消す
    await adminClient.from('employees').delete().eq('id', employeeId);

    return json({ ok: true });
  } catch (e) {
    console.error('削除に失敗しました', e);
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
