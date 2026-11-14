import test from "node:test";
import assert from "node:assert/strict";
import { applyLookDelta, createFirstPersonControls } from "./FirstPersonControls.js";

const fire = (target, name, values = {}) => target.dispatchEvent(Object.assign(new Event(name, { cancelable: true }), values));
function harness() {
  const doc = new EventTarget(), host = new EventTarget(), canvas = new EventTarget();
  host.matchMedia = () => ({ matches: true }); canvas.focus = () => {};
  canvas.requestPointerLock = () => Promise.resolve();
  doc.exitPointerLock = () => { doc.pointerLockElement = null; fire(doc, "pointerlockchange"); };
  const states = [], looks = [], pauses = [];
  const controls = createFirstPersonControls(canvas, { onLook: (...delta) => looks.push(delta), onChange: (s) => states.push(s), onPause: () => pauses.push(true), onClear() {} }, doc, host);
  const lock = () => { doc.pointerLockElement = canvas; fire(doc, "pointerlockchange"); };
  return { doc, canvas, host, states, looks, pauses, controls, lock };
}

test("Desktop waits for pointer lock and uses relative movement across screen edges", async () => {
  const h = harness();
  h.controls.start();
  assert.equal(h.states.at(-1).active, false); assert.equal(h.states.at(-1).pending, true);
  fire(h.canvas, "pointermove", { pointerId: 1, clientX: 4000, clientY: 4000 });
  assert.equal(h.looks.length, 0);
  h.lock(); assert.equal(h.states.at(-1).active, true);
  fire(h.doc, "mousemove", { movementX: 1400, movementY: -900 }); // acquisition warp is discarded
  for (const screen of [0, 1920, -1920, 7680]) fire(h.doc, "mousemove", { movementX: 4, movementY: 2, clientX: screen, clientY: screen });
  assert.deepEqual(h.looks, [[4, 2], [4, 2], [4, 2], [4, 2]]);
  h.controls.dispose();
});

test("Escape releases capture, pauses, opens settings, and Resume captures again", () => {
  const h = harness(); h.controls.start(); h.lock();
  fire(h.doc, "keydown", { code: "Escape" });
  assert.equal(h.doc.pointerLockElement, null); assert.equal(h.states.at(-1).active, false); assert.equal(h.pauses.length, 1);
  h.controls.start(); h.lock(); assert.equal(h.states.at(-1).locked, true);
  // Native browser Escape may only emit pointerlockchange, without keydown.
  h.doc.pointerLockElement = null; fire(h.doc, "pointerlockchange");
  assert.equal(h.states.at(-1).active, false); assert.equal(h.pauses.length, 2);
  h.controls.start(); h.lock(); h.controls.pause();
  assert.equal(h.pauses.length, 2, "Opening another panel must not force settings");
  h.controls.dispose();
});

test("Capture failure stays paused, and a late capture cannot close an open panel", async () => {
  const h = harness(); h.canvas.requestPointerLock = () => Promise.reject(new Error("denied"));
  h.controls.start(); await Promise.resolve();
  assert.equal(h.states.at(-1).active, false); assert.match(h.states.at(-1).error, /capture/);
  h.canvas.requestPointerLock = () => Promise.resolve();
  h.controls.start(); h.controls.pause(); h.lock();
  assert.equal(h.doc.pointerLockElement, null); assert.equal(h.states.at(-1).active, false);
  h.controls.dispose();
});

test("Look stays finite, rejects driver spikes and clamps pitch without flipping", () => {
  let look = { yaw: 0, pitch: 0 };
  for (let k = 0; k < 5000; k++) look = applyLookDelta(look.yaw, look.pitch, 30, 20, 1.7);
  assert.ok(Math.abs(look.yaw) <= Math.PI); assert.ok(look.pitch > -Math.PI / 2);
  assert.deepEqual(applyLookDelta(look.yaw, look.pitch, NaN, 20, 1.7), look);
  assert.deepEqual(applyLookDelta(look.yaw, look.pitch, 2000, -2000, 1.7), look);
  assert.ok(applyLookDelta(look.yaw, look.pitch, 0, -10, 1.7).pitch > look.pitch);
});
