// Brown Work のサービスワーカー
//
// ホーム画面に追加して使えるようにするためのものです。
//
// 【前の版で起きていたこと】
//   1. GETの取得に失敗すると、どんな相手でも「/」（index.html）を返していました。
//      そのため Supabase への問い合わせが一時的に失敗したとき、
//      アプリは JSON のつもりで HTML を受け取り、
//      「Unexpected token '<'」で止まっていました。
//      直したはずの画面が古いまま見える、という症状の一因でもあります。
//   2. GETの応答をすべてキャッシュに入れていました。
//      Supabase から返る給与・個人情報・マイナンバーの応答まで、
//      端末のキャッシュに残り続けていたことになります。
//
// 【この版の決まり】
//   ・自分のサイト（同じオリジン）のGETだけを扱います。
//     Supabase や Google Fonts などは一切さわらず、素通しします。
//   ・ページの読み込み（navigate）だけは、失敗したときに控えの「/」を返します。
//     ここは HTML を返すのが正しい場面です。
//   ・それ以外（画像・JS・CSS・JSONなど）は、失敗したら失敗のまま返します。
//     アプリに本当のエラーを届けるためです。
//   ・キャッシュに入れるのは、200で返ってきた自分のサイトのものだけです。
//
// 【入れ替えについて】
//   CACHE の名前を変えると、古いキャッシュは activate のときに消えます。
//   中身の決まりを変えたときは、必ず名前の数字を上げてください。
//   v2 への入れ替えで、前の版がためこんだ応答もまとめて消えます。

const CACHE = 'brown-work-v2';

// 最初に控えておくもの。ページの土台だけです。
const PRECACHE = ['/', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      // 1つでも取れないと入れ替えが止まってしまうので、失敗しても進めます
      .catch(() => undefined)
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names.filter((n) => n !== CACHE).map((n) => caches.delete(n))
      ))
      .then(() => self.clients.claim())
  );
});

// キャッシュに入れてよい応答か
//   ・200 で返ってきたもの
//   ・自分のサイトのもの（type が 'basic'）
// 206（部分取得）や、中身の見えない応答（opaque）は入れません。
const canCache = (response) => (
  response && response.status === 200 && response.type === 'basic'
);

// キャッシュに入れない道。
// いまのところ Brown Work は自分のサイトにAPIを持っていません
//（データはすべて Supabase＝別オリジンです）。
// 将来 /api/ を置いたときに、その応答を端末に残さないための備えです。
const isApiPath = (pathname) => pathname.startsWith('/api/');

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // 自分のサイト以外は、さわらずに素通しします。
  // Supabase への問い合わせをここで横取りしないのが肝心です。
  if (url.origin !== self.location.origin) return;

  // ---- ページの読み込み ----
  // 新しく出した版をすぐ拾えるよう、まずネットワークを見ます。
  // つながらないときだけ、控えてある「/」を返します。
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((response) => {
          if (canCache(response)) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put('/', copy)).catch(() => undefined);
          }
          return response;
        })
        .catch(() => caches.match('/').then((r) => r || Response.error()))
    );
    return;
  }

  // ---- それ以外（画像・JS・CSS・JSONなど）----
  // まずネットワーク、だめなら控え。控えも無ければ、そのまま失敗を返します。
  // ここで「/」を返すと、JSONを待っている側にHTMLが届いてしまいます。
  event.respondWith(
    fetch(req)
      .then((response) => {
        if (canCache(response) && !isApiPath(url.pathname)) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => undefined);
        }
        return response;
      })
      .catch(() => caches.match(req).then((r) => r || Response.error()))
  );
});
