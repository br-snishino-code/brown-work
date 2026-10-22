// supabase/functions/record-login-attempt/index.ts
//
// ログインの失敗を記録する。
//
// デプロイ方法：
//   supabase functions deploy record-login-attempt
//   ※ --no-verify-jwt は付けないこと。
//     ログイン前に呼ぶ関数だが、アプリが持つ anon キーでゲートウェイは通る。
//     無関係な相手からの呼び出しを、その段階で減らすため。
//
// 【記録しないもの】
//   パスワードは一切受け取らないし、記録もしない。
//
// 【書き込みの上限】
//   同じ相手から大量に投げ込まれて表が膨らまないよう、
//   直近15分に同じIPから100件を超えていたら、それ以上は記録しない。

import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const WINDOW_MINUTES = 15;
const MAX_PER_WINDOW = 100;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

const clip = (v: unknown, max: number) => String(v ?? '').slice(0, max);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const username = clip(body?.username, 200);
    const reason = clip(body?.reason || 'ログイン失敗', 100);

    const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
    const userAgent = clip(req.headers.get('user-agent'), 300);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const since = new Date(Date.now() - WINDOW_MINUTES * 60_000).toISOString();

    const { count } = await admin
      .from('login_attempts')
      .select('id', { count: 'exact', head: true })
      .eq('client_ip', ip)
      .gte('occurred_at', since);

    if ((count ?? 0) >= MAX_PER_WINDOW) {
      // 記録はしないが、呼び出し元にはエラーを返さない
      // （ログイン画面の動きに影響させないため）
      return json({ ok: true, skipped: 'too_many' });
    }

    await admin.from('login_attempts').insert({
      username,
      client_ip: ip,
      user_agent: userAgent,
      reason,
    });

    return json({ ok: true });
  } catch (e) {
    console.error('ログイン失敗の記録に失敗しました', e);
    // 記録の失敗でログイン画面を止めない
    return json({ ok: false }, 200);
  }
});
