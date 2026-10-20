import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export type ProceduralModelOptions = {
  wireframe?: boolean;
  castShadow?: boolean;
  receiveShadow?: boolean;
  textureSize?: number;
  textureAnisotropy?: number;
  qualityPriority?: 'reference-fidelity' | 'balanced';
};

export type ProceduralModelRuntime = {
  nodes: Record<string, THREE.Object3D>;
  meshes: Record<string, THREE.Mesh>;
  sockets: Record<string, THREE.Object3D>;
  colliders: Record<string, unknown>;
  destructionGroups: Record<string, THREE.Object3D[]>;
};

type SculptMaterialSpec = Record<string, unknown> & {
  colorVariation?: Record<string,unknown> & {palette?: unknown[];amplitude?: number;variation?: number;heightCorrelation?: number};
  albedo?: Record<string,unknown> & {dominant?: string;secondary?: unknown[]};
  colorGradient?: ColorGradientSpec;
  textureProjection?: Record<string,unknown> & {repeat?: number[];anisotropy?: number};
  referencePbr?: Record<string,unknown> & {usable?: boolean;confidence?: number;estimatedFidelity?: number;targetThreshold?: number;maps?: Record<string,unknown>};
  materialReference?: Record<string,unknown> & {profileId?: string};
  textureResolution?: number;
};

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function readLayerNumber(value: unknown, keys: string[], fallback: number): number {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of keys) {
      if (typeof record[key] === 'number') return record[key] as number;
    }
  }
  return fallback;
}

function hexToRgb(hex: string): [number, number, number] {
  const normalized = /^#[0-9a-f]{3}$/i.test(hex)
    ? '#' + hex.slice(1).split('').map((part) => part + part).join('')
    : hex;
  const value = /^#[0-9a-f]{6}$/i.test(normalized) ? Number.parseInt(normalized.slice(1), 16) : 0x8a7a5f;
  return [clampAlbedoChannel((value >> 16) & 255), clampAlbedoChannel((value >> 8) & 255), clampAlbedoChannel(value & 255)];
}

function materialPalette(spec: SculptMaterialSpec): string[] {
  const palette = spec.colorVariation?.palette;
  if (Array.isArray(palette) && palette.length > 0) return palette.filter((value) => typeof value === 'string');
  const secondary = spec.albedo?.secondary;
  const colors = [spec.baseColor ?? spec.color ?? spec.albedo?.dominant, ...(Array.isArray(secondary) ? secondary : [])];
  return colors.filter((value): value is string => typeof value === 'string' && value.startsWith('#'));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clampAlbedoChannel(value: number): number {
  return Math.max(30, Math.min(240, Math.round(value)));
}

function clampPbrF0(value: number): number {
  return Math.max(0.02, Math.min(1, value));
}

function clampPbrIor(value: number): number {
  return Math.max(1, Math.min(2.5, value));
}

function clampPbrMetalness(value: number): number {
  return value >= 0.5 ? 1 : 0;
}

function clampedAlbedoColor(spec: SculptMaterialSpec): THREE.Color {
  const source = typeof spec.baseColor === 'string' ? spec.baseColor : '#8A7A5F';
  // setStyle with an explicit SRGBColorSpace, NOT the numeric constructor.
  //
  // `new THREE.Color(r, g, b)` treats its arguments as LINEAR working-space components,
  // while an authored `baseColor` hex is sRGB. Feeding one to the other skipped the
  // transfer function and lifted every dark albedo: #2e2a28, authored as a near-black
  // vinyl, rendered at roughly sRGB 0.46 — a mid grey. The error is largest exactly where
  // it matters most, because the transfer curve is steepest near black.
  return new THREE.Color().setStyle(source, THREE.SRGBColorSpace);
}

function smoothCurve(value: number): number {
  return value * value * (3 - 2 * value);
}

function periodicHash(x: number, y: number, seed: number, periodX: number, periodY: number): number {
  const wrappedX = ((x % periodX) + periodX) % periodX;
  const wrappedY = ((y % periodY) + periodY) % periodY;
  let value = Math.imul(wrappedX + seed * 17, 374761393) ^ Math.imul(wrappedY + seed * 31, 668265263);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function periodicValueNoise(u: number, v: number, seed: number, periodX: number, periodY: number): number {
  const x = u * periodX;
  const y = v * periodY;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smoothCurve(x - x0);
  const ty = smoothCurve(y - y0);
  const a = periodicHash(x0, y0, seed, periodX, periodY);
  const b = periodicHash(x0 + 1, y0, seed, periodX, periodY);
  const c = periodicHash(x0, y0 + 1, seed, periodX, periodY);
  const d = periodicHash(x0 + 1, y0 + 1, seed, periodX, periodY);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(a, b, tx), THREE.MathUtils.lerp(c, d, tx), ty);
}

type SurfaceBand = {
  frequency: number;
  amplitude: number;
  stretchX: number;
  stretchY: number;
  ridge: boolean;
};

function surfaceBands(spec: SculptMaterialSpec): SurfaceBand[] {
  const source = Array.isArray(spec.surfaceFrequencyBands) ? spec.surfaceFrequencyBands : [];
  const parsed = source.flatMap((item: unknown) => {
    if (!item || typeof item !== 'object') return [];
    const band = item as Record<string, unknown>;
    const frequency = typeof band.frequency === 'number' ? band.frequency : 0;
    const amplitude = typeof band.amplitude === 'number' ? band.amplitude : 0;
    if (frequency <= 0 || amplitude <= 0) return [];
    const stretch = Array.isArray(band.stretch) ? band.stretch : [1, 1];
    const description = `${String(band.pattern ?? '')} ${String(band.role ?? '')}`.toLowerCase();
    return [{
      frequency,
      amplitude,
      stretchX: typeof stretch[0] === 'number' ? Math.max(0.1, stretch[0]) : 1,
      stretchY: typeof stretch[1] === 'number' ? Math.max(0.1, stretch[1]) : 1,
      ridge: /(ridge|groove|grain|fiber|striated|crack)/.test(description),
    }];
  });
  return parsed.length > 0 ? parsed : [
    { frequency: 2, amplitude: 0.42, stretchX: 1, stretchY: 1, ridge: false },
    { frequency: 12, amplitude: 0.22, stretchX: 1, stretchY: 1, ridge: false },
    { frequency: 56, amplitude: 0.08, stretchX: 1, stretchY: 1, ridge: false },
  ];
}

function sampleSurface(u: number, v: number, bands: SurfaceBand[], seed: number): number {
  let value = 0;
  let weight = 0;
  for (let index = 0; index < bands.length; index += 1) {
    const band = bands[index];
    const periodX = Math.max(1, Math.round(band.frequency * band.stretchX));
    const periodY = Math.max(1, Math.round(band.frequency * band.stretchY));
    let sample = periodicValueNoise(u, v, seed + index * 1013, periodX, periodY);
    if (band.ridge) sample = 1 - Math.abs(sample * 2 - 1);
    value += sample * band.amplitude;
    weight += band.amplitude;
  }
  return weight > 0 ? clamp01(value / weight) : 0.5;
}

function mixPalette(colors: [number, number, number][], value: number): [number, number, number] {
  if (colors.length === 1) return colors[0];
  const scaled = clamp01(value) * (colors.length - 1);
  const index = Math.min(colors.length - 2, Math.floor(scaled));
  const mix = scaled - index;
  const a = colors[index];
  const b = colors[index + 1];
  return [
    Math.round(THREE.MathUtils.lerp(a[0], b[0], mix)),
    Math.round(THREE.MathUtils.lerp(a[1], b[1], mix)),
    Math.round(THREE.MathUtils.lerp(a[2], b[2], mix)),
  ];
}

type ColorGradientStop = { offset: number; color: string };
type ColorGradientSpec = {
  type: 'linear' | 'radial';
  axis: [number, number];
  stops: ColorGradientStop[];
};

function parseRgba(value: string): [number, number, number] {
  const match = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(value);
  if (!match) return [138, 122, 95];
  return [clampAlbedoChannel(Number(match[1])), clampAlbedoChannel(Number(match[2])), clampAlbedoChannel(Number(match[3]))];
}

// Analytical per-pixel gradient sample. The extraction schema's colorGradient carries
// exact rgba(...) stop colors (see extract_part_color_recipe.py), so this samples the
// same trend directly in JS math rather than round-tripping through a Canvas 2D
// createLinearGradient/createRadialGradient object — same visual result, and it composes
// directly with the existing noise/height-correlated colorVariation blend below.
function sampleColorGradient(gradient: ColorGradientSpec, u: number, v: number): [number, number, number] {
  const stops = gradient.stops.length >= 2 ? gradient.stops : [{ offset: 0, color: 'rgba(138,122,95,1)' }, { offset: 1, color: 'rgba(138,122,95,1)' }];
  let t: number;
  if (gradient.type === 'radial') {
    const [cx, cy] = gradient.axis;
    const dx = u - cx;
    const dy = v - cy;
    const maxRadius = Math.max(0.001, Math.hypot(Math.max(cx, 1 - cx), Math.max(cy, 1 - cy)));
    t = clamp01(Math.hypot(dx, dy) / maxRadius);
  } else {
    const [ax, ay] = gradient.axis;
    const projection = (u - 0.5) * ax + (v - 0.5) * ay;
    const maxProjection = 0.5 * (Math.abs(ax) + Math.abs(ay)) || 0.5;
    t = clamp01(projection / maxProjection + 0.5);
  }
  const scaled = t * (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.max(0, Math.floor(scaled)));
  const mix = scaled - index;
  const a = parseRgba(stops[index].color);
  const b = parseRgba(stops[index + 1].color);
  return [
    THREE.MathUtils.lerp(a[0], b[0], mix),
    THREE.MathUtils.lerp(a[1], b[1], mix),
    THREE.MathUtils.lerp(a[2], b[2], mix),
  ];
}

function writePixel(data: Uint8ClampedArray, offset: number, red: number, green: number, blue: number): void {
  data[offset] = Math.max(0, Math.min(255, Math.round(red)));
  data[offset + 1] = Math.max(0, Math.min(255, Math.round(green)));
  data[offset + 2] = Math.max(0, Math.min(255, Math.round(blue)));
  data[offset + 3] = 255;
}

function makeCanvas(size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

function createMapTexture(
  canvas: HTMLCanvasElement,
  colorSpace: THREE.ColorSpace,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  const projection = spec.textureProjection && typeof spec.textureProjection === 'object' ? spec.textureProjection : {};
  const repeat = Array.isArray(projection.repeat) ? projection.repeat : [2, 2];
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(
    typeof repeat[0] === 'number' ? repeat[0] : 2,
    typeof repeat[1] === 'number' ? repeat[1] : 2,
  );
  texture.anisotropy = Math.max(1, Math.round(options.textureAnisotropy ?? projection.anisotropy ?? 8));
  texture.needsUpdate = true;
  return texture;
}

type ProceduralTextureSet = {
  albedo: THREE.Texture;
  roughness: THREE.Texture;
  height: THREE.Texture;
  normal: THREE.Texture;
  ao: THREE.Texture;
  source: 'reference-pixel-extraction' | 'procedural';
};

function referenceMapUrl(spec: SculptMaterialSpec, channel: string): string | null {
  const reference = spec.referencePbr;
  if (!reference || typeof reference !== 'object') return null;
  if (reference.usable === false) return null;
  const confidence = typeof reference.confidence === 'number'
    ? reference.confidence
    : (typeof reference.estimatedFidelity === 'number' ? reference.estimatedFidelity : 0);
  const threshold = typeof reference.targetThreshold === 'number' ? reference.targetThreshold : 0.7;
  if (confidence < threshold) return null;
  const maps = reference.maps;
  if (!maps || typeof maps !== 'object') return null;
  const map = (maps as Record<string, unknown>)[channel];
  if (!map || typeof map !== 'object') return null;
  const record = map as Record<string, unknown>;
  const url = typeof record.url === 'string' && record.url.trim() ? record.url : record.path;
  return typeof url === 'string' && url.trim() ? url : null;
}

function createLoadedMapTexture(
  url: string,
  colorSpace: THREE.ColorSpace,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): THREE.Texture {
  const texture = new THREE.TextureLoader().load(url);
  const projection = spec.textureProjection && typeof spec.textureProjection === 'object' ? spec.textureProjection : {};
  const repeat = Array.isArray(projection.repeat) ? projection.repeat : [1, 1];
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(
    typeof repeat[0] === 'number' ? repeat[0] : 1,
    typeof repeat[1] === 'number' ? repeat[1] : 1,
  );
  texture.anisotropy = Math.max(1, Math.round(options.textureAnisotropy ?? projection.anisotropy ?? 8));
  texture.needsUpdate = true;
  return texture;
}

function makeReferenceTextureSet(spec: SculptMaterialSpec, options: ProceduralModelOptions): ProceduralTextureSet | null {
  const albedo = referenceMapUrl(spec, 'albedo');
  const roughness = referenceMapUrl(spec, 'roughness');
  const height = referenceMapUrl(spec, 'height');
  const normal = referenceMapUrl(spec, 'normal');
  const ao = referenceMapUrl(spec, 'ao');
  if (!albedo || !roughness || !height || !normal || !ao) return null;
  return {
    albedo: createLoadedMapTexture(albedo, THREE.SRGBColorSpace, spec, options),
    roughness: createLoadedMapTexture(roughness, THREE.NoColorSpace, spec, options),
    height: createLoadedMapTexture(height, THREE.NoColorSpace, spec, options),
    normal: createLoadedMapTexture(normal, THREE.NoColorSpace, spec, options),
    ao: createLoadedMapTexture(ao, THREE.NoColorSpace, spec, options),
    source: 'reference-pixel-extraction',
  };
}

function makeProceduralTextureSet(
  id: string,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): ProceduralTextureSet | null {
  if (typeof document === 'undefined') return null;
  const qualityFirst = (options.qualityPriority ?? 'reference-fidelity') === 'reference-fidelity';
  const requested = options.textureSize ?? spec.textureResolution;
  const requestedSize = typeof requested === 'number' && Number.isFinite(requested)
    ? requested
    : (qualityFirst ? 1024 : 512);
  const size = Math.max(256, Math.min(2048, 2 ** Math.round(Math.log2(requestedSize))));
  const canvases = {
    albedo: makeCanvas(size),
    roughness: makeCanvas(size),
    height: makeCanvas(size),
    normal: makeCanvas(size),
    ao: makeCanvas(size),
  };
  const contexts = {
    albedo: canvases.albedo.getContext('2d'),
    roughness: canvases.roughness.getContext('2d'),
    height: canvases.height.getContext('2d'),
    normal: canvases.normal.getContext('2d'),
    ao: canvases.ao.getContext('2d'),
  };
  if (!contexts.albedo || !contexts.roughness || !contexts.height || !contexts.normal || !contexts.ao) return null;
  const images = {
    albedo: contexts.albedo.createImageData(size, size),
    roughness: contexts.roughness.createImageData(size, size),
    height: contexts.height.createImageData(size, size),
    normal: contexts.normal.createImageData(size, size),
    ao: contexts.ao.createImageData(size, size),
  };
  const seed = hashString(id);
  const bands = surfaceBands(spec);
  const heightField = new Float32Array(size * size);
  const roughnessField = new Float32Array(size * size);
  const palette = materialPalette(spec);
  const fallback = typeof spec.baseColor === 'string' ? spec.baseColor : '#8A7A5F';
  const colors = (palette.length >= 2 ? palette : [fallback, '#6E614B', '#A08F70']).map(hexToRgb);
  const baseRoughness = clamp01(readLayerNumber(spec.roughness, ['base'], 0.76));
  const roughnessVariation = clamp01(readLayerNumber(spec.roughness, ['variation'], 0.18));
  const colorAmplitude = clamp01(readLayerNumber(spec.colorVariation, ['amplitude', 'variation'], 0.18));
  const heightCorrelation = clamp01(readLayerNumber(spec.colorVariation, ['heightCorrelation'], 0.3));
  const colorGradient: ColorGradientSpec | undefined = spec.colorGradient;
  for (let y = 0; y < size; y += 1) {
    const v = y / size;
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const index = y * size + x;
      const height = sampleSurface(u, v, bands, seed + 101);
      const roughNoise = sampleSurface(u, v, bands, seed + 7001);
      const colorNoise = sampleSurface(u, v, bands, seed + 15013);
      heightField[index] = height;
      roughnessField[index] = clamp01(baseRoughness + (roughNoise - 0.5) * roughnessVariation * 2);
      let color: [number, number, number];
      if (colorGradient) {
        // Evidence-derived spatial gradient (Plan 1.3 Workstream C) takes priority
        // over the noise-based palette blend below — it is a measured trend, not a guess.
        color = sampleColorGradient(colorGradient, u, v);
      } else {
        const paletteValue = clamp01(
          0.5 + (colorNoise - 0.5) * colorAmplitude * 2 + (height - 0.5) * heightCorrelation
        );
        color = mixPalette(colors, paletteValue);
      }
      writePixel(images.albedo.data, index * 4, color[0], color[1], color[2]);
    }
  }
  const normalStrength = Math.max(0.05, readLayerNumber(spec.normal, ['strength', 'amplitude'], 0.35));
  const aoStrength = clamp01(readLayerNumber(spec.ambientOcclusion, ['cavityStrength', 'strength'], 0.35));
  for (let y = 0; y < size; y += 1) {
    const up = ((y - 1 + size) % size) * size;
    const down = ((y + 1) % size) * size;
    for (let x = 0; x < size; x += 1) {
      const left = (x - 1 + size) % size;
      const right = (x + 1) % size;
      const index = y * size + x;
      const center = heightField[index];
      const dx = (heightField[y * size + right] - heightField[y * size + left]) * normalStrength * 6;
      const dy = (heightField[down + x] - heightField[up + x]) * normalStrength * 6;
      const inverseLength = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const normalX = -dx * inverseLength;
      const normalY = -dy * inverseLength;
      const normalZ = inverseLength;
      const neighborAverage = (
        heightField[y * size + left] + heightField[y * size + right]
        + heightField[up + x] + heightField[down + x]
      ) * 0.25;
      const cavity = Math.max(0, neighborAverage - center);
      const ao = clamp01(1 - aoStrength * (cavity * 12 + (1 - center) * 0.16));
      const offset = index * 4;
      const heightByte = center * 255;
      const roughnessByte = roughnessField[index] * 255;
      writePixel(images.height.data, offset, heightByte, heightByte, heightByte);
      writePixel(images.roughness.data, offset, roughnessByte, roughnessByte, roughnessByte);
      writePixel(
        images.normal.data, offset,
        (normalX * 0.5 + 0.5) * 255,
        (normalY * 0.5 + 0.5) * 255,
        (normalZ * 0.5 + 0.5) * 255,
      );
      writePixel(images.ao.data, offset, ao * 255, ao * 255, ao * 255);
    }
  }
  contexts.albedo.putImageData(images.albedo, 0, 0);
  contexts.roughness.putImageData(images.roughness, 0, 0);
  contexts.height.putImageData(images.height, 0, 0);
  contexts.normal.putImageData(images.normal, 0, 0);
  contexts.ao.putImageData(images.ao, 0, 0);
  return {
    albedo: createMapTexture(canvases.albedo, THREE.SRGBColorSpace, spec, options),
    roughness: createMapTexture(canvases.roughness, THREE.NoColorSpace, spec, options),
    height: createMapTexture(canvases.height, THREE.NoColorSpace, spec, options),
    normal: createMapTexture(canvases.normal, THREE.NoColorSpace, spec, options),
    ao: createMapTexture(canvases.ao, THREE.NoColorSpace, spec, options),
    source: 'procedural',
  };
}

function createSculptMaterial(id: string, spec: SculptMaterialSpec, options: ProceduralModelOptions, denseComponent = false): THREE.MeshPhysicalMaterial {
  // A material that declares -- with evidence -- that its subject carries no texture
  // detail gets NO texture set. Synthesising one anyway is not a harmless default: the
  // branch below then forces color to white and roughness to 1 and reads both from the
  // generated maps, so the authored albedo and the reference-derived roughness are both
  // discarded, and the model gains mottling the reference does not have. Measured on the
  // tuxedo cat, whose black fur rendered as speckled grey-and-white from a palette that
  // only ever described two flat regions.
  const textureless = (spec.textureless as { declared?: boolean } | undefined)?.declared === true;
  const textures = textureless
    ? null
    : makeReferenceTextureSet(spec, options) ?? makeProceduralTextureSet(id, spec, options);
  const material = new THREE.MeshPhysicalMaterial({
    color: textures ? 0xffffff : clampedAlbedoColor(spec),
    roughness: textures ? 1 : clamp01(readLayerNumber(spec.roughness, ['base'], 0.76)),
    metalness: clampPbrMetalness(readLayerNumber(spec.metalness, ['base'], 0.0)),
    clearcoat: clamp01(readLayerNumber(spec.clearcoat, ['base', 'amount'], 0)),
    clearcoatRoughness: clamp01(readLayerNumber(spec.clearcoatRoughness, ['base'], 0.25)),
    transmission: clamp01(readLayerNumber(spec.transmission, ['base', 'amount'], 0)),
    ior: clampPbrIor(readLayerNumber(spec.ior, ['base', 'value'], 1.5)),
    thickness: Math.max(0, readLayerNumber(spec.thickness, ['base', 'amount'], 0)),
    attenuationDistance: Math.max(0.001, readLayerNumber(spec.attenuationDistance, ['base', 'value'], Infinity)),
    attenuationColor: new THREE.Color(typeof spec.attenuationColor === 'string' ? spec.attenuationColor : '#ffffff'),
    sheen: clamp01(readLayerNumber(spec.sheen, ['base', 'amount'], 0)),
    sheenColor: new THREE.Color(typeof spec.sheenColor === 'string' ? spec.sheenColor : '#ffffff'),
    sheenRoughness: clamp01(readLayerNumber(spec.sheenRoughness, ['base'], 1.0)),
    iridescence: clamp01(readLayerNumber(spec.iridescence, ['base', 'amount'], 0)),
    iridescenceIOR: clampPbrIor(readLayerNumber(spec.iridescenceIOR, ['base', 'value'], 1.3)),
    anisotropy: clamp01(readLayerNumber(spec.anisotropy, ['base', 'amount'], 0)),
    anisotropyRotation: readLayerNumber(spec.anisotropy, ['rotation'], 0),
    specularIntensity: clampPbrF0(readLayerNumber(spec.specularF0 ?? spec.f0 ?? spec.specularIntensity, ['base', 'value'], 1.0)),
    specularColor: new THREE.Color(typeof spec.specularColor === 'string' ? spec.specularColor : '#ffffff'),
    emissive: new THREE.Color(typeof spec.emissive === 'string' ? spec.emissive : '#000000'),
    emissiveIntensity: Math.max(0, readLayerNumber(spec.emissiveIntensity, ['base'], 1.0)),
    opacity: clamp01(readLayerNumber(spec.opacity, ['base'], 1)),
    transparent: readLayerNumber(spec.transmission, ['base', 'amount'], 0) > 0 || readLayerNumber(spec.opacity, ['base'], 1) < 1,
    alphaTest: Math.max(0, readLayerNumber(spec.alpha, ['cutoff', 'alphaTest'], 0)),
    wireframe: options.wireframe ?? false,
    side: spec.doubleSided === true ? THREE.DoubleSide : THREE.FrontSide,
    flatShading: spec.flatShading === true,
  });
  if (textures) {
    material.map = textures.albedo;
    material.roughnessMap = textures.roughness;
    material.normalMap = textures.normal;
    material.normalScale.setScalar(Math.max(0.05, readLayerNumber(spec.normal, ['strength', 'amplitude'], 0.35)));
    material.aoMap = textures.ao;
    material.aoMap.channel = 0;
    material.aoMapIntensity = readLayerNumber(spec.ambientOcclusion, ['cavityStrength', 'strength'], 0.35);
    const denseMesh = denseComponent || spec.denseMesh === true || spec.geometryDensity === 'dense' || spec.topologyClass === 'dense';
    const bumpScale = Math.max(0, readLayerNumber(spec.bump, ['amplitude', 'strength'], 0));
    const effectiveBumpScale = denseMesh ? Math.max(0.05, bumpScale) : bumpScale;
    if (effectiveBumpScale > 0) {
      material.bumpMap = textures.height;
      material.bumpScale = effectiveBumpScale;
    }
    const displacementScale = Math.max(0, readLayerNumber(spec.displacement, ['amplitude', 'strength'], 0));
    const effectiveDisplacementScale = denseMesh ? Math.max(0.005, displacementScale) : displacementScale;
    if (effectiveDisplacementScale > 0) {
      material.displacementMap = textures.height;
      material.displacementScale = effectiveDisplacementScale;
      material.displacementBias = -effectiveDisplacementScale * 0.5;
    }
  }
  material.envMapIntensity = readLayerNumber(spec, ['envMapIntensity'], 0.8);
  material.userData.sculptMaterial = spec;
  material.userData.proceduralMapsIndependent = true;
  material.userData.pbrConstraints = { albedoRange: [30, 240], binaryMetalness: true, f0Range: [0.02, 1], iorRange: [1, 2.5] };
  material.userData.pbrTextureSource = textures?.source ?? 'flat-fallback';
  material.userData.referencePbr = spec.referencePbr ?? null;
  material.userData.referenceMaterialId = spec.referenceMaterialId ?? spec.materialReference?.profileId ?? null;
  material.userData.materialEvidence = spec.materialEvidence ?? null;
  material.userData.validationViews = spec.materialReference?.validationViews ?? [];
  material.needsUpdate = true;
  return material;
}

type AttachmentEndpoint = {
  start: THREE.Vector3;
  midpoint: THREE.Vector3;
  quaternion: THREE.Quaternion;
  length: number;
  baseRadius: number;
  endRadius: number;
};

function readVector3(value: unknown, fallback: [number, number, number]): THREE.Vector3 {
  if (Array.isArray(value) && value.length === 3 && value.every((item) => typeof item === 'number')) {
    return new THREE.Vector3(value[0], value[1], value[2]);
  }
  return new THREE.Vector3(fallback[0], fallback[1], fallback[2]);
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function makeAttachmentEndpoint(attachment: unknown): AttachmentEndpoint | null {
  if (!attachment || typeof attachment !== 'object') return null;
  const record = attachment as Record<string, unknown>;
  const start = readVector3(record.localStart, [0, 0, 0]);
  const end = readVector3(record.localEnd, [0, 1, 0]);
  const delta = end.clone().sub(start);
  const length = delta.length();
  if (length <= 0.0001) return null;
  const direction = delta.clone().normalize();
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
  const baseRadius = Math.max(0.005, readNumber(record.baseRadius, 0.06));
  const endRadius = Math.max(0.003, readNumber(record.endRadius, baseRadius * 0.55));
  return {
    start,
    midpoint: delta.multiplyScalar(0.5),
    quaternion,
    length,
    baseRadius,
    endRadius,
  };
}

// Generated from ObjectSculptSpec target: Conceptual underwater camera
// Sculpt build pass: form-refinement
// This factory is intentionally pass-gated. Finish browser screenshot review before unlocking deeper passes.
export function createConceptualUnderwaterCameraModel(options: ProceduralModelOptions = {}): THREE.Group {
  const root = new THREE.Group();
  root.name = "Conceptual underwater camera";
  root.userData.reconstructionEvidence = {"itemFamily": null, "subtype": null, "componentAdapter": null, "route": null, "exactnessTier": null, "referenceCamera": {"solved": false, "fovDegrees": 35, "aspect": 1.5, "orientation": {"yaw": 0.22, "pitch": 0.08, "roll": 0}, "positionHint": [2, 1.3, 6], "note": "For likeness work, solve the reference camera (forge/stage1_intake/solve_camera_pose.py) so the review render aligns with the photo and the reference can be projected. Confirm by overlay review."}, "approximationNotes": []};
  root.userData.materialPipeline = {};
  root.userData.materialReferenceRegistry = null;

  const materialMap: Record<string, THREE.Material> = {};
  materialMap["housing"] = createSculptMaterial(
    "housing",
    {"id": "housing", "name": "housing", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#183047", "color": "#183047", "albedo": {"dominant": "#183047", "secondary": ["#183047"], "samplingNotes": "Observed solid-color concept; exclude cast highlights."}, "colorVariation": {"palette": ["#183047"], "pattern": "fine-grain", "amplitude": 0.015, "heightCorrelation": 0.3}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.42, "role": "broad color and height breakup"}, {"id": "meso", "frequency": 12.0, "amplitude": 0.22, "role": "ridges, pores, grain, dents, or equivalent visible relief"}, {"id": "micro", "frequency": 56.0, "amplitude": 0.08, "role": "highlight breakup visible under grazing light"}], "roughness": {"base": 0.65, "variation": 0.04, "map": "independent-procedural-field", "localResponse": "higher roughness in cavities, lower roughness on worn edges"}, "metalness": {"base": 0, "variation": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.025, "scale": 65, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "housing-edge", "region": "outer bevel", "roughness": 0.5700000000000001, "notes": "Edge reflection has lower roughness than recessed material."}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Visual inference from conceptual reference. No exact inverse-rendering claim.", "referencePbr": {"version": "1.0", "sourceImage": "D:\\Tourism\\docs\\design\\three\\material-crops\\housing.png", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence, not photogrammetry", "usable": true, "verdict": "pass", "confidence": 0.751, "targetThreshold": 0.7, "maps": {"albedo": {"path": "D:\\Tourism\\docs\\design\\three\\material-evidence\\housing\\housing_albedo.png", "url": "housing_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "D:\\Tourism\\docs\\design\\three\\material-evidence\\housing\\housing_roughness.png", "url": "housing_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "D:\\Tourism\\docs\\design\\three\\material-evidence\\housing\\housing_height.png", "url": "housing_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "D:\\Tourism\\docs\\design\\three\\material-evidence\\housing\\housing_normal.png", "url": "housing_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "D:\\Tourism\\docs\\design\\three\\material-evidence\\housing\\housing_ao.png", "url": "housing_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}, "warnings": ["image is not clearly isolated from background; using most pixels as material evidence", "object/background separation is weak", "single-image inverse rendering cannot prove true physical PBR; confidence is capped", "low value range weakens height/roughness inference"]}},
    options
  );
  materialMap["turquoise"] = createSculptMaterial(
    "turquoise",
    {"id": "turquoise", "name": "turquoise", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#21aebb", "color": "#21aebb", "albedo": {"dominant": "#21aebb", "secondary": ["#21aebb"], "samplingNotes": "Observed solid-color concept; exclude cast highlights."}, "colorVariation": {"palette": ["#21aebb"], "pattern": "fine-grain", "amplitude": 0.015, "heightCorrelation": 0.3}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.42, "role": "broad color and height breakup"}, {"id": "meso", "frequency": 12.0, "amplitude": 0.22, "role": "ridges, pores, grain, dents, or equivalent visible relief"}, {"id": "micro", "frequency": 56.0, "amplitude": 0.08, "role": "highlight breakup visible under grazing light"}], "roughness": {"base": 0.29, "variation": 0.04, "map": "independent-procedural-field", "localResponse": "higher roughness in cavities, lower roughness on worn edges"}, "metalness": {"base": 0.6, "variation": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.025, "scale": 65, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "turquoise-edge", "region": "outer bevel", "roughness": 0.20999999999999996, "notes": "Edge reflection has lower roughness than recessed material."}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Visual inference from conceptual reference. No exact inverse-rendering claim.", "referencePbr": {"version": "1.0", "sourceImage": "D:\\Tourism\\docs\\design\\three\\material-crops\\turquoise.png", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence, not photogrammetry", "usable": true, "verdict": "pass", "confidence": 0.755, "targetThreshold": 0.7, "maps": {"albedo": {"path": "D:\\Tourism\\docs\\design\\three\\material-evidence\\turquoise\\turquoise_albedo.png", "url": "turquoise_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "D:\\Tourism\\docs\\design\\three\\material-evidence\\turquoise\\turquoise_roughness.png", "url": "turquoise_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "D:\\Tourism\\docs\\design\\three\\material-evidence\\turquoise\\turquoise_height.png", "url": "turquoise_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "D:\\Tourism\\docs\\design\\three\\material-evidence\\turquoise\\turquoise_normal.png", "url": "turquoise_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "D:\\Tourism\\docs\\design\\three\\material-evidence\\turquoise\\turquoise_ao.png", "url": "turquoise_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}, "warnings": ["image is not clearly isolated from background; using most pixels as material evidence", "object/background separation is weak", "single-image inverse rendering cannot prove true physical PBR; confidence is capped", "low value range weakens height/roughness inference"]}},
    options
  );
  materialMap["rubber"] = createSculptMaterial(
    "rubber",
    {"id": "rubber", "name": "rubber", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#252a2b", "color": "#252a2b", "albedo": {"dominant": "#252a2b", "secondary": ["#252a2b"], "samplingNotes": "Observed solid-color concept; exclude cast highlights."}, "colorVariation": {"palette": ["#252a2b"], "pattern": "fine-grain", "amplitude": 0.015, "heightCorrelation": 0.3}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.42, "role": "broad color and height breakup"}, {"id": "meso", "frequency": 12.0, "amplitude": 0.22, "role": "ridges, pores, grain, dents, or equivalent visible relief"}, {"id": "micro", "frequency": 56.0, "amplitude": 0.08, "role": "highlight breakup visible under grazing light"}], "roughness": {"base": 0.85, "variation": 0.04, "map": "independent-procedural-field", "localResponse": "higher roughness in cavities, lower roughness on worn edges"}, "metalness": {"base": 0, "variation": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.025, "scale": 65, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "rubber-edge", "region": "outer bevel", "roughness": 0.77, "notes": "Edge reflection has lower roughness than recessed material."}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Visual inference from conceptual reference. No exact inverse-rendering claim.", "referencePbr": {"version": "1.0", "sourceImage": "D:\\Tourism\\docs\\design\\three\\material-crops\\rubber.png", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence, not photogrammetry", "usable": true, "verdict": "pass", "confidence": 0.716, "targetThreshold": 0.7, "maps": {"albedo": {"path": "D:\\Tourism\\docs\\design\\three\\material-evidence\\rubber\\rubber_albedo.png", "url": "rubber_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "D:\\Tourism\\docs\\design\\three\\material-evidence\\rubber\\rubber_roughness.png", "url": "rubber_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "D:\\Tourism\\docs\\design\\three\\material-evidence\\rubber\\rubber_height.png", "url": "rubber_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "D:\\Tourism\\docs\\design\\three\\material-evidence\\rubber\\rubber_normal.png", "url": "rubber_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "D:\\Tourism\\docs\\design\\three\\material-evidence\\rubber\\rubber_ao.png", "url": "rubber_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}, "warnings": ["foreground mask is tiny; material extraction is likely unreliable", "image is not clearly isolated from background; using most pixels as material evidence", "object/background separation is weak", "single-image inverse rendering cannot prove true physical PBR; confidence is capped", "low value range weakens height/roughness inference"]}},
    options
  );
  materialMap["glass"] = createSculptMaterial(
    "glass",
    {"id": "glass", "name": "glass", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#0d2025", "color": "#0d2025", "albedo": {"dominant": "#0d2025", "secondary": ["#0d2025"], "samplingNotes": "Observed solid-color concept; exclude cast highlights."}, "colorVariation": {"palette": ["#0d2025"], "pattern": "fine-grain", "amplitude": 0.015, "heightCorrelation": 0.3}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.42, "role": "broad color and height breakup"}, {"id": "meso", "frequency": 12.0, "amplitude": 0.22, "role": "ridges, pores, grain, dents, or equivalent visible relief"}, {"id": "micro", "frequency": 56.0, "amplitude": 0.08, "role": "highlight breakup visible under grazing light"}], "roughness": {"base": 0.09, "variation": 0.04, "map": "independent-procedural-field", "localResponse": "higher roughness in cavities, lower roughness on worn edges"}, "metalness": {"base": 0.1, "variation": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0, "scale": 65, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "glass-edge", "region": "outer bevel", "roughness": 0.02, "notes": "Edge reflection has lower roughness than recessed material."}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Visual inference from conceptual reference. No exact inverse-rendering claim.", "referencePbr": {"version": "1.0", "sourceImage": "D:\\Tourism\\docs\\design\\three\\material-crops\\glass.png", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence, not photogrammetry", "usable": true, "verdict": "pass", "confidence": 0.86, "targetThreshold": 0.7, "maps": {"albedo": {"path": "D:\\Tourism\\docs\\design\\three\\material-evidence\\glass\\glass_albedo.png", "url": "glass_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "D:\\Tourism\\docs\\design\\three\\material-evidence\\glass\\glass_roughness.png", "url": "glass_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "D:\\Tourism\\docs\\design\\three\\material-evidence\\glass\\glass_height.png", "url": "glass_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "D:\\Tourism\\docs\\design\\three\\material-evidence\\glass\\glass_normal.png", "url": "glass_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "D:\\Tourism\\docs\\design\\three\\material-evidence\\glass\\glass_ao.png", "url": "glass_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}, "warnings": ["single-image inverse rendering cannot prove true physical PBR; confidence is capped"]}},
    options
  );
  materialMap["sand"] = createSculptMaterial(
    "sand",
    {"id": "sand", "name": "sand", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#b7ab91", "color": "#b7ab91", "albedo": {"dominant": "#b7ab91", "secondary": ["#b7ab91"], "samplingNotes": "Observed solid-color concept; exclude cast highlights."}, "colorVariation": {"palette": ["#b7ab91"], "pattern": "fine-grain", "amplitude": 0.015, "heightCorrelation": 0.3}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.42, "role": "broad color and height breakup"}, {"id": "meso", "frequency": 12.0, "amplitude": 0.22, "role": "ridges, pores, grain, dents, or equivalent visible relief"}, {"id": "micro", "frequency": 56.0, "amplitude": 0.08, "role": "highlight breakup visible under grazing light"}], "roughness": {"base": 0.34, "variation": 0.04, "map": "independent-procedural-field", "localResponse": "higher roughness in cavities, lower roughness on worn edges"}, "metalness": {"base": 0.8, "variation": 0.0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.025, "scale": 65, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0.0, "scale": 1.0}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "sand-edge", "region": "outer bevel", "roughness": 0.26, "notes": "Edge reflection has lower roughness than recessed material."}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Visual inference from conceptual reference. No exact inverse-rendering claim.", "referencePbr": {"version": "1.0", "sourceImage": "D:\\Tourism\\docs\\design\\three\\material-crops\\sand.png", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence, not photogrammetry", "usable": true, "verdict": "pass", "confidence": 0.809, "targetThreshold": 0.7, "maps": {"albedo": {"path": "D:\\Tourism\\docs\\design\\three\\material-evidence\\sand\\sand_albedo.png", "url": "sand_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "D:\\Tourism\\docs\\design\\three\\material-evidence\\sand\\sand_roughness.png", "url": "sand_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "D:\\Tourism\\docs\\design\\three\\material-evidence\\sand\\sand_height.png", "url": "sand_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "D:\\Tourism\\docs\\design\\three\\material-evidence\\sand\\sand_normal.png", "url": "sand_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "D:\\Tourism\\docs\\design\\three\\material-evidence\\sand\\sand_ao.png", "url": "sand_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}, "warnings": ["image is not clearly isolated from background; using most pixels as material evidence", "object/background separation is weak", "single-image inverse rendering cannot prove true physical PBR; confidence is capped"]}},
    options
  );

  const nodes: Record<string, THREE.Object3D> = { root };
  const meshes: Record<string, THREE.Mesh> = {};
  const sockets: Record<string, THREE.Object3D> = {};
  const colliders: Record<string, unknown> = {};
  const destructionGroups: Record<string, THREE.Object3D[]> = {};

  const endpoint_root_0 = makeAttachmentEndpoint(null);
  const node_root_0 = new THREE.Group();
  node_root_0.name = "root__pivot";
  node_root_0.scale.set(1, 1, 1);
  if (endpoint_root_0) {
    node_root_0.position.copy(endpoint_root_0.start);
    node_root_0.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_root_0.position.set(0.0, 0.0, 0.0);
    node_root_0.rotation.set(0.0, 0.0, 0.0);
  }
  node_root_0.userData.sculptComponent = {"id": "root", "name": "root", "level": "macro", "role": "body", "importance": 0.9, "confidence": 0.9, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Discrete rigid manufactured part with bounded faces; primitive follows the observed silhouette.", "geometryDescriptor": {"topologyIntent": "Closed solid with visible rounded rim.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": null, "attachment": null, "dimensions": {"width": 2.6, "height": 1.7, "depth": 0.7, "units": "relative", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "housing"}}, "material": "housing", "materialLayers": ["housing"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "root-form", "type": "bevel", "description": "Reference-observed silhouette and bevel.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "fine molded grain", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Solid-color concept with subtle micro relief; not a measured finish."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structured", "colorMaterialRecipe": {"dominantAlbedo": "rgba(24,48,71,1)", "secondaryAlbedo": "rgba(24,48,71,1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "notes": "Solid-color original conceptual reference."}};
  node_root_0.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "housing"}};
  (nodes["root"] ?? root).add(node_root_0);
  nodes["root"] = node_root_0;
  const mesh_root_0Geometry = endpoint_root_0
    ? new THREE.CylinderGeometry(endpoint_root_0.endRadius, endpoint_root_0.baseRadius, endpoint_root_0.length, 8, 4)
    : new RoundedBoxGeometry(1, 1, 1, 3, 0.08);
  if (!endpoint_root_0) {
    mesh_root_0Geometry.scale(2.6, 1.7, 0.7);
  }
  const mesh_root_0 = new THREE.Mesh(
    mesh_root_0Geometry,
    materialMap["housing"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_root_0.name = "root";
  if (endpoint_root_0) {
    mesh_root_0.position.copy(endpoint_root_0.midpoint);
    mesh_root_0.quaternion.copy(endpoint_root_0.quaternion);
  }
  mesh_root_0.castShadow = options.castShadow ?? true;
  mesh_root_0.receiveShadow = options.receiveShadow ?? true;
  mesh_root_0.userData.sculptComponent = {"id": "root", "name": "root", "level": "macro", "role": "body", "importance": 0.9, "confidence": 0.9, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Discrete rigid manufactured part with bounded faces; primitive follows the observed silhouette.", "geometryDescriptor": {"topologyIntent": "Closed solid with visible rounded rim.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": null, "attachment": null, "dimensions": {"width": 2.6, "height": 1.7, "depth": 0.7, "units": "relative", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "housing"}}, "material": "housing", "materialLayers": ["housing"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "root-form", "type": "bevel", "description": "Reference-observed silhouette and bevel.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "fine molded grain", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Solid-color concept with subtle micro relief; not a measured finish."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structured", "colorMaterialRecipe": {"dominantAlbedo": "rgba(24,48,71,1)", "secondaryAlbedo": "rgba(24,48,71,1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "notes": "Solid-color original conceptual reference."}};
  node_root_0.add(mesh_root_0);
  meshes["root"] = mesh_root_0;
  colliders["root"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_root_0);

  const attachment_lens_mount_1 = {"parentId": "root", "parentSocket": "lens-mount-seat", "localStart": [0, 0, 0.4], "localEnd": [0, 0, 0.4], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_lens_mount_1 = makeAttachmentEndpoint(attachment_lens_mount_1);
  const node_lens_mount_1 = new THREE.Group();
  node_lens_mount_1.name = "lens mount__pivot";
  node_lens_mount_1.scale.set(1, 1, 1);
  if (endpoint_lens_mount_1) {
    node_lens_mount_1.position.copy(endpoint_lens_mount_1.start);
    node_lens_mount_1.rotation.set(1.57079632679, 0.0, 0.0);
  } else {
    node_lens_mount_1.position.set(0.0, 0.0, 0.4);
    node_lens_mount_1.rotation.set(1.57079632679, 0.0, 0.0);
  }
  node_lens_mount_1.userData.sculptComponent = {"id": "lens-mount", "name": "lens mount", "level": "macro", "role": "body", "importance": 0.9, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Discrete rigid manufactured part with bounded faces; primitive follows the observed silhouette.", "geometryDescriptor": {"topologyIntent": "Closed solid with visible rounded rim.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "lens-mount-seat", "localStart": [0, 0, 0.4], "localEnd": [0, 0, 0.4], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1.42, "height": 0.2, "depth": 1.42, "units": "relative", "confidence": 0.85}, "transform": {"position": [0, 0, 0.4], "rotation": [1.57079632679, 0, 0]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lens-mount", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "turquoise"}}, "material": "turquoise", "materialLayers": ["turquoise"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "lens-mount-form", "type": "bevel", "description": "Reference-observed silhouette and bevel.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "fine molded grain", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Solid-color concept with subtle micro relief; not a measured finish."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structured", "colorMaterialRecipe": {"dominantAlbedo": "rgba(33,174,187,1)", "secondaryAlbedo": "rgba(33,174,187,1)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "notes": "Solid-color original conceptual reference."}};
  node_lens_mount_1.userData.actionProfile = {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lens-mount", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "turquoise"}};
  (nodes["root"] ?? root).add(node_lens_mount_1);
  nodes["lens-mount"] = node_lens_mount_1;
  const mesh_lens_mount_1Geometry = endpoint_lens_mount_1
    ? new THREE.CylinderGeometry(endpoint_lens_mount_1.endRadius, endpoint_lens_mount_1.baseRadius, endpoint_lens_mount_1.length, 8, 4)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 1);
  if (!endpoint_lens_mount_1) {
    mesh_lens_mount_1Geometry.scale(1.42, 0.2, 1.42);
  }
  const mesh_lens_mount_1 = new THREE.Mesh(
    mesh_lens_mount_1Geometry,
    materialMap["turquoise"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_lens_mount_1.name = "lens mount";
  if (endpoint_lens_mount_1) {
    mesh_lens_mount_1.position.copy(endpoint_lens_mount_1.midpoint);
    mesh_lens_mount_1.quaternion.copy(endpoint_lens_mount_1.quaternion);
  }
  mesh_lens_mount_1.castShadow = options.castShadow ?? true;
  mesh_lens_mount_1.receiveShadow = options.receiveShadow ?? true;
  mesh_lens_mount_1.userData.sculptComponent = {"id": "lens-mount", "name": "lens mount", "level": "macro", "role": "body", "importance": 0.9, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Discrete rigid manufactured part with bounded faces; primitive follows the observed silhouette.", "geometryDescriptor": {"topologyIntent": "Closed solid with visible rounded rim.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "lens-mount-seat", "localStart": [0, 0, 0.4], "localEnd": [0, 0, 0.4], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1.42, "height": 0.2, "depth": 1.42, "units": "relative", "confidence": 0.85}, "transform": {"position": [0, 0, 0.4], "rotation": [1.57079632679, 0, 0]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lens-mount", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "turquoise"}}, "material": "turquoise", "materialLayers": ["turquoise"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "lens-mount-form", "type": "bevel", "description": "Reference-observed silhouette and bevel.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "fine molded grain", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Solid-color concept with subtle micro relief; not a measured finish."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structured", "colorMaterialRecipe": {"dominantAlbedo": "rgba(33,174,187,1)", "secondaryAlbedo": "rgba(33,174,187,1)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "notes": "Solid-color original conceptual reference."}};
  node_lens_mount_1.add(mesh_lens_mount_1);
  meshes["lens-mount"] = mesh_lens_mount_1;
  colliders["lens-mount"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."};
  destructionGroups["lens-mount"] ??= [];
  destructionGroups["lens-mount"].push(node_lens_mount_1);

  const endpoint_grip_2 = makeAttachmentEndpoint(null);
  const node_grip_2 = new THREE.Group();
  node_grip_2.name = "grip__pivot";
  node_grip_2.scale.set(1, 1, 1);
  if (endpoint_grip_2) {
    node_grip_2.position.copy(endpoint_grip_2.start);
    node_grip_2.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_grip_2.position.set(1.39, -0.02, 0.0);
    node_grip_2.rotation.set(0.0, 0.0, 0.0);
  }
  node_grip_2.userData.sculptComponent = {"id": "grip", "name": "grip", "level": "macro", "role": "body", "importance": 0.9, "confidence": 0.9, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Discrete rigid manufactured part with bounded faces; primitive follows the observed silhouette.", "geometryDescriptor": {"topologyIntent": "Closed solid with visible rounded rim.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "grip-seat", "localStart": [1.39, -0.02, 0], "localEnd": [1.39, -0.02, 0], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.42, "height": 1.25, "depth": 0.62, "units": "relative", "confidence": 0.85}, "transform": {"position": [1.39, -0.02, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "grip", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "rubber"}}, "material": "rubber", "materialLayers": ["rubber"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "grip-form", "type": "bevel", "description": "Reference-observed silhouette and bevel.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "fine molded grain", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Solid-color concept with subtle micro relief; not a measured finish."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structured", "colorMaterialRecipe": {"dominantAlbedo": "rgba(37,42,43,1)", "secondaryAlbedo": "rgba(37,42,43,1)", "materialClass": "rubber", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "notes": "Solid-color original conceptual reference."}};
  node_grip_2.userData.actionProfile = {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "grip", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "rubber"}};
  (nodes["root"] ?? root).add(node_grip_2);
  nodes["grip"] = node_grip_2;
  const mesh_grip_2Geometry = endpoint_grip_2
    ? new THREE.CylinderGeometry(endpoint_grip_2.endRadius, endpoint_grip_2.baseRadius, endpoint_grip_2.length, 8, 4)
    : new RoundedBoxGeometry(1, 1, 1, 3, 0.08);
  if (!endpoint_grip_2) {
    mesh_grip_2Geometry.scale(0.42, 1.25, 0.62);
  }
  const mesh_grip_2 = new THREE.Mesh(
    mesh_grip_2Geometry,
    materialMap["rubber"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_grip_2.name = "grip";
  if (endpoint_grip_2) {
    mesh_grip_2.position.copy(endpoint_grip_2.midpoint);
    mesh_grip_2.quaternion.copy(endpoint_grip_2.quaternion);
  }
  mesh_grip_2.castShadow = options.castShadow ?? true;
  mesh_grip_2.receiveShadow = options.receiveShadow ?? true;
  mesh_grip_2.userData.sculptComponent = {"id": "grip", "name": "grip", "level": "macro", "role": "body", "importance": 0.9, "confidence": 0.9, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Discrete rigid manufactured part with bounded faces; primitive follows the observed silhouette.", "geometryDescriptor": {"topologyIntent": "Closed solid with visible rounded rim.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "grip-seat", "localStart": [1.39, -0.02, 0], "localEnd": [1.39, -0.02, 0], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.42, "height": 1.25, "depth": 0.62, "units": "relative", "confidence": 0.85}, "transform": {"position": [1.39, -0.02, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "grip", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "rubber"}}, "material": "rubber", "materialLayers": ["rubber"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "grip-form", "type": "bevel", "description": "Reference-observed silhouette and bevel.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "fine molded grain", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Solid-color concept with subtle micro relief; not a measured finish."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structured", "colorMaterialRecipe": {"dominantAlbedo": "rgba(37,42,43,1)", "secondaryAlbedo": "rgba(37,42,43,1)", "materialClass": "rubber", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "notes": "Solid-color original conceptual reference."}};
  node_grip_2.add(mesh_grip_2);
  meshes["grip"] = mesh_grip_2;
  colliders["grip"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."};
  destructionGroups["grip"] ??= [];
  destructionGroups["grip"].push(node_grip_2);

  const endpoint_front_panel_3 = makeAttachmentEndpoint(null);
  const node_front_panel_3 = new THREE.Group();
  node_front_panel_3.name = "front panel__pivot";
  node_front_panel_3.scale.set(1, 1, 1);
  if (endpoint_front_panel_3) {
    node_front_panel_3.position.copy(endpoint_front_panel_3.start);
    node_front_panel_3.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_front_panel_3.position.set(0.0, 0.0, 0.355);
    node_front_panel_3.rotation.set(0.0, 0.0, 0.0);
  }
  node_front_panel_3.userData.sculptComponent = {"id": "front-panel", "name": "front panel", "level": "meso", "role": "body", "importance": 0.9, "confidence": 0.9, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Discrete rigid manufactured part with bounded faces; primitive follows the observed silhouette.", "geometryDescriptor": {"topologyIntent": "Closed solid with visible rounded rim.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "front-panel-seat", "localStart": [0, 0, 0.355], "localEnd": [0, 0, 0.355], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 2.48, "height": 1.58, "depth": 0.05, "units": "relative", "confidence": 0.85}, "transform": {"position": [0, 0, 0.355], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "front-panel", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "housing"}}, "material": "housing", "materialLayers": ["housing"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "front-panel-form", "type": "bevel", "description": "Reference-observed silhouette and bevel.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "fine molded grain", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Solid-color concept with subtle micro relief; not a measured finish."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structured", "colorMaterialRecipe": {"dominantAlbedo": "rgba(24,48,71,1)", "secondaryAlbedo": "rgba(24,48,71,1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "notes": "Solid-color original conceptual reference."}};
  node_front_panel_3.userData.actionProfile = {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "front-panel", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "housing"}};
  (nodes["root"] ?? root).add(node_front_panel_3);
  nodes["front-panel"] = node_front_panel_3;
  const mesh_front_panel_3Geometry = endpoint_front_panel_3
    ? new THREE.CylinderGeometry(endpoint_front_panel_3.endRadius, endpoint_front_panel_3.baseRadius, endpoint_front_panel_3.length, 8, 4)
    : new RoundedBoxGeometry(1, 1, 1, 3, 0.08);
  if (!endpoint_front_panel_3) {
    mesh_front_panel_3Geometry.scale(2.48, 1.58, 0.05);
  }
  const mesh_front_panel_3 = new THREE.Mesh(
    mesh_front_panel_3Geometry,
    materialMap["housing"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_front_panel_3.name = "front panel";
  if (endpoint_front_panel_3) {
    mesh_front_panel_3.position.copy(endpoint_front_panel_3.midpoint);
    mesh_front_panel_3.quaternion.copy(endpoint_front_panel_3.quaternion);
  }
  mesh_front_panel_3.castShadow = options.castShadow ?? true;
  mesh_front_panel_3.receiveShadow = options.receiveShadow ?? true;
  mesh_front_panel_3.userData.sculptComponent = {"id": "front-panel", "name": "front panel", "level": "meso", "role": "body", "importance": 0.9, "confidence": 0.9, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Discrete rigid manufactured part with bounded faces; primitive follows the observed silhouette.", "geometryDescriptor": {"topologyIntent": "Closed solid with visible rounded rim.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "front-panel-seat", "localStart": [0, 0, 0.355], "localEnd": [0, 0, 0.355], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 2.48, "height": 1.58, "depth": 0.05, "units": "relative", "confidence": 0.85}, "transform": {"position": [0, 0, 0.355], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "front-panel", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "housing"}}, "material": "housing", "materialLayers": ["housing"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "front-panel-form", "type": "bevel", "description": "Reference-observed silhouette and bevel.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "fine molded grain", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Solid-color concept with subtle micro relief; not a measured finish."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structured", "colorMaterialRecipe": {"dominantAlbedo": "rgba(24,48,71,1)", "secondaryAlbedo": "rgba(24,48,71,1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "notes": "Solid-color original conceptual reference."}};
  node_front_panel_3.add(mesh_front_panel_3);
  meshes["front-panel"] = mesh_front_panel_3;
  colliders["front-panel"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."};
  destructionGroups["front-panel"] ??= [];
  destructionGroups["front-panel"].push(node_front_panel_3);

  const endpoint_glass_dome_4 = makeAttachmentEndpoint(null);
  const node_glass_dome_4 = new THREE.Group();
  node_glass_dome_4.name = "glass dome__pivot";
  node_glass_dome_4.scale.set(1, 1, 1);
  if (endpoint_glass_dome_4) {
    node_glass_dome_4.position.copy(endpoint_glass_dome_4.start);
    node_glass_dome_4.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_glass_dome_4.position.set(0.0, 0.0, 0.51);
    node_glass_dome_4.rotation.set(0.0, 0.0, 0.0);
  }
  node_glass_dome_4.userData.sculptComponent = {"id": "glass-dome", "name": "glass dome", "level": "meso", "role": "body", "importance": 0.9, "confidence": 0.9, "primitive": "sphere", "topologyClass": "assembled-solid", "topologyRationale": "Discrete rigid manufactured part with bounded faces; primitive follows the observed silhouette.", "geometryDescriptor": {"topologyIntent": "Closed solid with visible rounded rim.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "glass-dome-seat", "localStart": [0, 0, 0.51], "localEnd": [0, 0, 0.51], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1.08, "height": 1.08, "depth": 0.38, "units": "relative", "confidence": 0.85}, "transform": {"position": [0, 0, 0.51], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "glass-dome", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "glass"}}, "material": "glass", "materialLayers": ["glass"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "glass-dome-form", "type": "bevel", "description": "Reference-observed silhouette and bevel.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "fine molded grain", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Solid-color concept with subtle micro relief; not a measured finish."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structured", "colorMaterialRecipe": {"dominantAlbedo": "rgba(13,32,37,1)", "secondaryAlbedo": "rgba(13,32,37,1)", "materialClass": "glass", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "notes": "Solid-color original conceptual reference."}};
  node_glass_dome_4.userData.actionProfile = {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "glass-dome", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "glass"}};
  (nodes["root"] ?? root).add(node_glass_dome_4);
  nodes["glass-dome"] = node_glass_dome_4;
  const mesh_glass_dome_4Geometry = endpoint_glass_dome_4
    ? new THREE.CylinderGeometry(endpoint_glass_dome_4.endRadius, endpoint_glass_dome_4.baseRadius, endpoint_glass_dome_4.length, 8, 4)
    : new THREE.SphereGeometry(0.5, 48, 24);
  if (!endpoint_glass_dome_4) {
    mesh_glass_dome_4Geometry.scale(1.08, 1.08, 0.38);
  }
  const mesh_glass_dome_4 = new THREE.Mesh(
    mesh_glass_dome_4Geometry,
    materialMap["glass"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_glass_dome_4.name = "glass dome";
  if (endpoint_glass_dome_4) {
    mesh_glass_dome_4.position.copy(endpoint_glass_dome_4.midpoint);
    mesh_glass_dome_4.quaternion.copy(endpoint_glass_dome_4.quaternion);
  }
  mesh_glass_dome_4.castShadow = options.castShadow ?? true;
  mesh_glass_dome_4.receiveShadow = options.receiveShadow ?? true;
  mesh_glass_dome_4.userData.sculptComponent = {"id": "glass-dome", "name": "glass dome", "level": "meso", "role": "body", "importance": 0.9, "confidence": 0.9, "primitive": "sphere", "topologyClass": "assembled-solid", "topologyRationale": "Discrete rigid manufactured part with bounded faces; primitive follows the observed silhouette.", "geometryDescriptor": {"topologyIntent": "Closed solid with visible rounded rim.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "glass-dome-seat", "localStart": [0, 0, 0.51], "localEnd": [0, 0, 0.51], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1.08, "height": 1.08, "depth": 0.38, "units": "relative", "confidence": 0.85}, "transform": {"position": [0, 0, 0.51], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "glass-dome", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "glass"}}, "material": "glass", "materialLayers": ["glass"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "glass-dome-form", "type": "bevel", "description": "Reference-observed silhouette and bevel.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "fine molded grain", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Solid-color concept with subtle micro relief; not a measured finish."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structured", "colorMaterialRecipe": {"dominantAlbedo": "rgba(13,32,37,1)", "secondaryAlbedo": "rgba(13,32,37,1)", "materialClass": "glass", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "notes": "Solid-color original conceptual reference."}};
  node_glass_dome_4.add(mesh_glass_dome_4);
  meshes["glass-dome"] = mesh_glass_dome_4;
  colliders["glass-dome"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."};
  destructionGroups["glass-dome"] ??= [];
  destructionGroups["glass-dome"].push(node_glass_dome_4);

  const attachment_control_main_5 = {"parentId": "root", "parentSocket": "control-main-seat", "localStart": [-0.65, 0.96, 0], "localEnd": [-0.65, 0.96, 0], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_control_main_5 = makeAttachmentEndpoint(attachment_control_main_5);
  const node_control_main_5 = new THREE.Group();
  node_control_main_5.name = "control main__pivot";
  node_control_main_5.scale.set(1, 1, 1);
  if (endpoint_control_main_5) {
    node_control_main_5.position.copy(endpoint_control_main_5.start);
    node_control_main_5.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_control_main_5.position.set(-0.65, 0.96, 0.0);
    node_control_main_5.rotation.set(0.0, 0.0, 0.0);
  }
  node_control_main_5.userData.sculptComponent = {"id": "control-main", "name": "control main", "level": "macro", "role": "control", "importance": 0.9, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Discrete rigid manufactured part with bounded faces; primitive follows the observed silhouette.", "geometryDescriptor": {"topologyIntent": "Closed solid with visible rounded rim.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "control-main-seat", "localStart": [-0.65, 0.96, 0], "localEnd": [-0.65, 0.96, 0], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.4, "height": 0.24, "depth": 0.4, "units": "relative", "confidence": 0.85}, "transform": {"position": [-0.65, 0.96, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "control-main", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "sand"}}, "material": "sand", "materialLayers": ["sand"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "control-main-form", "type": "bevel", "description": "Reference-observed silhouette and bevel.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "fine molded grain", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Solid-color concept with subtle micro relief; not a measured finish."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structured", "colorMaterialRecipe": {"dominantAlbedo": "rgba(183,171,145,1)", "secondaryAlbedo": "rgba(183,171,145,1)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "notes": "Solid-color original conceptual reference."}};
  node_control_main_5.userData.actionProfile = {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "control-main", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "sand"}};
  (nodes["root"] ?? root).add(node_control_main_5);
  nodes["control-main"] = node_control_main_5;
  const mesh_control_main_5Geometry = endpoint_control_main_5
    ? new THREE.CylinderGeometry(endpoint_control_main_5.endRadius, endpoint_control_main_5.baseRadius, endpoint_control_main_5.length, 8, 4)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 1);
  if (!endpoint_control_main_5) {
    mesh_control_main_5Geometry.scale(0.4, 0.24, 0.4);
  }
  const mesh_control_main_5 = new THREE.Mesh(
    mesh_control_main_5Geometry,
    materialMap["sand"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_control_main_5.name = "control main";
  if (endpoint_control_main_5) {
    mesh_control_main_5.position.copy(endpoint_control_main_5.midpoint);
    mesh_control_main_5.quaternion.copy(endpoint_control_main_5.quaternion);
  }
  mesh_control_main_5.castShadow = options.castShadow ?? true;
  mesh_control_main_5.receiveShadow = options.receiveShadow ?? true;
  mesh_control_main_5.userData.sculptComponent = {"id": "control-main", "name": "control main", "level": "macro", "role": "control", "importance": 0.9, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Discrete rigid manufactured part with bounded faces; primitive follows the observed silhouette.", "geometryDescriptor": {"topologyIntent": "Closed solid with visible rounded rim.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "control-main-seat", "localStart": [-0.65, 0.96, 0], "localEnd": [-0.65, 0.96, 0], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.4, "height": 0.24, "depth": 0.4, "units": "relative", "confidence": 0.85}, "transform": {"position": [-0.65, 0.96, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "control-main", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "sand"}}, "material": "sand", "materialLayers": ["sand"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "control-main-form", "type": "bevel", "description": "Reference-observed silhouette and bevel.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "fine molded grain", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Solid-color concept with subtle micro relief; not a measured finish."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structured", "colorMaterialRecipe": {"dominantAlbedo": "rgba(183,171,145,1)", "secondaryAlbedo": "rgba(183,171,145,1)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "notes": "Solid-color original conceptual reference."}};
  node_control_main_5.add(mesh_control_main_5);
  meshes["control-main"] = mesh_control_main_5;
  colliders["control-main"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."};
  destructionGroups["control-main"] ??= [];
  destructionGroups["control-main"].push(node_control_main_5);

  const attachment_control_secondary_6 = {"parentId": "root", "parentSocket": "control-secondary-seat", "localStart": [0.03, 0.93, 0], "localEnd": [0.03, 0.93, 0], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_control_secondary_6 = makeAttachmentEndpoint(attachment_control_secondary_6);
  const node_control_secondary_6 = new THREE.Group();
  node_control_secondary_6.name = "control secondary__pivot";
  node_control_secondary_6.scale.set(1, 1, 1);
  if (endpoint_control_secondary_6) {
    node_control_secondary_6.position.copy(endpoint_control_secondary_6.start);
    node_control_secondary_6.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_control_secondary_6.position.set(0.03, 0.93, 0.0);
    node_control_secondary_6.rotation.set(0.0, 0.0, 0.0);
  }
  node_control_secondary_6.userData.sculptComponent = {"id": "control-secondary", "name": "control secondary", "level": "macro", "role": "control", "importance": 0.9, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Discrete rigid manufactured part with bounded faces; primitive follows the observed silhouette.", "geometryDescriptor": {"topologyIntent": "Closed solid with visible rounded rim.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "control-secondary-seat", "localStart": [0.03, 0.93, 0], "localEnd": [0.03, 0.93, 0], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.27, "height": 0.17, "depth": 0.27, "units": "relative", "confidence": 0.85}, "transform": {"position": [0.03, 0.93, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "control-secondary", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "sand"}}, "material": "sand", "materialLayers": ["sand"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "control-secondary-form", "type": "bevel", "description": "Reference-observed silhouette and bevel.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "fine molded grain", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Solid-color concept with subtle micro relief; not a measured finish."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structured", "colorMaterialRecipe": {"dominantAlbedo": "rgba(183,171,145,1)", "secondaryAlbedo": "rgba(183,171,145,1)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "notes": "Solid-color original conceptual reference."}};
  node_control_secondary_6.userData.actionProfile = {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "control-secondary", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "sand"}};
  (nodes["root"] ?? root).add(node_control_secondary_6);
  nodes["control-secondary"] = node_control_secondary_6;
  const mesh_control_secondary_6Geometry = endpoint_control_secondary_6
    ? new THREE.CylinderGeometry(endpoint_control_secondary_6.endRadius, endpoint_control_secondary_6.baseRadius, endpoint_control_secondary_6.length, 8, 4)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 1);
  if (!endpoint_control_secondary_6) {
    mesh_control_secondary_6Geometry.scale(0.27, 0.17, 0.27);
  }
  const mesh_control_secondary_6 = new THREE.Mesh(
    mesh_control_secondary_6Geometry,
    materialMap["sand"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_control_secondary_6.name = "control secondary";
  if (endpoint_control_secondary_6) {
    mesh_control_secondary_6.position.copy(endpoint_control_secondary_6.midpoint);
    mesh_control_secondary_6.quaternion.copy(endpoint_control_secondary_6.quaternion);
  }
  mesh_control_secondary_6.castShadow = options.castShadow ?? true;
  mesh_control_secondary_6.receiveShadow = options.receiveShadow ?? true;
  mesh_control_secondary_6.userData.sculptComponent = {"id": "control-secondary", "name": "control secondary", "level": "macro", "role": "control", "importance": 0.9, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Discrete rigid manufactured part with bounded faces; primitive follows the observed silhouette.", "geometryDescriptor": {"topologyIntent": "Closed solid with visible rounded rim.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "control-secondary-seat", "localStart": [0.03, 0.93, 0], "localEnd": [0.03, 0.93, 0], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.27, "height": 0.17, "depth": 0.27, "units": "relative", "confidence": 0.85}, "transform": {"position": [0.03, 0.93, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "control-secondary", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "sand"}}, "material": "sand", "materialLayers": ["sand"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "control-secondary-form", "type": "bevel", "description": "Reference-observed silhouette and bevel.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "fine molded grain", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Solid-color concept with subtle micro relief; not a measured finish."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structured", "colorMaterialRecipe": {"dominantAlbedo": "rgba(183,171,145,1)", "secondaryAlbedo": "rgba(183,171,145,1)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "notes": "Solid-color original conceptual reference."}};
  node_control_secondary_6.add(mesh_control_secondary_6);
  meshes["control-secondary"] = mesh_control_secondary_6;
  colliders["control-secondary"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."};
  destructionGroups["control-secondary"] ??= [];
  destructionGroups["control-secondary"].push(node_control_secondary_6);

  const attachment_lens_sleeve_7 = {"parentId": "root", "parentSocket": "lens-sleeve-seat", "localStart": [0, 0, 0.5], "localEnd": [0, 0, 0.5], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_lens_sleeve_7 = makeAttachmentEndpoint(attachment_lens_sleeve_7);
  const node_lens_sleeve_7 = new THREE.Group();
  node_lens_sleeve_7.name = "lens sleeve__pivot";
  node_lens_sleeve_7.scale.set(1, 1, 1);
  if (endpoint_lens_sleeve_7) {
    node_lens_sleeve_7.position.copy(endpoint_lens_sleeve_7.start);
    node_lens_sleeve_7.rotation.set(1.57079632679, 0.0, 0.0);
  } else {
    node_lens_sleeve_7.position.set(0.0, 0.0, 0.5);
    node_lens_sleeve_7.rotation.set(1.57079632679, 0.0, 0.0);
  }
  node_lens_sleeve_7.userData.sculptComponent = {"id": "lens-sleeve", "name": "lens sleeve", "level": "meso", "role": "body", "importance": 0.9, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Discrete rigid manufactured part with bounded faces; primitive follows the observed silhouette.", "geometryDescriptor": {"topologyIntent": "Closed solid with visible rounded rim.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "lens-sleeve-seat", "localStart": [0, 0, 0.5], "localEnd": [0, 0, 0.5], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1.15, "height": 0.15, "depth": 1.15, "units": "relative", "confidence": 0.85}, "transform": {"position": [0, 0, 0.5], "rotation": [1.57079632679, 0, 0]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lens-sleeve", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "rubber"}}, "material": "rubber", "materialLayers": ["rubber"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "lens-sleeve-form", "type": "bevel", "description": "Reference-observed silhouette and bevel.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "fine molded grain", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Solid-color concept with subtle micro relief; not a measured finish."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structured", "colorMaterialRecipe": {"dominantAlbedo": "rgba(37,42,43,1)", "secondaryAlbedo": "rgba(37,42,43,1)", "materialClass": "rubber", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "notes": "Solid-color original conceptual reference."}};
  node_lens_sleeve_7.userData.actionProfile = {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lens-sleeve", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "rubber"}};
  (nodes["root"] ?? root).add(node_lens_sleeve_7);
  nodes["lens-sleeve"] = node_lens_sleeve_7;
  const mesh_lens_sleeve_7Geometry = endpoint_lens_sleeve_7
    ? new THREE.CylinderGeometry(endpoint_lens_sleeve_7.endRadius, endpoint_lens_sleeve_7.baseRadius, endpoint_lens_sleeve_7.length, 8, 4)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 1);
  if (!endpoint_lens_sleeve_7) {
    mesh_lens_sleeve_7Geometry.scale(1.15, 0.15, 1.15);
  }
  const mesh_lens_sleeve_7 = new THREE.Mesh(
    mesh_lens_sleeve_7Geometry,
    materialMap["rubber"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_lens_sleeve_7.name = "lens sleeve";
  if (endpoint_lens_sleeve_7) {
    mesh_lens_sleeve_7.position.copy(endpoint_lens_sleeve_7.midpoint);
    mesh_lens_sleeve_7.quaternion.copy(endpoint_lens_sleeve_7.quaternion);
  }
  mesh_lens_sleeve_7.castShadow = options.castShadow ?? true;
  mesh_lens_sleeve_7.receiveShadow = options.receiveShadow ?? true;
  mesh_lens_sleeve_7.userData.sculptComponent = {"id": "lens-sleeve", "name": "lens sleeve", "level": "meso", "role": "body", "importance": 0.9, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Discrete rigid manufactured part with bounded faces; primitive follows the observed silhouette.", "geometryDescriptor": {"topologyIntent": "Closed solid with visible rounded rim.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "lens-sleeve-seat", "localStart": [0, 0, 0.5], "localEnd": [0, 0, 0.5], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1.15, "height": 0.15, "depth": 1.15, "units": "relative", "confidence": 0.85}, "transform": {"position": [0, 0, 0.5], "rotation": [1.57079632679, 0, 0]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lens-sleeve", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "rubber"}}, "material": "rubber", "materialLayers": ["rubber"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "lens-sleeve-form", "type": "bevel", "description": "Reference-observed silhouette and bevel.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "fine molded grain", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Solid-color concept with subtle micro relief; not a measured finish."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structured", "colorMaterialRecipe": {"dominantAlbedo": "rgba(37,42,43,1)", "secondaryAlbedo": "rgba(37,42,43,1)", "materialClass": "rubber", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "notes": "Solid-color original conceptual reference."}};
  node_lens_sleeve_7.add(mesh_lens_sleeve_7);
  meshes["lens-sleeve"] = mesh_lens_sleeve_7;
  colliders["lens-sleeve"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."};
  destructionGroups["lens-sleeve"] ??= [];
  destructionGroups["lens-sleeve"].push(node_lens_sleeve_7);

  const endpoint_optical_collar_8 = makeAttachmentEndpoint(null);
  const node_optical_collar_8 = new THREE.Group();
  node_optical_collar_8.name = "optical collar__pivot";
  node_optical_collar_8.scale.set(1, 1, 1);
  if (endpoint_optical_collar_8) {
    node_optical_collar_8.position.copy(endpoint_optical_collar_8.start);
    node_optical_collar_8.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_optical_collar_8.position.set(0.0, 0.0, 0.59);
    node_optical_collar_8.rotation.set(0.0, 0.0, 0.0);
  }
  node_optical_collar_8.userData.sculptComponent = {"id": "optical-collar", "name": "optical collar", "level": "meso", "role": "body", "importance": 0.9, "confidence": 0.9, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "Discrete rigid manufactured part with bounded faces; primitive follows the observed silhouette.", "geometryDescriptor": {"topologyIntent": "Closed solid with visible rounded rim.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "optical-collar-seat", "localStart": [0, 0, 0.59], "localEnd": [0, 0, 0.59], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1.13, "height": 1.13, "depth": 0.05, "units": "relative", "confidence": 0.85}, "transform": {"position": [0, 0, 0.59], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "optical-collar", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "rubber"}}, "material": "rubber", "materialLayers": ["rubber"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "optical-collar-form", "type": "bevel", "description": "Reference-observed silhouette and bevel.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "fine molded grain", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Solid-color concept with subtle micro relief; not a measured finish."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structured", "colorMaterialRecipe": {"dominantAlbedo": "rgba(37,42,43,1)", "secondaryAlbedo": "rgba(37,42,43,1)", "materialClass": "rubber", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "notes": "Solid-color original conceptual reference."}};
  node_optical_collar_8.userData.actionProfile = {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "optical-collar", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "rubber"}};
  (nodes["root"] ?? root).add(node_optical_collar_8);
  nodes["optical-collar"] = node_optical_collar_8;
  const mesh_optical_collar_8Geometry = endpoint_optical_collar_8
    ? new THREE.CylinderGeometry(endpoint_optical_collar_8.endRadius, endpoint_optical_collar_8.baseRadius, endpoint_optical_collar_8.length, 8, 4)
    : new THREE.TorusGeometry(0.48, 0.022, 8, 64);
  if (!endpoint_optical_collar_8) {
    mesh_optical_collar_8Geometry.scale(1.13, 1.13, 0.05);
  }
  const mesh_optical_collar_8 = new THREE.Mesh(
    mesh_optical_collar_8Geometry,
    materialMap["rubber"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_optical_collar_8.name = "optical collar";
  if (endpoint_optical_collar_8) {
    mesh_optical_collar_8.position.copy(endpoint_optical_collar_8.midpoint);
    mesh_optical_collar_8.quaternion.copy(endpoint_optical_collar_8.quaternion);
  }
  mesh_optical_collar_8.castShadow = options.castShadow ?? true;
  mesh_optical_collar_8.receiveShadow = options.receiveShadow ?? true;
  mesh_optical_collar_8.userData.sculptComponent = {"id": "optical-collar", "name": "optical collar", "level": "meso", "role": "body", "importance": 0.9, "confidence": 0.9, "primitive": "torus", "topologyClass": "assembled-solid", "topologyRationale": "Discrete rigid manufactured part with bounded faces; primitive follows the observed silhouette.", "geometryDescriptor": {"topologyIntent": "Closed solid with visible rounded rim.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "optical-collar-seat", "localStart": [0, 0, 0.59], "localEnd": [0, 0, 0.59], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 1.13, "height": 1.13, "depth": 0.05, "units": "relative", "confidence": 0.85}, "transform": {"position": [0, 0, 0.59], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "optical-collar", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "rubber"}}, "material": "rubber", "materialLayers": ["rubber"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "optical-collar-form", "type": "bevel", "description": "Reference-observed silhouette and bevel.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "fine molded grain", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Solid-color concept with subtle micro relief; not a measured finish."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structured", "colorMaterialRecipe": {"dominantAlbedo": "rgba(37,42,43,1)", "secondaryAlbedo": "rgba(37,42,43,1)", "materialClass": "rubber", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "notes": "Solid-color original conceptual reference."}};
  node_optical_collar_8.add(mesh_optical_collar_8);
  meshes["optical-collar"] = mesh_optical_collar_8;
  colliders["optical-collar"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."};
  destructionGroups["optical-collar"] ??= [];
  destructionGroups["optical-collar"].push(node_optical_collar_8);

  const attachment_main_control_seat_9 = {"parentId": "root", "parentSocket": "main-control-seat-seat", "localStart": [-0.65, 0.87, 0], "localEnd": [-0.65, 0.87, 0], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_main_control_seat_9 = makeAttachmentEndpoint(attachment_main_control_seat_9);
  const node_main_control_seat_9 = new THREE.Group();
  node_main_control_seat_9.name = "main control seat__pivot";
  node_main_control_seat_9.scale.set(1, 1, 1);
  if (endpoint_main_control_seat_9) {
    node_main_control_seat_9.position.copy(endpoint_main_control_seat_9.start);
    node_main_control_seat_9.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_main_control_seat_9.position.set(-0.65, 0.87, 0.0);
    node_main_control_seat_9.rotation.set(0.0, 0.0, 0.0);
  }
  node_main_control_seat_9.userData.sculptComponent = {"id": "main-control-seat", "name": "main control seat", "level": "meso", "role": "body", "importance": 0.9, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Discrete rigid manufactured part with bounded faces; primitive follows the observed silhouette.", "geometryDescriptor": {"topologyIntent": "Closed solid with visible rounded rim.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "main-control-seat-seat", "localStart": [-0.65, 0.87, 0], "localEnd": [-0.65, 0.87, 0], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.46, "height": 0.06, "depth": 0.46, "units": "relative", "confidence": 0.85}, "transform": {"position": [-0.65, 0.87, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "main-control-seat", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "housing"}}, "material": "housing", "materialLayers": ["housing"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "main-control-seat-form", "type": "bevel", "description": "Reference-observed silhouette and bevel.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "fine molded grain", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Solid-color concept with subtle micro relief; not a measured finish."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structured", "colorMaterialRecipe": {"dominantAlbedo": "rgba(24,48,71,1)", "secondaryAlbedo": "rgba(24,48,71,1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "notes": "Solid-color original conceptual reference."}};
  node_main_control_seat_9.userData.actionProfile = {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "main-control-seat", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "housing"}};
  (nodes["root"] ?? root).add(node_main_control_seat_9);
  nodes["main-control-seat"] = node_main_control_seat_9;
  const mesh_main_control_seat_9Geometry = endpoint_main_control_seat_9
    ? new THREE.CylinderGeometry(endpoint_main_control_seat_9.endRadius, endpoint_main_control_seat_9.baseRadius, endpoint_main_control_seat_9.length, 8, 4)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 1);
  if (!endpoint_main_control_seat_9) {
    mesh_main_control_seat_9Geometry.scale(0.46, 0.06, 0.46);
  }
  const mesh_main_control_seat_9 = new THREE.Mesh(
    mesh_main_control_seat_9Geometry,
    materialMap["housing"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_main_control_seat_9.name = "main control seat";
  if (endpoint_main_control_seat_9) {
    mesh_main_control_seat_9.position.copy(endpoint_main_control_seat_9.midpoint);
    mesh_main_control_seat_9.quaternion.copy(endpoint_main_control_seat_9.quaternion);
  }
  mesh_main_control_seat_9.castShadow = options.castShadow ?? true;
  mesh_main_control_seat_9.receiveShadow = options.receiveShadow ?? true;
  mesh_main_control_seat_9.userData.sculptComponent = {"id": "main-control-seat", "name": "main control seat", "level": "meso", "role": "body", "importance": 0.9, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Discrete rigid manufactured part with bounded faces; primitive follows the observed silhouette.", "geometryDescriptor": {"topologyIntent": "Closed solid with visible rounded rim.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "main-control-seat-seat", "localStart": [-0.65, 0.87, 0], "localEnd": [-0.65, 0.87, 0], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.46, "height": 0.06, "depth": 0.46, "units": "relative", "confidence": 0.85}, "transform": {"position": [-0.65, 0.87, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "main-control-seat", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "housing"}}, "material": "housing", "materialLayers": ["housing"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "main-control-seat-form", "type": "bevel", "description": "Reference-observed silhouette and bevel.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "fine molded grain", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Solid-color concept with subtle micro relief; not a measured finish."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structured", "colorMaterialRecipe": {"dominantAlbedo": "rgba(24,48,71,1)", "secondaryAlbedo": "rgba(24,48,71,1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "notes": "Solid-color original conceptual reference."}};
  node_main_control_seat_9.add(mesh_main_control_seat_9);
  meshes["main-control-seat"] = mesh_main_control_seat_9;
  colliders["main-control-seat"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."};
  destructionGroups["main-control-seat"] ??= [];
  destructionGroups["main-control-seat"].push(node_main_control_seat_9);

  const attachment_secondary_control_seat_10 = {"parentId": "root", "parentSocket": "secondary-control-seat-seat", "localStart": [0.03, 0.87, 0], "localEnd": [0.03, 0.87, 0], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_secondary_control_seat_10 = makeAttachmentEndpoint(attachment_secondary_control_seat_10);
  const node_secondary_control_seat_10 = new THREE.Group();
  node_secondary_control_seat_10.name = "secondary control seat__pivot";
  node_secondary_control_seat_10.scale.set(1, 1, 1);
  if (endpoint_secondary_control_seat_10) {
    node_secondary_control_seat_10.position.copy(endpoint_secondary_control_seat_10.start);
    node_secondary_control_seat_10.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_secondary_control_seat_10.position.set(0.03, 0.87, 0.0);
    node_secondary_control_seat_10.rotation.set(0.0, 0.0, 0.0);
  }
  node_secondary_control_seat_10.userData.sculptComponent = {"id": "secondary-control-seat", "name": "secondary control seat", "level": "meso", "role": "body", "importance": 0.9, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Discrete rigid manufactured part with bounded faces; primitive follows the observed silhouette.", "geometryDescriptor": {"topologyIntent": "Closed solid with visible rounded rim.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "secondary-control-seat-seat", "localStart": [0.03, 0.87, 0], "localEnd": [0.03, 0.87, 0], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.33, "height": 0.06, "depth": 0.33, "units": "relative", "confidence": 0.85}, "transform": {"position": [0.03, 0.87, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "secondary-control-seat", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "housing"}}, "material": "housing", "materialLayers": ["housing"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "secondary-control-seat-form", "type": "bevel", "description": "Reference-observed silhouette and bevel.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "fine molded grain", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Solid-color concept with subtle micro relief; not a measured finish."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structured", "colorMaterialRecipe": {"dominantAlbedo": "rgba(24,48,71,1)", "secondaryAlbedo": "rgba(24,48,71,1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "notes": "Solid-color original conceptual reference."}};
  node_secondary_control_seat_10.userData.actionProfile = {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "secondary-control-seat", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "housing"}};
  (nodes["root"] ?? root).add(node_secondary_control_seat_10);
  nodes["secondary-control-seat"] = node_secondary_control_seat_10;
  const mesh_secondary_control_seat_10Geometry = endpoint_secondary_control_seat_10
    ? new THREE.CylinderGeometry(endpoint_secondary_control_seat_10.endRadius, endpoint_secondary_control_seat_10.baseRadius, endpoint_secondary_control_seat_10.length, 8, 4)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 1);
  if (!endpoint_secondary_control_seat_10) {
    mesh_secondary_control_seat_10Geometry.scale(0.33, 0.06, 0.33);
  }
  const mesh_secondary_control_seat_10 = new THREE.Mesh(
    mesh_secondary_control_seat_10Geometry,
    materialMap["housing"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_secondary_control_seat_10.name = "secondary control seat";
  if (endpoint_secondary_control_seat_10) {
    mesh_secondary_control_seat_10.position.copy(endpoint_secondary_control_seat_10.midpoint);
    mesh_secondary_control_seat_10.quaternion.copy(endpoint_secondary_control_seat_10.quaternion);
  }
  mesh_secondary_control_seat_10.castShadow = options.castShadow ?? true;
  mesh_secondary_control_seat_10.receiveShadow = options.receiveShadow ?? true;
  mesh_secondary_control_seat_10.userData.sculptComponent = {"id": "secondary-control-seat", "name": "secondary control seat", "level": "meso", "role": "body", "importance": 0.9, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Discrete rigid manufactured part with bounded faces; primitive follows the observed silhouette.", "geometryDescriptor": {"topologyIntent": "Closed solid with visible rounded rim.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "secondary-control-seat-seat", "localStart": [0.03, 0.87, 0], "localEnd": [0.03, 0.87, 0], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.33, "height": 0.06, "depth": 0.33, "units": "relative", "confidence": 0.85}, "transform": {"position": [0.03, 0.87, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "secondary-control-seat", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "housing"}}, "material": "housing", "materialLayers": ["housing"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "secondary-control-seat-form", "type": "bevel", "description": "Reference-observed silhouette and bevel.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "fine molded grain", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Solid-color concept with subtle micro relief; not a measured finish."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structured", "colorMaterialRecipe": {"dominantAlbedo": "rgba(24,48,71,1)", "secondaryAlbedo": "rgba(24,48,71,1)", "materialClass": "plastic", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "notes": "Solid-color original conceptual reference."}};
  node_secondary_control_seat_10.add(mesh_secondary_control_seat_10);
  meshes["secondary-control-seat"] = mesh_secondary_control_seat_10;
  colliders["secondary-control-seat"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."};
  destructionGroups["secondary-control-seat"] ??= [];
  destructionGroups["secondary-control-seat"].push(node_secondary_control_seat_10);

  const attachment_corner_fastener_0_11 = {"parentId": "root", "parentSocket": "corner-fastener-0-seat", "localStart": [-1.1, -0.65, 0.4], "localEnd": [-1.1, -0.65, 0.4], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_corner_fastener_0_11 = makeAttachmentEndpoint(attachment_corner_fastener_0_11);
  const node_corner_fastener_0_11 = new THREE.Group();
  node_corner_fastener_0_11.name = "corner fastener 0__pivot";
  node_corner_fastener_0_11.scale.set(1, 1, 1);
  if (endpoint_corner_fastener_0_11) {
    node_corner_fastener_0_11.position.copy(endpoint_corner_fastener_0_11.start);
    node_corner_fastener_0_11.rotation.set(1.57079632679, 0.0, 0.0);
  } else {
    node_corner_fastener_0_11.position.set(-1.1, -0.65, 0.4);
    node_corner_fastener_0_11.rotation.set(1.57079632679, 0.0, 0.0);
  }
  node_corner_fastener_0_11.userData.sculptComponent = {"id": "corner-fastener-0", "name": "corner fastener 0", "level": "meso", "role": "body", "importance": 0.9, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Discrete rigid manufactured part with bounded faces; primitive follows the observed silhouette.", "geometryDescriptor": {"topologyIntent": "Closed solid with visible rounded rim.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "corner-fastener-0-seat", "localStart": [-1.1, -0.65, 0.4], "localEnd": [-1.1, -0.65, 0.4], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.13, "height": 0.04, "depth": 0.13, "units": "relative", "confidence": 0.85}, "transform": {"position": [-1.1, -0.65, 0.4], "rotation": [1.57079632679, 0, 0]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "corner-fastener-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "sand"}}, "material": "sand", "materialLayers": ["sand"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "corner-fastener-0-form", "type": "bevel", "description": "Reference-observed silhouette and bevel.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "fine molded grain", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Solid-color concept with subtle micro relief; not a measured finish."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structured", "colorMaterialRecipe": {"dominantAlbedo": "rgba(183,171,145,1)", "secondaryAlbedo": "rgba(183,171,145,1)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "notes": "Solid-color original conceptual reference."}};
  node_corner_fastener_0_11.userData.actionProfile = {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "corner-fastener-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "sand"}};
  (nodes["root"] ?? root).add(node_corner_fastener_0_11);
  nodes["corner-fastener-0"] = node_corner_fastener_0_11;
  const mesh_corner_fastener_0_11Geometry = endpoint_corner_fastener_0_11
    ? new THREE.CylinderGeometry(endpoint_corner_fastener_0_11.endRadius, endpoint_corner_fastener_0_11.baseRadius, endpoint_corner_fastener_0_11.length, 8, 4)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 1);
  if (!endpoint_corner_fastener_0_11) {
    mesh_corner_fastener_0_11Geometry.scale(0.13, 0.04, 0.13);
  }
  const mesh_corner_fastener_0_11 = new THREE.Mesh(
    mesh_corner_fastener_0_11Geometry,
    materialMap["sand"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_corner_fastener_0_11.name = "corner fastener 0";
  if (endpoint_corner_fastener_0_11) {
    mesh_corner_fastener_0_11.position.copy(endpoint_corner_fastener_0_11.midpoint);
    mesh_corner_fastener_0_11.quaternion.copy(endpoint_corner_fastener_0_11.quaternion);
  }
  mesh_corner_fastener_0_11.castShadow = options.castShadow ?? true;
  mesh_corner_fastener_0_11.receiveShadow = options.receiveShadow ?? true;
  mesh_corner_fastener_0_11.userData.sculptComponent = {"id": "corner-fastener-0", "name": "corner fastener 0", "level": "meso", "role": "body", "importance": 0.9, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Discrete rigid manufactured part with bounded faces; primitive follows the observed silhouette.", "geometryDescriptor": {"topologyIntent": "Closed solid with visible rounded rim.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "corner-fastener-0-seat", "localStart": [-1.1, -0.65, 0.4], "localEnd": [-1.1, -0.65, 0.4], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.13, "height": 0.04, "depth": 0.13, "units": "relative", "confidence": 0.85}, "transform": {"position": [-1.1, -0.65, 0.4], "rotation": [1.57079632679, 0, 0]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "corner-fastener-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "sand"}}, "material": "sand", "materialLayers": ["sand"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "corner-fastener-0-form", "type": "bevel", "description": "Reference-observed silhouette and bevel.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "fine molded grain", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Solid-color concept with subtle micro relief; not a measured finish."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structured", "colorMaterialRecipe": {"dominantAlbedo": "rgba(183,171,145,1)", "secondaryAlbedo": "rgba(183,171,145,1)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "notes": "Solid-color original conceptual reference."}};
  node_corner_fastener_0_11.add(mesh_corner_fastener_0_11);
  meshes["corner-fastener-0"] = mesh_corner_fastener_0_11;
  colliders["corner-fastener-0"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."};
  destructionGroups["corner-fastener-0"] ??= [];
  destructionGroups["corner-fastener-0"].push(node_corner_fastener_0_11);

  const attachment_corner_socket_0_12 = {"parentId": "root", "parentSocket": "corner-socket-0-seat", "localStart": [-1.1, -0.65, 0.42400000000000004], "localEnd": [-1.1, -0.65, 0.42400000000000004], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_corner_socket_0_12 = makeAttachmentEndpoint(attachment_corner_socket_0_12);
  const node_corner_socket_0_12 = new THREE.Group();
  node_corner_socket_0_12.name = "corner socket 0__pivot";
  node_corner_socket_0_12.scale.set(1, 1, 1);
  if (endpoint_corner_socket_0_12) {
    node_corner_socket_0_12.position.copy(endpoint_corner_socket_0_12.start);
    node_corner_socket_0_12.rotation.set(1.57079632679, 0.0, 0.0);
  } else {
    node_corner_socket_0_12.position.set(-1.1, -0.65, 0.42400000000000004);
    node_corner_socket_0_12.rotation.set(1.57079632679, 0.0, 0.0);
  }
  node_corner_socket_0_12.userData.sculptComponent = {"id": "corner-socket-0", "name": "corner socket 0", "level": "micro", "role": "body", "importance": 0.9, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Discrete rigid manufactured part with bounded faces; primitive follows the observed silhouette.", "geometryDescriptor": {"topologyIntent": "Closed solid with visible rounded rim.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "corner-socket-0-seat", "localStart": [-1.1, -0.65, 0.42400000000000004], "localEnd": [-1.1, -0.65, 0.42400000000000004], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.0546, "height": 0.012, "depth": 0.0546, "units": "relative", "confidence": 0.85}, "transform": {"position": [-1.1, -0.65, 0.42400000000000004], "rotation": [1.57079632679, 0, 0]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "corner-socket-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "rubber"}}, "material": "rubber", "materialLayers": ["rubber"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "corner-socket-0-form", "type": "bevel", "description": "Reference-observed silhouette and bevel.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "fine molded grain", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Solid-color concept with subtle micro relief; not a measured finish."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structured", "colorMaterialRecipe": {"dominantAlbedo": "rgba(37,42,43,1)", "secondaryAlbedo": "rgba(37,42,43,1)", "materialClass": "rubber", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "notes": "Solid-color original conceptual reference."}};
  node_corner_socket_0_12.userData.actionProfile = {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "corner-socket-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "rubber"}};
  (nodes["root"] ?? root).add(node_corner_socket_0_12);
  nodes["corner-socket-0"] = node_corner_socket_0_12;
  const mesh_corner_socket_0_12Geometry = endpoint_corner_socket_0_12
    ? new THREE.CylinderGeometry(endpoint_corner_socket_0_12.endRadius, endpoint_corner_socket_0_12.baseRadius, endpoint_corner_socket_0_12.length, 8, 4)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 1);
  if (!endpoint_corner_socket_0_12) {
    mesh_corner_socket_0_12Geometry.scale(0.0546, 0.012, 0.0546);
  }
  const mesh_corner_socket_0_12 = new THREE.Mesh(
    mesh_corner_socket_0_12Geometry,
    materialMap["rubber"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_corner_socket_0_12.name = "corner socket 0";
  if (endpoint_corner_socket_0_12) {
    mesh_corner_socket_0_12.position.copy(endpoint_corner_socket_0_12.midpoint);
    mesh_corner_socket_0_12.quaternion.copy(endpoint_corner_socket_0_12.quaternion);
  }
  mesh_corner_socket_0_12.castShadow = options.castShadow ?? true;
  mesh_corner_socket_0_12.receiveShadow = options.receiveShadow ?? true;
  mesh_corner_socket_0_12.userData.sculptComponent = {"id": "corner-socket-0", "name": "corner socket 0", "level": "micro", "role": "body", "importance": 0.9, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Discrete rigid manufactured part with bounded faces; primitive follows the observed silhouette.", "geometryDescriptor": {"topologyIntent": "Closed solid with visible rounded rim.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "corner-socket-0-seat", "localStart": [-1.1, -0.65, 0.42400000000000004], "localEnd": [-1.1, -0.65, 0.42400000000000004], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.0546, "height": 0.012, "depth": 0.0546, "units": "relative", "confidence": 0.85}, "transform": {"position": [-1.1, -0.65, 0.42400000000000004], "rotation": [1.57079632679, 0, 0]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "corner-socket-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "rubber"}}, "material": "rubber", "materialLayers": ["rubber"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "corner-socket-0-form", "type": "bevel", "description": "Reference-observed silhouette and bevel.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "fine molded grain", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Solid-color concept with subtle micro relief; not a measured finish."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structured", "colorMaterialRecipe": {"dominantAlbedo": "rgba(37,42,43,1)", "secondaryAlbedo": "rgba(37,42,43,1)", "materialClass": "rubber", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "notes": "Solid-color original conceptual reference."}};
  node_corner_socket_0_12.add(mesh_corner_socket_0_12);
  meshes["corner-socket-0"] = mesh_corner_socket_0_12;
  colliders["corner-socket-0"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."};
  destructionGroups["corner-socket-0"] ??= [];
  destructionGroups["corner-socket-0"].push(node_corner_socket_0_12);

  const attachment_corner_fastener_1_13 = {"parentId": "root", "parentSocket": "corner-fastener-1-seat", "localStart": [-1.1, 0.65, 0.4], "localEnd": [-1.1, 0.65, 0.4], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_corner_fastener_1_13 = makeAttachmentEndpoint(attachment_corner_fastener_1_13);
  const node_corner_fastener_1_13 = new THREE.Group();
  node_corner_fastener_1_13.name = "corner fastener 1__pivot";
  node_corner_fastener_1_13.scale.set(1, 1, 1);
  if (endpoint_corner_fastener_1_13) {
    node_corner_fastener_1_13.position.copy(endpoint_corner_fastener_1_13.start);
    node_corner_fastener_1_13.rotation.set(1.57079632679, 0.0, 0.0);
  } else {
    node_corner_fastener_1_13.position.set(-1.1, 0.65, 0.4);
    node_corner_fastener_1_13.rotation.set(1.57079632679, 0.0, 0.0);
  }
  node_corner_fastener_1_13.userData.sculptComponent = {"id": "corner-fastener-1", "name": "corner fastener 1", "level": "meso", "role": "body", "importance": 0.9, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Discrete rigid manufactured part with bounded faces; primitive follows the observed silhouette.", "geometryDescriptor": {"topologyIntent": "Closed solid with visible rounded rim.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "corner-fastener-1-seat", "localStart": [-1.1, 0.65, 0.4], "localEnd": [-1.1, 0.65, 0.4], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.13, "height": 0.04, "depth": 0.13, "units": "relative", "confidence": 0.85}, "transform": {"position": [-1.1, 0.65, 0.4], "rotation": [1.57079632679, 0, 0]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "corner-fastener-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "sand"}}, "material": "sand", "materialLayers": ["sand"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "corner-fastener-1-form", "type": "bevel", "description": "Reference-observed silhouette and bevel.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "fine molded grain", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Solid-color concept with subtle micro relief; not a measured finish."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structured", "colorMaterialRecipe": {"dominantAlbedo": "rgba(183,171,145,1)", "secondaryAlbedo": "rgba(183,171,145,1)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "notes": "Solid-color original conceptual reference."}};
  node_corner_fastener_1_13.userData.actionProfile = {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "corner-fastener-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "sand"}};
  (nodes["root"] ?? root).add(node_corner_fastener_1_13);
  nodes["corner-fastener-1"] = node_corner_fastener_1_13;
  const mesh_corner_fastener_1_13Geometry = endpoint_corner_fastener_1_13
    ? new THREE.CylinderGeometry(endpoint_corner_fastener_1_13.endRadius, endpoint_corner_fastener_1_13.baseRadius, endpoint_corner_fastener_1_13.length, 8, 4)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 1);
  if (!endpoint_corner_fastener_1_13) {
    mesh_corner_fastener_1_13Geometry.scale(0.13, 0.04, 0.13);
  }
  const mesh_corner_fastener_1_13 = new THREE.Mesh(
    mesh_corner_fastener_1_13Geometry,
    materialMap["sand"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_corner_fastener_1_13.name = "corner fastener 1";
  if (endpoint_corner_fastener_1_13) {
    mesh_corner_fastener_1_13.position.copy(endpoint_corner_fastener_1_13.midpoint);
    mesh_corner_fastener_1_13.quaternion.copy(endpoint_corner_fastener_1_13.quaternion);
  }
  mesh_corner_fastener_1_13.castShadow = options.castShadow ?? true;
  mesh_corner_fastener_1_13.receiveShadow = options.receiveShadow ?? true;
  mesh_corner_fastener_1_13.userData.sculptComponent = {"id": "corner-fastener-1", "name": "corner fastener 1", "level": "meso", "role": "body", "importance": 0.9, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Discrete rigid manufactured part with bounded faces; primitive follows the observed silhouette.", "geometryDescriptor": {"topologyIntent": "Closed solid with visible rounded rim.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "corner-fastener-1-seat", "localStart": [-1.1, 0.65, 0.4], "localEnd": [-1.1, 0.65, 0.4], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.13, "height": 0.04, "depth": 0.13, "units": "relative", "confidence": 0.85}, "transform": {"position": [-1.1, 0.65, 0.4], "rotation": [1.57079632679, 0, 0]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "corner-fastener-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "sand"}}, "material": "sand", "materialLayers": ["sand"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "corner-fastener-1-form", "type": "bevel", "description": "Reference-observed silhouette and bevel.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "fine molded grain", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Solid-color concept with subtle micro relief; not a measured finish."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structured", "colorMaterialRecipe": {"dominantAlbedo": "rgba(183,171,145,1)", "secondaryAlbedo": "rgba(183,171,145,1)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "notes": "Solid-color original conceptual reference."}};
  node_corner_fastener_1_13.add(mesh_corner_fastener_1_13);
  meshes["corner-fastener-1"] = mesh_corner_fastener_1_13;
  colliders["corner-fastener-1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."};
  destructionGroups["corner-fastener-1"] ??= [];
  destructionGroups["corner-fastener-1"].push(node_corner_fastener_1_13);

  const attachment_corner_socket_1_14 = {"parentId": "root", "parentSocket": "corner-socket-1-seat", "localStart": [-1.1, 0.65, 0.42400000000000004], "localEnd": [-1.1, 0.65, 0.42400000000000004], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_corner_socket_1_14 = makeAttachmentEndpoint(attachment_corner_socket_1_14);
  const node_corner_socket_1_14 = new THREE.Group();
  node_corner_socket_1_14.name = "corner socket 1__pivot";
  node_corner_socket_1_14.scale.set(1, 1, 1);
  if (endpoint_corner_socket_1_14) {
    node_corner_socket_1_14.position.copy(endpoint_corner_socket_1_14.start);
    node_corner_socket_1_14.rotation.set(1.57079632679, 0.0, 0.0);
  } else {
    node_corner_socket_1_14.position.set(-1.1, 0.65, 0.42400000000000004);
    node_corner_socket_1_14.rotation.set(1.57079632679, 0.0, 0.0);
  }
  node_corner_socket_1_14.userData.sculptComponent = {"id": "corner-socket-1", "name": "corner socket 1", "level": "micro", "role": "body", "importance": 0.9, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Discrete rigid manufactured part with bounded faces; primitive follows the observed silhouette.", "geometryDescriptor": {"topologyIntent": "Closed solid with visible rounded rim.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "corner-socket-1-seat", "localStart": [-1.1, 0.65, 0.42400000000000004], "localEnd": [-1.1, 0.65, 0.42400000000000004], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.0546, "height": 0.012, "depth": 0.0546, "units": "relative", "confidence": 0.85}, "transform": {"position": [-1.1, 0.65, 0.42400000000000004], "rotation": [1.57079632679, 0, 0]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "corner-socket-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "rubber"}}, "material": "rubber", "materialLayers": ["rubber"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "corner-socket-1-form", "type": "bevel", "description": "Reference-observed silhouette and bevel.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "fine molded grain", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Solid-color concept with subtle micro relief; not a measured finish."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structured", "colorMaterialRecipe": {"dominantAlbedo": "rgba(37,42,43,1)", "secondaryAlbedo": "rgba(37,42,43,1)", "materialClass": "rubber", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "notes": "Solid-color original conceptual reference."}};
  node_corner_socket_1_14.userData.actionProfile = {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "corner-socket-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "rubber"}};
  (nodes["root"] ?? root).add(node_corner_socket_1_14);
  nodes["corner-socket-1"] = node_corner_socket_1_14;
  const mesh_corner_socket_1_14Geometry = endpoint_corner_socket_1_14
    ? new THREE.CylinderGeometry(endpoint_corner_socket_1_14.endRadius, endpoint_corner_socket_1_14.baseRadius, endpoint_corner_socket_1_14.length, 8, 4)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 1);
  if (!endpoint_corner_socket_1_14) {
    mesh_corner_socket_1_14Geometry.scale(0.0546, 0.012, 0.0546);
  }
  const mesh_corner_socket_1_14 = new THREE.Mesh(
    mesh_corner_socket_1_14Geometry,
    materialMap["rubber"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_corner_socket_1_14.name = "corner socket 1";
  if (endpoint_corner_socket_1_14) {
    mesh_corner_socket_1_14.position.copy(endpoint_corner_socket_1_14.midpoint);
    mesh_corner_socket_1_14.quaternion.copy(endpoint_corner_socket_1_14.quaternion);
  }
  mesh_corner_socket_1_14.castShadow = options.castShadow ?? true;
  mesh_corner_socket_1_14.receiveShadow = options.receiveShadow ?? true;
  mesh_corner_socket_1_14.userData.sculptComponent = {"id": "corner-socket-1", "name": "corner socket 1", "level": "micro", "role": "body", "importance": 0.9, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Discrete rigid manufactured part with bounded faces; primitive follows the observed silhouette.", "geometryDescriptor": {"topologyIntent": "Closed solid with visible rounded rim.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "corner-socket-1-seat", "localStart": [-1.1, 0.65, 0.42400000000000004], "localEnd": [-1.1, 0.65, 0.42400000000000004], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.0546, "height": 0.012, "depth": 0.0546, "units": "relative", "confidence": 0.85}, "transform": {"position": [-1.1, 0.65, 0.42400000000000004], "rotation": [1.57079632679, 0, 0]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "corner-socket-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "rubber"}}, "material": "rubber", "materialLayers": ["rubber"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "corner-socket-1-form", "type": "bevel", "description": "Reference-observed silhouette and bevel.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "fine molded grain", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Solid-color concept with subtle micro relief; not a measured finish."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structured", "colorMaterialRecipe": {"dominantAlbedo": "rgba(37,42,43,1)", "secondaryAlbedo": "rgba(37,42,43,1)", "materialClass": "rubber", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "notes": "Solid-color original conceptual reference."}};
  node_corner_socket_1_14.add(mesh_corner_socket_1_14);
  meshes["corner-socket-1"] = mesh_corner_socket_1_14;
  colliders["corner-socket-1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."};
  destructionGroups["corner-socket-1"] ??= [];
  destructionGroups["corner-socket-1"].push(node_corner_socket_1_14);

  const attachment_corner_fastener_2_15 = {"parentId": "root", "parentSocket": "corner-fastener-2-seat", "localStart": [1.1, -0.65, 0.4], "localEnd": [1.1, -0.65, 0.4], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_corner_fastener_2_15 = makeAttachmentEndpoint(attachment_corner_fastener_2_15);
  const node_corner_fastener_2_15 = new THREE.Group();
  node_corner_fastener_2_15.name = "corner fastener 2__pivot";
  node_corner_fastener_2_15.scale.set(1, 1, 1);
  if (endpoint_corner_fastener_2_15) {
    node_corner_fastener_2_15.position.copy(endpoint_corner_fastener_2_15.start);
    node_corner_fastener_2_15.rotation.set(1.57079632679, 0.0, 0.0);
  } else {
    node_corner_fastener_2_15.position.set(1.1, -0.65, 0.4);
    node_corner_fastener_2_15.rotation.set(1.57079632679, 0.0, 0.0);
  }
  node_corner_fastener_2_15.userData.sculptComponent = {"id": "corner-fastener-2", "name": "corner fastener 2", "level": "meso", "role": "body", "importance": 0.9, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Discrete rigid manufactured part with bounded faces; primitive follows the observed silhouette.", "geometryDescriptor": {"topologyIntent": "Closed solid with visible rounded rim.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "corner-fastener-2-seat", "localStart": [1.1, -0.65, 0.4], "localEnd": [1.1, -0.65, 0.4], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.13, "height": 0.04, "depth": 0.13, "units": "relative", "confidence": 0.85}, "transform": {"position": [1.1, -0.65, 0.4], "rotation": [1.57079632679, 0, 0]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "corner-fastener-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "sand"}}, "material": "sand", "materialLayers": ["sand"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "corner-fastener-2-form", "type": "bevel", "description": "Reference-observed silhouette and bevel.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "fine molded grain", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Solid-color concept with subtle micro relief; not a measured finish."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structured", "colorMaterialRecipe": {"dominantAlbedo": "rgba(183,171,145,1)", "secondaryAlbedo": "rgba(183,171,145,1)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "notes": "Solid-color original conceptual reference."}};
  node_corner_fastener_2_15.userData.actionProfile = {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "corner-fastener-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "sand"}};
  (nodes["root"] ?? root).add(node_corner_fastener_2_15);
  nodes["corner-fastener-2"] = node_corner_fastener_2_15;
  const mesh_corner_fastener_2_15Geometry = endpoint_corner_fastener_2_15
    ? new THREE.CylinderGeometry(endpoint_corner_fastener_2_15.endRadius, endpoint_corner_fastener_2_15.baseRadius, endpoint_corner_fastener_2_15.length, 8, 4)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 1);
  if (!endpoint_corner_fastener_2_15) {
    mesh_corner_fastener_2_15Geometry.scale(0.13, 0.04, 0.13);
  }
  const mesh_corner_fastener_2_15 = new THREE.Mesh(
    mesh_corner_fastener_2_15Geometry,
    materialMap["sand"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_corner_fastener_2_15.name = "corner fastener 2";
  if (endpoint_corner_fastener_2_15) {
    mesh_corner_fastener_2_15.position.copy(endpoint_corner_fastener_2_15.midpoint);
    mesh_corner_fastener_2_15.quaternion.copy(endpoint_corner_fastener_2_15.quaternion);
  }
  mesh_corner_fastener_2_15.castShadow = options.castShadow ?? true;
  mesh_corner_fastener_2_15.receiveShadow = options.receiveShadow ?? true;
  mesh_corner_fastener_2_15.userData.sculptComponent = {"id": "corner-fastener-2", "name": "corner fastener 2", "level": "meso", "role": "body", "importance": 0.9, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Discrete rigid manufactured part with bounded faces; primitive follows the observed silhouette.", "geometryDescriptor": {"topologyIntent": "Closed solid with visible rounded rim.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "corner-fastener-2-seat", "localStart": [1.1, -0.65, 0.4], "localEnd": [1.1, -0.65, 0.4], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.13, "height": 0.04, "depth": 0.13, "units": "relative", "confidence": 0.85}, "transform": {"position": [1.1, -0.65, 0.4], "rotation": [1.57079632679, 0, 0]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "corner-fastener-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "sand"}}, "material": "sand", "materialLayers": ["sand"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "corner-fastener-2-form", "type": "bevel", "description": "Reference-observed silhouette and bevel.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "fine molded grain", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Solid-color concept with subtle micro relief; not a measured finish."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structured", "colorMaterialRecipe": {"dominantAlbedo": "rgba(183,171,145,1)", "secondaryAlbedo": "rgba(183,171,145,1)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "notes": "Solid-color original conceptual reference."}};
  node_corner_fastener_2_15.add(mesh_corner_fastener_2_15);
  meshes["corner-fastener-2"] = mesh_corner_fastener_2_15;
  colliders["corner-fastener-2"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."};
  destructionGroups["corner-fastener-2"] ??= [];
  destructionGroups["corner-fastener-2"].push(node_corner_fastener_2_15);

  const attachment_corner_socket_2_16 = {"parentId": "root", "parentSocket": "corner-socket-2-seat", "localStart": [1.1, -0.65, 0.42400000000000004], "localEnd": [1.1, -0.65, 0.42400000000000004], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_corner_socket_2_16 = makeAttachmentEndpoint(attachment_corner_socket_2_16);
  const node_corner_socket_2_16 = new THREE.Group();
  node_corner_socket_2_16.name = "corner socket 2__pivot";
  node_corner_socket_2_16.scale.set(1, 1, 1);
  if (endpoint_corner_socket_2_16) {
    node_corner_socket_2_16.position.copy(endpoint_corner_socket_2_16.start);
    node_corner_socket_2_16.rotation.set(1.57079632679, 0.0, 0.0);
  } else {
    node_corner_socket_2_16.position.set(1.1, -0.65, 0.42400000000000004);
    node_corner_socket_2_16.rotation.set(1.57079632679, 0.0, 0.0);
  }
  node_corner_socket_2_16.userData.sculptComponent = {"id": "corner-socket-2", "name": "corner socket 2", "level": "micro", "role": "body", "importance": 0.9, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Discrete rigid manufactured part with bounded faces; primitive follows the observed silhouette.", "geometryDescriptor": {"topologyIntent": "Closed solid with visible rounded rim.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "corner-socket-2-seat", "localStart": [1.1, -0.65, 0.42400000000000004], "localEnd": [1.1, -0.65, 0.42400000000000004], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.0546, "height": 0.012, "depth": 0.0546, "units": "relative", "confidence": 0.85}, "transform": {"position": [1.1, -0.65, 0.42400000000000004], "rotation": [1.57079632679, 0, 0]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "corner-socket-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "rubber"}}, "material": "rubber", "materialLayers": ["rubber"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "corner-socket-2-form", "type": "bevel", "description": "Reference-observed silhouette and bevel.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "fine molded grain", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Solid-color concept with subtle micro relief; not a measured finish."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structured", "colorMaterialRecipe": {"dominantAlbedo": "rgba(37,42,43,1)", "secondaryAlbedo": "rgba(37,42,43,1)", "materialClass": "rubber", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "notes": "Solid-color original conceptual reference."}};
  node_corner_socket_2_16.userData.actionProfile = {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "corner-socket-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "rubber"}};
  (nodes["root"] ?? root).add(node_corner_socket_2_16);
  nodes["corner-socket-2"] = node_corner_socket_2_16;
  const mesh_corner_socket_2_16Geometry = endpoint_corner_socket_2_16
    ? new THREE.CylinderGeometry(endpoint_corner_socket_2_16.endRadius, endpoint_corner_socket_2_16.baseRadius, endpoint_corner_socket_2_16.length, 8, 4)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 1);
  if (!endpoint_corner_socket_2_16) {
    mesh_corner_socket_2_16Geometry.scale(0.0546, 0.012, 0.0546);
  }
  const mesh_corner_socket_2_16 = new THREE.Mesh(
    mesh_corner_socket_2_16Geometry,
    materialMap["rubber"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_corner_socket_2_16.name = "corner socket 2";
  if (endpoint_corner_socket_2_16) {
    mesh_corner_socket_2_16.position.copy(endpoint_corner_socket_2_16.midpoint);
    mesh_corner_socket_2_16.quaternion.copy(endpoint_corner_socket_2_16.quaternion);
  }
  mesh_corner_socket_2_16.castShadow = options.castShadow ?? true;
  mesh_corner_socket_2_16.receiveShadow = options.receiveShadow ?? true;
  mesh_corner_socket_2_16.userData.sculptComponent = {"id": "corner-socket-2", "name": "corner socket 2", "level": "micro", "role": "body", "importance": 0.9, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Discrete rigid manufactured part with bounded faces; primitive follows the observed silhouette.", "geometryDescriptor": {"topologyIntent": "Closed solid with visible rounded rim.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "corner-socket-2-seat", "localStart": [1.1, -0.65, 0.42400000000000004], "localEnd": [1.1, -0.65, 0.42400000000000004], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.0546, "height": 0.012, "depth": 0.0546, "units": "relative", "confidence": 0.85}, "transform": {"position": [1.1, -0.65, 0.42400000000000004], "rotation": [1.57079632679, 0, 0]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "corner-socket-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "rubber"}}, "material": "rubber", "materialLayers": ["rubber"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "corner-socket-2-form", "type": "bevel", "description": "Reference-observed silhouette and bevel.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "fine molded grain", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Solid-color concept with subtle micro relief; not a measured finish."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structured", "colorMaterialRecipe": {"dominantAlbedo": "rgba(37,42,43,1)", "secondaryAlbedo": "rgba(37,42,43,1)", "materialClass": "rubber", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "notes": "Solid-color original conceptual reference."}};
  node_corner_socket_2_16.add(mesh_corner_socket_2_16);
  meshes["corner-socket-2"] = mesh_corner_socket_2_16;
  colliders["corner-socket-2"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."};
  destructionGroups["corner-socket-2"] ??= [];
  destructionGroups["corner-socket-2"].push(node_corner_socket_2_16);

  const attachment_corner_fastener_3_17 = {"parentId": "root", "parentSocket": "corner-fastener-3-seat", "localStart": [1.1, 0.65, 0.4], "localEnd": [1.1, 0.65, 0.4], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_corner_fastener_3_17 = makeAttachmentEndpoint(attachment_corner_fastener_3_17);
  const node_corner_fastener_3_17 = new THREE.Group();
  node_corner_fastener_3_17.name = "corner fastener 3__pivot";
  node_corner_fastener_3_17.scale.set(1, 1, 1);
  if (endpoint_corner_fastener_3_17) {
    node_corner_fastener_3_17.position.copy(endpoint_corner_fastener_3_17.start);
    node_corner_fastener_3_17.rotation.set(1.57079632679, 0.0, 0.0);
  } else {
    node_corner_fastener_3_17.position.set(1.1, 0.65, 0.4);
    node_corner_fastener_3_17.rotation.set(1.57079632679, 0.0, 0.0);
  }
  node_corner_fastener_3_17.userData.sculptComponent = {"id": "corner-fastener-3", "name": "corner fastener 3", "level": "meso", "role": "body", "importance": 0.9, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Discrete rigid manufactured part with bounded faces; primitive follows the observed silhouette.", "geometryDescriptor": {"topologyIntent": "Closed solid with visible rounded rim.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "corner-fastener-3-seat", "localStart": [1.1, 0.65, 0.4], "localEnd": [1.1, 0.65, 0.4], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.13, "height": 0.04, "depth": 0.13, "units": "relative", "confidence": 0.85}, "transform": {"position": [1.1, 0.65, 0.4], "rotation": [1.57079632679, 0, 0]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "corner-fastener-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "sand"}}, "material": "sand", "materialLayers": ["sand"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "corner-fastener-3-form", "type": "bevel", "description": "Reference-observed silhouette and bevel.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "fine molded grain", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Solid-color concept with subtle micro relief; not a measured finish."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structured", "colorMaterialRecipe": {"dominantAlbedo": "rgba(183,171,145,1)", "secondaryAlbedo": "rgba(183,171,145,1)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "notes": "Solid-color original conceptual reference."}};
  node_corner_fastener_3_17.userData.actionProfile = {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "corner-fastener-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "sand"}};
  (nodes["root"] ?? root).add(node_corner_fastener_3_17);
  nodes["corner-fastener-3"] = node_corner_fastener_3_17;
  const mesh_corner_fastener_3_17Geometry = endpoint_corner_fastener_3_17
    ? new THREE.CylinderGeometry(endpoint_corner_fastener_3_17.endRadius, endpoint_corner_fastener_3_17.baseRadius, endpoint_corner_fastener_3_17.length, 8, 4)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 1);
  if (!endpoint_corner_fastener_3_17) {
    mesh_corner_fastener_3_17Geometry.scale(0.13, 0.04, 0.13);
  }
  const mesh_corner_fastener_3_17 = new THREE.Mesh(
    mesh_corner_fastener_3_17Geometry,
    materialMap["sand"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_corner_fastener_3_17.name = "corner fastener 3";
  if (endpoint_corner_fastener_3_17) {
    mesh_corner_fastener_3_17.position.copy(endpoint_corner_fastener_3_17.midpoint);
    mesh_corner_fastener_3_17.quaternion.copy(endpoint_corner_fastener_3_17.quaternion);
  }
  mesh_corner_fastener_3_17.castShadow = options.castShadow ?? true;
  mesh_corner_fastener_3_17.receiveShadow = options.receiveShadow ?? true;
  mesh_corner_fastener_3_17.userData.sculptComponent = {"id": "corner-fastener-3", "name": "corner fastener 3", "level": "meso", "role": "body", "importance": 0.9, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Discrete rigid manufactured part with bounded faces; primitive follows the observed silhouette.", "geometryDescriptor": {"topologyIntent": "Closed solid with visible rounded rim.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "corner-fastener-3-seat", "localStart": [1.1, 0.65, 0.4], "localEnd": [1.1, 0.65, 0.4], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.13, "height": 0.04, "depth": 0.13, "units": "relative", "confidence": 0.85}, "transform": {"position": [1.1, 0.65, 0.4], "rotation": [1.57079632679, 0, 0]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "corner-fastener-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "sand"}}, "material": "sand", "materialLayers": ["sand"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "corner-fastener-3-form", "type": "bevel", "description": "Reference-observed silhouette and bevel.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "fine molded grain", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Solid-color concept with subtle micro relief; not a measured finish."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structured", "colorMaterialRecipe": {"dominantAlbedo": "rgba(183,171,145,1)", "secondaryAlbedo": "rgba(183,171,145,1)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "notes": "Solid-color original conceptual reference."}};
  node_corner_fastener_3_17.add(mesh_corner_fastener_3_17);
  meshes["corner-fastener-3"] = mesh_corner_fastener_3_17;
  colliders["corner-fastener-3"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."};
  destructionGroups["corner-fastener-3"] ??= [];
  destructionGroups["corner-fastener-3"].push(node_corner_fastener_3_17);

  const attachment_corner_socket_3_18 = {"parentId": "root", "parentSocket": "corner-socket-3-seat", "localStart": [1.1, 0.65, 0.42400000000000004], "localEnd": [1.1, 0.65, 0.42400000000000004], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_corner_socket_3_18 = makeAttachmentEndpoint(attachment_corner_socket_3_18);
  const node_corner_socket_3_18 = new THREE.Group();
  node_corner_socket_3_18.name = "corner socket 3__pivot";
  node_corner_socket_3_18.scale.set(1, 1, 1);
  if (endpoint_corner_socket_3_18) {
    node_corner_socket_3_18.position.copy(endpoint_corner_socket_3_18.start);
    node_corner_socket_3_18.rotation.set(1.57079632679, 0.0, 0.0);
  } else {
    node_corner_socket_3_18.position.set(1.1, 0.65, 0.42400000000000004);
    node_corner_socket_3_18.rotation.set(1.57079632679, 0.0, 0.0);
  }
  node_corner_socket_3_18.userData.sculptComponent = {"id": "corner-socket-3", "name": "corner socket 3", "level": "micro", "role": "body", "importance": 0.9, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Discrete rigid manufactured part with bounded faces; primitive follows the observed silhouette.", "geometryDescriptor": {"topologyIntent": "Closed solid with visible rounded rim.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "corner-socket-3-seat", "localStart": [1.1, 0.65, 0.42400000000000004], "localEnd": [1.1, 0.65, 0.42400000000000004], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.0546, "height": 0.012, "depth": 0.0546, "units": "relative", "confidence": 0.85}, "transform": {"position": [1.1, 0.65, 0.42400000000000004], "rotation": [1.57079632679, 0, 0]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "corner-socket-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "rubber"}}, "material": "rubber", "materialLayers": ["rubber"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "corner-socket-3-form", "type": "bevel", "description": "Reference-observed silhouette and bevel.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "fine molded grain", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Solid-color concept with subtle micro relief; not a measured finish."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structured", "colorMaterialRecipe": {"dominantAlbedo": "rgba(37,42,43,1)", "secondaryAlbedo": "rgba(37,42,43,1)", "materialClass": "rubber", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "notes": "Solid-color original conceptual reference."}};
  node_corner_socket_3_18.userData.actionProfile = {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "corner-socket-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "rubber"}};
  (nodes["root"] ?? root).add(node_corner_socket_3_18);
  nodes["corner-socket-3"] = node_corner_socket_3_18;
  const mesh_corner_socket_3_18Geometry = endpoint_corner_socket_3_18
    ? new THREE.CylinderGeometry(endpoint_corner_socket_3_18.endRadius, endpoint_corner_socket_3_18.baseRadius, endpoint_corner_socket_3_18.length, 8, 4)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 1);
  if (!endpoint_corner_socket_3_18) {
    mesh_corner_socket_3_18Geometry.scale(0.0546, 0.012, 0.0546);
  }
  const mesh_corner_socket_3_18 = new THREE.Mesh(
    mesh_corner_socket_3_18Geometry,
    materialMap["rubber"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_corner_socket_3_18.name = "corner socket 3";
  if (endpoint_corner_socket_3_18) {
    mesh_corner_socket_3_18.position.copy(endpoint_corner_socket_3_18.midpoint);
    mesh_corner_socket_3_18.quaternion.copy(endpoint_corner_socket_3_18.quaternion);
  }
  mesh_corner_socket_3_18.castShadow = options.castShadow ?? true;
  mesh_corner_socket_3_18.receiveShadow = options.receiveShadow ?? true;
  mesh_corner_socket_3_18.userData.sculptComponent = {"id": "corner-socket-3", "name": "corner socket 3", "level": "micro", "role": "body", "importance": 0.9, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Discrete rigid manufactured part with bounded faces; primitive follows the observed silhouette.", "geometryDescriptor": {"topologyIntent": "Closed solid with visible rounded rim.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "corner-socket-3-seat", "localStart": [1.1, 0.65, 0.42400000000000004], "localEnd": [1.1, 0.65, 0.42400000000000004], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.0546, "height": 0.012, "depth": 0.0546, "units": "relative", "confidence": 0.85}, "transform": {"position": [1.1, 0.65, 0.42400000000000004], "rotation": [1.57079632679, 0, 0]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "corner-socket-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "rubber"}}, "material": "rubber", "materialLayers": ["rubber"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "corner-socket-3-form", "type": "bevel", "description": "Reference-observed silhouette and bevel.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "fine molded grain", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Solid-color concept with subtle micro relief; not a measured finish."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structured", "colorMaterialRecipe": {"dominantAlbedo": "rgba(37,42,43,1)", "secondaryAlbedo": "rgba(37,42,43,1)", "materialClass": "rubber", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "notes": "Solid-color original conceptual reference."}};
  node_corner_socket_3_18.add(mesh_corner_socket_3_18);
  meshes["corner-socket-3"] = mesh_corner_socket_3_18;
  colliders["corner-socket-3"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."};
  destructionGroups["corner-socket-3"] ??= [];
  destructionGroups["corner-socket-3"].push(node_corner_socket_3_18);

  const attachment_lens_fastener_0_19 = {"parentId": "root", "parentSocket": "lens-fastener-0-seat", "localStart": [-0.43, -0.43, 0.53], "localEnd": [-0.43, -0.43, 0.53], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_lens_fastener_0_19 = makeAttachmentEndpoint(attachment_lens_fastener_0_19);
  const node_lens_fastener_0_19 = new THREE.Group();
  node_lens_fastener_0_19.name = "lens fastener 0__pivot";
  node_lens_fastener_0_19.scale.set(1, 1, 1);
  if (endpoint_lens_fastener_0_19) {
    node_lens_fastener_0_19.position.copy(endpoint_lens_fastener_0_19.start);
    node_lens_fastener_0_19.rotation.set(1.57079632679, 0.0, 0.0);
  } else {
    node_lens_fastener_0_19.position.set(-0.43, -0.43, 0.53);
    node_lens_fastener_0_19.rotation.set(1.57079632679, 0.0, 0.0);
  }
  node_lens_fastener_0_19.userData.sculptComponent = {"id": "lens-fastener-0", "name": "lens fastener 0", "level": "meso", "role": "body", "importance": 0.9, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Discrete rigid manufactured part with bounded faces; primitive follows the observed silhouette.", "geometryDescriptor": {"topologyIntent": "Closed solid with visible rounded rim.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "lens-fastener-0-seat", "localStart": [-0.43, -0.43, 0.53], "localEnd": [-0.43, -0.43, 0.53], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.105, "height": 0.04, "depth": 0.105, "units": "relative", "confidence": 0.85}, "transform": {"position": [-0.43, -0.43, 0.53], "rotation": [1.57079632679, 0, 0]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lens-fastener-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "sand"}}, "material": "sand", "materialLayers": ["sand"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "lens-fastener-0-form", "type": "bevel", "description": "Reference-observed silhouette and bevel.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "fine molded grain", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Solid-color concept with subtle micro relief; not a measured finish."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structured", "colorMaterialRecipe": {"dominantAlbedo": "rgba(183,171,145,1)", "secondaryAlbedo": "rgba(183,171,145,1)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "notes": "Solid-color original conceptual reference."}};
  node_lens_fastener_0_19.userData.actionProfile = {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lens-fastener-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "sand"}};
  (nodes["root"] ?? root).add(node_lens_fastener_0_19);
  nodes["lens-fastener-0"] = node_lens_fastener_0_19;
  const mesh_lens_fastener_0_19Geometry = endpoint_lens_fastener_0_19
    ? new THREE.CylinderGeometry(endpoint_lens_fastener_0_19.endRadius, endpoint_lens_fastener_0_19.baseRadius, endpoint_lens_fastener_0_19.length, 8, 4)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 1);
  if (!endpoint_lens_fastener_0_19) {
    mesh_lens_fastener_0_19Geometry.scale(0.105, 0.04, 0.105);
  }
  const mesh_lens_fastener_0_19 = new THREE.Mesh(
    mesh_lens_fastener_0_19Geometry,
    materialMap["sand"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_lens_fastener_0_19.name = "lens fastener 0";
  if (endpoint_lens_fastener_0_19) {
    mesh_lens_fastener_0_19.position.copy(endpoint_lens_fastener_0_19.midpoint);
    mesh_lens_fastener_0_19.quaternion.copy(endpoint_lens_fastener_0_19.quaternion);
  }
  mesh_lens_fastener_0_19.castShadow = options.castShadow ?? true;
  mesh_lens_fastener_0_19.receiveShadow = options.receiveShadow ?? true;
  mesh_lens_fastener_0_19.userData.sculptComponent = {"id": "lens-fastener-0", "name": "lens fastener 0", "level": "meso", "role": "body", "importance": 0.9, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Discrete rigid manufactured part with bounded faces; primitive follows the observed silhouette.", "geometryDescriptor": {"topologyIntent": "Closed solid with visible rounded rim.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "lens-fastener-0-seat", "localStart": [-0.43, -0.43, 0.53], "localEnd": [-0.43, -0.43, 0.53], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.105, "height": 0.04, "depth": 0.105, "units": "relative", "confidence": 0.85}, "transform": {"position": [-0.43, -0.43, 0.53], "rotation": [1.57079632679, 0, 0]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lens-fastener-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "sand"}}, "material": "sand", "materialLayers": ["sand"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "lens-fastener-0-form", "type": "bevel", "description": "Reference-observed silhouette and bevel.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "fine molded grain", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Solid-color concept with subtle micro relief; not a measured finish."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structured", "colorMaterialRecipe": {"dominantAlbedo": "rgba(183,171,145,1)", "secondaryAlbedo": "rgba(183,171,145,1)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "notes": "Solid-color original conceptual reference."}};
  node_lens_fastener_0_19.add(mesh_lens_fastener_0_19);
  meshes["lens-fastener-0"] = mesh_lens_fastener_0_19;
  colliders["lens-fastener-0"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."};
  destructionGroups["lens-fastener-0"] ??= [];
  destructionGroups["lens-fastener-0"].push(node_lens_fastener_0_19);

  const attachment_lens_socket_0_20 = {"parentId": "root", "parentSocket": "lens-socket-0-seat", "localStart": [-0.43, -0.43, 0.554], "localEnd": [-0.43, -0.43, 0.554], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_lens_socket_0_20 = makeAttachmentEndpoint(attachment_lens_socket_0_20);
  const node_lens_socket_0_20 = new THREE.Group();
  node_lens_socket_0_20.name = "lens socket 0__pivot";
  node_lens_socket_0_20.scale.set(1, 1, 1);
  if (endpoint_lens_socket_0_20) {
    node_lens_socket_0_20.position.copy(endpoint_lens_socket_0_20.start);
    node_lens_socket_0_20.rotation.set(1.57079632679, 0.0, 0.0);
  } else {
    node_lens_socket_0_20.position.set(-0.43, -0.43, 0.554);
    node_lens_socket_0_20.rotation.set(1.57079632679, 0.0, 0.0);
  }
  node_lens_socket_0_20.userData.sculptComponent = {"id": "lens-socket-0", "name": "lens socket 0", "level": "micro", "role": "body", "importance": 0.9, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Discrete rigid manufactured part with bounded faces; primitive follows the observed silhouette.", "geometryDescriptor": {"topologyIntent": "Closed solid with visible rounded rim.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "lens-socket-0-seat", "localStart": [-0.43, -0.43, 0.554], "localEnd": [-0.43, -0.43, 0.554], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.04409999999999999, "height": 0.012, "depth": 0.04409999999999999, "units": "relative", "confidence": 0.85}, "transform": {"position": [-0.43, -0.43, 0.554], "rotation": [1.57079632679, 0, 0]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lens-socket-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "rubber"}}, "material": "rubber", "materialLayers": ["rubber"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "lens-socket-0-form", "type": "bevel", "description": "Reference-observed silhouette and bevel.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "fine molded grain", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Solid-color concept with subtle micro relief; not a measured finish."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structured", "colorMaterialRecipe": {"dominantAlbedo": "rgba(37,42,43,1)", "secondaryAlbedo": "rgba(37,42,43,1)", "materialClass": "rubber", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "notes": "Solid-color original conceptual reference."}};
  node_lens_socket_0_20.userData.actionProfile = {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lens-socket-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "rubber"}};
  (nodes["root"] ?? root).add(node_lens_socket_0_20);
  nodes["lens-socket-0"] = node_lens_socket_0_20;
  const mesh_lens_socket_0_20Geometry = endpoint_lens_socket_0_20
    ? new THREE.CylinderGeometry(endpoint_lens_socket_0_20.endRadius, endpoint_lens_socket_0_20.baseRadius, endpoint_lens_socket_0_20.length, 8, 4)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 1);
  if (!endpoint_lens_socket_0_20) {
    mesh_lens_socket_0_20Geometry.scale(0.04409999999999999, 0.012, 0.04409999999999999);
  }
  const mesh_lens_socket_0_20 = new THREE.Mesh(
    mesh_lens_socket_0_20Geometry,
    materialMap["rubber"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_lens_socket_0_20.name = "lens socket 0";
  if (endpoint_lens_socket_0_20) {
    mesh_lens_socket_0_20.position.copy(endpoint_lens_socket_0_20.midpoint);
    mesh_lens_socket_0_20.quaternion.copy(endpoint_lens_socket_0_20.quaternion);
  }
  mesh_lens_socket_0_20.castShadow = options.castShadow ?? true;
  mesh_lens_socket_0_20.receiveShadow = options.receiveShadow ?? true;
  mesh_lens_socket_0_20.userData.sculptComponent = {"id": "lens-socket-0", "name": "lens socket 0", "level": "micro", "role": "body", "importance": 0.9, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Discrete rigid manufactured part with bounded faces; primitive follows the observed silhouette.", "geometryDescriptor": {"topologyIntent": "Closed solid with visible rounded rim.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "lens-socket-0-seat", "localStart": [-0.43, -0.43, 0.554], "localEnd": [-0.43, -0.43, 0.554], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.04409999999999999, "height": 0.012, "depth": 0.04409999999999999, "units": "relative", "confidence": 0.85}, "transform": {"position": [-0.43, -0.43, 0.554], "rotation": [1.57079632679, 0, 0]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lens-socket-0", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "rubber"}}, "material": "rubber", "materialLayers": ["rubber"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "lens-socket-0-form", "type": "bevel", "description": "Reference-observed silhouette and bevel.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "fine molded grain", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Solid-color concept with subtle micro relief; not a measured finish."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structured", "colorMaterialRecipe": {"dominantAlbedo": "rgba(37,42,43,1)", "secondaryAlbedo": "rgba(37,42,43,1)", "materialClass": "rubber", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "notes": "Solid-color original conceptual reference."}};
  node_lens_socket_0_20.add(mesh_lens_socket_0_20);
  meshes["lens-socket-0"] = mesh_lens_socket_0_20;
  colliders["lens-socket-0"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."};
  destructionGroups["lens-socket-0"] ??= [];
  destructionGroups["lens-socket-0"].push(node_lens_socket_0_20);

  const attachment_lens_fastener_1_21 = {"parentId": "root", "parentSocket": "lens-fastener-1-seat", "localStart": [-0.43, 0.43, 0.53], "localEnd": [-0.43, 0.43, 0.53], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_lens_fastener_1_21 = makeAttachmentEndpoint(attachment_lens_fastener_1_21);
  const node_lens_fastener_1_21 = new THREE.Group();
  node_lens_fastener_1_21.name = "lens fastener 1__pivot";
  node_lens_fastener_1_21.scale.set(1, 1, 1);
  if (endpoint_lens_fastener_1_21) {
    node_lens_fastener_1_21.position.copy(endpoint_lens_fastener_1_21.start);
    node_lens_fastener_1_21.rotation.set(1.57079632679, 0.0, 0.0);
  } else {
    node_lens_fastener_1_21.position.set(-0.43, 0.43, 0.53);
    node_lens_fastener_1_21.rotation.set(1.57079632679, 0.0, 0.0);
  }
  node_lens_fastener_1_21.userData.sculptComponent = {"id": "lens-fastener-1", "name": "lens fastener 1", "level": "meso", "role": "body", "importance": 0.9, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Discrete rigid manufactured part with bounded faces; primitive follows the observed silhouette.", "geometryDescriptor": {"topologyIntent": "Closed solid with visible rounded rim.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "lens-fastener-1-seat", "localStart": [-0.43, 0.43, 0.53], "localEnd": [-0.43, 0.43, 0.53], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.105, "height": 0.04, "depth": 0.105, "units": "relative", "confidence": 0.85}, "transform": {"position": [-0.43, 0.43, 0.53], "rotation": [1.57079632679, 0, 0]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lens-fastener-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "sand"}}, "material": "sand", "materialLayers": ["sand"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "lens-fastener-1-form", "type": "bevel", "description": "Reference-observed silhouette and bevel.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "fine molded grain", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Solid-color concept with subtle micro relief; not a measured finish."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structured", "colorMaterialRecipe": {"dominantAlbedo": "rgba(183,171,145,1)", "secondaryAlbedo": "rgba(183,171,145,1)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "notes": "Solid-color original conceptual reference."}};
  node_lens_fastener_1_21.userData.actionProfile = {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lens-fastener-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "sand"}};
  (nodes["root"] ?? root).add(node_lens_fastener_1_21);
  nodes["lens-fastener-1"] = node_lens_fastener_1_21;
  const mesh_lens_fastener_1_21Geometry = endpoint_lens_fastener_1_21
    ? new THREE.CylinderGeometry(endpoint_lens_fastener_1_21.endRadius, endpoint_lens_fastener_1_21.baseRadius, endpoint_lens_fastener_1_21.length, 8, 4)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 1);
  if (!endpoint_lens_fastener_1_21) {
    mesh_lens_fastener_1_21Geometry.scale(0.105, 0.04, 0.105);
  }
  const mesh_lens_fastener_1_21 = new THREE.Mesh(
    mesh_lens_fastener_1_21Geometry,
    materialMap["sand"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_lens_fastener_1_21.name = "lens fastener 1";
  if (endpoint_lens_fastener_1_21) {
    mesh_lens_fastener_1_21.position.copy(endpoint_lens_fastener_1_21.midpoint);
    mesh_lens_fastener_1_21.quaternion.copy(endpoint_lens_fastener_1_21.quaternion);
  }
  mesh_lens_fastener_1_21.castShadow = options.castShadow ?? true;
  mesh_lens_fastener_1_21.receiveShadow = options.receiveShadow ?? true;
  mesh_lens_fastener_1_21.userData.sculptComponent = {"id": "lens-fastener-1", "name": "lens fastener 1", "level": "meso", "role": "body", "importance": 0.9, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Discrete rigid manufactured part with bounded faces; primitive follows the observed silhouette.", "geometryDescriptor": {"topologyIntent": "Closed solid with visible rounded rim.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "lens-fastener-1-seat", "localStart": [-0.43, 0.43, 0.53], "localEnd": [-0.43, 0.43, 0.53], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.105, "height": 0.04, "depth": 0.105, "units": "relative", "confidence": 0.85}, "transform": {"position": [-0.43, 0.43, 0.53], "rotation": [1.57079632679, 0, 0]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lens-fastener-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "sand"}}, "material": "sand", "materialLayers": ["sand"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "lens-fastener-1-form", "type": "bevel", "description": "Reference-observed silhouette and bevel.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "fine molded grain", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Solid-color concept with subtle micro relief; not a measured finish."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structured", "colorMaterialRecipe": {"dominantAlbedo": "rgba(183,171,145,1)", "secondaryAlbedo": "rgba(183,171,145,1)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "notes": "Solid-color original conceptual reference."}};
  node_lens_fastener_1_21.add(mesh_lens_fastener_1_21);
  meshes["lens-fastener-1"] = mesh_lens_fastener_1_21;
  colliders["lens-fastener-1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."};
  destructionGroups["lens-fastener-1"] ??= [];
  destructionGroups["lens-fastener-1"].push(node_lens_fastener_1_21);

  const attachment_lens_socket_1_22 = {"parentId": "root", "parentSocket": "lens-socket-1-seat", "localStart": [-0.43, 0.43, 0.554], "localEnd": [-0.43, 0.43, 0.554], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_lens_socket_1_22 = makeAttachmentEndpoint(attachment_lens_socket_1_22);
  const node_lens_socket_1_22 = new THREE.Group();
  node_lens_socket_1_22.name = "lens socket 1__pivot";
  node_lens_socket_1_22.scale.set(1, 1, 1);
  if (endpoint_lens_socket_1_22) {
    node_lens_socket_1_22.position.copy(endpoint_lens_socket_1_22.start);
    node_lens_socket_1_22.rotation.set(1.57079632679, 0.0, 0.0);
  } else {
    node_lens_socket_1_22.position.set(-0.43, 0.43, 0.554);
    node_lens_socket_1_22.rotation.set(1.57079632679, 0.0, 0.0);
  }
  node_lens_socket_1_22.userData.sculptComponent = {"id": "lens-socket-1", "name": "lens socket 1", "level": "micro", "role": "body", "importance": 0.9, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Discrete rigid manufactured part with bounded faces; primitive follows the observed silhouette.", "geometryDescriptor": {"topologyIntent": "Closed solid with visible rounded rim.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "lens-socket-1-seat", "localStart": [-0.43, 0.43, 0.554], "localEnd": [-0.43, 0.43, 0.554], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.04409999999999999, "height": 0.012, "depth": 0.04409999999999999, "units": "relative", "confidence": 0.85}, "transform": {"position": [-0.43, 0.43, 0.554], "rotation": [1.57079632679, 0, 0]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lens-socket-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "rubber"}}, "material": "rubber", "materialLayers": ["rubber"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "lens-socket-1-form", "type": "bevel", "description": "Reference-observed silhouette and bevel.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "fine molded grain", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Solid-color concept with subtle micro relief; not a measured finish."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structured", "colorMaterialRecipe": {"dominantAlbedo": "rgba(37,42,43,1)", "secondaryAlbedo": "rgba(37,42,43,1)", "materialClass": "rubber", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "notes": "Solid-color original conceptual reference."}};
  node_lens_socket_1_22.userData.actionProfile = {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lens-socket-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "rubber"}};
  (nodes["root"] ?? root).add(node_lens_socket_1_22);
  nodes["lens-socket-1"] = node_lens_socket_1_22;
  const mesh_lens_socket_1_22Geometry = endpoint_lens_socket_1_22
    ? new THREE.CylinderGeometry(endpoint_lens_socket_1_22.endRadius, endpoint_lens_socket_1_22.baseRadius, endpoint_lens_socket_1_22.length, 8, 4)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 1);
  if (!endpoint_lens_socket_1_22) {
    mesh_lens_socket_1_22Geometry.scale(0.04409999999999999, 0.012, 0.04409999999999999);
  }
  const mesh_lens_socket_1_22 = new THREE.Mesh(
    mesh_lens_socket_1_22Geometry,
    materialMap["rubber"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_lens_socket_1_22.name = "lens socket 1";
  if (endpoint_lens_socket_1_22) {
    mesh_lens_socket_1_22.position.copy(endpoint_lens_socket_1_22.midpoint);
    mesh_lens_socket_1_22.quaternion.copy(endpoint_lens_socket_1_22.quaternion);
  }
  mesh_lens_socket_1_22.castShadow = options.castShadow ?? true;
  mesh_lens_socket_1_22.receiveShadow = options.receiveShadow ?? true;
  mesh_lens_socket_1_22.userData.sculptComponent = {"id": "lens-socket-1", "name": "lens socket 1", "level": "micro", "role": "body", "importance": 0.9, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Discrete rigid manufactured part with bounded faces; primitive follows the observed silhouette.", "geometryDescriptor": {"topologyIntent": "Closed solid with visible rounded rim.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "lens-socket-1-seat", "localStart": [-0.43, 0.43, 0.554], "localEnd": [-0.43, 0.43, 0.554], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.04409999999999999, "height": 0.012, "depth": 0.04409999999999999, "units": "relative", "confidence": 0.85}, "transform": {"position": [-0.43, 0.43, 0.554], "rotation": [1.57079632679, 0, 0]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lens-socket-1", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "rubber"}}, "material": "rubber", "materialLayers": ["rubber"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "lens-socket-1-form", "type": "bevel", "description": "Reference-observed silhouette and bevel.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "fine molded grain", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Solid-color concept with subtle micro relief; not a measured finish."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structured", "colorMaterialRecipe": {"dominantAlbedo": "rgba(37,42,43,1)", "secondaryAlbedo": "rgba(37,42,43,1)", "materialClass": "rubber", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "notes": "Solid-color original conceptual reference."}};
  node_lens_socket_1_22.add(mesh_lens_socket_1_22);
  meshes["lens-socket-1"] = mesh_lens_socket_1_22;
  colliders["lens-socket-1"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."};
  destructionGroups["lens-socket-1"] ??= [];
  destructionGroups["lens-socket-1"].push(node_lens_socket_1_22);

  const attachment_lens_fastener_2_23 = {"parentId": "root", "parentSocket": "lens-fastener-2-seat", "localStart": [0.43, -0.43, 0.53], "localEnd": [0.43, -0.43, 0.53], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_lens_fastener_2_23 = makeAttachmentEndpoint(attachment_lens_fastener_2_23);
  const node_lens_fastener_2_23 = new THREE.Group();
  node_lens_fastener_2_23.name = "lens fastener 2__pivot";
  node_lens_fastener_2_23.scale.set(1, 1, 1);
  if (endpoint_lens_fastener_2_23) {
    node_lens_fastener_2_23.position.copy(endpoint_lens_fastener_2_23.start);
    node_lens_fastener_2_23.rotation.set(1.57079632679, 0.0, 0.0);
  } else {
    node_lens_fastener_2_23.position.set(0.43, -0.43, 0.53);
    node_lens_fastener_2_23.rotation.set(1.57079632679, 0.0, 0.0);
  }
  node_lens_fastener_2_23.userData.sculptComponent = {"id": "lens-fastener-2", "name": "lens fastener 2", "level": "meso", "role": "body", "importance": 0.9, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Discrete rigid manufactured part with bounded faces; primitive follows the observed silhouette.", "geometryDescriptor": {"topologyIntent": "Closed solid with visible rounded rim.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "lens-fastener-2-seat", "localStart": [0.43, -0.43, 0.53], "localEnd": [0.43, -0.43, 0.53], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.105, "height": 0.04, "depth": 0.105, "units": "relative", "confidence": 0.85}, "transform": {"position": [0.43, -0.43, 0.53], "rotation": [1.57079632679, 0, 0]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lens-fastener-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "sand"}}, "material": "sand", "materialLayers": ["sand"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "lens-fastener-2-form", "type": "bevel", "description": "Reference-observed silhouette and bevel.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "fine molded grain", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Solid-color concept with subtle micro relief; not a measured finish."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structured", "colorMaterialRecipe": {"dominantAlbedo": "rgba(183,171,145,1)", "secondaryAlbedo": "rgba(183,171,145,1)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "notes": "Solid-color original conceptual reference."}};
  node_lens_fastener_2_23.userData.actionProfile = {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lens-fastener-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "sand"}};
  (nodes["root"] ?? root).add(node_lens_fastener_2_23);
  nodes["lens-fastener-2"] = node_lens_fastener_2_23;
  const mesh_lens_fastener_2_23Geometry = endpoint_lens_fastener_2_23
    ? new THREE.CylinderGeometry(endpoint_lens_fastener_2_23.endRadius, endpoint_lens_fastener_2_23.baseRadius, endpoint_lens_fastener_2_23.length, 8, 4)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 1);
  if (!endpoint_lens_fastener_2_23) {
    mesh_lens_fastener_2_23Geometry.scale(0.105, 0.04, 0.105);
  }
  const mesh_lens_fastener_2_23 = new THREE.Mesh(
    mesh_lens_fastener_2_23Geometry,
    materialMap["sand"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_lens_fastener_2_23.name = "lens fastener 2";
  if (endpoint_lens_fastener_2_23) {
    mesh_lens_fastener_2_23.position.copy(endpoint_lens_fastener_2_23.midpoint);
    mesh_lens_fastener_2_23.quaternion.copy(endpoint_lens_fastener_2_23.quaternion);
  }
  mesh_lens_fastener_2_23.castShadow = options.castShadow ?? true;
  mesh_lens_fastener_2_23.receiveShadow = options.receiveShadow ?? true;
  mesh_lens_fastener_2_23.userData.sculptComponent = {"id": "lens-fastener-2", "name": "lens fastener 2", "level": "meso", "role": "body", "importance": 0.9, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Discrete rigid manufactured part with bounded faces; primitive follows the observed silhouette.", "geometryDescriptor": {"topologyIntent": "Closed solid with visible rounded rim.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "lens-fastener-2-seat", "localStart": [0.43, -0.43, 0.53], "localEnd": [0.43, -0.43, 0.53], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.105, "height": 0.04, "depth": 0.105, "units": "relative", "confidence": 0.85}, "transform": {"position": [0.43, -0.43, 0.53], "rotation": [1.57079632679, 0, 0]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lens-fastener-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "sand"}}, "material": "sand", "materialLayers": ["sand"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "lens-fastener-2-form", "type": "bevel", "description": "Reference-observed silhouette and bevel.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "fine molded grain", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Solid-color concept with subtle micro relief; not a measured finish."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structured", "colorMaterialRecipe": {"dominantAlbedo": "rgba(183,171,145,1)", "secondaryAlbedo": "rgba(183,171,145,1)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "notes": "Solid-color original conceptual reference."}};
  node_lens_fastener_2_23.add(mesh_lens_fastener_2_23);
  meshes["lens-fastener-2"] = mesh_lens_fastener_2_23;
  colliders["lens-fastener-2"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."};
  destructionGroups["lens-fastener-2"] ??= [];
  destructionGroups["lens-fastener-2"].push(node_lens_fastener_2_23);

  const attachment_lens_socket_2_24 = {"parentId": "root", "parentSocket": "lens-socket-2-seat", "localStart": [0.43, -0.43, 0.554], "localEnd": [0.43, -0.43, 0.554], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_lens_socket_2_24 = makeAttachmentEndpoint(attachment_lens_socket_2_24);
  const node_lens_socket_2_24 = new THREE.Group();
  node_lens_socket_2_24.name = "lens socket 2__pivot";
  node_lens_socket_2_24.scale.set(1, 1, 1);
  if (endpoint_lens_socket_2_24) {
    node_lens_socket_2_24.position.copy(endpoint_lens_socket_2_24.start);
    node_lens_socket_2_24.rotation.set(1.57079632679, 0.0, 0.0);
  } else {
    node_lens_socket_2_24.position.set(0.43, -0.43, 0.554);
    node_lens_socket_2_24.rotation.set(1.57079632679, 0.0, 0.0);
  }
  node_lens_socket_2_24.userData.sculptComponent = {"id": "lens-socket-2", "name": "lens socket 2", "level": "micro", "role": "body", "importance": 0.9, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Discrete rigid manufactured part with bounded faces; primitive follows the observed silhouette.", "geometryDescriptor": {"topologyIntent": "Closed solid with visible rounded rim.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "lens-socket-2-seat", "localStart": [0.43, -0.43, 0.554], "localEnd": [0.43, -0.43, 0.554], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.04409999999999999, "height": 0.012, "depth": 0.04409999999999999, "units": "relative", "confidence": 0.85}, "transform": {"position": [0.43, -0.43, 0.554], "rotation": [1.57079632679, 0, 0]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lens-socket-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "rubber"}}, "material": "rubber", "materialLayers": ["rubber"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "lens-socket-2-form", "type": "bevel", "description": "Reference-observed silhouette and bevel.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "fine molded grain", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Solid-color concept with subtle micro relief; not a measured finish."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structured", "colorMaterialRecipe": {"dominantAlbedo": "rgba(37,42,43,1)", "secondaryAlbedo": "rgba(37,42,43,1)", "materialClass": "rubber", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "notes": "Solid-color original conceptual reference."}};
  node_lens_socket_2_24.userData.actionProfile = {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lens-socket-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "rubber"}};
  (nodes["root"] ?? root).add(node_lens_socket_2_24);
  nodes["lens-socket-2"] = node_lens_socket_2_24;
  const mesh_lens_socket_2_24Geometry = endpoint_lens_socket_2_24
    ? new THREE.CylinderGeometry(endpoint_lens_socket_2_24.endRadius, endpoint_lens_socket_2_24.baseRadius, endpoint_lens_socket_2_24.length, 8, 4)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 1);
  if (!endpoint_lens_socket_2_24) {
    mesh_lens_socket_2_24Geometry.scale(0.04409999999999999, 0.012, 0.04409999999999999);
  }
  const mesh_lens_socket_2_24 = new THREE.Mesh(
    mesh_lens_socket_2_24Geometry,
    materialMap["rubber"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_lens_socket_2_24.name = "lens socket 2";
  if (endpoint_lens_socket_2_24) {
    mesh_lens_socket_2_24.position.copy(endpoint_lens_socket_2_24.midpoint);
    mesh_lens_socket_2_24.quaternion.copy(endpoint_lens_socket_2_24.quaternion);
  }
  mesh_lens_socket_2_24.castShadow = options.castShadow ?? true;
  mesh_lens_socket_2_24.receiveShadow = options.receiveShadow ?? true;
  mesh_lens_socket_2_24.userData.sculptComponent = {"id": "lens-socket-2", "name": "lens socket 2", "level": "micro", "role": "body", "importance": 0.9, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Discrete rigid manufactured part with bounded faces; primitive follows the observed silhouette.", "geometryDescriptor": {"topologyIntent": "Closed solid with visible rounded rim.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "lens-socket-2-seat", "localStart": [0.43, -0.43, 0.554], "localEnd": [0.43, -0.43, 0.554], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.04409999999999999, "height": 0.012, "depth": 0.04409999999999999, "units": "relative", "confidence": 0.85}, "transform": {"position": [0.43, -0.43, 0.554], "rotation": [1.57079632679, 0, 0]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lens-socket-2", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "rubber"}}, "material": "rubber", "materialLayers": ["rubber"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "lens-socket-2-form", "type": "bevel", "description": "Reference-observed silhouette and bevel.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "fine molded grain", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Solid-color concept with subtle micro relief; not a measured finish."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structured", "colorMaterialRecipe": {"dominantAlbedo": "rgba(37,42,43,1)", "secondaryAlbedo": "rgba(37,42,43,1)", "materialClass": "rubber", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "notes": "Solid-color original conceptual reference."}};
  node_lens_socket_2_24.add(mesh_lens_socket_2_24);
  meshes["lens-socket-2"] = mesh_lens_socket_2_24;
  colliders["lens-socket-2"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."};
  destructionGroups["lens-socket-2"] ??= [];
  destructionGroups["lens-socket-2"].push(node_lens_socket_2_24);

  const attachment_lens_fastener_3_25 = {"parentId": "root", "parentSocket": "lens-fastener-3-seat", "localStart": [0.43, 0.43, 0.53], "localEnd": [0.43, 0.43, 0.53], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_lens_fastener_3_25 = makeAttachmentEndpoint(attachment_lens_fastener_3_25);
  const node_lens_fastener_3_25 = new THREE.Group();
  node_lens_fastener_3_25.name = "lens fastener 3__pivot";
  node_lens_fastener_3_25.scale.set(1, 1, 1);
  if (endpoint_lens_fastener_3_25) {
    node_lens_fastener_3_25.position.copy(endpoint_lens_fastener_3_25.start);
    node_lens_fastener_3_25.rotation.set(1.57079632679, 0.0, 0.0);
  } else {
    node_lens_fastener_3_25.position.set(0.43, 0.43, 0.53);
    node_lens_fastener_3_25.rotation.set(1.57079632679, 0.0, 0.0);
  }
  node_lens_fastener_3_25.userData.sculptComponent = {"id": "lens-fastener-3", "name": "lens fastener 3", "level": "meso", "role": "body", "importance": 0.9, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Discrete rigid manufactured part with bounded faces; primitive follows the observed silhouette.", "geometryDescriptor": {"topologyIntent": "Closed solid with visible rounded rim.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "lens-fastener-3-seat", "localStart": [0.43, 0.43, 0.53], "localEnd": [0.43, 0.43, 0.53], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.105, "height": 0.04, "depth": 0.105, "units": "relative", "confidence": 0.85}, "transform": {"position": [0.43, 0.43, 0.53], "rotation": [1.57079632679, 0, 0]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lens-fastener-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "sand"}}, "material": "sand", "materialLayers": ["sand"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "lens-fastener-3-form", "type": "bevel", "description": "Reference-observed silhouette and bevel.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "fine molded grain", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Solid-color concept with subtle micro relief; not a measured finish."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structured", "colorMaterialRecipe": {"dominantAlbedo": "rgba(183,171,145,1)", "secondaryAlbedo": "rgba(183,171,145,1)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "notes": "Solid-color original conceptual reference."}};
  node_lens_fastener_3_25.userData.actionProfile = {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lens-fastener-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "sand"}};
  (nodes["root"] ?? root).add(node_lens_fastener_3_25);
  nodes["lens-fastener-3"] = node_lens_fastener_3_25;
  const mesh_lens_fastener_3_25Geometry = endpoint_lens_fastener_3_25
    ? new THREE.CylinderGeometry(endpoint_lens_fastener_3_25.endRadius, endpoint_lens_fastener_3_25.baseRadius, endpoint_lens_fastener_3_25.length, 8, 4)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 1);
  if (!endpoint_lens_fastener_3_25) {
    mesh_lens_fastener_3_25Geometry.scale(0.105, 0.04, 0.105);
  }
  const mesh_lens_fastener_3_25 = new THREE.Mesh(
    mesh_lens_fastener_3_25Geometry,
    materialMap["sand"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_lens_fastener_3_25.name = "lens fastener 3";
  if (endpoint_lens_fastener_3_25) {
    mesh_lens_fastener_3_25.position.copy(endpoint_lens_fastener_3_25.midpoint);
    mesh_lens_fastener_3_25.quaternion.copy(endpoint_lens_fastener_3_25.quaternion);
  }
  mesh_lens_fastener_3_25.castShadow = options.castShadow ?? true;
  mesh_lens_fastener_3_25.receiveShadow = options.receiveShadow ?? true;
  mesh_lens_fastener_3_25.userData.sculptComponent = {"id": "lens-fastener-3", "name": "lens fastener 3", "level": "meso", "role": "body", "importance": 0.9, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Discrete rigid manufactured part with bounded faces; primitive follows the observed silhouette.", "geometryDescriptor": {"topologyIntent": "Closed solid with visible rounded rim.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "lens-fastener-3-seat", "localStart": [0.43, 0.43, 0.53], "localEnd": [0.43, 0.43, 0.53], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.105, "height": 0.04, "depth": 0.105, "units": "relative", "confidence": 0.85}, "transform": {"position": [0.43, 0.43, 0.53], "rotation": [1.57079632679, 0, 0]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lens-fastener-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "sand"}}, "material": "sand", "materialLayers": ["sand"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "lens-fastener-3-form", "type": "bevel", "description": "Reference-observed silhouette and bevel.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "fine molded grain", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Solid-color concept with subtle micro relief; not a measured finish."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structured", "colorMaterialRecipe": {"dominantAlbedo": "rgba(183,171,145,1)", "secondaryAlbedo": "rgba(183,171,145,1)", "materialClass": "metal", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "notes": "Solid-color original conceptual reference."}};
  node_lens_fastener_3_25.add(mesh_lens_fastener_3_25);
  meshes["lens-fastener-3"] = mesh_lens_fastener_3_25;
  colliders["lens-fastener-3"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."};
  destructionGroups["lens-fastener-3"] ??= [];
  destructionGroups["lens-fastener-3"].push(node_lens_fastener_3_25);

  const attachment_lens_socket_3_26 = {"parentId": "root", "parentSocket": "lens-socket-3-seat", "localStart": [0.43, 0.43, 0.554], "localEnd": [0.43, 0.43, 0.554], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]};
  const endpoint_lens_socket_3_26 = makeAttachmentEndpoint(attachment_lens_socket_3_26);
  const node_lens_socket_3_26 = new THREE.Group();
  node_lens_socket_3_26.name = "lens socket 3__pivot";
  node_lens_socket_3_26.scale.set(1, 1, 1);
  if (endpoint_lens_socket_3_26) {
    node_lens_socket_3_26.position.copy(endpoint_lens_socket_3_26.start);
    node_lens_socket_3_26.rotation.set(1.57079632679, 0.0, 0.0);
  } else {
    node_lens_socket_3_26.position.set(0.43, 0.43, 0.554);
    node_lens_socket_3_26.rotation.set(1.57079632679, 0.0, 0.0);
  }
  node_lens_socket_3_26.userData.sculptComponent = {"id": "lens-socket-3", "name": "lens socket 3", "level": "micro", "role": "body", "importance": 0.9, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Discrete rigid manufactured part with bounded faces; primitive follows the observed silhouette.", "geometryDescriptor": {"topologyIntent": "Closed solid with visible rounded rim.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "lens-socket-3-seat", "localStart": [0.43, 0.43, 0.554], "localEnd": [0.43, 0.43, 0.554], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.04409999999999999, "height": 0.012, "depth": 0.04409999999999999, "units": "relative", "confidence": 0.85}, "transform": {"position": [0.43, 0.43, 0.554], "rotation": [1.57079632679, 0, 0]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lens-socket-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "rubber"}}, "material": "rubber", "materialLayers": ["rubber"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "lens-socket-3-form", "type": "bevel", "description": "Reference-observed silhouette and bevel.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "fine molded grain", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Solid-color concept with subtle micro relief; not a measured finish."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structured", "colorMaterialRecipe": {"dominantAlbedo": "rgba(37,42,43,1)", "secondaryAlbedo": "rgba(37,42,43,1)", "materialClass": "rubber", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "notes": "Solid-color original conceptual reference."}};
  node_lens_socket_3_26.userData.actionProfile = {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lens-socket-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "rubber"}};
  (nodes["root"] ?? root).add(node_lens_socket_3_26);
  nodes["lens-socket-3"] = node_lens_socket_3_26;
  const mesh_lens_socket_3_26Geometry = endpoint_lens_socket_3_26
    ? new THREE.CylinderGeometry(endpoint_lens_socket_3_26.endRadius, endpoint_lens_socket_3_26.baseRadius, endpoint_lens_socket_3_26.length, 8, 4)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 48, 1);
  if (!endpoint_lens_socket_3_26) {
    mesh_lens_socket_3_26Geometry.scale(0.04409999999999999, 0.012, 0.04409999999999999);
  }
  const mesh_lens_socket_3_26 = new THREE.Mesh(
    mesh_lens_socket_3_26Geometry,
    materialMap["rubber"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_lens_socket_3_26.name = "lens socket 3";
  if (endpoint_lens_socket_3_26) {
    mesh_lens_socket_3_26.position.copy(endpoint_lens_socket_3_26.midpoint);
    mesh_lens_socket_3_26.quaternion.copy(endpoint_lens_socket_3_26.quaternion);
  }
  mesh_lens_socket_3_26.castShadow = options.castShadow ?? true;
  mesh_lens_socket_3_26.receiveShadow = options.receiveShadow ?? true;
  mesh_lens_socket_3_26.userData.sculptComponent = {"id": "lens-socket-3", "name": "lens socket 3", "level": "micro", "role": "body", "importance": 0.9, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Discrete rigid manufactured part with bounded faces; primitive follows the observed silhouette.", "geometryDescriptor": {"topologyIntent": "Closed solid with visible rounded rim.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "lens-socket-3-seat", "localStart": [0.43, 0.43, 0.554], "localEnd": [0.43, 0.43, 0.554], "contactType": "overlap", "embedDepth": 0.025, "overlap": 0.025, "gapTolerance": 0.01, "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.04409999999999999, "height": 0.012, "depth": 0.04409999999999999, "units": "relative", "confidence": 0.85}, "transform": {"position": [0.43, 0.43, 0.554], "rotation": [1.57079632679, 0, 0]}, "actionProfile": {"animationRole": "rigid-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lens-socket-3", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "rubber"}}, "material": "rubber", "materialLayers": ["rubber"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "lens-socket-3-form", "type": "bevel", "description": "Reference-observed silhouette and bevel.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.04, "segments": 3}}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "fine molded grain", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": "Solid-color concept with subtle micro relief; not a measured finish."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "structured", "colorMaterialRecipe": {"dominantAlbedo": "rgba(37,42,43,1)", "secondaryAlbedo": "rgba(37,42,43,1)", "materialClass": "rubber", "materialClassConfidence": 0.85, "evidenceRefs": ["full-object"], "notes": "Solid-color original conceptual reference."}};
  node_lens_socket_3_26.add(mesh_lens_socket_3_26);
  meshes["lens-socket-3"] = mesh_lens_socket_3_26;
  colliders["lens-socket-3"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Coarse browser picking proxy only."};
  destructionGroups["lens-socket-3"] ??= [];
  destructionGroups["lens-socket-3"].push(node_lens_socket_3_26);
  // repetition system "corner-screws" describes 4 parts that are already built individually; not instanced.
  // repetition system "lens-screws" describes 4 parts that are already built individually; not instanced.

  root.userData.sculptRuntime = { nodes, meshes, sockets, colliders, destructionGroups } satisfies ProceduralModelRuntime;
  root.userData.lookDevTargets = {"qualityPriority": "reference-fidelity", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 2048, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "single-image extraction is reference-derived inference, not exact photogrammetry"}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth bark, stone, cloth, foliage, or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare cavity dirt, edge wear, stains, moss, scratches, or other local masks.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."]};
  root.userData.actionReadiness = {
    note: 'Use root.userData.sculptRuntime.nodes for transforms, sockets for attachments, colliders for physics proxies, and destructionGroups for breakable sets.',
  };
  return root;
}

export function createConceptualUnderwaterCameraLookDevLights(
  mode: 'neutral' | 'grazing' | 'reference' = 'neutral',
): THREE.Group {
  const lights = new THREE.Group();
  lights.name = "Conceptual underwater camera look-dev lights";
  const hemi = new THREE.HemisphereLight(
    mode === 'reference' ? 0xfff0d6 : 0xf2f4ff,
    0x363b42,
    mode === 'grazing' ? 0.28 : mode === 'reference' ? 0.72 : 0.85,
  );
  lights.add(hemi);
  const key = new THREE.DirectionalLight(
    mode === 'reference' ? 0xffcf8a : 0xfff4e8,
    mode === 'grazing' ? 4.2 : mode === 'reference' ? 2.6 : 2.15,
  );
  if (mode === 'grazing') key.position.set(7.5, 1.1, 4.0);
  else if (mode === 'reference') key.position.set(-4.5, 7.5, 5.0);
  else key.position.set(-4.0, 6.0, 5.5);
  key.castShadow = true;
  key.shadow.mapSize.set(4096, 4096);
  key.shadow.bias = -0.00025;
  key.shadow.normalBias = 0.018;
  key.shadow.radius = 7;
  key.shadow.blurSamples = 24;
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 30;
  key.shadow.camera.left = -2.6;
  key.shadow.camera.right = 2.6;
  key.shadow.camera.top = 2.6;
  key.shadow.camera.bottom = -2.6;
  key.shadow.camera.updateProjectionMatrix();
  lights.add(key);
  const fill = new THREE.DirectionalLight(0xa8c4ff, mode === 'grazing' ? 0.12 : 0.42);
  fill.position.set(4.0, 3.0, 3.5);
  lights.add(fill);
  const rim = new THREE.DirectionalLight(0xfff1c4, mode === 'grazing' ? 0.28 : 0.85);
  rim.position.set(0.5, 4.5, -6.0);
  lights.add(rim);
  lights.userData.reviewMode = mode;
  lights.userData.lightingFromPhoto = [{"type": "key light", "position": [-3, 5, 4], "color": "#fff4df", "intensity": 3, "rendering": "ACES filmic tone mapping, exposure 1.0; soft ground shadow"}, {"type": "fill light", "position": [4, 1, 2], "color": "#dceef7", "intensity": 1.3}, {"type": "rim light", "position": [1, 3, -3], "color": "#ffffff", "intensity": 2}];
  lights.userData.lookDevTargets = {"qualityPriority": "reference-fidelity", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 2048, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "single-image extraction is reference-derived inference, not exact photogrammetry"}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth bark, stone, cloth, foliage, or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare cavity dirt, edge wear, stains, moss, scratches, or other local masks.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."]};
  return lights;
}

// PBR materials (clearcoat/iridescence/transmission/anisotropy) need an environment
// map to visually behave as intended — call this once per renderer and assign the
// result to scene.environment before rendering. No external HDR asset required.
export function createConceptualUnderwaterCameraEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const texture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  return texture;
}

// Plan 1.3 §3.2 — auto-framing by bounding box. The Divine Eye can only compare a
// render to the reference if the object is FRAMED consistently (an object framed
// differently scores as wrong even when its shape is right). This positions the camera
// deterministically from the object's bounding box so it fills the frame at a stable
// margin, and sets near/far to the object scale. Call after adding the model to the
// scene, and again on resize (after updating camera.aspect).
export function frameConceptualUnderwaterCameraCamera(
  camera: THREE.PerspectiveCamera,
  object: THREE.Object3D,
  options: { margin?: number; azimuthDeg?: number; elevationDeg?: number } = {},
): void {
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const margin = options.margin ?? 1.15;
  const maxDim = Math.max(size.x, size.y, size.z) * margin;
  const fov = (camera.fov * Math.PI) / 180;
  // distance so the largest object dimension fits vertically in the frame
  const distance = (maxDim / 2) / Math.tan(fov / 2);
  const az = ((options.azimuthDeg ?? 0) * Math.PI) / 180;
  const el = ((options.elevationDeg ?? 0) * Math.PI) / 180;
  const dir = new THREE.Vector3(
    Math.sin(az) * Math.cos(el),
    Math.sin(el),
    Math.cos(az) * Math.cos(el),
  );
  camera.position.copy(center).addScaledVector(dir, distance);
  camera.near = Math.max(0.01, distance - maxDim);
  camera.far = distance + maxDim * 2;
  camera.lookAt(center);
  camera.updateProjectionMatrix();
}

// Plan 1.3 §3.2c — PRESENTATION composer (DOF + bloom). CRITICAL (R-POSTFX): this is
// for the showcase/hero render ONLY. The Divine Eye's EVALUATION render MUST use a
// plain renderer with NO composer — bloom blows highlights and DOF blurs edges, which
// would corrupt the deterministic IoU/DCD/edge/blowout signals. Enable dof/bloom ONLY
// when the reference photo actually exhibits them (detect_reference_effects.py authorizes).
export function createConceptualUnderwaterCameraPresentationComposer(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  options: { dof?: boolean; bloom?: boolean; bloomStrength?: number; dofFocus?: number; dofAperture?: number } = {},
): EffectComposer {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  if (options.dof) {
    composer.addPass(new BokehPass(scene, camera, {
      focus: options.dofFocus ?? 10.0,
      aperture: options.dofAperture ?? 0.0002,
      maxblur: 0.01,
    }));
  }
  if (options.bloom) {
    const size = new THREE.Vector2();
    renderer.getSize(size);
    composer.addPass(new UnrealBloomPass(size, options.bloomStrength ?? 0.4, 0.4, 0.85));
  }
  return composer;
}

export function configureConceptualUnderwaterCameraRenderer(renderer: THREE.WebGLRenderer): void {
  // Load-bearing for view-dependent finishes (anodized / Doppler): without ACES + sRGB
  // the environment reflection reads flat/washed instead of a believable metal response.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
}

export function createConceptualUnderwaterCameraInspectControls(
  camera: THREE.Camera,
  domElement: HTMLElement,
): OrbitControls {
  // View-dependent finishes only read correctly once the user orbits — their color
  // comes from the environment reflection, not albedo, so free rotation matters here.
  const controls = new OrbitControls(camera, domElement);
  controls.enableDamping = true;
  controls.minDistance = 1.0;
  controls.maxDistance = 8.0;
  controls.autoRotate = false;
  return controls;
}
