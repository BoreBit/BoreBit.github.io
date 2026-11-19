import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { Box3, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { aimWeapon, createWeaponRig, resetArms } from '../src/scripts/characterIK.ts';

async function loadRig() {
  const bytes = fs.readFileSync(new URL('../assets/character-military.optimized.glb', import.meta.url));
  const length = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + length));
  // Exercise the shipped geometry and skeleton without browser-only image decoding.
  delete json.images;
  delete json.textures;
  delete json.materials;
  for (const mesh of json.meshes) for (const primitive of mesh.primitives) delete primitive.material;
  json.buffers[0].uri = 'data:application/octet-stream;base64,' + bytes.subarray(length + 28).toString('base64');
  globalThis.ProgressEvent ??= class { constructor(type, values) { Object.assign(this, { type }, values); } };
  const { scene } = await new GLTFLoader().parseAsync(JSON.stringify(json), '');
  scene.updateMatrixWorld(true);
  const bounds = new Box3().setFromObject(scene);
  const scale = 3.2 / bounds.getSize(new Vector3()).y;
  scene.scale.multiplyScalar(scale);
  scene.position.copy(bounds.getCenter(new Vector3()).multiplyScalar(-scale));
  scene.updateMatrixWorld(true);
  return { scene, rig: createWeaponRig(scene), gun: scene.getObjectByName('topGun_low') };
}

test('weapon aims at cursor while both grips stay attached through IK and blending', async () => {
  const { scene, rig, gun } = await loadRig();
  assert.ok(rig);
  assert.equal(gun.parent, rig.right.hand);
  const grips = [rig.right, rig.left].map(arm => gun.worldToLocal(arm.hand.getWorldPosition(new Vector3())));
  for (const x of [-1, 0, 0.5, 1.1, 2, 4]) for (const y of [-4, -2, -1, 0, 1, 2, 3]) {
    // IK is disabled inside and immediately around the portrait, where a cursor can
    // lie behind the muzzle. Test the actual interactive region outside that circle.
    if (Math.hypot(x, y - 0.88) < 1.05) continue;
    for (const strength of [0, 0.2, 0.5, 1]) {
      resetArms(rig);
      scene.updateMatrixWorld(true);
      const cursor = new Vector3(x, y, 0);
      aimWeapon(rig, cursor, strength);
      scene.updateMatrixWorld(true);
      [rig.right, rig.left].forEach((arm, index) => {
        const grip = gun.localToWorld(grips[index].clone());
        assert.ok(grip.distanceTo(arm.hand.getWorldPosition(new Vector3())) < 0.001,
          `Grip ${index} detached at cursor ${x}, ${y}; strength ${strength}`);
      });
      if (strength !== 1) continue;
      const muzzle = rig.barrel.localToWorld(rig.muzzle.clone());
      const axis = muzzle.clone().sub(rig.barrel.localToWorld(rig.breech.clone()));
      const toCursor = cursor.clone().sub(muzzle);
      const error = Math.abs(axis.x * toCursor.y - axis.y * toCursor.x) /
        (Math.hypot(axis.x, axis.y) * Math.hypot(toCursor.x, toCursor.y));
      assert.ok(error < 0.0001, `Barrel misses cursor ${x}, ${y}`);
      assert.ok(axis.x * toCursor.x + axis.y * toCursor.y > 0, 'Muzzle points away from cursor '+x+', '+y);
    }
  }
  resetArms(rig);
  for (const arm of [rig.right, rig.left]) {
    assert.ok(arm.upper.quaternion.equals(arm.restUpper));
    assert.ok(arm.forearm.quaternion.equals(arm.restForearm));
    assert.ok(arm.hand.quaternion.equals(arm.restHand));
  }
});

