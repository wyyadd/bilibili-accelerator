// Play-info response entry point for Loon and Surge.
(function runBiliAcceleratorResponse(root) {
  "use strict";

  const core = root.BiliAcceleratorCore;
  const env = root.BiliAcceleratorProxyEnv;
  const sample = root.BiliAcceleratorSample;
  const backup = root.BiliAcceleratorBackup;

  function finish(value) {
    if (typeof $done === "function") {
      $done(value || {});
    }
  }

  if (!core || !env || !sample || !backup ||
      typeof $response === "undefined" ||
      !$response || typeof $response.body !== "string") {
    finish({});
    return;
  }

  try {
    const config = env.loadConfig(core);
    const payload = JSON.parse($response.body);
    const tracker = { changed: false, rewrites: [] };
    const sampleUrl = sample.findMediaUrl(payload, config);

    if (config.enabled && config.mode !== "off" &&
        config.selection === "auto" && sampleUrl) {
      env.saveProbeSample(sampleUrl);
    }

    core.rewriteObject(payload, config, tracker);
    const backups = backup.enrichBackups(payload, config);
    const live = core.filterLiveUrlInfo(payload, config);

    if (!tracker.changed && !backups.changed && !live.changed) {
      finish({});
      return;
    }
    finish({ body: JSON.stringify(payload) });
  } catch (_) {
    // Preserve the original response on malformed, oversized, compressed, or
    // otherwise unsupported bodies.
    finish({});
  }
})(
  typeof globalThis !== "undefined"
    ? globalThis
    : (typeof self !== "undefined" ? self : this)
);
