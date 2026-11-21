"use strict";

// CIE76 on sRGB. A perfect match scores 100; the score falls as the colors separate.
(function (root) {
  const EPSILON = 216 / 24389;
  const KAPPA = 24389 / 27;

  function clamp(n, a, b) {
    return Math.min(b, Math.max(a, n));
  }

  function linearize(channel) {
    const x = channel / 255;
    return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  }

  function pivot(t) {
    return t > EPSILON ? Math.cbrt(t) : (KAPPA * t + 16) / 116;
  }

  function rgbToLab(rgb) {
    const r = linearize(rgb[0]);
    const g = linearize(rgb[1]);
    const b = linearize(rgb[2]);
    const x = (r * 0.4124564 + g * 0.3575761 + b * 0.1804375) / 0.95047;
    const y = r * 0.2126729 + g * 0.7151522 + b * 0.072175;
    const z = (r * 0.0193339 + g * 0.119192 + b * 0.9503041) / 1.08883;
    const fx = pivot(x);
    const fy = pivot(y);
    const fz = pivot(z);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  }

  function deltaE(rgbA, rgbB) {
    const a = rgbToLab(rgbA);
    const b = rgbToLab(rgbB);
    const dl = a[0] - b[0];
    const da = a[1] - b[1];
    const db = a[2] - b[2];
    return Math.sqrt(dl * dl + da * da + db * db);
  }

  function scoreFromDeltaE(de) {
    if (!Number.isFinite(de) || de <= 0) return 100;
    const ratio = Math.max(0, 1 - de / 80);
    return clamp(Math.round(100 * Math.pow(ratio, 1.15)), 0, 100);
  }

  root.ColorMath = { rgbToLab, deltaE, scoreFromDeltaE };
})(typeof globalThis !== "undefined" ? globalThis : this);
