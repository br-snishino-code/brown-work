# スプレッドシート用のスクリプト

## shift-import.gs — シフト希望の取り込み

Brown Work に提出されたシフト希望を、スタッフシフトのスプレッドシートへ取り込みます。

### 準備（初回のみ）

1. Supabase に合言葉を設定する

   ```
   supabase secrets set SHIFT_EXPORT_KEY=<好きな長い文字列>
   supabase functions deploy shift-requests-export --no-verify-jwt
   ```

2. スプレッドシートを開き、「拡張機能」→「Apps Script」
3. `Code.gs` の中身を消し、`shift-import.gs` の内容を貼り付けて保存
4. 「プロジェクトの設定」→「スクリプト プロパティ」に2つ追加

   | 名前 | 値 |
   |---|---|
   | `SUPABASE_URL` | `https://xxxxxxxx.supabase.co` |
   | `SHIFT_API_KEY` | 手順1で決めた合言葉 |

5. スプレッドシートを再読み込みすると「Brown Work」メニューが出ます

### 使い方

- 「Brown Work」→「シフト希望を取り込む」→ 対象月を入力
- 「シフト希望_2026-11」というシートに、スタッフ×日付の表が書き込まれます
- 「毎日の自動取り込みを設定」を押すと、毎朝6時台に翌月分を自動で取り込みます

### 注意

- 合言葉を知っている人は、その月のシフト希望を読み取れます。スプレッドシートの共有範囲にご注意ください
- 書き込み先は専用のシートです。既存のシフト表は書き換えません
