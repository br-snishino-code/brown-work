// supabase/functions/update-employee-email/index.ts
//
// マスター管理者だけが呼び出せる「ログインID（メールアドレス）の変更」用Edge Function。
// 認証システム側のアドレスと、スタッフ情報側のログインIDの両方を書き換える。
//
// デプロイ方法：
//   supabase functions deploy update-employee-email

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
    if (caller?.role !== 'master_admin') {
      return json({ error: 'ログインIDを変更できるのはマスター管理者のみです' }, 403);
    }

    const { employeeId, newEmail, updateContactEmail } = (await req.json()) || {};
    if (!employeeId || !newEmail) {
      return json({ error: 'employeeId と newEmail は必須です' }, 400);
    }
    const email = String(newEmail).trim();
    if (!email.includes('@')) {
      return json({ error: 'メールアドレスの形式でご入力ください' }, 400);
    }

    // 同じアドレスが既に使われていないか確認する
    const { data: duplicated } = await adminClient
      .from('employees')
      .select('id')
      .eq('username', email)
      .neq('id', employeeId)
      .maybeSingle();
    if (duplicated) {
      return json({ error: 'そのメールアドレスは既に使用されています' }, 400);
    }

    // 認証システム側のアドレスを変更する
    const { error: authError } = await adminClient.auth.admin.updateUserById(employeeId, {
      email,
      email_confirm: true,
    });
    if (authError) {
      const msg = authError.message?.includes('already')
        ? 'そのメールアドレスは既に使用されています'
        : authError.message || 'ログインIDの変更に失敗しました';
      return json({ error: msg }, 400);
    }

    // スタッフ情報側のログインIDを変更する
    const patch: Record<string, unknown> = { username: email };
    if (updateContactEmail) patch.contact_email = email;
    const { error: updateError } = await adminClient
      .from('employees')
      .update(patch)
      .eq('id', employeeId);
    if (updateError) {
      return json({ error: `スタッフ情報の更新に失敗しました: ${updateError.message}` }, 400);
    }

    return json({ ok: true });
  } catch (e) {
    console.error('ログインIDの変更に失敗しました', e);
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
