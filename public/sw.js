self.addEventListener('push', event => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: 'Yılan Oyunu Platformu', body: 'Yeni mesaj' };
  }

  const options = {
    body: data.body || 'Yeni mesaj',
    icon: 'https://img.remit.ee/api/file/BQACAgUAAyEGAASHRsPbAAEZnjVqiNcypAY9RPOqIiCfIwkYE0S-EQACHiEAAgK8SFT-tAhBtaDTQT0E.png',
    badge: 'https://img.remit.ee/api/file/BQACAgUAAyEGAASHRsPbAAEZnjVqiNcypAY9RPOqIiCfIwkYE0S-EQACHiEAAgK8SFT-tAhBtaDTQT0E.png',
    vibrate: [200, 100, 200],
    lang: 'tr',
    requireInteraction: false,  // heads-up bildirimi için false
    silent: false,              // ses çalması için false
    tag: data.tag || 'default',
    renotify: true,
    data: { url: data.data?.url || '/' }
  };

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(data.title || 'Yılan Oyunu Platformu', options),
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
        clients.forEach(client => {
          client.postMessage({
            type: 'SHOW_TOAST',
            title: data.title || 'Yılan Oyunu Platformu',
            body: data.body || 'Yeni mesaj'
          });
        });
      })
    ])
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      for (let client of windowClients) {
        if (client.url.includes(url) && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(url);
      }
    })
  );
});
