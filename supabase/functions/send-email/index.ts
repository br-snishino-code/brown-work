// supabase/functions/send-email/index.ts
//
// アプリからのメール送信をまとめて受け持つEdge Function。
// 会社のメール（Google Workspace）からSMTPで送信する。
//
// デプロイ方法：
//   supabase functions deploy send-email
//
// 必要なシークレット（Supabase側で設定）：
//   supabase secrets set SMTP_HOST=smtp.gmail.com
//   supabase secrets set SMTP_PORT=465
//   supabase secrets set SMTP_USER=送信元のメールアドレス
//   supabase secrets set SMTP_PASS=Googleで発行したアプリパスワード（16桁）
//   supabase secrets set SMTP_FROM_NAME=Brown Work
//
// ※ SMTP_PASS は通常のログインパスワードではなく「アプリパスワード」を使う。
//    Googleアカウント → セキュリティ → 2段階認証 → アプリパスワード から発行する。

import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts';

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

  const host = Deno.env.get('SMTP_HOST');
  const port = Number(Deno.env.get('SMTP_PORT') || '465');
  const user = Deno.env.get('SMTP_USER');
  const pass = Deno.env.get('SMTP_PASS');
  const fromName = Deno.env.get('SMTP_FROM_NAME') || 'Brown Work';

  // 未設定でもアプリ側の処理は止めない（通知はアプリ内に残る）
  if (!host || !user || !pass) {
    return json({ skipped: true, reason: 'SMTP settings are not configured' }, 200);
  }

  try {
    const { to, subject, text, html } = await req.json();
    if (!to || !subject) {
      return json({ error: 'to と subject は必須です' }, 400);
    }

    const client = new SMTPClient({
      connection: {
        hostname: host,
        port,
        tls: port === 465,
        auth: { username: user, password: pass },
      },
    });

    await client.send({
      from: `${fromName} <${user}>`,
      to,
      subject,
      content: text || '',
      html: html || undefined,
    });
    await client.close();

    return json({ ok: true });
  } catch (e) {
    console.error('メール送信に失敗しました', e);
    return json({ error: String(e?.message || e) }, 500);
  }
});
