const C='sg-v2.7.0';
const SHELL=['./','./index.html','./manifest.json','./icon-192.png','./icon-512.png','./guide.html','./mux.js','./shop.html','./config.json'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(c=>c.addAll(SHELL)));self.skipWaiting()});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==C).map(k=>caches.delete(k)))));self.clients.claim()});
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(e.request.method!=='GET'||u.hostname.includes('generativelanguage')||/(products|picks|config|maeum)\.json$/.test(u.pathname))return;
  if(u.origin===location.origin){ // 앱 파일: 최신 우선, 오프라인이면 저장본
    e.respondWith(fetch(e.request).then(r=>{const cp=r.clone();caches.open(C).then(c=>c.put(e.request,cp));return r}).catch(()=>caches.match(e.request)));return}
  if(/fonts\.(googleapis|gstatic)\.com/.test(u.hostname)){ // 글꼴: 저장본 우선
    e.respondWith(caches.match(e.request).then(m=>m||fetch(e.request).then(r=>{const cp=r.clone();caches.open(C).then(c=>c.put(e.request,cp));return r})))}
});
