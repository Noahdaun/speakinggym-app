const VERSION = "sg-v57";
const CACHE = `speakinggym-${VERSION}`;
const ASSETS = [
  '/speakinggym-app/',
  '/speakinggym-app/index.html',
  '/speakinggym-app/manifest.json',
  '/speakinggym-app/icon-192.png',
  '/speakinggym-app/icon-512.png',
];

// 설치 — 핵심 파일 캐시
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// 활성화 — 이전 캐시 삭제
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// fetch — 네트워크 우선, 실패 시 캐시
self.addEventListener('fetch', e => {
  // Supabase API는 항상 네트워크
  if (e.request.url.includes('supabase.co') || 
      e.request.url.includes('anthropic.com')) {
    return;
  }
  e.respondWith(
    fetch(e.request)
      .then(res => {
        // 성공하면 캐시 업데이트
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(cache => cache.put(e.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});

// 업데이트 감지 — 새 버전 있으면 클라이언트에 알림
self.addEventListener('message', e => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});

// 푸시 알림 수신 — 서버(send-push 함수)가 보낸 메시지를 실제 알림으로 표시
self.addEventListener('push', e => {
  let data = { title: 'Speaking Gym', body: '' };
  try { data = e.data.json(); } catch { if (e.data) data.body = e.data.text(); }
  e.waitUntil(
    self.registration.showNotification(data.title || 'Speaking Gym', {
      body: data.body || '',
      icon: '/speakinggym-app/icon-192.png',
      badge: '/speakinggym-app/icon-192.png',
      data: { url: data.url || '/speakinggym-app/' },
    })
  );
});

// 알림 클릭 — 이미 열려있는 탭이 있으면 포커스, 없으면 새로 열기
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = e.notification.data?.url || '/speakinggym-app/';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      for (const client of windowClients) {
        if (client.url.includes('/speakinggym-app/') && 'focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
