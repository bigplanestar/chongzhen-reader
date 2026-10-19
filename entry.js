'use strict';
const statusText=document.getElementById('status'),enter=document.getElementById('enter'),retry=document.getElementById('retry');
let redirectTimer;
function verified(data) {if(!data||typeof data.url!=='string'||!/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(data.url))throw new Error('地址更新中');return data.url;}
async function request(url,headers={}) {const response=await fetch(url,{headers,cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(10000)});if(!response.ok)throw new Error('连接更新中');return response.json();}
async function connect(){
  clearTimeout(redirectTimer);retry.hidden=true;enter.hidden=true;statusText.textContent='正在为你翻开书页…';
  try{
    let target;
    try{const file=await request('https://api.github.com/repos/bigplanestar/chongzhen-reader/contents/endpoint.json',{Accept:'application/vnd.github.raw+json'});target=verified(file);}
    catch{target=verified(await request('./endpoint.json?t='+Date.now()));}
    enter.href=target;enter.hidden=false;statusText.textContent='书房入口已就绪，即将打开。';
    if(!new URLSearchParams(location.search).has('stay'))redirectTimer=setTimeout(()=>location.replace(target),1200);
  }catch{statusText.textContent='书房地址暂时未能载入，请稍后再试。';retry.hidden=false;}
}
retry.onclick=connect;connect();
