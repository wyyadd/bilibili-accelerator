// Extract a short-lived signed VOD URL for the periodic CDN ranker.
(function initBiliAcceleratorSample(root, factory) {
  let core = root.BiliAcceleratorCore;
  if (!core && typeof module === "object" && module.exports) {
    core = require("../core/rewrite.js");
  }

  const sample = factory(core);
  root.BiliAcceleratorSample = sample;
  if (typeof module === "object" && module.exports) {
    module.exports = sample;
  }
})(
  typeof globalThis !== "undefined"
    ? globalThis
    : (typeof self !== "undefined" ? self : this),
  function createSample(core) {
    "use strict";

    function isVodMediaUrl(value) {
      if (!core || typeof value !== "string" ||
          !core.hasMediaSignal(value)) {
        return false;
      }
      try {
        const url = new URL(
          value.slice(0, 2) === "//" ? "https:" + value : value
        );
        const media = /\.(m4s|mp4|flv|m3u8)(?:$|[?#])/i.test(
          url.pathname + url.search
        ) || url.pathname.indexOf("/upgcxcode/") === 0 ||
          url.pathname.indexOf("/v1/resource/") === 0;
        return media && url.pathname.indexOf("/live-bvc/") === -1;
      } catch (_) {
        return false;
      }
    }

    function findMediaUrl(payload, rawConfig) {
      if (!core) {
        return null;
      }
      const config = core.normalizeConfig(rawConfig);
      const seen = new WeakSet();

      function visit(value, depth) {
        if (value == null || depth > config.maxDepth) {
          return null;
        }
        if (typeof value === "string") {
          return isVodMediaUrl(value) ? value : null;
        }
        if (typeof value !== "object" || seen.has(value)) {
          return null;
        }
        seen.add(value);
        const keys = Array.isArray(value)
          ? value.map(function (_, index) { return index; })
          : Object.keys(value);
        for (let index = 0; index < keys.length; index += 1) {
          const found = visit(value[keys[index]], depth + 1);
          if (found) {
            return found;
          }
        }
        return null;
      }

      return visit(payload, 0);
    }

    return { findMediaUrl };
  }
);
