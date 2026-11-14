import RAPIER from "@dimforge/rapier3d-compat";
import { surfaceAt } from "./coordinates.js";

let initialized;
export function initPhysics() { return initialized ||= RAPIER.init(); }
export const FIXED_STEP = 1 / 60;
export const LUNAR_GRAVITY = 1.62;
export const EYE_HEIGHT = 1.7;
const HALF_HEIGHT = 0.6, RADIUS = 0.3, CENTER_HEIGHT = HALF_HEIGHT + RADIUS;

export class LunarPhysics {
  constructor(terrain, rocks = []) {
    this.terrain = terrain;
    this.world = new RAPIER.World({ x: 0, y: -LUNAR_GRAVITY, z: 0 });
    this.world.timestep = FIXED_STEP;
    this.world.createCollider(RAPIER.ColliderDesc.trimesh(terrain.positions, terrain.indices, RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES));
    // Solid boundaries supplement the movement clamp, including while airborne.
    for (const [x, z, hx, hz] of [[-501, 0, 1, 502], [501, 0, 1, 502], [0, -501, 502, 1], [0, 501, 502, 1]]) {
      this.world.createCollider(RAPIER.ColliderDesc.cuboid(hx, 4000, hz).setTranslation(x, 0, z));
    }
    for (const rock of rocks) if (rock.radius >= 0.3) {
      this.world.createCollider(RAPIER.ColliderDesc.ball(rock.radius).setTranslation(rock.x, rock.y + rock.radius * 0.45, rock.z));
    }
    this.body = this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
    this.collider = this.world.createCollider(RAPIER.ColliderDesc.capsule(HALF_HEIGHT, RADIUS), this.body);
    this.controller = this.world.createCharacterController(0.015);
    this.controller.setMaxSlopeClimbAngle(42 * Math.PI / 180);
    this.controller.setMinSlopeSlideAngle(44 * Math.PI / 180);
    this.controller.enableAutostep(0.22, 0.3, false);
    this.controller.enableSnapToGround(0.35);
    this.velocity = { x: 0, y: 0, z: 0 };
    this.grounded = false;
    this.reset();
    this.world.step();
  }

  reset() {
    const y = surfaceAt(this.terrain, 0, 0) + CENTER_HEIGHT + 0.04;
    this.body.setTranslation({ x: 0, y, z: 0 }, true);
    this.body.setNextKinematicTranslation({ x: 0, y, z: 0 });
    this.velocity = { x: 0, y: 0, z: 0 };
    this.grounded = false;
    this.previous = { x: 0, y, z: 0 };
    this.world.propagateModifiedBodyPositionsToColliders();
  }

  step(input, yaw, dt = FIXED_STEP) {
    const position = this.body.translation();
    this.previous = { ...position };
    const speed = input.fast ? 4 : 1.6, length = Math.hypot(input.right, input.forward) || 1;
    const right = input.right / length, forward = input.forward / length;
    const targetX = (right * Math.cos(yaw) - forward * Math.sin(yaw)) * speed;
    const targetZ = (-right * Math.sin(yaw) - forward * Math.cos(yaw)) * speed;
    const blend = 1 - Math.exp(-(this.grounded ? 9 : 2.5) * dt);
    this.velocity.x += (targetX - this.velocity.x) * blend;
    this.velocity.z += (targetZ - this.velocity.z) * blend;
    if (input.jump && this.grounded) this.velocity.y = 2.5;
    else if (this.grounded && this.velocity.y < 0) this.velocity.y = -0.3;
    this.velocity.y -= LUNAR_GRAVITY * dt;
    const clamp = (v) => Math.max(-499.6, Math.min(499.6, v));
    this.controller.computeColliderMovement(this.collider, {
      x: clamp(position.x + this.velocity.x * dt) - position.x,
      y: this.velocity.y * dt,
      z: clamp(position.z + this.velocity.z * dt) - position.z,
    });
    const movement = this.controller.computedMovement();
    this.grounded = this.controller.computedGrounded();
    if (this.grounded && this.velocity.y < 0) this.velocity.y = -0.3;
    if (movement.y < this.velocity.y * dt - 0.001 && this.velocity.y > 0) this.velocity.y = 0;
    this.body.setNextKinematicTranslation({ x: position.x + movement.x, y: position.y + movement.y, z: position.z + movement.z });
    this.world.step();
    const next = this.body.translation(), floor = surfaceAt(this.terrain, next.x, next.z);
    if (!Number.isFinite(next.y) || next.y < floor - 2) this.reset();
  }

  eye(alpha = 1) {
    const p = this.body.translation(), a = this.previous;
    return { x: a.x + (p.x - a.x) * alpha, y: a.y + (p.y - a.y) * alpha + EYE_HEIGHT - CENTER_HEIGHT, z: a.z + (p.z - a.z) * alpha };
  }

  dispose() { this.world.free(); }
}
