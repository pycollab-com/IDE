import { useEffect, useRef } from "react";
import * as THREE from "three";
import "./LandingVoxelScene.css";

const PY_GREEN = new THREE.Color("#899878");

const LOGO_SVG_PATH = `
  M299 842.5 L146 842.5 L142.5 836 L142.5 140 L145 136.5 L442 136.5
  L521 152.5 L576 176.5 L611 201.5 L652.5 250 L668.5 282 L680.5 323
  L685.5 371 L684.5 424 L676.5 472 L656.5 519 L629.5 557 L587 593.5
  L550 614.5 L460 638.5 L303 643.5 Z
  M433.5 504 L474 488.5 L494.5 472 L513.5 446 L525.5 397 L524.5 368
  L513.5 331 L485 295.5 L444 275.5 L421 271.5 L306 271.5 L301.5 276
  L301.5 502 Z
  M889 1051.5 L798.5 1049 L798.5 922 L926 920.5 L953 912.5 L966 904.5
  L985.5 880 L998.5 844 L998.5 832 L898.5 829 L738.5 318 L894.5 318
  L1008.5 704 L1015 710.5 L1024 710.5 L1029.5 708 L1033.5 697
  L1123.5 319 L1269 316.5 L1268.5 333 L1120.5 904 L1096.5 961
  L1067 1000.5 L1025 1029.5 L963 1046.5 Z
`;

const VIEW_WIDTH = 1350;
const VIEW_HEIGHT = 1150;

const clamp01 = (value) => Math.min(1, Math.max(0, value));
const lerp = THREE.MathUtils.lerp;

function smoothstep(edge0, edge1, value) {
  const t = clamp01((value - edge0) / Math.max(0.0001, edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function getRevealProgress(element, start, end) {
  if (!element) return 0;
  const rect = element.getBoundingClientRect();
  return clamp01((start - rect.top) / Math.max(1, start - end));
}

function getQualityProfile() {
  const width = window.innerWidth;
  const pixelRatio = window.devicePixelRatio || 1;
  const memory = navigator.deviceMemory || 4;
  const cores = navigator.hardwareConcurrency || 4;
  const coarsePointer = window.matchMedia("(pointer: coarse)").matches;
  const constrained = coarsePointer || memory <= 4 || cores <= 4;

  if (width < 680) {
    return {
      density: 40,
      pixelRatio: Math.min(pixelRatio, 1),
      targetFps: 24,
      constrained: true,
    };
  }

  if (width < 1100 || constrained) {
    return {
      density: 48,
      pixelRatio: Math.min(pixelRatio, 1),
      targetFps: 30,
      constrained: true,
    };
  }

  return {
    density: 56,
    pixelRatio: Math.min(pixelRatio, 1.2),
    targetFps: 36,
    constrained: false,
  };
}

function buildShadowCatcher(theme) {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    const fallback = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0 }),
    );
    fallback.rotation.x = -Math.PI * 0.5;
    return { mesh: fallback, texture: null };
  }

  const gradient = ctx.createRadialGradient(64, 64, 10, 64, 64, 64);
  const core = theme === "light" ? "rgba(18,17,19,0.16)" : "rgba(0,0,0,0.28)";
  const mid = theme === "light" ? "rgba(18,17,19,0.08)" : "rgba(0,0,0,0.14)";

  gradient.addColorStop(0, core);
  gradient.addColorStop(0.58, mid);
  gradient.addColorStop(1, "rgba(0,0,0,0)");

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;

  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    opacity: theme === "light" ? 0.3 : 0.44,
  });

  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
  mesh.rotation.x = -Math.PI * 0.5;

  return { mesh, texture };
}

function makeLogoMask(size) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    return { mask: new Uint8Array(size * size), width: size, height: size };
  }

  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = "#ffffff";

  const scale = Math.min((size - 10) / VIEW_WIDTH, (size - 10) / VIEW_HEIGHT);
  const path = new Path2D(LOGO_SVG_PATH);

  ctx.save();
  ctx.translate(size * 0.5, size * 0.5 + 1.6);
  ctx.scale(scale, scale);
  ctx.translate(-VIEW_WIDTH * 0.5, -VIEW_HEIGHT * 0.5);
  ctx.fill(path, "evenodd");
  ctx.restore();

  const imageData = ctx.getImageData(0, 0, size, size).data;
  const mask = new Uint8Array(size * size);

  for (let i = 0; i < size * size; i += 1) {
    mask[i] = imageData[i * 4 + 3] > 24 ? 1 : 0;
  }

  return { mask, width: size, height: size };
}

function chamferDistance(mask, width, height) {
  const distances = new Float32Array(width * height);
  const infinity = 1e9;
  const diagonal = Math.SQRT2;

  for (let i = 0; i < width * height; i += 1) {
    distances[i] = mask[i] ? infinity : 0;
  }

  for (let y = 0; y < height; y += 1) {
    const row = y * width;

    for (let x = 0; x < width; x += 1) {
      const index = row + x;
      let best = distances[index];

      if (x > 0) best = Math.min(best, distances[index - 1] + 1);
      if (y > 0) best = Math.min(best, distances[index - width] + 1);
      if (x > 0 && y > 0) best = Math.min(best, distances[index - width - 1] + diagonal);
      if (x < width - 1 && y > 0) best = Math.min(best, distances[index - width + 1] + diagonal);

      distances[index] = best;
    }
  }

  for (let y = height - 1; y >= 0; y -= 1) {
    const row = y * width;

    for (let x = width - 1; x >= 0; x -= 1) {
      const index = row + x;
      let best = distances[index];

      if (x < width - 1) best = Math.min(best, distances[index + 1] + 1);
      if (y < height - 1) best = Math.min(best, distances[index + width] + 1);
      if (x < width - 1 && y < height - 1) best = Math.min(best, distances[index + width + 1] + diagonal);
      if (x > 0 && y < height - 1) best = Math.min(best, distances[index + width - 1] + diagonal);

      distances[index] = best;
    }
  }

  return distances;
}

function buildVoxelShell(size) {
  const { mask, width, height } = makeLogoMask(size);
  const insideDistance = chamferDistance(mask, width, height);

  let maxInside = 0;
  for (let i = 0; i < mask.length; i += 1) {
    if (mask[i]) {
      maxInside = Math.max(maxInside, insideDistance[i]);
    }
  }

  const zMin = new Int16Array(width * height);
  const zMax = new Int16Array(width * height);

  for (let i = 0; i < mask.length; i += 1) {
    if (!mask[i]) continue;

    const normalized = Math.pow(insideDistance[i] / Math.max(1, maxInside), 0.9);
    const layers = Math.max(2, Math.round(2 + normalized * 12));
    const minLayer = -Math.floor(layers / 2);

    zMin[i] = minLayer;
    zMax[i] = minLayer + layers - 1;
  }

  function hasVoxel(x, y, z) {
    if (x < 0 || x >= width || y < 0 || y >= height) return false;
    const index = y * width + x;
    if (!mask[index]) return false;
    return z >= zMin[index] && z <= zMax[index];
  }

  const raw = [];
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  const spacing = 0.1375;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (!mask[index]) continue;

      const borderBias = 1 - Math.min(1, Math.max(0, (insideDistance[index] - 1) / Math.max(1, maxInside - 1)));

      for (let z = zMin[index]; z <= zMax[index]; z += 1) {
        const isSurface =
          z === zMin[index] ||
          z === zMax[index] ||
          !hasVoxel(x - 1, y, z) ||
          !hasVoxel(x + 1, y, z) ||
          !hasVoxel(x, y - 1, z) ||
          !hasVoxel(x, y + 1, z);

        if (!isSurface) continue;

        let openFaces = 0;
        if (!hasVoxel(x - 1, y, z)) openFaces += 1;
        if (!hasVoxel(x + 1, y, z)) openFaces += 1;
        if (!hasVoxel(x, y - 1, z)) openFaces += 1;
        if (!hasVoxel(x, y + 1, z)) openFaces += 1;
        if (!hasVoxel(x, y, z - 1)) openFaces += 1;
        if (!hasVoxel(x, y, z + 1)) openFaces += 1;

        const px = (x - width * 0.5) * spacing;
        const py = (height * 0.5 - y) * spacing;
        const pz = z * spacing;
        const ao = THREE.MathUtils.clamp(0.22 + (openFaces / 6) * 0.58 + borderBias * 0.22, 0.18, 1);

        raw.push({ px, py, pz, ao });

        minX = Math.min(minX, px);
        minY = Math.min(minY, py);
        minZ = Math.min(minZ, pz);
        maxX = Math.max(maxX, px);
        maxY = Math.max(maxY, py);
        maxZ = Math.max(maxZ, pz);
      }
    }
  }

  const centerX = (minX + maxX) * 0.5;
  const centerY = (minY + maxY) * 0.5;
  const centerZ = (minZ + maxZ) * 0.5;
  const count = raw.length;
  const offsets = new Float32Array(count * 3);
  const scatters = new Float32Array(count * 3);
  const aos = new Float32Array(count);
  const delays = new Float32Array(count);

  let maxRadial = 0;
  for (let i = 0; i < count; i += 1) {
    const vx = raw[i].px - centerX;
    const vy = raw[i].py - centerY;
    maxRadial = Math.max(maxRadial, Math.hypot(vx, vy));
  }

  for (let i = 0; i < count; i += 1) {
    const vx = raw[i].px - centerX;
    const vy = raw[i].py - centerY;
    const vz = raw[i].pz - centerZ;

    offsets[i * 3] = vx;
    offsets[i * 3 + 1] = vy;
    offsets[i * 3 + 2] = vz;

    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const radial = 22 + Math.random() * 10 + Math.hypot(vx, vy) * 0.38;

    scatters[i * 3] = Math.sin(phi) * Math.cos(theta) * radial;
    scatters[i * 3 + 1] = Math.cos(phi) * radial;
    scatters[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * radial;

    aos[i] = raw[i].ao;
    delays[i] = (Math.hypot(vx, vy) / Math.max(0.001, maxRadial)) * 0.42 + Math.random() * 0.05;
  }

  return { count, offsets, scatters, aos, delays };
}

function buildVoxelMesh(size) {
  const { count, offsets, scatters, aos, delays } = buildVoxelShell(size);
  const geometry = new THREE.BoxGeometry(0.125, 0.125, 0.125);
  const cornerAO = new Float32Array(geometry.attributes.position.count);
  const position = geometry.attributes.position;

  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const edge = Math.pow(Math.min(1, Math.sqrt(x * x + y * y + z * z) / 0.108), 0.85);
    cornerAO[i] = edge;
  }

  geometry.setAttribute("cornerAO", new THREE.BufferAttribute(cornerAO, 1));
  geometry.setAttribute("instanceOffset", new THREE.InstancedBufferAttribute(offsets, 3));
  geometry.setAttribute("instanceScatter", new THREE.InstancedBufferAttribute(scatters, 3));
  geometry.setAttribute("instanceAo", new THREE.InstancedBufferAttribute(aos, 1));
  geometry.setAttribute("instanceDelay", new THREE.InstancedBufferAttribute(delays, 1));

  const material = new THREE.MeshLambertMaterial({
    color: PY_GREEN.clone(),
    emissive: PY_GREEN.clone().multiplyScalar(0.13),
  });

  material.customProgramCacheKey = () => "pycollab-landing-voxel-v1";
  const applyVoxelShader = (shader) => {
    shader.uniforms.uTime = { value: 0 };
    shader.uniforms.uIntroProgress = { value: 0 };
    shader.uniforms.uExplosionProgress = { value: 0 };

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `
        #include <common>
        attribute vec3 instanceOffset;
        attribute vec3 instanceScatter;
        attribute float instanceAo;
        attribute float instanceDelay;
        attribute float cornerAO;
        uniform float uTime;
        uniform float uIntroProgress;
        uniform float uExplosionProgress;
        varying float vAO;
        varying vec3 vAnimPos;
        varying float vIntro;
        varying float vExplosion;

        float easeOutElastic(float x) {
          const float c4 = (2.0 * 3.14159265) / 3.0;
          return x == 0.0
            ? 0.0
            : x == 1.0
            ? 1.0
            : pow(2.0, -10.0 * x) * sin((x * 10.0 - 0.75) * c4) + 1.0;
        }
        `,
      )
      .replace(
        "#include <begin_vertex>",
        `
        #include <begin_vertex>
        float intro = clamp((uIntroProgress - instanceDelay) / 0.58, 0.0, 1.0);
        float introEased = easeOutElastic(intro);
        float settled = smoothstep(0.68, 1.0, intro) * (1.0 - uExplosionProgress);
        float pulseA = sin(uTime * 0.85 + instanceOffset.x * 3.2 + instanceOffset.y * 2.6);
        float pulseB = sin(uTime * 0.55 + instanceOffset.y * 2.4 + instanceOffset.z * 4.4);
        vec3 assembled = instanceOffset;
        transformed.z += (pulseA * 0.055 + pulseB * 0.02) * cornerAO * settled;
        transformed.y += pulseA * 0.024 * cornerAO * settled;
        assembled.z += pulseA * 0.2 * settled;
        assembled.y += (pulseA * 0.08 + pulseB * 0.05) * settled;
        vec3 currentOffset = mix(instanceScatter, assembled, introEased);
        currentOffset = mix(currentOffset, instanceScatter, uExplosionProgress);
        transformed += currentOffset;
        vAO = clamp(instanceAo * 0.82 + cornerAO * 0.18, 0.0, 1.0);
        vAnimPos = currentOffset;
        vIntro = intro;
        vExplosion = uExplosionProgress;
        `,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `
        #include <common>
        uniform float uTime;
        varying float vAO;
        varying vec3 vAnimPos;
        varying float vIntro;
        varying float vExplosion;
        `,
      )
      .replace(
        "#include <dithering_fragment>",
        `
        float sweepWave = sin(vAnimPos.x * 0.62 + vAnimPos.y * 0.41 + vAnimPos.z * 1.35 - uTime * 2.35);
        float sweep = smoothstep(0.93, 0.995, sweepWave * 0.5 + 0.5) * smoothstep(0.65, 1.0, vIntro);
        float ember = smoothstep(0.35, 1.0, vExplosion) * smoothstep(0.75, 0.98, sweepWave * 0.5 + 0.5);
        float aoShade = mix(0.56, 1.06, clamp(vAO, 0.0, 1.0));
        gl_FragColor.rgb *= aoShade;
        gl_FragColor.rgb += gl_FragColor.rgb * sweep * 0.26;
        gl_FragColor.rgb += vec3(0.2, 0.24, 0.16) * ember * 0.26;
        #include <dithering_fragment>
        `,
      );

    material.userData.shader = shader;
  };
  material.onBeforeCompile = applyVoxelShader;
  material.onBuild = applyVoxelShader;

  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.frustumCulled = false;

  const identity = new THREE.Matrix4();
  for (let i = 0; i < count; i += 1) {
    mesh.setMatrixAt(i, identity);
  }
  mesh.instanceMatrix.needsUpdate = true;

  return mesh;
}

export default function LandingVoxelScene({ platformRef, ctaRef, theme }) {
  const containerRef = useRef(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let quality = getQualityProfile();

    const renderer = new THREE.WebGLRenderer({
      antialias: !quality.constrained,
      alpha: true,
      powerPreference: quality.constrained ? "default" : "high-performance",
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = theme === "light" ? 1 : 1.06;
    renderer.setClearColor(0x000000, 0);
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 240);

    const keyLight = new THREE.DirectionalLight(theme === "light" ? 0xf5f0e8 : 0xf6f1e9, theme === "light" ? 2.8 : 3.25);
    keyLight.position.set(28, 32, 24);
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xa9b895, theme === "light" ? 0.78 : 0.92);
    fillLight.position.set(-32, 10, 20);
    scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0xeaf1e2, theme === "light" ? 1.1 : 1.4);
    rimLight.position.set(-18, 24, -28);
    scene.add(rimLight);

    const ambient = new THREE.HemisphereLight(theme === "light" ? 0xd5dacd : 0x2f302c, 0x080808, theme === "light" ? 0.68 : 0.52);
    scene.add(ambient);

    const voxelRig = new THREE.Group();
    const voxelMesh = buildVoxelMesh(quality.density);
    voxelRig.add(voxelMesh);
    scene.add(voxelRig);

    const { mesh: shadowCatcher, texture: shadowTexture } = buildShadowCatcher(theme);
    shadowCatcher.position.set(0, -6.3, 0);
    scene.add(shadowCatcher);

    const resize = () => {
      quality = getQualityProfile();
      const width = container.clientWidth || window.innerWidth;
      const height = container.clientHeight || window.innerHeight;

      camera.aspect = width / Math.max(1, height);
      camera.updateProjectionMatrix();
      renderer.setPixelRatio(quality.pixelRatio);
      renderer.setSize(width, height, false);
    };

    resize();
    window.addEventListener("resize", resize);

    const lookTarget = new THREE.Vector3();
    const motion = { page: 0, platform: 0, cta: 0 };
    const clock = new THREE.Clock();
    let lastRenderTime = -Infinity;

    renderer.setAnimationLoop(() => {
      const time = clock.getElapsedTime();

      if (document.hidden) {
        lastRenderTime = time;
        return;
      }

      const frameBudget = 1 / quality.targetFps;
      if (lastRenderTime >= 0 && time - lastRenderTime < frameBudget) {
        return;
      }

      const delta = Math.min(0.05, lastRenderTime < 0 ? frameBudget : time - lastRenderTime);
      lastRenderTime = time;
      const viewportHeight = window.innerHeight || 1;
      const maxScroll = Math.max(1, document.documentElement.scrollHeight - viewportHeight);

      const pageTarget = clamp01(window.scrollY / maxScroll);
      const platformTarget = getRevealProgress(platformRef?.current, viewportHeight * 0.96, viewportHeight * 0.34);
      const ctaTarget = getRevealProgress(ctaRef?.current, viewportHeight * 0.64, viewportHeight * 0.16);
      const follow = 1 - Math.exp(-delta * (prefersReducedMotion ? 10 : 5));

      motion.page = lerp(motion.page, pageTarget, follow);
      motion.platform = lerp(motion.platform, platformTarget, follow);
      motion.cta = lerp(motion.cta, ctaTarget, follow);

      const compact = window.innerWidth < 900;
      const featureZoom = smoothstep(0, 1, motion.platform);
      const explosion = prefersReducedMotion ? motion.cta * 0.35 : smoothstep(0, 1, motion.cta);
      const intro = prefersReducedMotion ? 1 : Math.min(1.2, time * 0.58);

      const xStart = compact ? 0.1 : 4.8;
      const xFeature = compact ? 0 : 2.45;
      const yStart = compact ? -1.15 : -1.45;
      const yFeature = compact ? -0.75 : -1.08;
      const driftX = motion.page * (compact ? 0.18 : 0.45);

      voxelRig.position.set(
        lerp(xStart, xFeature, featureZoom) - driftX,
        lerp(yStart, yFeature, featureZoom) + Math.sin(time * 0.55) * 0.16 * (1 - explosion * 0.65),
        0,
      );
      voxelRig.scale.setScalar(lerp(compact ? 0.9 : 1.0, compact ? 1.05 : 1.08, featureZoom));
      voxelRig.rotation.y = 0.28 + motion.page * 0.9 + Math.sin(time * 0.22) * 0.16;
      voxelRig.rotation.x = -0.16 + Math.sin(time * 0.3) * 0.04 + featureZoom * 0.08;
      voxelRig.rotation.z = Math.sin(time * 0.18) * 0.035 * (1 - explosion * 0.5);

      const cameraZ = lerp(compact ? 27.5 : 34.5, compact ? 18.5 : 22.5, featureZoom) + explosion * 0.6;
      const cameraX = lerp(compact ? 0.25 : 1.05, 0.25, featureZoom) + Math.sin(time * 0.32) * (compact ? 0.18 : 0.38) * (1 - explosion * 0.4);
      const cameraY = lerp(compact ? 1.6 : 2.15, 0.72, featureZoom) + Math.sin(time * 0.42) * 0.18;

      camera.position.set(cameraX, cameraY, cameraZ);
      lookTarget.set(voxelRig.position.x * 0.07, lerp(-0.35, -0.12, featureZoom), 0);
      camera.lookAt(lookTarget);

      shadowCatcher.position.x = voxelRig.position.x * 0.18;
      shadowCatcher.position.y = voxelRig.position.y - lerp(5.7, 5.2, featureZoom);
      shadowCatcher.scale.set(
        lerp(8.4, 9.8, featureZoom),
        lerp(5.1, 6.2, featureZoom),
        1,
      );
      shadowCatcher.material.opacity = (theme === "light" ? 0.22 : 0.3) * (1 - explosion * 0.45);

      const shader = voxelMesh.material.userData.shader;
      if (shader) {
        shader.uniforms.uTime.value = time;
        shader.uniforms.uIntroProgress.value = intro;
        shader.uniforms.uExplosionProgress.value = explosion;
      }

      renderer.render(scene, camera);
    });

    return () => {
      window.removeEventListener("resize", resize);
      renderer.setAnimationLoop(null);
      voxelMesh.geometry.dispose();
      voxelMesh.material.dispose();
      shadowCatcher.geometry.dispose();
      shadowCatcher.material.dispose();
      shadowTexture?.dispose();
      renderer.dispose();

      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [ctaRef, platformRef, theme]);

  return (
    <div className="landing-voxel-scene" aria-hidden="true">
      <div className="landing-voxel-scene__canvas" ref={containerRef} />
      <div className="landing-voxel-scene__scrim" />
    </div>
  );
}
