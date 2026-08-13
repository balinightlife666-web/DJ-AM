(() => {
  'use strict';
  const files = [
    '/v9-analyser-hook.js?v=9',
    '/app-v8.js?v=9',
    '/v9-bpm-overlay.js?v=9',
    '/v9-beatlink.js?v=9'
  ];

  function load(index) {
    if (index >= files.length) return;
    const script = document.createElement('script');
    script.src = files[index];
    script.async = false;
    script.onload = () => load(index + 1);
    script.onerror = () => console.error('ACC DJ runtime gagal memuat:', files[index]);
    document.head.appendChild(script);
  }

  load(0);
})();
