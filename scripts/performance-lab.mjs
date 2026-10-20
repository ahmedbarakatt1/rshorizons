/* global window, PerformanceObserver, performance, location */
import {chromium} from "@playwright/test";
import {mkdirSync,writeFileSync} from "node:fs";
const base=process.env.E2E_BASE_URL??"http://127.0.0.1:3002";
if(!["127.0.0.1","localhost"].includes(new URL(base).hostname))throw new Error("Local performance verification only.");
mkdirSync(".local/evidence/perf",{recursive:true});mkdirSync("docs/evidence",{recursive:true});
const browser=await chromium.launch(),samples=[];
try{
 for(const width of [1440,390])for(const route of ["/en","/en/booking/request?service=boat-tours"]){
  const context=await browser.newContext({viewport:{width,height:900},deviceScaleFactor:1}),page=await context.newPage(),session=await context.newCDPSession(page);
  const trace=[];session.on("Tracing.dataCollected",event=>trace.push(...event.value));
  await session.send("Network.enable");await session.send("Network.setCacheDisabled",{cacheDisabled:true});
  await session.send("Emulation.setCPUThrottlingRate",{rate:4});
  await session.send("Network.emulateNetworkConditions",{offline:false,latency:150,downloadThroughput:200000,uploadThroughput:93750});
  await page.addInitScript(()=>{
   window.__lab={lcpMs:null,lcpElement:null,cls:0,shifts:[],longTaskBlockingMs:0};let sessionStart=0,lastShift=0,sessionScore=0;
   new PerformanceObserver(list=>{for(const e of list.getEntries()){window.__lab.lcpMs=e.startTime;window.__lab.lcpElement=e.element?.className;}}).observe({type:"largest-contentful-paint",buffered:true});
   new PerformanceObserver(list=>{for(const e of list.getEntries()){if(e.hadRecentInput)continue;if(e.startTime-lastShift>1000||e.startTime-sessionStart>5000){sessionStart=e.startTime;sessionScore=0;}sessionScore+=e.value;lastShift=e.startTime;window.__lab.cls=Math.max(window.__lab.cls,sessionScore);window.__lab.shifts.push({at:e.startTime,value:e.value,sources:e.sources.map(s=>({element:s.node?.className||s.node?.nodeName,from:s.previousRect.toJSON(),to:s.currentRect.toJSON()}))});}}).observe({type:"layout-shift",buffered:true});
   new PerformanceObserver(list=>{for(const e of list.getEntries())window.__lab.longTaskBlockingMs+=Math.max(0,e.duration-50);}).observe({type:"longtask",buffered:true});
  });
  const scripts=[];page.on("response",response=>{if(response.request().resourceType()==="script")scripts.push(response);});
  await session.send("Tracing.start",{categories:"devtools.timeline,blink.user_timing",transferMode:"ReportEvents"});
  const response=await page.goto(base+route,{waitUntil:"load",timeout:60000});if(response.status()!==200)throw new Error("Performance page failed.");
  await page.waitForTimeout(2500);
  const data=await page.evaluate(()=>{const resources=performance.getEntriesByType("resource"),nav=performance.getEntriesByType("navigation")[0];return {...window.__lab,ttfbMs:nav.responseStart,scriptEncodedBytes:resources.filter(e=>e.initiatorType==="script").reduce((sum,e)=>sum+e.encodedBodySize,0),scriptDecodedBytes:resources.filter(e=>e.initiatorType==="script").reduce((sum,e)=>sum+e.decodedBodySize,0),imageEncodedBytes:resources.filter(e=>e.initiatorType==="img"||/demo-media|\.webp|\.svg/.test(e.name)).reduce((sum,e)=>sum+e.encodedBodySize,0),externalOrigins:[...new Set(resources.map(e=>new URL(e.name).origin).filter(origin=>origin!==location.origin))]};});
  let threeLoaded=false;for(const script of scripts){const code=await script.text();if(/THREE\.WebGLRenderer|isWebGLRenderer|THREE\.Object3D/.test(code))threeLoaded=true;}
  const done=new Promise(resolve=>session.once("Tracing.tracingComplete",resolve));await session.send("Tracing.end");await done;
  writeFileSync(`.local/evidence/perf/${width}-${route.includes("request")?"booking":"home"}.json`,JSON.stringify({traceEvents:trace}));
  samples.push({route,width,...data,threeLoaded});await context.close();
 }
 const report={at:new Date().toISOString(),browser:browser.version(),conditions:{cpuSlowdown:4,latencyMs:150,downloadBytesPerSecond:200000,uploadBytesPerSecond:93750,cacheDisabled:true,postLoadObservationMs:2500},samples,limitations:"One cold synthetic lab observation per route/viewport on a shared Windows host. Long-task blocking is an observation-window diagnostic, not a Lighthouse TBT score. No field p75, INP or production capacity claim; repeat in designated staging and collect consented aggregate field metrics."};
 writeFileSync("docs/evidence/performance-lab.json",JSON.stringify(report,null,2)+"\n");
 console.log(JSON.stringify(report,null,2));if(samples.some(sample=>sample.threeLoaded||sample.externalOrigins.length))throw new Error("Unexpected third-party or Three.js payload on critical pages.");
}finally{await browser.close();}
