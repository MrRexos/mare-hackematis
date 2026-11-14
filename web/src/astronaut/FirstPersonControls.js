const TAU = Math.PI * 2, PITCH_LIMIT = Math.PI * 0.47;

export function applyLookDelta(yaw, pitch, dx, dy, sensitivity) {
  // Ignore cursor-warp/driver spikes. Screen coordinates never drive the mouse.
  if (![dx, dy].every(Number.isFinite) || Math.hypot(dx, dy) > 900) return { yaw, pitch };
  const gain = sensitivity * 0.001, clamp = (n) => Math.max(-140, Math.min(140, n));
  yaw -= clamp(dx) * gain;
  return { yaw: ((yaw + Math.PI) % TAU + TAU) % TAU - Math.PI,
    pitch: Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch - clamp(dy) * gain)) };
}

export function createFirstPersonControls(canvas, { onLook, onChange, onPause, onClear }, doc = document, host = window) {
  let active = false, locked = false, pending = false, wanted = false, disposed = false, intentionalUnlock = false;
  let discardMotion = false, touch = null, error = "";
  const removers = [];
  const listen = (target, name, fn) => { target.addEventListener(name, fn); removers.push(() => target.removeEventListener(name, fn)); };
  const emit = () => { if (!disposed) onChange({ active, locked, pending, error }); };
  const clear = () => {
    if (touch && canvas.hasPointerCapture?.(touch.id)) canvas.releasePointerCapture(touch.id);
    touch = null; onClear();
  };
  const pause = (settings = false) => {
    wanted = false; active = false; pending = false; intentionalUnlock = true; clear();
    if (doc.pointerLockElement === canvas) doc.exitPointerLock();
    locked = false; emit();
    if (settings && !disposed) onPause();
  };
  const fail = () => {
    if (disposed || !wanted) return;
    active = false; pending = false; wanted = false;
    error = "Mouse capture was interrupted. Click Resume exploring to capture it again.";
    clear(); emit(); onPause();
  };
  const activateTouch = () => { wanted = true; active = true; error = ""; emit(); };
  const start = () => {
    if (disposed || pending || locked) return;
    wanted = true; intentionalUnlock = false; error = ""; clear(); canvas.focus({ preventScroll: true });
    if (!host.matchMedia("(pointer: fine)").matches) { activateTouch(); return; }
    // Activation waits for pointerlockchange. Desktop has no drag fallback.
    if (!canvas.requestPointerLock) { fail(); return; }
    pending = true; emit();
    try { Promise.resolve(canvas.requestPointerLock()).catch(fail); } catch { fail(); }
  };
  listen(doc, "pointerlockchange", () => {
    const hadLock = locked;
    locked = doc.pointerLockElement === canvas; pending = false; clear();
    if (locked) {
      if (!wanted) { intentionalUnlock = true; doc.exitPointerLock(); locked = false; }
      else { active = true; error = ""; discardMotion = true; }
    } else {
      active = false;
      if (hadLock && !intentionalUnlock) { wanted = false; onPause(); }
    }
    intentionalUnlock = false; emit();
  });
  listen(doc, "pointerlockerror", fail);
  listen(doc, "keydown", (event) => { if (event.code === "Escape") { event.preventDefault(); pause(true); } });
  listen(host, "blur", () => { if (active || pending) pause(true); });
  listen(doc, "visibilitychange", () => { if (doc.hidden && (active || pending)) pause(true); });
  listen(doc, "mousemove", (event) => {
    if (!locked || !active) return;
    if (discardMotion) { discardMotion = false; return; }
    onLook(event.movementX, event.movementY);
  });
  listen(canvas, "pointerdown", (event) => {
    if (event.button !== 0) return;
    if (event.pointerType === "touch" || event.pointerType === "pen") {
      activateTouch(); touch = { id: event.pointerId, x: event.clientX, y: event.clientY };
      canvas.setPointerCapture(event.pointerId);
    } else if (!active) start();
  });
  listen(canvas, "pointermove", (event) => {
    if (!active || locked || touch?.id !== event.pointerId) return;
    onLook(event.clientX - touch.x, event.clientY - touch.y);
    touch.x = event.clientX; touch.y = event.clientY;
  });
  listen(canvas, "pointerup", (event) => { if (touch?.id === event.pointerId) clear(); });
  listen(canvas, "pointercancel", clear);
  return { start, pause: () => pause(false), activateTouch,
    dispose() { pause(false); disposed = true; removers.forEach((remove) => remove()); } };
}
