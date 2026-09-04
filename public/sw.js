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
    requireInteraction: false,
    silent: false,
    tag: data.tag || 'default',
    renotify: true,
    data: { url: data.data?.url || '/' }
  };

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(data.title || 'Yılan Oyunu Platformu', options),
      // Client'lara mesaj gönder ve ses çal
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
        clients.forEach(client => {
          client.postMessage({
            type: 'SHOW_TOAST_AND_SOUND',
            title: data.title || 'Yılan Oyunu Platformu',
            body: data.body || 'Yeni mesaj'
          });
        });
      })
    ])
  );
});
