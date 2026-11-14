/* @ds-bundle: {"format":4,"namespace":"LunarHorizon","components":[{"name":"Icon"},{"name":"Button"},{"name":"IconButton"},{"name":"SegmentedControl"},{"name":"Tabs"},{"name":"NavRail"},{"name":"Panel"},{"name":"SiteHeader"},{"name":"Readout"},{"name":"VisibilityTag"},{"name":"FidelityBadge"},{"name":"MetricBar"},{"name":"SiteRow"},{"name":"CompareTray"},{"name":"MapMarker"},{"name":"TimeBar"},{"name":"AvailabilityLanes"},{"name":"SkyPlot"},{"name":"DayStrip"},{"name":"Compass"},{"name":"Slider"},{"name":"Switch"},{"name":"ChoiceList"},{"name":"StatusBanner"},{"name":"ExplainNote"},{"name":"Kbd"},{"name":"Pager"}]} */
(function () {
  "use strict";
  var React = window.React;
  var h = React.createElement;
  var useState = React.useState, useEffect = React.useEffect, useRef = React.useRef, useCallback = React.useCallback;

  /* ---------- helpers ---------- */
  var uidCount = 0;
  function useUid(prefix) {
    var r = useRef(null);
    if (r.current === null) { uidCount += 1; r.current = (prefix || "lh") + "-" + uidCount; }
    return r.current;
  }
  function cx() {
    var out = [];
    for (var i = 0; i < arguments.length; i++) { if (arguments[i]) out.push(arguments[i]); }
    return out.join(" ");
  }
  function omit(obj, keys) {
    var o = {};
    for (var k in obj) { if (Object.prototype.hasOwnProperty.call(obj, k) && keys.indexOf(k) < 0) o[k] = obj[k]; }
    return o;
  }
  function useControllable(value, defaultValue, onChange) {
    var s = useState(defaultValue);
    var isCtl = value !== undefined;
    var set = useCallback(function (v) { if (!isCtl) s[1](v); if (onChange) onChange(v); }, [isCtl, onChange]);
    return [isCtl ? value : s[0], set];
  }
  function toDate(v) { return v instanceof Date ? v : new Date(v); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var HOUR = 3600000, DAY = 86400000;
  function fmtDate(d) { return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate()); }
  function fmtTime(d) { return pad(d.getUTCHours()) + ":" + pad(d.getUTCMinutes()); }
  function fmtShort(d) { return MONTHS[d.getUTCMonth()] + " " + d.getUTCDate() + " · " + fmtTime(d); }
  function makeTicks(start, end) {
    var span = end - start, ticks = [], d;
    if (span > 3 * 365 * DAY) {
      d = new Date(Date.UTC(start.getUTCFullYear() + 1, 0, 1));
      while (d < end) { ticks.push({ t: d, label: String(d.getUTCFullYear()) }); d = new Date(Date.UTC(d.getUTCFullYear() + 1, 0, 1)); }
    } else if (span > 75 * DAY) {
      var stepM = span > 500 * DAY ? 3 : 1;
      d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
      while (d < end) {
        ticks.push({ t: d, label: d.getUTCMonth() === 0 ? String(d.getUTCFullYear()) : MONTHS[d.getUTCMonth()] });
        d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + stepM, 1));
      }
    } else {
      var stepD = span > 21 * DAY ? 7 : span > 6 * DAY ? 2 : 1;
      d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + 1));
      while (d < end) { ticks.push({ t: d, label: MONTHS[d.getUTCMonth()] + " " + d.getUTCDate() }); d = new Date(d.getTime() + stepD * DAY); }
    }
    return ticks;
  }

  /* ---------- Icon (Lucide data, ISC) ---------- */
  var ICONS = {"orbit":[["circle",{"cx":"12","cy":"12","r":"3"}],["circle",{"cx":"19","cy":"5","r":"2"}],["circle",{"cx":"5","cy":"19","r":"2"}],["path",{"d":"M10.4 21.9a10 10 0 0 0 9.941-15.416"}],["path",{"d":"M13.5 2.1a10 10 0 0 0-9.841 15.416"}]],"map-pin":[["path",{"d":"M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"}],["circle",{"cx":"12","cy":"10","r":"3"}]],"git-compare-arrows":[["circle",{"cx":"5","cy":"6","r":"3"}],["path",{"d":"M12 6h5a2 2 0 0 1 2 2v7"}],["path",{"d":"m15 9-3-3 3-3"}],["circle",{"cx":"19","cy":"18","r":"3"}],["path",{"d":"M12 18H7a2 2 0 0 1-2-2V9"}],["path",{"d":"m9 15 3 3-3 3"}]],"book-open":[["path",{"d":"M12 7v14"}],["path",{"d":"M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"}]],"sliders-horizontal":[["line",{"x1":"21","x2":"14","y1":"4","y2":"4"}],["line",{"x1":"10","x2":"3","y1":"4","y2":"4"}],["line",{"x1":"21","x2":"12","y1":"12","y2":"12"}],["line",{"x1":"8","x2":"3","y1":"12","y2":"12"}],["line",{"x1":"21","x2":"16","y1":"20","y2":"20"}],["line",{"x1":"12","x2":"3","y1":"20","y2":"20"}],["line",{"x1":"14","x2":"14","y1":"2","y2":"6"}],["line",{"x1":"8","x2":"8","y1":"10","y2":"14"}],["line",{"x1":"16","x2":"16","y1":"18","y2":"22"}]],"share-2":[["circle",{"cx":"18","cy":"5","r":"3"}],["circle",{"cx":"6","cy":"12","r":"3"}],["circle",{"cx":"18","cy":"19","r":"3"}],["line",{"x1":"8.59","x2":"15.42","y1":"13.51","y2":"17.49"}],["line",{"x1":"15.41","x2":"8.59","y1":"6.51","y2":"10.49"}]],"sun":[["circle",{"cx":"12","cy":"12","r":"4"}],["path",{"d":"M12 2v2"}],["path",{"d":"M12 20v2"}],["path",{"d":"m4.93 4.93 1.41 1.41"}],["path",{"d":"m17.66 17.66 1.41 1.41"}],["path",{"d":"M2 12h2"}],["path",{"d":"M20 12h2"}],["path",{"d":"m6.34 17.66-1.41 1.41"}],["path",{"d":"m19.07 4.93-1.41 1.41"}]],"earth":[["path",{"d":"M21.54 15H17a2 2 0 0 0-2 2v4.54"}],["path",{"d":"M7 3.34V5a3 3 0 0 0 3 3a2 2 0 0 1 2 2c0 1.1.9 2 2 2a2 2 0 0 0 2-2c0-1.1.9-2 2-2h3.17"}],["path",{"d":"M11 21.95V18a2 2 0 0 0-2-2a2 2 0 0 1-2-2v-1a2 2 0 0 0-2-2H2.05"}],["circle",{"cx":"12","cy":"12","r":"10"}]],"blend":[["circle",{"cx":"9","cy":"9","r":"7"}],["circle",{"cx":"15","cy":"15","r":"7"}]],"moon":[["path",{"d":"M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"}]],"satellite-dish":[["path",{"d":"M4 10a7.31 7.31 0 0 0 10 10Z"}],["path",{"d":"m9 15 3-3"}],["path",{"d":"M17 13a6 6 0 0 0-6-6"}],["path",{"d":"M21 13A10 10 0 0 0 11 3"}]],"mountain":[["path",{"d":"m8 3 4 8 5-5 5 15H2L8 3z"}]],"play":[["polygon",{"points":"6 3 20 12 6 21 6 3"}]],"pause":[["rect",{"x":"14","y":"4","width":"4","height":"16","rx":"1"}],["rect",{"x":"6","y":"4","width":"4","height":"16","rx":"1"}]],"skip-back":[["polygon",{"points":"19 20 9 12 19 4 19 20"}],["line",{"x1":"5","x2":"5","y1":"19","y2":"5"}]],"skip-forward":[["polygon",{"points":"5 4 15 12 5 20 5 4"}],["line",{"x1":"19","x2":"19","y1":"5","y2":"19"}]],"chevron-left":[["path",{"d":"m15 18-6-6 6-6"}]],"chevron-right":[["path",{"d":"m9 18 6-6-6-6"}]],"chevron-up":[["path",{"d":"m18 15-6-6-6 6"}]],"chevron-down":[["path",{"d":"m6 9 6 6 6-6"}]],"calendar":[["path",{"d":"M8 2v4"}],["path",{"d":"M16 2v4"}],["rect",{"width":"18","height":"18","x":"3","y":"4","rx":"2"}],["path",{"d":"M3 10h18"}]],"clock":[["circle",{"cx":"12","cy":"12","r":"10"}],["polyline",{"points":"12 6 12 12 16 14"}]],"timer":[["line",{"x1":"10","x2":"14","y1":"2","y2":"2"}],["line",{"x1":"12","x2":"15","y1":"14","y2":"11"}],["circle",{"cx":"12","cy":"14","r":"8"}]],"plus":[["path",{"d":"M5 12h14"}],["path",{"d":"M12 5v14"}]],"minus":[["path",{"d":"M5 12h14"}]],"maximize-2":[["polyline",{"points":"15 3 21 3 21 9"}],["polyline",{"points":"9 21 3 21 3 15"}],["line",{"x1":"21","x2":"14","y1":"3","y2":"10"}],["line",{"x1":"3","x2":"10","y1":"21","y2":"14"}]],"minimize-2":[["polyline",{"points":"4 14 10 14 10 20"}],["polyline",{"points":"20 10 14 10 14 4"}],["line",{"x1":"14","x2":"21","y1":"10","y2":"3"}],["line",{"x1":"3","x2":"10","y1":"21","y2":"14"}]],"crosshair":[["circle",{"cx":"12","cy":"12","r":"10"}],["line",{"x1":"22","x2":"18","y1":"12","y2":"12"}],["line",{"x1":"6","x2":"2","y1":"12","y2":"12"}],["line",{"x1":"12","x2":"12","y1":"6","y2":"2"}],["line",{"x1":"12","x2":"12","y1":"22","y2":"18"}]],"locate-fixed":[["line",{"x1":"2","x2":"5","y1":"12","y2":"12"}],["line",{"x1":"19","x2":"22","y1":"12","y2":"12"}],["line",{"x1":"12","x2":"12","y1":"2","y2":"5"}],["line",{"x1":"12","x2":"12","y1":"19","y2":"22"}],["circle",{"cx":"12","cy":"12","r":"7"}],["circle",{"cx":"12","cy":"12","r":"3"}]],"layers":[["path",{"d":"m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"}],["path",{"d":"m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"}],["path",{"d":"m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"}]],"search":[["circle",{"cx":"11","cy":"11","r":"8"}],["path",{"d":"m21 21-4.3-4.3"}]],"x":[["path",{"d":"M18 6 6 18"}],["path",{"d":"m6 6 12 12"}]],"check":[["path",{"d":"M20 6 9 17l-5-5"}]],"info":[["circle",{"cx":"12","cy":"12","r":"10"}],["path",{"d":"M12 16v-4"}],["path",{"d":"M12 8h.01"}]],"triangle-alert":[["path",{"d":"m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"}],["path",{"d":"M12 9v4"}],["path",{"d":"M12 17h.01"}]],"loader-circle":[["path",{"d":"M21 12a9 9 0 1 1-6.219-8.56"}]],"circle-dashed":[["path",{"d":"M10.1 2.182a10 10 0 0 1 3.8 0"}],["path",{"d":"M13.9 21.818a10 10 0 0 1-3.8 0"}],["path",{"d":"M17.609 3.721a10 10 0 0 1 2.69 2.7"}],["path",{"d":"M2.182 13.9a10 10 0 0 1 0-3.8"}],["path",{"d":"M20.279 17.609a10 10 0 0 1-2.7 2.69"}],["path",{"d":"M21.818 10.1a10 10 0 0 1 0 3.8"}],["path",{"d":"M3.721 6.391a10 10 0 0 1 2.7-2.69"}],["path",{"d":"M6.391 20.279a10 10 0 0 1-2.69-2.7"}]],"circle-dot":[["circle",{"cx":"12","cy":"12","r":"10"}],["circle",{"cx":"12","cy":"12","r":"1"}]],"badge-check":[["path",{"d":"M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z"}],["path",{"d":"m9 12 2 2 4-4"}]],"circle-dot-dashed":[["path",{"d":"M10.1 2.18a9.93 9.93 0 0 1 3.8 0"}],["path",{"d":"M17.6 3.71a9.95 9.95 0 0 1 2.69 2.7"}],["path",{"d":"M21.82 10.1a9.93 9.93 0 0 1 0 3.8"}],["path",{"d":"M20.29 17.6a9.95 9.95 0 0 1-2.7 2.69"}],["path",{"d":"M13.9 21.82a9.94 9.94 0 0 1-3.8 0"}],["path",{"d":"M6.4 20.29a9.95 9.95 0 0 1-2.69-2.7"}],["path",{"d":"M2.18 13.9a9.93 9.93 0 0 1 0-3.8"}],["path",{"d":"M3.71 6.4a9.95 9.95 0 0 1 2.7-2.69"}],["circle",{"cx":"12","cy":"12","r":"1"}]],"eye":[["path",{"d":"M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"}],["circle",{"cx":"12","cy":"12","r":"3"}]],"download":[["path",{"d":"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"}],["polyline",{"points":"7 10 12 15 17 10"}],["line",{"x1":"12","x2":"12","y1":"15","y2":"3"}]],"arrow-up-right":[["path",{"d":"M7 7h10v10"}],["path",{"d":"M7 17 17 7"}]],"rotate-ccw":[["path",{"d":"M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"}],["path",{"d":"M3 3v5h5"}]],"move-vertical":[["path",{"d":"M12 2v20"}],["path",{"d":"m8 18 4 4 4-4"}],["path",{"d":"m8 6 4-4 4 4"}]],"sunrise":[["path",{"d":"M12 2v8"}],["path",{"d":"m4.93 10.93 1.41 1.41"}],["path",{"d":"M2 18h2"}],["path",{"d":"M20 18h2"}],["path",{"d":"m19.07 10.93-1.41 1.41"}],["path",{"d":"M22 22H2"}],["path",{"d":"m8 6 4-4 4 4"}],["path",{"d":"M16 18a4 4 0 0 0-8 0"}]],"sunset":[["path",{"d":"M12 10V2"}],["path",{"d":"m4.93 10.93 1.41 1.41"}],["path",{"d":"M2 18h2"}],["path",{"d":"M20 18h2"}],["path",{"d":"m19.07 10.93-1.41 1.41"}],["path",{"d":"M22 22H2"}],["path",{"d":"m16 6-4 4-4-4"}],["path",{"d":"M16 18a4 4 0 0 0-8 0"}]],"scan":[["path",{"d":"M3 7V5a2 2 0 0 1 2-2h2"}],["path",{"d":"M17 3h2a2 2 0 0 1 2 2v2"}],["path",{"d":"M21 17v2a2 2 0 0 1-2 2h-2"}],["path",{"d":"M7 21H5a2 2 0 0 1-2-2v-2"}]],"globe":[["circle",{"cx":"12","cy":"12","r":"10"}],["path",{"d":"M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"}],["path",{"d":"M2 12h20"}]],"settings-2":[["path",{"d":"M20 7h-9"}],["path",{"d":"M14 17H5"}],["circle",{"cx":"17","cy":"17","r":"3"}],["circle",{"cx":"7","cy":"7","r":"3"}]],"circle-help":[["circle",{"cx":"12","cy":"12","r":"10"}],["path",{"d":"M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"}],["path",{"d":"M12 17h.01"}]],"file-spreadsheet":[["path",{"d":"M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"}],["path",{"d":"M14 2v4a2 2 0 0 0 2 2h4"}],["path",{"d":"M8 13h2"}],["path",{"d":"M14 13h2"}],["path",{"d":"M8 17h2"}],["path",{"d":"M14 17h2"}]],"image":[["rect",{"width":"18","height":"18","x":"3","y":"3","rx":"2","ry":"2"}],["circle",{"cx":"9","cy":"9","r":"2"}],["path",{"d":"m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"}]],"arrow-right":[["path",{"d":"M5 12h14"}],["path",{"d":"m12 5 7 7-7 7"}]],"arrow-left":[["path",{"d":"m12 19-7-7 7-7"}],["path",{"d":"M19 12H5"}]],"grip-vertical":[["circle",{"cx":"9","cy":"12","r":"1"}],["circle",{"cx":"9","cy":"5","r":"1"}],["circle",{"cx":"9","cy":"19","r":"1"}],["circle",{"cx":"15","cy":"12","r":"1"}],["circle",{"cx":"15","cy":"5","r":"1"}],["circle",{"cx":"15","cy":"19","r":"1"}]],"eye-off":[["path",{"d":"M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"}],["path",{"d":"M14.084 14.158a3 3 0 0 1-4.242-4.242"}],["path",{"d":"M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"}],["path",{"d":"m2 2 20 20"}]]};
  function Icon(p) {
    var data = ICONS[p.name];
    if (!data) return null;
    var size = p.size || 20;
    return h("svg", {
      xmlns: "http://www.w3.org/2000/svg", width: size, height: size, viewBox: "0 0 24 24", fill: "none",
      stroke: "currentColor", strokeWidth: p.strokeWidth || 1.75, strokeLinecap: "round", strokeLinejoin: "round",
      className: cx("lh-icon", p.className), style: p.style,
      role: p.label ? "img" : undefined, "aria-label": p.label || undefined, "aria-hidden": p.label ? undefined : true, focusable: "false"
    }, data.map(function (c, i) { return h(c[0], Object.assign({ key: i }, c[1])); }));
  }
  Icon.names = Object.keys(ICONS);

  var KIND = {
    sun: { icon: "sun", name: "Sun" },
    earth: { icon: "earth", name: "Earth" },
    both: { icon: "blend", name: "Sun + Earth" }
  };

  /* ---------- Button ---------- */
  function Button(p) {
    var variant = p.variant || "secondary", size = p.size || "md";
    var isz = size === "sm" ? 16 : 18;
    var rest = omit(p, ["variant", "size", "icon", "iconRight", "loading", "className", "children"]);
    return h("button", Object.assign({ type: "button" }, rest, {
      className: cx("lh-btn", "lh-btn--" + variant, "lh-btn--" + size, p.loading && "is-loading", p.className),
      disabled: p.disabled || p.loading, "aria-busy": p.loading ? true : undefined
    }),
      p.loading ? h(Icon, { name: "loader-circle", size: isz, className: "lh-spin" }) : (p.icon ? h(Icon, { name: p.icon, size: isz }) : null),
      p.children != null ? h("span", { className: "lh-btn__label" }, p.children) : null,
      p.iconRight ? h(Icon, { name: p.iconRight, size: isz }) : null);
  }

  /* ---------- IconButton ---------- */
  function IconButton(p) {
    var size = p.size || "md", variant = p.variant || "raised";
    var isz = size === "sm" ? 16 : size === "lg" ? 22 : 20;
    var rest = omit(p, ["icon", "label", "text", "size", "variant", "active", "className", "caption"]);
    var btn = h("button", Object.assign({ type: "button", "aria-label": p.label, title: p.label }, rest, {
      className: cx("lh-ibtn", "lh-ibtn--" + variant, "lh-ibtn--" + size, p.active && "is-active", p.className),
      "aria-pressed": p.active === undefined ? undefined : !!p.active
    }), p.text ? h("span", { className: "lh-ibtn__text" }, p.text) : h(Icon, { name: p.icon, size: isz }));
    if (!p.caption) return btn;
    return h("span", { className: "lh-ibtn-wrap" }, btn, h("span", { className: "lh-ibtn__caption", "aria-hidden": true }, p.caption));
  }

  /* ---------- SegmentedControl ---------- */
  function rovingKey(e, i, n) {
    if (e.key === "ArrowRight" || e.key === "ArrowDown") return (i + 1) % n;
    if (e.key === "ArrowLeft" || e.key === "ArrowUp") return (i - 1 + n) % n;
    if (e.key === "Home") return 0;
    if (e.key === "End") return n - 1;
    return -1;
  }
  function SegmentedControl(p) {
    var opts = p.options || [];
    var st = useControllable(p.value, p.defaultValue !== undefined ? p.defaultValue : (opts[0] && opts[0].value), p.onChange);
    var refs = useRef([]);
    return h("div", { role: "radiogroup", "aria-label": p.label, className: cx("lh-seg", "lh-seg--" + (p.size || "md"), p.block && "lh-seg--block", p.className) },
      opts.map(function (o, i) {
        var on = o.value === st[0];
        return h("button", {
          key: String(o.value), type: "button", role: "radio", "aria-checked": on, tabIndex: on ? 0 : -1,
          "aria-label": o.ariaLabel, disabled: o.disabled,
          ref: function (el) { refs.current[i] = el; },
          className: cx("lh-seg__opt", on && "is-on"),
          onClick: function () { st[1](o.value); },
          onKeyDown: function (e) {
            var n = rovingKey(e, i, opts.length);
            if (n < 0) return;
            e.preventDefault(); st[1](opts[n].value);
            if (refs.current[n]) refs.current[n].focus();
          }
        },
          o.icon ? h(Icon, { name: o.icon, size: 16 }) : null,
          o.label ? h("span", null, o.label) : null,
          o.count != null ? h("span", { className: "lh-seg__count" }, o.count) : null);
      }));
  }

  /* ---------- Tabs ---------- */
  function Tabs(p) {
    var items = p.items || [];
    var st = useControllable(p.value, p.defaultValue !== undefined ? p.defaultValue : (items[0] && items[0].value), p.onChange);
    var refs = useRef([]);
    return h("div", { role: "tablist", "aria-label": p.label, className: cx("lh-tabs", p.className) },
      items.map(function (it, i) {
        var on = it.value === st[0];
        return h("button", {
          key: String(it.value), type: "button", role: "tab", "aria-selected": on, tabIndex: on ? 0 : -1,
          "aria-controls": it.panelId, disabled: it.disabled,
          ref: function (el) { refs.current[i] = el; },
          className: cx("lh-tab", on && "is-on"),
          onClick: function () { st[1](it.value); },
          onKeyDown: function (e) {
            var n = rovingKey(e, i, items.length);
            if (n < 0) return;
            e.preventDefault(); st[1](items[n].value);
            if (refs.current[n]) refs.current[n].focus();
          }
        },
          p.indexed ? h("span", { className: "lh-tab__idx" }, pad(i + 1)) : null,
          h("span", null, it.label),
          it.badge ? h("span", { className: "lh-tab__badge" }, it.badge) : null);
      }));
  }

  /* ---------- NavRail ---------- */
  function NavRail(p) {
    var items = p.items || [], footer = p.footer || [];
    var st = useControllable(p.active, p.defaultActive !== undefined ? p.defaultActive : (items[0] && items[0].id), p.onSelect);
    function item(it) {
      var on = it.id === st[0];
      return h("li", { key: it.id },
        h("button", {
          type: "button", className: cx("lh-rail__item", on && "is-active"), "aria-current": on ? "page" : undefined,
          disabled: it.disabled, title: it.label,
          onClick: function () { if (it.onClick) it.onClick(); else st[1](it.id); }
        },
          h("span", { className: "lh-rail__icon" }, h(Icon, { name: it.icon, size: 20 }),
            it.badge != null ? h("span", { className: "lh-rail__badge" }, it.badge) : null),
          h("span", { className: "lh-rail__label" }, it.label)));
    }
    return h("nav", { className: cx("lh-rail", p.orientation === "horizontal" && "lh-rail--h", p.className), "aria-label": p.label || "Main" },
      p.orientation === "horizontal" ? null : h("div", { className: "lh-rail__brand", title: p.brandLabel || "Lunar Horizon" }, p.brand || "LH"),
      h("ul", { className: "lh-rail__list" }, items.map(item)),
      footer.length ? h("ul", { className: "lh-rail__list lh-rail__footer" }, footer.map(item)) : null);
  }

  /* ---------- Panel ---------- */
  function Panel(p) {
    var tid = useUid("lh-panel");
    var rest = omit(p, ["title", "eyebrow", "actions", "tone", "padding", "className", "children", "as"]);
    var hasHead = p.title || p.eyebrow || p.actions;
    return h(p.as || "section", Object.assign({ "aria-labelledby": p.title ? tid : undefined }, rest, {
      className: cx("lh-panel", "lh-panel--" + (p.tone || "default"), p.padding && "lh-panel--pad-" + p.padding, p.className)
    }),
      hasHead ? h("header", { className: "lh-panel__head" },
        h("div", { className: "lh-panel__titles" },
          p.eyebrow ? h("div", { className: "eyebrow lh-muted" }, p.eyebrow) : null,
          p.title ? h("h2", { id: tid, className: "title lh-panel__title" }, p.title) : null),
        p.actions ? h("div", { className: "lh-panel__actions" }, p.actions) : null) : null,
      p.children);
  }

  /* ---------- FidelityBadge ---------- */
  var FID = {
    validated: { icon: "badge-check", label: "Validated" },
    computed: { icon: "circle-dot", label: "Computed" },
    approximate: { icon: "circle-dashed", label: "Approximate" },
    low: { icon: "circle-dot-dashed", label: "Low fidelity" },
    processing: { icon: "loader-circle", label: "Processing" }
  };
  function FidelityBadge(p) {
    var level = p.level || "computed", f = FID[level] || FID.computed;
    return h("span", { className: cx("lh-fid", "lh-fid--" + level, p.className), title: p.detail || undefined },
      h(Icon, { name: f.icon, size: 14, className: level === "processing" ? "lh-spin" : undefined }),
      h("span", { className: "lh-fid__label" }, p.children || f.label));
  }

  /* ---------- SiteHeader ---------- */
  function SiteHeader(p) {
    return h("header", { className: cx("lh-sitehead", p.className) },
      h("div", { className: "lh-sitehead__main" },
        p.eyebrow ? h("div", { className: "eyebrow lh-muted" }, p.eyebrow) : null,
        h("h1", { className: "title-lg lh-sitehead__name" }, p.name),
        h("div", { className: "lh-sitehead__meta" },
          p.coords ? h("span", { className: "readout-sm lh-sec" }, p.coords) : null,
          p.place ? h("span", { className: "body-sm lh-sec" }, p.place) : null,
          p.rank ? h("span", { className: "lh-chip" },
            h("span", { className: "readout-sm" }, "#" + p.rank.position),
            h("span", { className: "body-sm lh-sec" }, p.rank.goal)) : null,
          p.fidelity ? h(FidelityBadge, { level: p.fidelity, detail: p.fidelityDetail }) : null)),
      p.actions ? h("div", { className: "lh-sitehead__actions" }, p.actions) : null);
  }

  /* ---------- Readout ---------- */
  function Readout(p) {
    var size = p.size || "md";
    var valCls = size === "xl" ? "figure-xl" : size === "lg" ? "figure" : size === "sm" ? "readout-sm" : "readout";
    var k = KIND[p.kind];
    return h("div", { className: cx("lh-readout", "lh-readout--" + size, p.className) },
      h("div", { className: "lh-readout__label" },
        k ? h(Icon, { name: k.icon, size: 14, className: "lh-k-" + p.kind }) : null,
        h("span", { className: "label" }, p.label)),
      h("div", { className: "lh-readout__value" },
        p.approx ? h("span", { className: cx(valCls, "lh-approx"), title: "Approximate value" }, "≈") : null,
        h("span", { className: valCls }, p.value, p.unit === "%" || p.unit === "°" ? p.unit : null),
        p.unit && p.unit !== "%" && p.unit !== "°" ? h("span", { className: cx(size === "xl" || size === "lg" ? "body" : "body-sm", "lh-sec") }, p.unit) : null),
      p.hint ? h("div", { className: "caption lh-muted" }, p.hint) : null);
  }

  /* ---------- VisibilityTag ---------- */
  function VisibilityTag(p) {
    var kind = p.kind || "sun", k = KIND[kind] || KIND.sun, state = p.state || "visible";
    var txt = p.children;
    if (txt == null) {
      if (kind === "both") txt = state === "visible" ? "Sun + Earth now" : "Not both now";
      else txt = state === "visible" ? k.name + " visible" : state === "blocked" ? k.name + " blocked by terrain" : k.name + " below horizon";
    }
    return h("span", { className: cx("lh-vtag", "lh-vtag--" + kind, "is-" + state, p.className) },
      h(Icon, { name: k.icon, size: 16, className: "lh-vtag__icon" }),
      h("span", { className: "body-sm" }, txt),
      p.value != null ? h("span", { className: "readout-sm lh-sec" }, p.value) : null);
  }

  /* ---------- MetricBar ---------- */
  function MetricBar(p) {
    var max = p.max || 100, v = Math.max(0, Math.min(max, +p.value || 0)), pct = v / max * 100;
    var kind = p.kind || "neutral", k = KIND[kind];
    var unit = p.unit === undefined ? "%" : p.unit;
    var display = p.display != null ? p.display : (Math.round(v * 10) / 10) + unit;
    return h("div", { className: cx("lh-mbar", "lh-mbar--" + kind, p.compact && "lh-mbar--compact", p.className) },
      p.label ? h("div", { className: "lh-mbar__head" },
        h("span", { className: cx("lh-mbar__label", p.compact ? "caption" : "body-sm") },
          k ? h(Icon, { name: k.icon, size: 14, className: "lh-mbar__icon" }) : null, h("span", { className: "lh-mbar__text" }, p.label)),
        h("span", { className: "readout-sm lh-mbar__val" }, (p.approx ? "≈ " : "") + display)) : null,
      h("div", {
        className: "lh-mbar__track", role: "meter", "aria-valuemin": 0, "aria-valuemax": max, "aria-valuenow": v,
        "aria-label": (p.label || kind) + " " + display
      }, h("div", { className: "lh-mbar__fill", style: { width: pct + "%" } })));
  }

  /* ---------- SiteRow ---------- */
  function SiteRow(p) {
    var rank = p.rank != null ? pad(p.rank) : "—";
    return h("div", { className: cx("lh-siterow", p.selected && "is-selected", p.className), "aria-current": p.selected ? "true" : undefined },
      h("div", { className: "lh-siterow__in" },
        h("span", { className: "lh-siterow__rank readout" }, rank),
        h("div", { className: "lh-siterow__thumb", "aria-hidden": true },
          p.thumbnail ? h("img", { src: p.thumbnail, alt: "" }) : h(Icon, { name: "mountain", size: 18 })),
        h("div", { className: "lh-siterow__main" },
          h("div", { className: "lh-siterow__title" },
            h("button", { type: "button", className: "lh-siterow__name heading", onClick: p.onOpen }, p.name),
            p.fidelity ? h(FidelityBadge, { level: p.fidelity }) : null),
          p.meta ? h("div", { className: "caption lh-muted lh-siterow__meta" }, p.meta) : null,
          h("div", { className: "lh-siterow__metrics" },
            h(MetricBar, { kind: "sun", label: "Sun", value: p.sun, compact: true }),
            h(MetricBar, { kind: "earth", label: "Earth", value: p.earth, compact: true }),
            h(MetricBar, { kind: "both", label: "Both", value: p.both, compact: true }),
            p.longestNight ? h("div", { className: "lh-siterow__night" },
              h("span", { className: "caption lh-muted" }, "Longest night"),
              h("span", { className: "readout-sm" }, p.longestNight)) : null)),
        h("div", { className: "lh-siterow__score" },
          h("span", { className: "figure" }, p.score),
          h("span", { className: "label lh-muted" }, "Score")),
        h("div", { className: "lh-siterow__actions" },
          h(IconButton, {
            icon: p.inCompare ? "check" : "plus", size: "sm", active: !!p.inCompare, onClick: p.onToggleCompare,
            label: p.inCompare ? "Remove " + p.name + " from comparison" : "Add " + p.name + " to comparison"
          }),
          h(IconButton, { icon: "arrow-right", size: "sm", variant: "ghost", label: "Open " + p.name, onClick: p.onOpen }))));
  }

  /* ---------- CompareTray ---------- */
  function CompareTray(p) {
    var sites = p.sites || [], max = p.max || 4, slots = [];
    for (var i = 0; i < max; i++) slots.push(sites[i] || null);
    var regions = {};
    sites.forEach(function (s) { if (s.region) regions[s.region] = 1; });
    var mixed = Object.keys(regions).length > 1;
    return h("section", { className: cx("lh-tray", p.className), "aria-label": "Comparison tray" },
      h("div", { className: "lh-tray__head" },
        h("span", { className: "label lh-muted" }, "Compare"),
        h("span", { className: "readout" }, sites.length + "/" + max)),
      h("ul", { className: "lh-tray__slots" }, slots.map(function (s, j) {
        if (!s) {
          return h("li", { key: "empty-" + j, className: "lh-tray__slot is-empty" },
            h("button", { type: "button", className: "lh-tray__add body-sm", onClick: p.onAdd }, h(Icon, { name: "plus", size: 16 }), "Add site"));
        }
        return h("li", { key: s.id, className: "lh-tray__slot" },
          h("span", { className: "lh-tray__idx readout-sm" }, j + 1),
          h("span", { className: "lh-tray__name" },
            h("span", { className: "body-sm lh-tray__title" }, s.name),
            s.region ? h("span", { className: "caption lh-muted" }, s.region) : null),
          h(IconButton, { icon: "x", size: "sm", variant: "ghost", label: "Remove " + s.name, onClick: function () { if (p.onRemove) p.onRemove(s.id); } }));
      })),
      h(Button, { variant: "primary", disabled: sites.length < 2, onClick: p.onCompare, iconRight: sites.length < 2 ? undefined : "arrow-right" },
        sites.length < 2 ? "Add 2+ sites" : "Compare " + sites.length),
      mixed ? h("div", { className: "lh-tray__note caption" }, h(Icon, { name: "info", size: 14 }),
        "Mixed regions: verdicts per goal, no joint ranking.") : null);
  }

  /* ---------- MapMarker ---------- */
  function MapMarker(p) {
    var state = p.state || "default", shape = p.shape || "circle", c = 14;
    function shapeEl(cls, key) {
      if (shape === "diamond") return h("rect", { key: key, className: cls, x: c - 5, y: c - 5, width: 10, height: 10, transform: "rotate(45 " + c + " " + c + ")" });
      if (shape === "square") return h("rect", { key: key, className: cls, x: c - 5.5, y: c - 5.5, width: 11, height: 11, rx: 1.5 });
      if (shape === "triangle") return h("path", { key: key, className: cls, d: "M14 7 L20.5 19 L7.5 19 Z" });
      if (shape === "custom") return h("g", { key: key, className: cls + " is-custom" },
        h("circle", { cx: c, cy: c, r: 5 }), h("path", { d: "M14 2v5M14 21v5M2 14h5M21 14h5" }));
      return h("circle", { key: key, className: cls, cx: c, cy: c, r: 6 });
    }
    var parts = [shapeEl("lh-mk__halo", "halo"), shapeEl("lh-mk__shape", "shape")];
    if (state === "selected") parts.push(h("path", { key: "br", className: "lh-mk__brackets", d: "M1 7V1h6M21 1h6v6M27 21v6h-6M7 27H1v-6" }));
    if (state === "processing") parts.push(h("circle", { key: "pr", className: "lh-mk__proc", cx: c, cy: c, r: 11 }));
    var showLabel = p.showLabel || state === "selected";
    var aria = p.label + (p.category ? ", " + p.category : "") + (p.rank ? ", rank " + p.rank : "") + (state === "processing" ? ", horizon still computing" : "");
    return h("button", {
      type: "button", className: cx("lh-mk", "is-" + state, p.className), style: p.style, onClick: p.onClick,
      "aria-label": aria, "aria-pressed": state === "selected"
    },
      h("svg", { width: 28, height: 28, viewBox: "0 0 28 28", "aria-hidden": true }, parts),
      p.compareIndex ? h("span", { className: "lh-mk__badge" }, p.compareIndex) : null,
      showLabel ? h("span", { className: "lh-mk__label" },
        p.rank ? h("span", { className: "lh-mk__rank" }, pad(p.rank)) : null,
        h("span", null, p.label)) : null);
  }

  /* ---------- AvailabilityLanes ---------- */
  function AvailabilityLanes(p) {
    var start = toDate(p.start), end = toDate(p.end), span = end - start;
    var lanes = p.lanes || [];
    function pct(t) { return ((toDate(t) - start) / span * 100); }
    var summary = p.summary || lanes.map(function (l) { return (l.label || KIND[l.kind].name) + (l.share != null ? " " + l.share + "%" : ""); }).join(", ");
    return h("div", { className: cx("lh-lanes", p.className), role: "img", "aria-label": "Availability from " + fmtDate(start) + " to " + fmtDate(end) + ": " + summary },
      lanes.map(function (l) {
        var k = KIND[l.kind] || KIND.sun;
        return h("div", { key: l.kind, className: "lh-lanes__row lh-lanes--" + l.kind },
          h("div", { className: "lh-lanes__label" },
            h(Icon, { name: k.icon, size: 14, className: "lh-lanes__icon" }),
            h("span", { className: "body-sm" }, l.label || k.name),
            l.share != null ? h("span", { className: "readout-sm lh-lanes__share" }, l.share + "%") : null),
          h("div", { className: "lh-lanes__track" }, (l.intervals || []).map(function (iv, i) {
            var a = Math.max(start, toDate(iv[0])), b = Math.min(end, toDate(iv[1]));
            if (b <= a) return null;
            return h("span", { key: i, className: "lh-lanes__iv", style: { left: pct(a) + "%", width: ((b - a) / span * 100) + "%" } });
          })));
      }),
      p.showAxis === false ? null : h("div", { className: "lh-lanes__axis", "aria-hidden": true },
        makeTicks(start, end).map(function (t, i) { return h("span", { key: i, className: "lh-lanes__tick", style: { left: pct(t.t) + "%" } }, t.label); })),
      p.cursor ? h("div", { className: "lh-lanes__overlay", "aria-hidden": true },
        h("span", { className: "lh-lanes__cursor", style: { left: pct(p.cursor) + "%" } })) : null);
  }

  /* ---------- UTC text field (ISO, never locale formatted) ---------- */
  function UtcField(p) {
    var d = useState(null), draft = d[0], setDraft = d[1];
    var pick = useRef(null);
    var re = p.kind === "date" ? /^(\d{4})-(\d{1,2})-(\d{1,2})$/ : /^(\d{1,2}):(\d{2})$/;
    function commit(v) {
      setDraft(null);
      var m = re.exec((v || "").trim());
      if (m) p.onCommit(m);
    }
    return h("span", { className: "lh-tb__fieldrow" },
      h("input", {
        className: "lh-tb__input", type: "text", inputMode: "numeric", spellCheck: false, autoComplete: "off",
        size: p.kind === "date" ? 10 : 5, "aria-label": p.label, value: draft != null ? draft : p.value,
        onChange: function (e) { setDraft(e.target.value); },
        onBlur: function () { if (draft != null) commit(draft); },
        onKeyDown: function (e) { if (e.key === "Enter") commit(draft != null ? draft : p.value); if (e.key === "Escape") setDraft(null); }
      }),
      p.kind === "date" ? h("input", {
        ref: pick, type: "date", className: "lh-sr", tabIndex: -1, "aria-hidden": true, value: p.value, min: p.min, max: p.max,
        onChange: function (e) { if (e.target.value) commit(e.target.value); }
      }) : null,
      p.kind === "date" ? h(IconButton, {
        icon: "calendar", size: "sm", variant: "ghost", label: "Pick a date",
        onClick: function () { try { if (pick.current && pick.current.showPicker) pick.current.showPicker(); } catch (err) { /* picker unavailable */ } }
      }) : null);
  }

  /* ---------- TimeBar ---------- */
  function TimeBar(p) {
    var start = toDate(p.start), end = toDate(p.end), span = end - start;
    var vs = useControllable(p.value !== undefined ? toDate(p.value) : undefined, p.defaultValue !== undefined ? toDate(p.defaultValue) : start, p.onChange);
    var ps = useControllable(p.playing, false, p.onPlayingChange);
    var es = useControllable(p.expanded, !!p.defaultExpanded, p.onExpandedChange);
    var value = vs[0], setValue = vs[1], playing = ps[0], setPlaying = ps[1], expanded = es[0];
    var valRef = useRef(value); valRef.current = value;
    var trackRef = useRef(null);
    var windows = p.windows || [], nights = p.nights || [];

    function clamp(t) { return new Date(Math.max(start.getTime(), Math.min(end.getTime(), t))); }
    useEffect(function () {
      if (!playing) return undefined;
      var id = setInterval(function () {
        var nv = valRef.current.getTime() + (p.playStepMs || 6 * HOUR);
        if (nv >= end.getTime()) { setPlaying(false); nv = end.getTime(); }
        setValue(new Date(nv));
      }, p.playIntervalMs || 120);
      return function () { clearInterval(id); };
    }, [playing]);

    function pct(t) { return ((toDate(t) - start) / span * 100); }
    function fromPointer(e) {
      var r = trackRef.current.getBoundingClientRect();
      var x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
      return clamp(Math.round((start.getTime() + x * span) / HOUR) * HOUR);
    }
    function onDown(e) {
      if (e.button !== undefined && e.button !== 0) return;
      e.preventDefault();
      trackRef.current.focus();
      setValue(fromPointer(e));
      var mv = function (ev) { setValue(fromPointer(ev)); };
      var up = function () { window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up); };
      window.addEventListener("pointermove", mv); window.addEventListener("pointerup", up);
    }
    function onKey(e) {
      var t = value.getTime(), m = e.shiftKey ? DAY : HOUR;
      if (e.key === "ArrowRight" || e.key === "ArrowUp") t += m;
      else if (e.key === "ArrowLeft" || e.key === "ArrowDown") t -= m;
      else if (e.key === "PageUp") t += 7 * DAY;
      else if (e.key === "PageDown") t -= 7 * DAY;
      else if (e.key === "Home") t = start.getTime();
      else if (e.key === "End") t = end.getTime();
      else if (e.key === " " || e.key === "k") { e.preventDefault(); setPlaying(!playing); return; }
      else return;
      e.preventDefault(); setValue(clamp(t));
    }
    var next = null;
    for (var i = 0; i < windows.length; i++) { if (toDate(windows[i][0]) > value) { next = toDate(windows[i][0]); break; } }
    function jumpNext() { if (p.onJumpNext) p.onJumpNext(); else if (next) setValue(next); }
    function onDate(m) { setValue(clamp(Date.UTC(+m[1], +m[2] - 1, +m[3], value.getUTCHours(), value.getUTCMinutes()))); }
    function onTime(m) { setValue(clamp(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate(), Math.min(23, +m[1]), Math.min(59, +m[2])))); }
    var inWindow = windows.some(function (w) { return value >= toDate(w[0]) && value <= toDate(w[1]); });
    var vp = pct(value);

    return h("section", { className: cx("lh-tb", p.tone === "overlay" && "lh-tb--overlay", p.className), "aria-label": "Time" },
      h("div", { className: "lh-tb__row" },
        h("div", { className: "lh-tb__transport" },
          h(IconButton, { icon: "chevron-left", label: "Back 1 day", size: "sm", variant: "ghost", onClick: function () { setValue(clamp(value.getTime() - DAY)); } }),
          h(IconButton, { icon: playing ? "pause" : "play", label: playing ? "Pause" : "Play", variant: "solid", size: "lg", onClick: function () { setPlaying(!playing); } }),
          h(IconButton, { icon: "chevron-right", label: "Forward 1 day", size: "sm", variant: "ghost", onClick: function () { setValue(clamp(value.getTime() + DAY)); } })),
        h("div", {
          ref: trackRef, className: "lh-tb__scrub", role: "slider", tabIndex: 0,
          "aria-label": "Selected instant (UTC)", "aria-valuemin": start.getTime(), "aria-valuemax": end.getTime(), "aria-valuenow": value.getTime(),
          "aria-valuetext": fmtDate(value) + " " + fmtTime(value) + " UTC" + (inWindow ? ", inside a Sun and Earth window" : ""),
          onPointerDown: onDown, onKeyDown: onKey
        },
          h("div", { className: "lh-tb__windows", "aria-hidden": true }, windows.map(function (w, j) {
            return h("span", { key: j, className: "lh-tb__win", style: { left: pct(w[0]) + "%", width: Math.max(0.4, pct(w[1]) - pct(w[0])) + "%" } });
          })),
          h("div", { className: "lh-tb__line", "aria-hidden": true }),
          h("div", { className: "lh-tb__nights", "aria-hidden": true }, nights.map(function (w, j) {
            return h("span", { key: j, className: "lh-tb__night", style: { left: pct(w[0]) + "%", width: Math.max(0.4, pct(w[1]) - pct(w[0])) + "%" } });
          })),
          h("div", { className: "lh-tb__ticks", "aria-hidden": true }, makeTicks(start, end).map(function (t, j) {
            return h("span", { key: j, className: "lh-tb__tick", style: { left: pct(t.t) + "%" } }, t.label);
          })),
          h("div", { className: "lh-tb__head", style: { left: vp + "%" }, "aria-hidden": true }, h("span", { className: "lh-tb__knob" })),
          h("div", { className: cx("lh-tb__chip", inWindow && "is-window"), style: { left: "clamp(52px, " + vp + "%, calc(100% - 52px))" }, "aria-hidden": true },
            inWindow ? h(Icon, { name: "blend", size: 12 }) : null, fmtShort(value))),
        h("div", { className: "lh-tb__clock" },
          h("div", { className: "lh-tb__field" },
            h("span", { className: "label lh-muted", "aria-hidden": true }, "Date"),
            h(UtcField, { kind: "date", label: "Date, UTC (YYYY-MM-DD)", value: fmtDate(value), min: fmtDate(start), max: fmtDate(end), onCommit: onDate })),
          h("div", { className: "lh-tb__field" },
            h("span", { className: "label lh-muted", "aria-hidden": true }, "Time UTC"),
            h(UtcField, { kind: "time", label: "Time, UTC (HH:MM)", value: fmtTime(value), onCommit: onTime }))),
        h("div", { className: "lh-tb__actions" },
          h(Button, { size: "sm", variant: "secondary", icon: "skip-forward", disabled: !next && !p.onJumpNext, onClick: jumpNext, title: "Jump to the next interval with Sun and Earth" },
            h("span", { className: "lh-tb__nextlabel" }, "Next window")),
          p.lanes ? h(IconButton, {
            icon: expanded ? "chevron-down" : "chevron-up", size: "sm", variant: "ghost",
            label: expanded ? "Collapse availability lanes" : "Expand availability lanes", "aria-expanded": expanded,
            onClick: function () { es[1](!expanded); }
          }) : null)),
      playing && p.reducedWhilePlaying ? h("div", { className: "lh-tb__note caption lh-sec" },
        h(FidelityBadge, { level: "low" }, "Preview resolution"), "Shadows render at reduced resolution while playing; full detail returns on pause.") : null,
      expanded && p.lanes ? h("div", { className: "lh-tb__lanes" },
        h(AvailabilityLanes, { start: start, end: end, lanes: p.lanes, cursor: value, showAxis: false })) : null);
  }

  /* ---------- SkyPlot (panorama: azimuth × elevation) ---------- */
  function SkyPlot(p) {
    var W = 720, H = p.height || 260, ml = 40, mr = 14, mt = 18, mb = 30, iw = W - ml - mr, ih = H - mt - mb;
    var er = p.elRange || [-4, 12], lo = er[0], hi = er[1];
    var hz = (p.horizon || []).slice().sort(function (a, b) { return a[0] - b[0]; });
    var hover = useState(null), hv = hover[0], setHv = hover[1];
    var wrap = useRef(null);
    function X(az) { if (az < 0 || az > 360) az = ((az % 360) + 360) % 360; return ml + az / 360 * iw; }
    function Y(el) { return mt + (hi - Math.max(lo, Math.min(hi, el))) / (hi - lo) * ih; }
    function horizonAt(az) {
      if (!hz.length) return 0;
      az = ((az % 360) + 360) % 360;
      for (var i = 0; i < hz.length; i++) {
        if (hz[i][0] >= az) {
          if (i === 0) return hz[0][1];
          var a = hz[i - 1], b = hz[i], t = (az - a[0]) / (b[0] - a[0] || 1);
          return a[1] + (b[1] - a[1]) * t;
        }
      }
      return hz[hz.length - 1][1];
    }
    var step = (hi - lo) <= 12 ? 2 : (hi - lo) <= 30 ? 5 : 10;
    var grid = [];
    for (var e = Math.ceil(lo / step) * step; e <= hi; e += step) {
      grid.push(h("line", { key: "e" + e, className: e === 0 ? "lh-sky__zero" : "lh-sky__grid", x1: ml, x2: W - mr, y1: Y(e), y2: Y(e) }));
      grid.push(h("text", { key: "et" + e, className: "lh-sky__axis", x: ml - 8, y: Y(e) + 3, textAnchor: "end" }, e + "°"));
    }
    var CARD = ["N", "NE", "E", "SE", "S", "SW", "W", "NW", "N"];
    for (var a = 0; a <= 360; a += 45) {
      var xx = ml + a / 360 * iw;
      grid.push(h("line", { key: "a" + a, className: "lh-sky__grid", x1: xx, x2: xx, y1: mt, y2: mt + ih }));
      grid.push(h("text", { key: "at" + a, className: cx("lh-sky__axis", a % 90 === 0 && "is-card"), x: xx, y: H - 10, textAnchor: "middle" }, CARD[a / 45]));
    }
    var terrain = null;
    if (hz.length) {
      var pts = ["M" + ml + " " + (mt + ih)];
      var first = horizonAt(0);
      pts.push("L" + ml + " " + Y(first));
      hz.forEach(function (q) { pts.push("L" + X(q[0]) + " " + Y(q[1])); });
      pts.push("L" + (W - mr) + " " + Y(horizonAt(359.999)));
      pts.push("L" + (W - mr) + " " + (mt + ih) + "Z");
      terrain = h("path", { className: "lh-sky__terrain", d: pts.join(" ") });
    }
    function runs(path) {
      var out = [], cur = null;
      (path || []).forEach(function (q, i) {
        var vis = q[1] > horizonAt(q[0]);
        var prev = i > 0 ? path[i - 1] : null;
        var wrapJump = prev && Math.abs(q[0] - prev[0]) > 180;
        if (!cur || cur.vis !== vis || wrapJump) {
          if (cur && !wrapJump) cur.pts.push(q);
          cur = { vis: vis, pts: wrapJump ? [] : (prev ? [prev] : []) };
          out.push(cur);
        }
        cur.pts.push(q);
      });
      return out.filter(function (r) { return r.pts.length > 1; });
    }
    function pathEls(kind, path) {
      return runs(path).map(function (r, i) {
        return h("polyline", { key: kind + i, className: cx("lh-sky__path", "lh-sky__path--" + kind, !r.vis && "is-hidden"), points: r.pts.map(function (q) { return X(q[0]) + "," + Y(q[1]); }).join(" ") });
      });
    }
    function marker(kind, b) {
      if (!b) return null;
      var vis = b.el > horizonAt(b.az), x = X(b.az), y = Y(b.el);
      var label = (kind === "sun" ? "Sun " : "Earth ") + (Math.round(b.el * 10) / 10) + "°";
      var right = x < W - 120;
      return h("g", { key: "m" + kind, className: cx("lh-sky__mk", "lh-sky__mk--" + kind, !vis && "is-hidden") },
        h("circle", { className: "lh-sky__ring", cx: x, cy: y, r: 8 }),
        h("circle", { className: "lh-sky__dot", cx: x, cy: y, r: 5 }),
        h("text", { className: "lh-sky__mklabel", x: right ? x + 12 : x - 12, y: y - 8, textAnchor: right ? "start" : "end" }, label + (vis ? "" : " · hidden")));
    }
    function onMove(e) {
      var r = wrap.current.getBoundingClientRect();
      var sx = (e.clientX - r.left) / r.width * W;
      if (sx < ml || sx > W - mr) { setHv(null); return; }
      var az = (sx - ml) / iw * 360;
      setHv({ az: az, x: sx, hz: horizonAt(az), left: (e.clientX - r.left) });
    }
    return h("figure", { className: cx("lh-sky", p.className) },
      p.legend === false ? null : h("figcaption", { className: "lh-sky__legend caption" },
        h("span", { className: "lh-key" }, h("span", { className: "lh-key__line lh-key__line--sun" }), "Sun path"),
        h("span", { className: "lh-key" }, h("span", { className: "lh-key__line lh-key__line--earth" }), "Earth path"),
        h("span", { className: "lh-key" }, h("span", { className: "lh-key__swatch" }), "Terrain horizon"),
        h("span", { className: "lh-key lh-muted" }, h("span", { className: "lh-key__line lh-key__line--dash" }), "Hidden by terrain"),
        p.caption ? h("span", { className: "lh-sky__note lh-muted" }, p.caption) : null),
      h("div", { className: "lh-sky__wrap", ref: wrap, onMouseMove: onMove, onMouseLeave: function () { setHv(null); } },
        h("svg", { viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": p.ariaLabel || "Sky plot: azimuth from local lunar north against elevation, with the terrain horizon and the paths of the Sun and Earth." },
          grid, terrain,
          pathEls("earth", p.earthPath), pathEls("sun", p.sunPath),
          hv ? h("line", { className: "lh-sky__cross", x1: hv.x, x2: hv.x, y1: mt, y2: mt + ih }) : null,
          marker("earth", p.earth), marker("sun", p.sun)),
        hv ? h("div", { className: "lh-sky__tip", style: { left: hv.left + "px" } },
          h("span", { className: "readout-sm" }, "Az " + Math.round(hv.az) + "°"),
          h("span", { className: "readout-sm lh-sec" }, "Horizon " + (Math.round(hv.hz * 10) / 10) + "°")) : null));
  }

  /* ---------- DayStrip (favourable-day calendar) ---------- */
  function DayStrip(p) {
    var days = p.days || [], lead = p.firstWeekday || 0, cells = [], i;
    for (i = 0; i < lead; i++) cells.push(null);
    days.forEach(function (v, j) { cells.push({ d: j + 1, v: v }); });
    function bin(v) { if (v == null) return "nd"; if (v <= 0) return "b0"; if (v < 1 / 3) return "b1"; if (v < 2 / 3) return "b2"; return "b3"; }
    var month = p.month || "";
    return h("figure", { className: cx("lh-days", p.className) },
      p.title ? h("figcaption", { className: "lh-days__title" },
        h("span", { className: "heading" }, p.title),
        p.subtitle ? h("span", { className: "caption lh-muted" }, p.subtitle) : null) : null,
      h("div", { className: "lh-days__dow caption lh-muted", "aria-hidden": true }, ["M", "T", "W", "T", "F", "S", "S"].map(function (d, j) { return h("span", { key: j }, d); })),
      h("div", { className: "lh-days__grid", role: "list", "aria-label": (month ? month + ": " : "") + "hours per day with Sun and Earth together" },
        cells.map(function (c, j) {
          if (!c) return h("span", { key: "p" + j, className: "lh-days__cell is-pad", "aria-hidden": true });
          var txt = c.v == null ? "no data" : Math.round(c.v * 24) + " h with Sun and Earth";
          var sel = p.selectedDay === c.d;
          var props = { key: c.d, role: "listitem", className: cx("lh-days__cell", bin(c.v), sel && "is-selected"), title: (month ? month + " " : "") + c.d + ": " + txt, "aria-label": (month ? month + " " : "") + c.d + ", " + txt + (sel ? ", selected" : "") };
          if (p.onSelect) { props.onClick = function () { p.onSelect(c.d); }; props.tabIndex = 0; }
          return h("span", props, c.d);
        })),
      p.legend === false ? null : h("div", { className: "lh-days__legend caption lh-sec", "aria-hidden": true },
        [["b0", "0 h"], ["b1", "< 8 h"], ["b2", "8–16 h"], ["b3", "> 16 h"], ["nd", "No data"]].map(function (x) {
          return h("span", { key: x[0], className: "lh-days__key" }, h("span", { className: "lh-days__sw " + x[0] }), x[1]);
        })));
  }

  /* ---------- Compass ---------- */
  function Compass(p) {
    var size = p.size || 220, c = size / 2, R = c - 26;
    var heading = (((p.heading || 0) % 360) + 360) % 360;
    var fov = p.fov || 60;
    function pt(az, r) { var rad = (az - 90) * Math.PI / 180; return [c + r * Math.cos(rad), c + r * Math.sin(rad)]; }
    var dial = [];
    for (var a = 0; a < 360; a += 5) {
      var long = a % 30 === 0, p1 = pt(a, R), p2 = pt(a, R - (long ? 9 : 5));
      dial.push(h("line", { key: "t" + a, className: cx("lh-cmp__tick", long && "is-long"), x1: p1[0], y1: p1[1], x2: p2[0], y2: p2[1] }));
      if (long && a % 90 !== 0) {
        var pn = pt(a, R + 12);
        dial.push(h("text", { key: "n" + a, className: "lh-cmp__num", x: pn[0], y: pn[1] + 3, textAnchor: "middle", transform: "rotate(" + heading + " " + pn[0] + " " + pn[1] + ")" }, a));
      }
    }
    [["N", 0], ["E", 90], ["S", 180], ["W", 270]].forEach(function (k) {
      var pc = pt(k[1], R - 22);
      dial.push(h("text", { key: k[0], className: cx("lh-cmp__card", k[0] === "N" && "is-n"), x: pc[0], y: pc[1] + 4, textAnchor: "middle", transform: "rotate(" + heading + " " + pc[0] + " " + pc[1] + ")" }, k[0]));
    });
    function body(kind, b) {
      if (!b) return null;
      var q = pt(b.az, R), vis = b.visible !== false;
      return h("g", { key: kind, className: cx("lh-cmp__body", "lh-cmp__body--" + kind, !vis && "is-hidden") },
        h("circle", { className: "lh-cmp__ring", cx: q[0], cy: q[1], r: 9 }),
        h("circle", { className: "lh-cmp__dot", cx: q[0], cy: q[1], r: 6 }));
    }
    var f1 = pt(-fov / 2, R - 30), f2 = pt(fov / 2, R - 30);
    var label = "Heading " + Math.round(heading) + "°" + (p.sun ? ", Sun at azimuth " + Math.round(p.sun.az) + "°" + (p.sun.visible === false ? " (hidden)" : "") : "") + (p.earth ? ", Earth at azimuth " + Math.round(p.earth.az) + "°" + (p.earth.visible === false ? " (hidden)" : "") : "");
    return h("figure", { className: cx("lh-cmp", p.className), style: { width: size } },
      h("div", { className: "lh-cmp__chip" }, Math.round(heading) + "°"),
      h("svg", { width: size, height: size, viewBox: "0 0 " + size + " " + size, role: "img", "aria-label": label },
        h("circle", { className: "lh-cmp__face", cx: c, cy: c, r: R }),
        h("g", { transform: "rotate(" + (-heading) + " " + c + " " + c + ")" }, dial, body("earth", p.earth), body("sun", p.sun)),
        h("path", { className: "lh-cmp__fov", d: "M" + c + " " + c + " L" + f1[0] + " " + f1[1] + " A" + (R - 30) + " " + (R - 30) + " 0 0 1 " + f2[0] + " " + f2[1] + " Z" }),
        h("path", { className: "lh-cmp__cross", d: "M" + (c - 10) + " " + c + "H" + (c + 10) + "M" + c + " " + (c - 10) + "V" + (c + 10) }),
        h("path", { className: "lh-cmp__index", d: "M" + (c - 5) + " " + (c - R - 9) + " L" + (c + 5) + " " + (c - R - 9) + " L" + c + " " + (c - R - 2) + " Z" })),
      h("figcaption", { className: "caption lh-muted" }, p.caption || "N = local lunar north"));
  }

  /* ---------- Slider ---------- */
  function Slider(p) {
    var id = useUid("lh-slider");
    var min = p.min != null ? p.min : 0, max = p.max != null ? p.max : 1, step = p.step || 0.01;
    var st = useControllable(p.value, p.defaultValue != null ? p.defaultValue : min, p.onChange);
    var v = st[0], pct = (v - min) / (max - min) * 100;
    var shown = p.format ? p.format(v) : String(v);
    return h("div", { className: cx("lh-slider", p.className) },
      h("div", { className: "lh-slider__head" },
        h("label", { htmlFor: id, className: "body-sm lh-slider__label" }, p.label),
        h("output", { htmlFor: id, className: "readout-sm" }, shown)),
      h("input", {
        id: id, type: "range", min: min, max: max, step: step, value: v, disabled: p.disabled,
        style: { "--p": pct + "%" }, "aria-valuetext": shown, "aria-describedby": p.description ? id + "-d" : undefined,
        onChange: function (e) { st[1](parseFloat(e.target.value)); }
      }),
      (p.minLabel || p.maxLabel) ? h("div", { className: "lh-slider__ends caption lh-muted" }, h("span", null, p.minLabel), h("span", null, p.maxLabel)) : null,
      p.description ? h("p", { id: id + "-d", className: "caption lh-muted lh-slider__desc" }, p.description) : null);
  }

  /* ---------- Switch ---------- */
  function Switch(p) {
    var id = useUid("lh-switch");
    var st = useControllable(p.checked, !!p.defaultChecked, p.onChange);
    return h("div", { className: cx("lh-switch", p.className) },
      h("div", { className: "lh-switch__text" },
        h("label", { htmlFor: id, className: "body lh-switch__label" }, p.label),
        p.description ? h("p", { id: id + "-d", className: "body-sm lh-sec" }, p.description) : null),
      h("button", {
        id: id, type: "button", role: "switch", "aria-checked": !!st[0], disabled: p.disabled,
        "aria-describedby": p.description ? id + "-d" : undefined,
        className: cx("lh-switch__ctl", st[0] && "is-on"), onClick: function () { st[1](!st[0]); }
      }, h("span", { className: "lh-switch__thumb" })));
  }

  /* ---------- ChoiceList ---------- */
  function ChoiceList(p) {
    var name = useUid("lh-choice"), opts = p.options || [];
    var st = useControllable(p.value, p.defaultValue !== undefined ? p.defaultValue : (opts[0] && opts[0].value), p.onChange);
    return h("fieldset", { className: cx("lh-choice", p.layout === "row" && "lh-choice--row", p.className) },
      p.legend ? h("legend", { className: "label lh-muted lh-choice__legend" }, p.legend) : null,
      opts.map(function (o) {
        var on = o.value === st[0], id = name + "-" + o.value;
        return h("label", { key: String(o.value), htmlFor: id, className: cx("lh-choice__opt", on && "is-on", o.disabled && "is-disabled") },
          h("input", { id: id, type: "radio", name: name, value: o.value, checked: on, disabled: o.disabled, className: "lh-choice__input", onChange: function () { st[1](o.value); } }),
          h("span", { className: "lh-choice__dot", "aria-hidden": true }),
          h("span", { className: "lh-choice__text" },
            h("span", { className: "body lh-choice__label" }, o.label, o.badge ? h("span", { className: "lh-choice__badge" }, o.badge) : null),
            o.description ? h("span", { className: "body-sm lh-sec" }, o.description) : null),
          o.icon ? h(Icon, { name: o.icon, size: 20, className: "lh-choice__icon" }) : null);
      }));
  }

  /* ---------- StatusBanner ---------- */
  var BANNER_ICON = { info: "info", loading: "loader-circle", approximate: "circle-dashed", error: "triangle-alert", empty: "search", done: "check" };
  function StatusBanner(p) {
    var tone = p.tone || "info", center = p.layout === "center";
    return h("div", {
      className: cx("lh-banner", "lh-banner--" + tone, center && "lh-banner--center", p.className),
      role: tone === "error" ? "alert" : "status"
    },
      h("span", { className: "lh-banner__icon" }, h(Icon, { name: p.icon || BANNER_ICON[tone], size: center ? 24 : 18, className: tone === "loading" ? "lh-spin" : undefined })),
      h("div", { className: "lh-banner__body" },
        p.title ? h("div", { className: "lh-banner__title" }, p.title) : null,
        p.children ? h("div", { className: "body-sm lh-sec" }, p.children) : null,
        p.progress != null ? h("div", { className: "lh-banner__progress", role: "progressbar", "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": Math.round(p.progress * 100), "aria-label": p.title || "Progress" },
          h("span", { style: { width: (p.progress * 100) + "%" } })) : null),
      p.action ? h("div", { className: "lh-banner__action" }, p.action) : null);
  }

  /* ---------- ExplainNote ---------- */
  function ExplainNote(p) {
    return h("aside", { className: cx("lh-explain", p.className), "aria-label": p.title || "Explanation" },
      h("div", { className: "lh-explain__head" },
        h(Icon, { name: "circle-help", size: 14 }),
        h("span", { className: "label" }, p.label || "Explain"),
        p.onDismiss ? h(IconButton, { icon: "x", label: "Hide explanation", size: "sm", variant: "ghost", onClick: p.onDismiss }) : null),
      p.title ? h("div", { className: "heading lh-explain__title" }, p.title) : null,
      h("div", { className: "body-sm lh-sec" }, p.children),
      p.href ? h("a", { href: p.href, className: "body-sm lh-link" }, p.linkLabel || "How this is computed", h(Icon, { name: "arrow-up-right", size: 14 })) : null);
  }

  /* ---------- Pager (msm-style numbered steps) ---------- */
  function Pager(p) {
    var n = p.count || 1;
    var st = useControllable(p.value, p.defaultValue || 1, p.onChange), v = st[0];
    var nums = [];
    for (var i = 1; i <= n; i++) nums.push(i);
    function go(i) { st[1](Math.max(1, Math.min(n, i))); }
    return h("nav", { className: cx("lh-pager", p.className), "aria-label": p.label || "Pages" },
      h("button", { type: "button", className: "lh-pager__arrow", "aria-label": p.prevLabel || "Previous", disabled: v <= 1, onClick: function () { go(v - 1); } }, h(Icon, { name: "arrow-left", size: 18 })),
      h("ol", { className: "lh-pager__list" }, nums.map(function (i) {
        return h("li", { key: i }, h("button", {
          type: "button", className: cx("lh-pager__num", i === v && "is-on"), "aria-current": i === v ? "step" : undefined,
          "aria-label": p.itemLabel ? p.itemLabel(i) : String(i), onClick: function () { go(i); }
        }, pad(i)));
      })),
      h("button", { type: "button", className: "lh-pager__arrow", "aria-label": p.nextLabel || "Next", disabled: v >= n, onClick: function () { go(v + 1); } }, h(Icon, { name: "arrow-right", size: 18 })));
  }

  /* ---------- Kbd ---------- */
  function Kbd(p) { return h("kbd", { className: cx("lh-kbd", p.className) }, p.children); }

  var api = {
    Icon: Icon, Button: Button, IconButton: IconButton, SegmentedControl: SegmentedControl, Tabs: Tabs, NavRail: NavRail,
    Panel: Panel, SiteHeader: SiteHeader, Readout: Readout, VisibilityTag: VisibilityTag, FidelityBadge: FidelityBadge,
    MetricBar: MetricBar, SiteRow: SiteRow, CompareTray: CompareTray, MapMarker: MapMarker, TimeBar: TimeBar,
    AvailabilityLanes: AvailabilityLanes, SkyPlot: SkyPlot, DayStrip: DayStrip, Compass: Compass, Slider: Slider,
    Switch: Switch, ChoiceList: ChoiceList, StatusBanner: StatusBanner, ExplainNote: ExplainNote, Kbd: Kbd, Pager: Pager,
    utils: { fmtDate: fmtDate, fmtTime: fmtTime, makeTicks: makeTicks }
  };
  window.LunarHorizon = Object.assign(window.LunarHorizon || {}, api);
})();
