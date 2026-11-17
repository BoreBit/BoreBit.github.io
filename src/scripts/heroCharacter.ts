import {
  AmbientLight, Bone, Box3, DirectionalLight, Group, MathUtils,
  OrthographicCamera, Quaternion, Scene, SRGBColorSpace, Vector3, WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'meshoptimizer';
import characterUrl from '../../assets/character.optimized.glb?url';

type ArmChain = {
  upper: Bone;
  forearm: Bone;
  hand: Bone;
  restUpper: Quaternion;
  restForearm: Quaternion;
  side: number;
};

function pointBoneAt(bone: Bone, child: Bone, target: Vector3) {
  const origin = bone.getWorldPosition(new Vector3());
  const current = child.getWorldPosition(new Vector3()).sub(origin);
  const desired = target.clone().sub(origin);
  if (current.lengthSq() < 0.0001 || desired.lengthSq() < 0.0001) return;

  const delta = new Quaternion().setFromUnitVectors(current.normalize(), desired.normalize());
  const worldRotation = bone.getWorldQuaternion(new Quaternion());
  const parentRotation = bone.parent!.getWorldQuaternion(new Quaternion());
  bone.quaternion.copy(parentRotation.invert().multiply(delta.multiply(worldRotation)));
  bone.updateWorldMatrix(false, true);
}

// Two-bone IK: use the arm lengths to place the elbow, then rotate each joint.
function aimArm(chain: ArmChain, target: Vector3, strength: number) {
  const { upper, forearm, hand, restUpper, restForearm, side } = chain;
  const shoulder = upper.getWorldPosition(new Vector3());
  const elbow = forearm.getWorldPosition(new Vector3());
  const wrist = hand.getWorldPosition(new Vector3());
  const upperLength = shoulder.distanceTo(elbow);
  const lowerLength = elbow.distanceTo(wrist);
  if (upperLength < 0.01 || lowerLength < 0.01) return;

  const direction = target.clone().add(new Vector3(side * 0.11, -0.04, 0)).sub(shoulder);
  const distance = MathUtils.clamp(
    direction.length(), Math.abs(upperLength - lowerLength) + 0.01, upperLength + lowerLength - 0.01,
  );
  direction.normalize();
  const along = (distance ** 2 + upperLength ** 2 - lowerLength ** 2) / (2 * distance);
  const bend = Math.sqrt(Math.max(0, upperLength ** 2 - along ** 2));
  const bendDirection = new Vector3(side * 0.7, -0.45, 0.8);
  bendDirection.addScaledVector(direction, -bendDirection.dot(direction)).normalize();
  const elbowTarget = shoulder.clone().addScaledVector(direction, along).addScaledVector(bendDirection, bend);
  const wristTarget = shoulder.clone().addScaledVector(direction, distance);

  pointBoneAt(upper, forearm, elbowTarget);
  pointBoneAt(forearm, hand, wristTarget);
  const solvedUpper = upper.quaternion.clone();
  const solvedForearm = forearm.quaternion.clone();
  upper.quaternion.copy(restUpper).slerp(solvedUpper, strength);
  forearm.quaternion.copy(restForearm).slerp(solvedForearm, strength);
  upper.updateWorldMatrix(false, true);
}

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
  camera.position.set(0, 0, 8);
  camera.lookAt(0, 0, 0);
  scene.add(new AmbientLight(0xffffff, 2.1));
  const keyLight = new DirectionalLight(0xffffff, 2.5);
  keyLight.position.set(3, 5, 6);
  scene.add(keyLight);
  const fillLight = new DirectionalLight(0xffd95a, 1.2);
  fillLight.position.set(-4, 2, 3);
  scene.add(fillLight);

  const pivot = new Group();
  scene.add(pivot);
  const arms: ArmChain[] = [];
  const pointerTarget = new Vector3(0, 0, 1);
  const smoothTarget = pointerTarget.clone();
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let pointerActive = false;
  let aimStrength = 0;
  let visible = true;
  let frame = 0;

  const resize = () => {
    const width = Math.max(canvasHost.clientWidth, 1);
    const height = Math.max(canvasHost.clientHeight, 1);
    const halfHeight = width < 700 ? 2.2 : 2.15;
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
    if (arms.length) {
      for (const arm of arms) {
        arm.upper.quaternion.copy(arm.restUpper);
        arm.forearm.quaternion.copy(arm.restForearm);
      }
      pivot.updateMatrixWorld(true);
      if (aimStrength > 0.001) {
        for (const arm of arms) aimArm(arm, smoothTarget, aimStrength);
      }
    }
    renderer.render(scene, camera);
    if (smoothTarget.distanceToSquared(pointerTarget) > 0.00001 ||
        Math.abs(aimStrength - (pointerActive ? 1 : 0)) > 0.001) {
      frame = requestAnimationFrame(tick);
    }
  };

  const requestTick = () => {
    if (visible && !document.hidden && !frame) frame = requestAnimationFrame(tick);
  };

  window.addEventListener('pointermove', (event) => {
    const rect = canvasHost.getBoundingClientRect();
    const x = MathUtils.clamp(((event.clientX - rect.left) / rect.width) * 2 - 1, -1.2, 1.2);
    const y = MathUtils.clamp(-(((event.clientY - rect.top) / rect.height) * 2 - 1), -1.2, 1.2);
    pointerTarget.set(x, y, 0).unproject(camera);
    pointerTarget.z = 1.1;
    pointerActive = true;
    requestTick();
  }, { passive: true });
  window.addEventListener('pointerout', (event) => {
    if (!event.relatedTarget) {
      pointerActive = false;
      requestTick();
    }
  });

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
      for (const side of ['L', 'R'] as const) {
        const upper = model.getObjectByName(`EM3D_Base_${side}_Upperarm`) as Bone | undefined;
        const forearm = model.getObjectByName(`EM3D_Base_${side}_Forearm`) as Bone | undefined;
        const hand = model.getObjectByName(`EM3D_Base_${side}_Hand`) as Bone | undefined;
        if (!upper || !forearm || !hand) continue;
        upper.rotation.z = side === 'L' ? -1.25 : 1.25;
        arms.push({ upper, forearm, hand, restUpper: upper.quaternion.clone(),
          restForearm: forearm.quaternion.clone(), side: side === 'L' ? 1 : -1 });
      }
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
