// supabase/functions/my-number/index.ts
//
// マイナンバーの保存と閲覧を、この関数だけに通す。
//
// デプロイ方法：
//   supabase functions deploy my-number
//   ※ --no-verify-jwt は付けないこと（ログイン必須の関数です）
//
// 必要なシークレット：
//   supabase secrets set MY_NUMBER_KEY=<32バイトをbase64にした文字列>
//
//   鍵の作り方（どちらでも）：
//     PowerShell:
//       $b=New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Fill($b); [Convert]::ToBase64String($b)
//     ブラウザのコンソール:
//       btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
//
//   ※ この鍵を紛失すると、保存済みのマイナンバーは二度と読めません。
//     パスワード管理ツールなど、安全な場所に控えてください。
//     逆に、この鍵が漏れたら暗号化の意味がなくなります。
//
// 【背景】
//   以前は employee_my_numbers.my_number_encrypted に番号が
//   平文のまま入っていた（列名に反して暗号化していなかった）。
//   RLS はアプリ経由のアクセスしか守らないため、
//   service_role キーの漏洩やバックアップの流出があれば、
//   全員分の番号がそのまま読めてしまう状態だった。
//
// 【この関数の考え方】
//   ・番号は AES-256-GCM で暗号化してから保存する
//   ・鍵はこの関数のシークレットにだけ置き、ブラウザには一切渡さない
//   ・表 employee_my_numbers への直接アクセスは RLS で塞ぎ、
//     読み書きはこの関数だけが行う（service_role を使用）
//   ・閲覧できるのはマスター管理者と、ご本人（自分の番号のみ）
//   ・保存と閲覧は必ず監査ログに記録する

import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const MY_NUMBER_KEY = Deno.env.get('MY_NUMBER_KEY') || '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

// ------------------------------------------------------------
// 暗号化・復号（AES-256-GCM）
//   保存する形：base64( 12バイトのIV + 暗号文 )
//   IV は保存のたびに作り直す（同じ番号でも毎回違う文字列になる）
// ------------------------------------------------------------
const b64encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const b64decode = (text: string) =>
  Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

let cachedKey: CryptoKey | null = null;
async function getKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;
  const raw = b64decode(MY_NUMBER_KEY);
  if (raw.length !== 32) {
    throw new Error('MY_NUMBER_KEY は32バイトをbase64にしたものである必要があります');
  }
  cachedKey = await crypto.subtle.importKey(
    'raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'],
  );
  return cachedKey;
}

async function encryptNumber(plain: string): Promise<string> {
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain)),
  );
  const packed = new Uint8Array(iv.length + cipher.length);
  packed.set(iv, 0);
  packed.set(cipher, iv.length);
  return b64encode(packed);
}

async function decryptNumber(stored: string): Promise<string> {
  const key = await getKey();
  const packed = b64decode(stored);
  const iv = packed.slice(0, 12);
  const cipher = packed.slice(12);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
  return new TextDecoder().decode(plain);
}

const onlyDigits = (v: unknown) => String(v ?? '').replace(/[^0-9]/g, '');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    if (!MY_NUMBER_KEY) {
      return json({ error: 'MY_NUMBER_KEY が設定されていません' }, 500);
    }

    // ---- 1. 呼び出した人を特定する ----
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: '認証情報がありません' }, 401);

    const callerClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await callerClient.auth.getUser();
    if (userError || !userData?.user) return json({ error: '認証に失敗しました' }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const callerId = userData.user.id;

    const { data: caller } = await admin
      .from('employees')
      .select('id, name, role')
      .eq('id', callerId)
      .maybeSingle();
    if (!caller) return json({ error: '権限がありません' }, 403);

    const isMaster = caller.role === 'master_admin';

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || '');
    const employeeId = String(body?.employeeId || callerId);

    const logAudit = async (actionLabel: string, detail: string) => {
      try {
        await admin.from('audit_logs').insert({
          actor_id: callerId,
          actor_name: caller.name || '',
          action: actionLabel,
          target_employee_id: employeeId,
          detail,
        });
      } catch (e) {
        console.error('監査ログの記録に失敗しました', e);
      }
    };

    // ---- 2. 閲覧 ----
    if (action === 'read') {
      // マスター管理者は全員分、それ以外はご自身の分のみ
      if (!isMaster && employeeId !== callerId) {
        return json({ error: 'マイナンバーを閲覧できるのはマスター管理者のみです' }, 403);
      }

      const { data: row, error } = await admin
        .from('employee_my_numbers')
        .select('my_number_encrypted, purposes')
        .eq('employee_id', employeeId)
        .maybeSingle();
      if (error) return json({ error: `取得に失敗しました：${error.message}` }, 500);

      if (!row?.my_number_encrypted) {
        return json({ number: '', purposes: row?.purposes || [] });
      }

      // 暗号化前の古いデータ（12桁の数字がそのまま入っている）かどうかを先に見る
      if (/^[0-9]{12}$/.test(row.my_number_encrypted)) {
        return json({
          error: 'この番号は暗号化される前に登録されたものです。'
            + 'お手数ですが、ご本人に再登録をご依頼ください。',
          reason: 'legacy_plaintext',
        }, 409);
      }

      // 鍵そのものが読めない場合（長さ違い・余計な空白など）を切り分ける
      try {
        await getKey();
      } catch (e) {
        return json({
          error: 'MY_NUMBER_KEY の形式が正しくありません（32バイトをbase64にした44文字）。'
            + '前後の空白や改行が入っていないかご確認ください。',
          reason: 'bad_key',
          detail: String((e as Error)?.message || e),
        }, 500);
      }

      let number = '';
      try {
        number = await decryptNumber(row.my_number_encrypted);
      } catch (_) {
        // 鍵は読めるが復号できない＝保存時と違う鍵が設定されている
        return json({
          error: '保存されている番号を復号できませんでした。'
            + '登録したときと違う鍵が設定されている可能性があります。'
            + '元の鍵に戻すか、ご本人に再登録をご依頼ください。',
          reason: 'wrong_key',
        }, 409);
      }

      await logAudit('マイナンバーを閲覧', employeeId === callerId ? 'ご本人による閲覧' : '');
      return json({ number, purposes: row.purposes || [] });
    }

    // ---- 3. 保存 ----
    if (action === 'save') {
      // マスター管理者は全員分、それ以外はご自身の分のみ
      if (!isMaster && employeeId !== callerId) {
        return json({ error: '他の方のマイナンバーは登録できません' }, 403);
      }

      const number = onlyDigits(body?.number);
      if (number.length !== 12) {
        return json({ error: 'マイナンバーは12桁の数字でご入力ください' }, 400);
      }
      const purposes: string[] = Array.isArray(body?.purposes)
        ? body.purposes.map((p: unknown) => String(p)).slice(0, 20)
        : [];

      const encrypted = await encryptNumber(number);

      const { error } = await admin.from('employee_my_numbers').upsert(
        {
          employee_id: employeeId,
          my_number_encrypted: encrypted,
          purposes,
          updated_by: callerId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'employee_id' },
      );
      if (error) return json({ error: `保存に失敗しました：${error.message}` }, 500);

      await logAudit(
        employeeId === callerId ? 'マイナンバーを本人登録' : 'マイナンバーを更新',
        purposes.length ? `利用目的: ${purposes.join('、')}` : '',
      );
      return json({ ok: true });
    }

    // ---- 4. 削除（保存期間を過ぎたものの廃棄） ----
    if (action === 'delete') {
      if (!isMaster) {
        return json({ error: 'マイナンバーを削除できるのはマスター管理者のみです' }, 403);
      }
      const { error } = await admin
        .from('employee_my_numbers')
        .delete()
        .eq('employee_id', employeeId);
      if (error) return json({ error: `削除に失敗しました：${error.message}` }, 500);

      await logAudit('マイナンバーを廃棄', '保存期間の経過による廃棄');
      return json({ ok: true });
    }

    return json({ error: 'action は read / save / delete のいずれかです' }, 400);
  } catch (e) {
    console.error('マイナンバーの処理に失敗しました', e);
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
