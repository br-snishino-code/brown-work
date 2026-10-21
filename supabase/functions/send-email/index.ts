// supabase/functions/send-email/index.ts
//
// アプリからのメール送信をまとめて受け持つEdge Function。
// 会社のメール（Google Workspace）からSMTPで送信する。
//
// デプロイ方法：
//   supabase functions deploy send-email
//   ※ --no-verify-jwt は付けないこと（ログイン必須の関数です）
//
// 必要なシークレット（Supabase側で設定）：
//   supabase secrets set SMTP_HOST=smtp.gmail.com
//   supabase secrets set SMTP_PORT=465
//   supabase secrets set SMTP_USER=送信元のメールアドレス
//   supabase secrets set SMTP_PASS=Googleで発行したアプリパスワード（16桁・スペースなし）
//   supabase secrets set SMTP_FROM_NAME="Brown Work"
//
// ※ 日本語の件名・本文を正しく扱うため nodemailer を使用している。
//
// 【セキュリティ修正（監査所見③）】
//   以前はこの関数に認証が一切なく、URLを知っていれば誰でも
//   会社のメールアドレスから任意の宛先・任意の本文のメールを送れた。
//   （迷惑メールの踏み台・会社名での詐欺メールに使える状態）
//   現在は次の2つで守っている：
//     1. ログイン済みのスタッフ本人のトークンが必要
//     2. 宛先は「社内に登録のあるアドレス」または
//        「管理者宛の通知先として設定されたアドレス」のみ

import nodemailer from 'npm:nodemailer@6.9.14';
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

// 改行をそのまま活かした簡易HTMLを作る（テキスト版と併せて送る）
const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const textToHtml = (text: string) =>
  `<div style="font-family:'Hiragino Sans','Yu Gothic',Meiryo,sans-serif;font-size:14px;line-height:1.8;color:#1e293b;white-space:pre-wrap;">${escapeHtml(text)}</div>`;

const normalizeAddress = (v: unknown) => String(v ?? '').trim().toLowerCase();

// 宛先は1件のみ。カンマ・改行・山かっこを含むものは受け付けない
// （ヘッダーに改行を混ぜて別の宛先を足す攻撃を防ぐ）
const isSingleAddress = (v: string) =>
  /^[^\s<>,;"]+@[^\s<>,;"]+\.[^\s<>,;"]+$/.test(v);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const host = Deno.env.get('SMTP_HOST');
  const port = Number(Deno.env.get('SMTP_PORT') || '465');
  const user = Deno.env.get('SMTP_USER');
  const pass = Deno.env.get('SMTP_PASS');
  const fromName = Deno.env.get('SMTP_FROM_NAME') || 'Brown Work';

  try {
    // ---- 1. 呼び出した人がログイン済みのスタッフであることを確認する ----
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return json({ error: '認証情報がありません' }, 401);
    }

    const callerClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await callerClient.auth.getUser();
    if (userError || !userData?.user) {
      return json({ error: '認証に失敗しました' }, 401);
    }

    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: caller } = await adminClient
      .from('employees')
      .select('id, resignation_date')
      .eq('id', userData.user.id)
      .maybeSingle();
    if (!caller) {
      return json({ error: 'メールを送信する権限がありません' }, 403);
    }

    // ---- 2. 宛先と本文を受け取る ----
    const { to, subject, text, html } = await req.json();
    if (!to || !subject) {
      return json({ error: 'to と subject は必須です' }, 400);
    }

    const target = normalizeAddress(to);
    if (!isSingleAddress(target)) {
      return json({ error: '宛先の形式が正しくありません（1件のみ指定してください）' }, 400);
    }
    if (String(subject).length > 200) {
      return json({ error: '件名が長すぎます' }, 400);
    }
    if (String(text ?? '').length > 20000 || String(html ?? '').length > 60000) {
      return json({ error: '本文が長すぎます' }, 400);
    }

    // ---- 3. 宛先が社内のアドレスかどうかを確認する ----
    // 社内に登録のあるアドレス（連絡用メールアドレス・ログインID）
    const { data: employeeRows } = await adminClient
      .from('employees')
      .select('contact_email, username');
    const allowed = new Set<string>();
    (employeeRows || []).forEach((row: { contact_email?: string; username?: string }) => {
      const a = normalizeAddress(row.contact_email);
      const b = normalizeAddress(row.username);
      if (a.includes('@')) allowed.add(a);
      if (b.includes('@')) allowed.add(b);
    });

    // 管理者宛の通知先として設定されたアドレス
    const { data: settingRow } = await adminClient
      .from('app_settings')
      .select('value')
      .eq('key', 'admin_notify_email')
      .maybeSingle();
    String(settingRow?.value || '')
      .split(/[,、\s]+/)
      .map((v) => normalizeAddress(v))
      .filter((v) => v.includes('@'))
      .forEach((v) => allowed.add(v));

    if (!allowed.has(target)) {
      console.warn('社内に登録のない宛先への送信を拒否しました', {
        caller: userData.user.id,
      });
      return json({ error: '社内に登録のない宛先には送信できません' }, 403);
    }

    // ---- 4. SMTP未設定でもアプリ側の処理は止めない（通知はアプリ内に残る）----
    if (!host || !user || !pass) {
      return json({ skipped: true, reason: 'SMTP settings are not configured' }, 200);
    }

    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });

    await transporter.sendMail({
      from: { name: fromName, address: user },
      to: target,
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
