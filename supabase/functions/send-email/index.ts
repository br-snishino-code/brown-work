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
//   supabase secrets set SMTP_PASS=Googleで発行したアプリパスワード（16桁・スペースなし）
//   supabase secrets set SMTP_FROM_NAME="Brown Work"
//
// ※ 日本語の件名・本文を正しく扱うため nodemailer を使用している。

import nodemailer from 'npm:nodemailer@6.9.14';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

// 改行をそのまま活かした簡易HTMLを作る（テキスト版と併せて送る）
const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const textToHtml = (text: string) =>
  `<div style="font-family:'Hiragino Sans','Yu Gothic',Meiryo,sans-serif;font-size:14px;line-height:1.8;color:#1e293b;white-space:pre-wrap;">${escapeHtml(text)}</div>`;

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

    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });

    await transporter.sendMail({
      from: { name: fromName, address: user },
      to,
      subject,
      text: text || '',
      html: html || (text ? textToHtml(text) : undefined),
    });

    return json({ ok: true });
  } catch (e) {
    console.error('メール送信に失敗しました', e);
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
