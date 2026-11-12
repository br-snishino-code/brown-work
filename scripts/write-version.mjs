// ビルドのたびに public/version.json を書き換えます。
//
// 【なぜ必要か】
//   ホーム画面に追加したアプリや、開きっぱなしのタブは、
//   新しい版を出しても再読み込みされるまで古いまま動き続けます。
//   直したはずの動きが直っていないように見える原因になります。
//   アプリが自分で新しい版に気づけるよう、版の目印を置いています。
//
// 【中身】
//   { "build": "2026-11-12T10:30:00.000Z-0913094" }
//   いつ出した版か（UTC）と、もとになったコミットの先頭7文字です。
//
// npm run build の前に自動で走ります（package.json の prebuild）。

import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

let sha = 'unknown';
try {
  sha = execSync('git rev-parse --short=7 HEAD', { cwd: root }).toString().trim();
} catch {
  // git が使えない場所でビルドしても止めません
}

const build = `${new Date().toISOString()}-${sha}`;
const out = join(root, 'public', 'version.json');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify({ build }, null, 2)}\n`);
console.log(`版の目印を書きました: ${build}`);
