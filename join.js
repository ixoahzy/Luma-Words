(() => {
  'use strict';
  const token = location.hash.slice(1);
  history.replaceState(null, '', '/join');
  const status = document.querySelector('#status');
  if (!token) { status.textContent = '没有找到邀请，请重新扫描主机二维码，或使用访问口令。'; return; }
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
  fetch('/auth/invite', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({token}), signal:controller.signal, credentials:'same-origin'})
    .then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error || '邀请验证失败'); location.replace('/'); })
    .catch(error => { status.textContent = error.name === 'AbortError' ? '连接主机超时，请检查网络后重新扫码。' : error instanceof TypeError ? '暂时无法连接主机，请确认主机仍在线后重新扫码。' : error.message; })
    .finally(() => clearTimeout(timer));
})();
