// Reproducible browser measurements. The skill's referenced export_mesh_geometry.mjs
// is absent from this installed package; this exports the same raw mesh inputs.
import {chromium} from "playwright";
import {writeFile} from "node:fs/promises";
import {resolve} from "node:path";
const prefix=process.argv[2]??"blockout-latest";
const browser=await chromium.launch({headless:true});
try{
  const page=await browser.newPage({viewport:{width:1536,height:1024},deviceScaleFactor:1});
  await page.goto("http://127.0.0.1:4177");
  await page.waitForFunction(()=>window.reviewReady===true);
  for(const angle of [15,0,90,180,270]){
    await page.evaluate(degrees=>window.setAngle(degrees),angle);
    await page.screenshot({path:resolve(`docs/design/three/${prefix}-${angle}.png`)});
  }
  const measured=await page.evaluate(async()=>{
    const THREE=await import("/three/build/three.module.js");
    const meshes=[],positions={};
    window.model.updateMatrixWorld(true);
    window.model.traverse(node=>{
      if(node.name)positions[node.name]=node.getWorldPosition(new THREE.Vector3()).toArray();
      if(!node.isMesh)return;
      const geometry=node.geometry.clone().applyMatrix4(node.matrixWorld),position=geometry.attributes.position,normal=geometry.attributes.normal;
      const vertices=[],normals=[];
      for(let i=0;i<position.count;i++){vertices.push([position.getX(i),position.getY(i),position.getZ(i)]);if(normal)normals.push([normal.getX(i),normal.getY(i),normal.getZ(i)]);}
      meshes.push({name:node.name||node.uuid,vertices,normals,indices:geometry.index?Array.from(geometry.index.array):Array.from({length:position.count},(_,i)=>i)});
      geometry.dispose();
    });
    return {meshes,positions};
  });
  await writeFile(resolve(`docs/design/three/${prefix}-meshes.json`),JSON.stringify({meshes:measured.meshes}));
  await writeFile(resolve(`docs/design/three/${prefix}-positions.json`),JSON.stringify(measured.positions,null,2));
  await page.goto("http://127.0.0.1:4177/?stripped=1");
  await page.waitForFunction(()=>window.reviewReady===true);
  await page.screenshot({path:resolve(`docs/design/three/${prefix}-stripped.png`)});
  console.log(JSON.stringify({prefix,meshes:measured.meshes.length,vertices:measured.meshes.reduce((sum,m)=>sum+m.vertices.length,0),captures:6}));
}finally{await browser.close();}
