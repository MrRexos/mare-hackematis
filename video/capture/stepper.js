// Injected before the page scripts. Lets the capture script own the animation clock:
// requestAnimationFrame callbacks only run when __cap.step(dtMs) is called, and
// performance.now() returns the stepped time. The app code is untouched.
(() => {
  const realNow = performance.now.bind(performance);
  const realRaf = window.requestAnimationFrame.bind(window);
  const realCancel = window.cancelAnimationFrame.bind(window);
  const cap = { manual: false, t: 0, q: new Map(), id: 1e6 };
  window.__cap = cap;
  performance.now = () => (cap.manual ? cap.t : realNow());
  window.requestAnimationFrame = (fn) => {
    if (cap.manual) { const id = cap.id++; cap.q.set(id, fn); return id; }
    // A callback asked for before enable() must not run later with the browser's
    // own timestamp: on a slow renderer that timestamp is seconds ahead of the
    // stepped clock, and anything the app throttles by time (HUD, shadow maps)
    // would then stand still. Such a callback joins the stepped queue instead.
    return realRaf((timestamp) => {
      if (cap.manual) cap.q.set(cap.id++, fn);
      else fn(timestamp);
    });
  };
  window.cancelAnimationFrame = (id) => { if (cap.q.delete(id)) return; realCancel(id); };
  cap.enable = () => { cap.t = realNow(); cap.manual = true; };
  cap.disable = () => { cap.manual = false; const fns = [...cap.q.values()]; cap.q.clear(); fns.forEach((fn) => realRaf(fn)); };
  cap.step = (dt) => {
    cap.t += dt;
    const fns = [...cap.q.values()]; cap.q.clear();
    for (const fn of fns) fn(cap.t);
    return fns.length;
  };
})();
