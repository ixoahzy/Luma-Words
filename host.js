(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  let state = null, pending = false, polling = false, qrVersion = '', refreshTimer;
  const last = (calls, name) => calls[name] ? `；最近成功调用 ${new Date(calls[name]*1000).toLocaleTimeString()}` : '；本次启动尚未实际调用';
  function message(text) { $('error').textContent=text; $('error').hidden=!text; }
  async function request(path, method='GET') {
    const controller = new AbortController(), timer=setTimeout(()=>controller.abort(),method==='POST'?100000:10000);
    try {
      const response=await fetch('/api/host/'+path,{method,signal:controller.signal,...(method==='POST'?{headers:{'Content-Type':'application/json'},body:'{}'}:{})});
      const data=await response.json(); if(!response.ok) throw new Error(data.error||'主机请求失败'); return data;
    } finally {clearTimeout(timer);}
  }
  function render() {
    if(!state) return;
    const busy=pending||state.busy, invite=state.invite;
    const seconds=Math.max(0,Math.floor(invite.expires-Date.now()/1000));
    const valid=state.running&&invite.valid&&seconds>0;
    $('share-state').textContent=state.running?(state.provider==='tailscale'?'固定 HTTPS 入口运行中':'临时 HTTPS 共享运行中'):'公网共享已关闭';
    $('public-address').textContent=state.origin||'没有正在运行的公网地址';
    $('sharing-mode').textContent=state.provider==='tailscale'?'可收藏固定网址，下次开启共享仍使用同一地址。普通链接使用原口令；扫码邀请仍为 15 分钟。':state.mode==='tailscale'?'已选择 Tailscale 固定入口。若临时共享仍在运行，停止后重新开启即可切换。':'临时通道重启会换地址。需要固定地址时，运行项目中的“设置固定网址.command”。';
    $('start').disabled=busy||state.running; $('rotate').disabled=busy||!state.running; $('stop').disabled=busy||!state.running;
    $('copy').disabled=$('save').disabled=$('visit').disabled=busy||!valid;
    $('qr').hidden=!valid; $('qr-empty').hidden=valid;
    $('qr-empty').textContent=state.running?'邀请已失效或次数已用完，请点击“更新二维码”。':'共享已关闭，旧二维码不可用。点击“开启共享”重新生成。';
    $('invite-state').textContent=valid?`剩余 ${Math.floor(seconds/60)} 分 ${seconds%60} 秒 · 可兑换 ${invite.remaining} 次`:'当前没有有效邀请';
    if(valid && qrVersion!==invite.version){qrVersion=invite.version;$('qr').src='/api/host/qr?v='+encodeURIComponent(qrVersion);}
    if(!valid) qrVersion='';
    $('website').textContent='正在运行 · 仅本机管理';
    $('chat').textContent=(state.modelReachable?'本机模型服务可连接':'本机模型服务暂不可连接')+last(state.lastCalls,'chat');
    $('whisper').textContent=(state.whisperInstalled?'依赖和模型已安装':'依赖或模型未安装')+(state.whisperLoaded?'；模型已加载':'；模型未加载')+last(state.lastCalls,'whisper');
    $('tts').textContent=(state.ttsInstalled?'独立环境和权重已就绪':'环境或权重未就绪')+(state.ttsRunning?'；常驻进程运行中':'；首次使用时加载')+last(state.lastCalls,'tts_qwen');
    $('backend').textContent=(state.defaultBackend==='qwen'?'本地 Qwen3-TTS · Serena':'服务端系统声音')+'；每位访客可在声音设置中另选音色';
  }
  async function refresh() {
    if(polling) return; polling=true;
    try {state=await request('status');render();}
    catch(error){state=null;$('qr').hidden=true;$('qr-empty').hidden=false;$('qr-empty').textContent='主机状态暂不可读，二维码暂不展示。';$('share-state').textContent='主机连接中断';$('website').textContent='暂时无法连接';for(const id of ['copy','save','rotate','stop'])$(id).disabled=true;message(error.name==='AbortError'?'状态读取超时，请稍候重试。':'无法读取主机状态：'+error.message);}
    finally{polling=false;}
  }
  for(const action of ['start','rotate','stop']) $(action).addEventListener('click',async()=>{
    pending=true;message('');render();$('copy-status').textContent=action==='start'?'正在建立 HTTPS 通道，可能需要几十秒…':'';
    try{await request(action,'POST');await refresh();}
    catch(error){message(error.name==='AbortError'?'操作等待超时，请刷新状态后检查日志。':error.message);}
    finally{pending=false;$('copy-status').textContent='';render();}
  });
  $('copy').addEventListener('click',async()=>{
    try{const data=await request('invite');await navigator.clipboard.writeText(data.url);$('copy-status').textContent='邀请链接已复制，请只分享给希望加入的人。';}
    catch(_){message('复制未完成，请允许剪贴板访问，或直接保存二维码分享。');}
  });
  $('save').addEventListener('click',async()=>{
    try{const response=await fetch('/api/host/qr');if(!response.ok)throw new Error();const url=URL.createObjectURL(await response.blob());const a=document.createElement('a');a.href=url;a.download='DeskTalk-邀请二维码.png';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
    catch(_){message('二维码已失效，请更新后再保存。');}
  });
  $('visit').addEventListener('click',async()=>{try{const data=await request('invite');location.assign(data.url);}catch(error){message(error.message);}});
  $('qr').addEventListener('error',()=>{qrVersion='';message('二维码暂未加载，请更新二维码或检查主机状态。');});
  void refresh(); refreshTimer=setInterval(()=>void refresh(),5000);
  const clock=setInterval(render,1000);
  window.addEventListener('pagehide',()=>{clearInterval(refreshTimer);clearInterval(clock);});
})();
