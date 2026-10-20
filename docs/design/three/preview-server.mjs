import {createServer} from "node:http";
import {readFile} from "node:fs/promises";
import {resolve,sep} from "node:path";
import ts from "typescript";
const root=resolve(import.meta.dirname,"../../..");
const source=resolve(root,"src/modules/photography/three/createCameraModel.ts");
const server=createServer(async(req,res)=>{
 try{
  const pathname=new URL(req.url,"http://127.0.0.1").pathname;
  if(pathname==="/camera.js"){res.setHeader("Content-Type","text/javascript");res.end(ts.transpileModule(await readFile(source,"utf8"),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText);return;}
  const map=pathname.match(/^\/(housing|turquoise|rubber|glass|sand)_(albedo|roughness|height|normal|ao)\.png$/);
  if(map){res.setHeader("Content-Type","image/png");res.end(await readFile(resolve(root,`docs/design/three/material-evidence/${map[1]}/${map[1]}_${map[2]}.png`)));return;}
  if(pathname==="/favicon.ico"){res.writeHead(204);res.end();return;}
  if(pathname.startsWith("/three/")){
   const base=resolve(root,"node_modules/three"),path=resolve(base,pathname.slice(7));
   if(!path.startsWith(base+sep))throw new Error("Invalid path");res.setHeader("Content-Type","text/javascript");res.end(await readFile(path));return;
  }
  if(pathname==="/"||pathname==="/index.html"){res.setHeader("Content-Type","text/html");res.end(await readFile(resolve(root,"docs/design/three/preview.html")));return;}
  res.writeHead(404);res.end();
 }catch{res.writeHead(404);res.end();}
});
server.listen(4177,"127.0.0.1",()=>process.stdout.write("Concept review preview http://127.0.0.1:4177\n"));
