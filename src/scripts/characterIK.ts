import { Bone, MathUtils, Mesh, Object3D, Quaternion, Vector3 } from 'three';

export type ArmChain = {
  upper: Bone;
  forearm: Bone;
  hand: Bone;
  restUpper: Quaternion;
  restForearm: Quaternion;
  restHand: Quaternion;
};

export type WeaponRig = {
  left: ArmChain;
  right: ArmChain;
  barrel: Mesh;
  muzzle: Vector3;
  breech: Vector3;
};

export function createWeaponRig(model: Object3D): WeaponRig | undefined {
  const arm = (side: string): ArmChain | undefined => {
    const upper = model.getObjectByName(`mixamorig${side}Arm`) as Bone;
    const forearm = model.getObjectByName(`mixamorig${side}ForeArm`) as Bone;
    const hand = model.getObjectByName(`mixamorig${side}Hand`) as Bone;
    if (!upper?.isBone || !forearm?.isBone || !hand?.isBone) return;
    return { upper, forearm, hand, restUpper: upper.quaternion.clone(),
      restForearm: forearm.quaternion.clone(), restHand: hand.quaternion.clone() };
  };
  const left = arm('Left');
  const right = arm('Right');
  const barrel = model.getObjectByName('barrel_low') as Mesh;
  if (!left || !right || !barrel?.isMesh) return;
  barrel.geometry.computeBoundingBox();
  const bounds = barrel.geometry.boundingBox!;
  const muzzle = bounds.getCenter(new Vector3());
  const breech = muzzle.clone();
  // This asset's barrel runs along local +Y, from the stock to the muzzle.
  muzzle.y = bounds.max.y;
  breech.y = bounds.min.y;
  return { left, right, barrel, muzzle, breech };
}

export function resetArms(rig: WeaponRig) {
  for (const arm of [rig.right, rig.left]) {
    arm.upper.quaternion.copy(arm.restUpper);
    arm.forearm.quaternion.copy(arm.restForearm);
    arm.hand.quaternion.copy(arm.restHand);
  }
}

function rotateBone(bone: Bone, child: Bone, target: Vector3) {
  const origin = bone.getWorldPosition(new Vector3());
  const current = child.getWorldPosition(new Vector3()).sub(origin).normalize();
  const desired = target.clone().sub(origin).normalize();
  const delta = new Quaternion().setFromUnitVectors(current, desired);
  const world = bone.getWorldQuaternion(new Quaternion());
  bone.quaternion.copy(bone.parent!.getWorldQuaternion(new Quaternion()).invert()
    .multiply(delta).multiply(world));
  bone.updateWorldMatrix(false, true);
}

function measureArm(arm: ArmChain) {
  const shoulder = arm.upper.getWorldPosition(new Vector3());
  const elbow = arm.forearm.getWorldPosition(new Vector3());
  const wrist = arm.hand.getWorldPosition(new Vector3());
  const upper = shoulder.distanceTo(elbow);
  const lower = elbow.distanceTo(wrist);
  return { shoulder, elbow, wrist, upper, lower, rotation: arm.hand.getWorldQuaternion(new Quaternion()) };
}

function solveArm(arm: ArmChain, rest: ReturnType<typeof measureArm>, target: Vector3, rotation: Quaternion) {
  const direction = target.clone().sub(rest.shoulder);
  const distance = MathUtils.clamp(direction.length(), Math.abs(rest.upper - rest.lower) + 0.001,
    rest.upper + rest.lower - 0.001);
  direction.normalize();
  const along = (distance * distance + rest.upper ** 2 - rest.lower ** 2) / (2 * distance);
  const bend = Math.sqrt(Math.max(0, rest.upper ** 2 - along ** 2));
  // Reuse the authored elbow pole, keeping elbows outside the torso as the weapon turns.
  const pole = rest.elbow.clone().sub(rest.shoulder);
  pole.addScaledVector(direction, -pole.dot(direction));
  if (pole.lengthSq() < 1e-8) pole.set(0, 0, -1).addScaledVector(direction, direction.z);
  pole.normalize();
  const elbow = rest.shoulder.clone().addScaledVector(direction, along).addScaledVector(pole, bend);
  rotateBone(arm.upper, arm.forearm, elbow);
  rotateBone(arm.forearm, arm.hand, target);
  arm.hand.quaternion.copy(arm.hand.parent!.getWorldQuaternion(new Quaternion()).invert().multiply(rotation));
  arm.hand.updateWorldMatrix(false, true);
}

/** Call after restoring the authored pose and updating world matrices. */
export function aimWeapon(rig: WeaponRig, cursor: Vector3, strength: number) {
  const right = measureArm(rig.right);
  const left = measureArm(rig.left);
  const muzzle = rig.barrel.localToWorld(rig.muzzle.clone());
  const axis = muzzle.clone().sub(rig.barrel.localToWorld(rig.breech.clone()));
  const muzzleOffset = muzzle.sub(right.wrist);
  const gripOffset = left.wrist.clone().sub(right.wrist);
  const translation = new Vector3();
  const turn = new Quaternion();
  const rightTarget = new Vector3();
  const leftTarget = new Vector3();
  const zAxis = new Vector3(0, 0, 1);

  const updateTargets = () => {
    rightTarget.copy(right.wrist).add(translation);
    const toCursor = cursor.clone().sub(rightTarget);
    // Solve the projected barrel line, including the muzzle's offset from the wrist.
    // Rotating only around camera Z preserves the authored depth and weapon roll.
    const cross = muzzleOffset.x * axis.y - muzzleOffset.y * axis.x;
    const denominator = Math.hypot(toCursor.x, toCursor.y) * Math.hypot(axis.x, axis.y);
    const angle = Math.atan2(toCursor.y, toCursor.x) + Math.asin(MathUtils.clamp(cross / Math.max(denominator, 1e-6), -1, 1))
      - Math.atan2(axis.y, axis.x);
    const shortestAngle = Math.atan2(Math.sin(angle), Math.cos(angle));
    turn.setFromAxisAngle(zAxis, shortestAngle * strength);
    leftTarget.copy(gripOffset).applyQuaternion(turn).add(rightTarget);
  };

  // Translate the shared grip frame only as needed to keep BOTH wrists reachable.
  // The weapon remains parented to the right hand; the left hand follows the same rigid frame.
  for (let iteration = 0; iteration < 24; iteration++) {
    updateTargets();
    let correction = 0;
    for (const [rest, target] of [[left, leftTarget], [right, rightTarget]] as const) {
      const offset = target.clone().sub(rest.shoulder);
      const distance = offset.length();
      const reach = MathUtils.clamp(distance, Math.abs(rest.upper - rest.lower) + 0.008, rest.upper + rest.lower - 0.008);
      if (Math.abs(reach - distance) > 0.00001) {
        const shift = offset.multiplyScalar(reach / distance - 1);
        translation.add(shift);
        rightTarget.add(shift);
        leftTarget.add(shift);
        correction += shift.length();
      }
    }
    if (correction < 0.00001) break;
  }
  updateTargets();
  solveArm(rig.right, right, rightTarget, turn.clone().multiply(right.rotation));
  solveArm(rig.left, left, leftTarget, turn.clone().multiply(left.rotation));
}
