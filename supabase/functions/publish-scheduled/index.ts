// supabase/functions/publish-scheduled/index.ts
//
// 予約した時刻になった給与明細・賞与明細を公開し、本人へお知らせとメールを送る。
// publish_schedules（supabase/81_publish_schedules.sql）を見て動く。
//
// 【デプロイ方法】
//   supabase functions deploy publish-scheduled --no-verify-jwt
//   ※ 定時実行から呼ぶため、ログインを必須にできない。
//     代わりに合言葉（x-api-key）で守っている。下のガードを参照。
//
// 【必要なシークレット】
//   supabase secrets set PUBLISH_SCHEDULED_KEY=長いランダムな文字列
//   （SMTP_* は send-email と同じものを使う。すでに設定済みなら追加不要）
//
// 【定時実行の設定（Supabase の Cron）】
//   Supabase → Integrations → Cron → Create job
//     Name     : publish-scheduled
//     Schedule : */15 * * * *        … 15分ごと
//     Type     : HTTP Request
//     Method   : POST
//     URL      : https://<プロジェクト>.supabase.co/functions/v1/publish-scheduled
//     Headers  : x-api-key: 上で設定した合言葉
//
//   15分ごとにしているのは、予約時刻ちょうどに動く仕組みではないため。
//   「9:00に公開」と予約すると、9:00〜9:15のあいだに公開される。
//   きっかり動かしたい場合は毎分にできるが、呼び出し回数が増える。
//
// 【安全のための決まり】
//   ・さかのぼって公開はしない。予約時刻をすぎた分だけを公開する。
//   ・すでに公開済みの明細には触らない。
//   ・1回の実行で扱う予約は MAX_SCHEDULES 件まで。
//   ・メールが送れなくても公開は取り消さない（お知らせはアプリ内に残る）。

import nodemailer from 'npm:nodemailer@6.9.14';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// 1回の実行で扱う予約の上限。取りこぼしても次の実行で拾う。
const MAX_SCHEDULES = 5;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

// 合言葉の比較。長さの違いから中身を推測されないように、
// どちらもHMACにしてから比べる（shift-confirmed-import と同じ作り）。
async function constantTimeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const keyData = crypto.getRandomValues(new Uint8Array(32));
  const key = await crypto.subtle.importKey(
    'raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const [ha, hb] = await Promise.all([
    crypto.subtle.sign('HMAC', key, enc.encode(a)),
    crypto.subtle.sign('HMAC', key, enc.encode(b)),
  ]);
  const va = new Uint8Array(ha);
  const vb = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i];
  return diff === 0;
}

// スタッフ向けメールの本文（画面側の buildStaffMailText と同じ体裁）
function buildMailText(name: string, lines: string[]): string {
  return [
    `${name} 様`,
    '',
    ...lines,
    '',
    '---',
    'このメールは Brown Work から自動で送信しています。',
    'お心当たりがない場合は、お手数ですが管理者までご連絡ください。',
  ].join('\n');
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ));
}

Deno.serve(async (req) => {
  // ---- 合言葉の確認 ----
  // 【順番が大事】expected が空のときにヘッダ無しで呼ばれると
  // '' と '' の比較になって通ってしまう。必ず先に空かどうかを見る。
  const expected = Deno.env.get('PUBLISH_SCHEDULED_KEY') || '';
  if (!expected) {
    return json({ error: 'PUBLISH_SCHEDULED_KEY が未設定です' }, 500);
  }
  const given = req.headers.get('x-api-key') || '';
  if (!(await constantTimeEqual(given, expected))) {
    return json({ error: '合言葉が違います' }, 401);
  }

  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const nowIso = new Date().toISOString();

  // ---- 予約時刻をすぎた分を取り出す ----
  const { data: due, error: dueError } = await db
    .from('publish_schedules')
    .select('*')
    .eq('status', 'scheduled')
    .lte('publish_at', nowIso)
    .order('publish_at', { ascending: true })
    .limit(MAX_SCHEDULES);

  if (dueError) {
    return json({ error: `予約の取得に失敗しました: ${dueError.message}` }, 500);
  }
  if (!due || due.length === 0) {
    return json({ ok: true, message: '公開する予約はありません', processed: 0 });
  }

  // ---- メールの準備（設定が無ければメールだけ飛ばす） ----
  const host = Deno.env.get('SMTP_HOST');
  const port = Number(Deno.env.get('SMTP_PORT') || '465');
  const user = Deno.env.get('SMTP_USER');
  const pass = Deno.env.get('SMTP_PASS');
  const fromName = Deno.env.get('SMTP_FROM_NAME') || 'Brown Work';
  const mailer = host && user && pass
    ? nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } })
    : null;

  const results: unknown[] = [];

  for (const s of due) {
    const isBonus = s.kind === 'bonus';
    const table = isBonus ? 'bonus_records' : 'payroll_records';
    let published = 0;
    let notified = 0;
    let mailed = 0;
    let lastError: string | null = null;

    try {
      // ---- 対象の下書きを取り出す ----
      // 賞与は (year, seq)、給与は (year, month) で絞る
      let q = db.from(table).select('*').eq('year', s.year).neq('status', 'published');
      q = isBonus ? q.eq('seq', s.period) : q.eq('month', s.period);
      const { data: records, error: recError } = await q;
      if (recError) throw new Error(`明細の取得に失敗: ${recError.message}`);

      for (const r of records || []) {
        // ---- 公開する ----
        const { error: upError } = await db
          .from(table)
          .update({ status: 'published', published_at: nowIso })
          .eq('id', r.id)
          .neq('status', 'published'); // 競合しても二重に公開しない
        if (upError) { lastError = `公開に失敗（${r.id}）: ${upError.message}`; continue; }
        published += 1;

        const title = isBonus
          ? `【賞与明細】${r.year}年 ${r.title || `第${r.seq}回`}`
          : `【給与明細】${r.year}年${r.month}月分`;
        const what = isBonus
          ? `${r.year}年 ${r.title || `第${r.seq}回`}の賞与明細`
          : `${r.year}年${r.month}月分の給与明細`;

        // ---- アプリ内のお知らせ ----
        // 列の名前は画面側の notify() と同じにする。
        // to_employee_id（to ではない）、to_role、related_id は text。
        const { error: notifyError } = await db.from('notifications').insert({
          to_employee_id: r.employee_id,
          to_role: 'employee',
          subject: title,
          body: `${what}が公開されました。ご確認ください。`,
          related_id: r.id,
        });
        if (notifyError) lastError = `お知らせに失敗（${r.id}）: ${notifyError.message}`;
        else notified += 1;

        // ---- メール ----
        if (!mailer) continue;
        const { data: emp } = await db
          .from('employees')
          .select('name, contact_email')
          .eq('id', r.employee_id)
          .maybeSingle();
        if (!emp?.contact_email) continue;
        const text = buildMailText(emp.name || '', [
          `${what}を公開しました。`,
          '下記よりご確認ください。',
        ]);
        try {
          await mailer.sendMail({
            from: `"${fromName}" <${user}>`,
            to: emp.contact_email,
            subject: title,
            text,
            html: `<pre style="font-family:sans-serif;white-space:pre-wrap">${escapeHtml(text)}</pre>`,
          });
          mailed += 1;
        } catch (e) {
          // メールが送れなくても公開は取り消さない。
          // お知らせはアプリ内に残っているため、本人は気づける。
          lastError = `メール送信に失敗（${r.id}）: ${String(e)}`;
        }
      }

      await db.from('publish_schedules').update({
        status: 'done',
        done_at: nowIso,
        published_count: published,
        notified_count: notified,
        mail_sent_count: mailed,
        last_error: lastError,
      }).eq('id', s.id);

      results.push({ id: s.id, kind: s.kind, year: s.year, period: s.period, published, notified, mailed, lastError });
    } catch (e) {
      // この予約は done にせず残す。次の実行でもう一度試す。
      await db.from('publish_schedules').update({ last_error: String(e) }).eq('id', s.id);
      results.push({ id: s.id, kind: s.kind, error: String(e) });
    }
  }

  return json({ ok: true, processed: due.length, results });
});
