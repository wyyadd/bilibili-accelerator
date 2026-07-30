// Media request entry point for Loon and Surge.
(function runBiliAcceleratorRequest(root) {
  "use strict";

  const core = root.BiliAcceleratorCore;
  const env = root.BiliAcceleratorProxyEnv;

  function finish(value) {
    if (typeof $done === "function") {
      $done(value || {});
    }
  }

  if (!core || !env || typeof $request === "undefined" ||
      !$request || typeof $request.url !== "string") {
    finish({});
    return;
  }

  try {
    const config = env.loadConfig(core);
    const detail = core.rewriteUrlDetail($request.url, config);
    if (!detail.changed) {
      finish({});
      return;
    }
    const targetHost = core.hostOf(detail.url);
    if (!targetHost) {
      finish({});
      return;
    }
    finish({
      url: detail.url,
      headers: env.rewriteAuthority($request.headers || {}, targetHost)
    });
  } catch (_) {
    // Network adapters must always fail open: a classifier or environment
    // mismatch should never turn into a broken media request.
    finish({});
  }
})(
  typeof globalThis !== "undefined"
    ? globalThis
    : (typeof self !== "undefined" ? self : this)
);
