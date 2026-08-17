self.addEventListener('push', event => {
  const data = event.data.json();
  const options = {
    body: data.body || 'Yılan seni özledi gel ve skorunu arttır!',
    icon: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', // 1x1 şeffaf
    badge: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', // 1x1 şeffaf
    vibrate: [100, 50, 100],
    requireInteraction: false,
    lang: 'tr',
    dir: 'auto'
  };
  event.waitUntil(
    self.registration.showNotification(data.title || 'Yılan Oyunu Platformu', options)
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.openWindow('/')
  );
});
