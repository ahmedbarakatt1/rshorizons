import * as THREE from "three";
import {createConceptualUnderwaterCameraModel} from "./createCameraModel";
export interface CameraIslandController {pause(value:boolean):void;visible(value:boolean):void;dispose():void}
/** Feature flag remains false while img2threejs gates are incomplete. */
export function mountCameraIsland(container:HTMLElement,onFailure:()=>void):CameraIslandController{
  const canvas=document.createElement("canvas");
  const context=canvas.getContext("webgl2",{alpha:true,antialias:true});
  if(!context)throw new Error("WEBGL_UNAVAILABLE");
  const renderer=new THREE.WebGLRenderer({canvas,context,alpha:true,antialias:true,powerPreference:"low-power"});
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(35,1,.1,40);
  camera.position.set(1.2,.7,5.8);camera.lookAt(0,.1,0);
  scene.add(new THREE.HemisphereLight(0xfff6e6,0x3a5466,2));
  const key=new THREE.DirectionalLight(0xffffff,4);key.position.set(-3,4,5);scene.add(key);
  const model=createConceptualUnderwaterCameraModel({textureSize:128,castShadow:false,receiveShadow:false});scene.add(model);
  container.append(canvas);canvas.style.width="100%";canvas.style.height="100%";
  let paused=false,visible=true,disposed=false,frame=0,last=0;
  const draw=(time:number)=>{
    frame=0;if(disposed||paused||!visible||document.hidden)return;
    if(time-last>=1000/24){model.rotation.y=Math.sin(time/6000)*.11;renderer.render(scene,camera);last=time;}
    frame=requestAnimationFrame(draw);
  };
  const start=()=>{if(!disposed&&!paused&&visible&&!document.hidden&&!frame)frame=requestAnimationFrame(draw);};
  const stop=()=>{cancelAnimationFrame(frame);frame=0;};
  const resize=new ResizeObserver(()=>{const {width,height}=container.getBoundingClientRect();if(!width||!height)return;renderer.setSize(Math.min(width,900),Math.min(height,600),false);camera.aspect=width/height;camera.updateProjectionMatrix();renderer.render(scene,camera);});resize.observe(container);
  const visibility=()=>document.hidden?stop():start();
  const lost=(event:Event)=>{event.preventDefault();dispose();onFailure();};
  const dispose=()=>{
    if(disposed)return;disposed=true;stop();resize.disconnect();document.removeEventListener("visibilitychange",visibility);canvas.removeEventListener("webglcontextlost",lost);
    const geometries=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>(),textures=new Set<THREE.Texture>();
    model.traverse(object=>{if(object instanceof THREE.Mesh){geometries.add(object.geometry);for(const material of [object.material].flat()){materials.add(material);for(const value of Object.values(material))if(value instanceof THREE.Texture)textures.add(value);}}});
    for(const t of textures)t.dispose();for(const g of geometries)g.dispose();for(const m of materials)m.dispose();renderer.dispose();renderer.forceContextLoss();canvas.remove();
  };
  canvas.addEventListener("webglcontextlost",lost);document.addEventListener("visibilitychange",visibility);start();
  return {pause(value){paused=value;if(value)stop();else start();},visible(value){visible=value;if(value)start();else stop();},dispose};
}
