self.addEventListener('push', event => {
  const data = event.data.json();
  const options = {
    body: data.body || 'Yılan seni özledi gel ve skorunu arttır!',
    icon: '/icon.png',
    badge: '/icon.png',
    vibrate: [100, 50, 100],
    lang: 'tr'
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
