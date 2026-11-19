import {
  AmbientLight, Box3, DirectionalLight, Group, MathUtils,
  OrthographicCamera, Raycaster, Scene, SRGBColorSpace, Vector2, Vector3, WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'meshoptimizer';
import characterUrl from '../../assets/character-military.optimized.glb?url';

import { aimWeapon, createWeaponRig, resetArms, type WeaponRig } from './characterIK';

export function mountHeroCharacter(stage: HTMLElement) {
  const canvasHost = stage.querySelector<HTMLElement>('[data-character-canvas]');
  const status = stage.querySelector<HTMLElement>('[data-character-status]');
  if (!canvasHost) return;

  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });
  } catch {
    if (status) status.textContent = '3D preview is unavailable on this device.';
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.outputColorSpace = SRGBColorSpace;
  canvasHost.appendChild(renderer.domElement);

  const scene = new Scene();
  const camera = new OrthographicCamera(-2, 2, 2, -2, 0.1, 100);
  camera.position.set(0, 0.88, 8);
  camera.lookAt(0, 0.88, 0);
  scene.add(new AmbientLight(0xffffff, 2.1));
  const keyLight = new DirectionalLight(0xffffff, 2.5);
  keyLight.position.set(3, 5, 6);
  scene.add(keyLight);
  const fillLight = new DirectionalLight(0xb5be9f, 1.2);
  fillLight.position.set(-4, 2, 3);
  scene.add(fillLight);

  const pivot = new Group();
  scene.add(pivot);
  let weaponRig: WeaponRig | undefined;
  const raycaster = new Raycaster();
  const pointer = new Vector2();
  let character: Group | null = null;
  let bodyTargetX = 0;
  let bodyTargetY = 0;
  const pointerTarget = new Vector3();
  const smoothTarget = pointerTarget.clone();
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let pointerActive = false;
  let aimStrength = 0;
  let visible = true;
  let frame = 0;

  const resize = () => {
    const width = Math.max(canvasHost.clientWidth, 1);
    const height = Math.max(canvasHost.clientHeight, 1);
    const halfHeight = 0.94;
    camera.left = -halfHeight * (width / height);
    camera.right = halfHeight * (width / height);
    camera.top = halfHeight;
    camera.bottom = -halfHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
    renderer.render(scene, camera);
  };

  const tick = () => {
    frame = 0;
    if (!visible || document.hidden) {
      return;
    }
    const easing = reducedMotion ? 1 : 0.12;
    smoothTarget.lerp(pointerTarget, easing);
    aimStrength += ((pointerActive ? 1 : 0) - aimStrength) * easing;
    pivot.rotation.x += (bodyTargetX - pivot.rotation.x) * easing;
    pivot.rotation.y += (bodyTargetY - pivot.rotation.y) * easing;
    if (weaponRig) {
      resetArms(weaponRig);
      pivot.updateMatrixWorld(true);
      if (aimStrength > 0.001) aimWeapon(weaponRig, smoothTarget, aimStrength);
    }
    renderer.render(scene, camera);
    if (smoothTarget.distanceToSquared(pointerTarget) > 0.00001 ||
        Math.abs(aimStrength - (pointerActive ? 1 : 0)) > 0.001 ||
        Math.abs(pivot.rotation.x - bodyTargetX) > 0.001 || Math.abs(pivot.rotation.y - bodyTargetY) > 0.001) {
      frame = requestAnimationFrame(tick);
    }
  };

  const requestTick = () => {
    if (visible && !document.hidden && !frame) frame = requestAnimationFrame(tick);
  };

  window.addEventListener('pointermove', (event) => {
    const rect = canvasHost.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
    pointer.set(x, y);
    raycaster.setFromCamera(pointer, camera);
    const hoveringCharacter = !!character && x * x + y * y <= 1 &&
      raycaster.intersectObject(character, true).length > 0;
    // Ignore the hidden legs and transparent corners outside the circular portrait.
    const nearCharacter = Math.hypot(x, y) <= 1 + 50 / rect.width;
    const nearButton = [...stage.querySelectorAll<HTMLElement>('.radial-nav a')].some((button) => {
      const bounds = button.getBoundingClientRect();
      return event.clientX >= bounds.left - 55 && event.clientX <= bounds.right + 55 &&
        event.clientY >= bounds.top - 55 && event.clientY <= bounds.bottom + 55;
    });
    pointerActive = nearButton && !nearCharacter && !reducedMotion;
    bodyTargetX = hoveringCharacter && !reducedMotion ? MathUtils.clamp(-y * 0.14, -0.14, 0.14) : 0;
    bodyTargetY = hoveringCharacter && !reducedMotion ? MathUtils.clamp(x * 0.25, -0.25, 0.25) : 0;
    // Unclamped world-space cursor: the barrel must track every point near a button.
    pointerTarget.set(x, y, 0).unproject(camera);
    requestTick();
  }, { passive: true });
  window.addEventListener('pointerout', (event) => {
    if (!event.relatedTarget) {
      pointerActive = false;
      bodyTargetX = bodyTargetY = 0;
      requestTick();
    }
  });
  const resetInteraction = () => {
    pointerActive = false;
    bodyTargetX = bodyTargetY = 0;
    requestTick();
  };
  window.addEventListener('blur', resetInteraction);
  window.addEventListener('scroll', resetInteraction, { passive: true });

  new ResizeObserver(resize).observe(canvasHost);
  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible) requestTick();
  }).observe(stage);
  document.addEventListener('visibilitychange', () => {
    requestTick();
  });

  new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).load(
    characterUrl,
    ({ scene: model }) => {
      character = model;
      model.updateMatrixWorld(true);
      weaponRig = createWeaponRig(model);
      const bounds = new Box3().setFromObject(model);
      const size = bounds.getSize(new Vector3());
      const center = bounds.getCenter(new Vector3());
      if (size.y > 0) {
        const scale = 3.2 / size.y;
        model.scale.multiplyScalar(scale);
        model.position.copy(center.multiplyScalar(-scale));
      }
      pivot.add(model);
      if (status) status.remove();
      resize();
      requestTick();
    },
    undefined,
    (error) => {
      console.error('Could not load the character model:', error);
      if (status) status.textContent = 'Character preview could not load.';
    },
  );
  resize();
}
