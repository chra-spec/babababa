self.addEventListener('push', event => {
  const data = event.data.json();
  const options = {
    body: data.body || 'Yılan seni özledi gel ve skorunu arttır!',
    icon: 'https://img.remit.ee/api/file/BQACAgUAAyEGAASHRsPbAAEZnjVqiNcypAY9RPOqIiCfIwkYE0S-EQACHiEAAgK8SFT-tAhBtaDTQT0E.png',
    badge: 'https://img.remit.ee/api/file/BQACAgUAAyEGAASHRsPbAAEZnjVqiNcypAY9RPOqIiCfIwkYE0S-EQACHiEAAgK8SFT-tAhBtaDTQT0E.png',
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
