if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', event => {
    if (event.data && event.data.type === 'SHOW_TOAST') {
      showToastNotification(event.data.title, event.data.body);
    }
  });
}

function showToastNotification(title, message) {
  const existingToast = document.querySelector('.custom-toast-notification');
  if (existingToast) existingToast.remove();

  const toast = document.createElement('div');
  toast.className = 'custom-toast-notification';
  toast.innerHTML = `
    <div class="toast-icon">🔔</div>
    <div class="toast-content">
      <div class="toast-title">${title}</div>
      <div class="toast-body">${message}</div>
    </div>
    <button class="toast-close">×</button>
  `;

  toast.style.cssText = `
    position: fixed;
    top: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: #fff;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    border-radius: 12px;
    padding: 12px 16px;
    display: flex;
    align-items: center;
    gap: 10px;
    z-index: 99999;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    max-width: 90%;
    width: 360px;
    animation: slideDownToast 0.3s ease-out;
  `;

  if (!document.getElementById('toast-animation-style')) {
    const style = document.createElement('style');
    style.id = 'toast-animation-style';
    style.textContent = `
      @keyframes slideDownToast {
        from { opacity: 0; transform: translate(-50%, -20px); }
        to { opacity: 1; transform: translate(-50%, 0); }
      }
    `;
    document.head.appendChild(style);
  }

  toast.querySelector('.toast-close').addEventListener('click', () => toast.remove());

  document.body.appendChild(toast);

  setTimeout(() => {
    if (toast.parentNode) toast.remove();
  }, 3000);
}
