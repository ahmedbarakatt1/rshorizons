// Reapply hand refinements specified in camera-sculpt-spec.json after each locked build.
// The installed generic factory ignores geometryDescriptor.edgeTreatment on box primitives.
import {readFile,writeFile} from "node:fs/promises";
const path="src/modules/photography/three/createCameraModel.ts";
let source=await readFile(path,"utf8");
if(!source.includes("import { RoundedBoxGeometry }"))source=source.replace("import * as THREE from 'three';","import * as THREE from 'three';\nimport { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';");
source=source.replaceAll("new THREE.BoxGeometry(1, 1, 1, 1, 1, 1)","new RoundedBoxGeometry(1, 1, 1, 3, 0.08)");
source=source.replaceAll("new THREE.CylinderGeometry(0.5, 0.5, 1, 10, 4)","new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 1)");
source=source.replaceAll("new THREE.SphereGeometry(0.5, 16, 10)","new THREE.SphereGeometry(0.5, 48, 24)");
source=source.replaceAll("new THREE.TorusGeometry(0.45, 0.08, 8, 16)","new THREE.TorusGeometry(0.48, 0.022, 8, 64)");
source=source.replace("type SculptMaterialSpec = Record<string, any>;",`type SculptMaterialSpec = Record<string, unknown> & {
  colorVariation?: Record<string,unknown> & {palette?: unknown[];amplitude?: number;variation?: number;heightCorrelation?: number};
  albedo?: Record<string,unknown> & {dominant?: string;secondary?: unknown[]};
  colorGradient?: ColorGradientSpec;
  textureProjection?: Record<string,unknown> & {repeat?: number[];anisotropy?: number};
  referencePbr?: Record<string,unknown> & {usable?: boolean;confidence?: number;estimatedFidelity?: number;targetThreshold?: number;maps?: Record<string,unknown>};
  materialReference?: Record<string,unknown> & {profileId?: string};
  textureResolution?: number;
};`);
await writeFile(path,source);
