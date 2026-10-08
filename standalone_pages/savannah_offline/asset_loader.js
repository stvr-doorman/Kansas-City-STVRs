/* Static-host loader for packaged JSON assets. No server transforms needed. */
'use strict';
(()=>{
 const base=new URL('.',document.currentScript.src),nativeFetch=globalThis.fetch.bind(globalThis);
 const assets=globalThis.PackagedAssets;
 globalThis.fetch=async function(input,options){
  const url=new URL(input instanceof Request?input.url:String(input),document.baseURI);
  const key=url.origin===base.origin&&url.pathname.startsWith(base.pathname)?decodeURIComponent(url.pathname.slice(base.pathname.length)):'';
  const asset=assets[key];
  if(!asset||((options?.method||'GET').toUpperCase()!=='GET'))return nativeFetch(input,options);
  const target=new URL(asset,base);target.search=url.search;
  const response=await nativeFetch(input instanceof Request?new Request(target,input):target,options);
  if(!response.ok)return response;
  const bytes=new Uint8Array(await response.arrayBuffer());
  const body=bytes[0]===31&&bytes[1]===139
   ?await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer():bytes;
  return new Response(body,{status:response.status,statusText:response.statusText,headers:{'Content-Type':'application/json;charset=utf-8'}});
 };
})();
