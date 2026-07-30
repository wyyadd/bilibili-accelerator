// Add ranked official CDN fallbacks to play-info responses.
(function initBiliAcceleratorBackup(root, factory) {
  let core = root.BiliAcceleratorCore;
  if (!core && typeof module === "object" && module.exports) {
    core = require("../core/rewrite.js");
  }

  const backup = factory(core);
  root.BiliAcceleratorBackup = backup;
  if (typeof module === "object" && module.exports) {
    module.exports = backup;
  }
})(
  typeof globalThis !== "undefined"
    ? globalThis
    : (typeof self !== "undefined" ? self : this),
  function createBackup(core) {
    "use strict";

    function mergeBackups(entry, key, base, config, hosts, maxBackups) {
      const alternatives = core.alternativesFor(base, config, hosts);
      if (!alternatives.length) {
        return false;
      }
      const existing = Array.isArray(entry[key]) ? entry[key] : [];
      const merged = alternatives.concat(existing)
        .filter(function unique(url, index, list) {
          return list.indexOf(url) === index;
        });
      const next = merged.slice(0, maxBackups > 0 ? maxBackups : 8);
      const changed = !Array.isArray(entry[key]) ||
        next.length !== existing.length ||
        next.some(function differs(url, index) {
          return url !== existing[index];
        });
      if (changed) {
        entry[key] = next;
      }
      return changed;
    }

    function enrichDash(dash, config, hosts, maxBackups) {
      if (!dash || typeof dash !== "object") {
        return false;
      }
      let changed = false;
      ["video", "audio"].forEach(function eachKind(kind) {
        const list = dash[kind];
        if (!Array.isArray(list)) {
          return;
        }
        list.forEach(function eachEntry(entry) {
          if (!entry || typeof entry !== "object") {
            return;
          }
          [
            ["baseUrl", "backupUrl"],
            ["base_url", "backup_url"]
          ].forEach(function eachShape(shape) {
            if (typeof entry[shape[0]] === "string") {
              changed = mergeBackups(
                entry,
                shape[1],
                entry[shape[0]],
                config,
                hosts,
                maxBackups
              ) || changed;
            }
          });
        });
      });
      return changed;
    }

    function enrichDurl(durl, config, hosts, maxBackups) {
      if (!Array.isArray(durl)) {
        return false;
      }
      let changed = false;
      durl.forEach(function eachEntry(entry) {
        if (entry && typeof entry.url === "string") {
          changed = mergeBackups(
            entry,
            "backup_url",
            entry.url,
            config,
            hosts,
            maxBackups
          ) || changed;
        }
      });
      return changed;
    }

    function enrichBackups(payload, rawConfig, hosts, maxBackups) {
      const config = core && core.normalizeConfig(rawConfig);
      if (!config || !config.enabled || config.mode === "off" ||
          config.selection !== "auto" ||
          !payload || typeof payload !== "object") {
        return { changed: false };
      }
      let changed = false;
      const containers = [
        payload.data,
        payload.result,
        payload.result && payload.result.video_info,
        payload
      ];
      const seen = new WeakSet();
      containers.forEach(function eachContainer(container) {
        if (!container || typeof container !== "object" ||
            seen.has(container)) {
          return;
        }
        seen.add(container);
        changed = enrichDash(
          container.dash,
          config,
          hosts,
          maxBackups
        ) || changed;
        changed = enrichDurl(
          container.durl,
          config,
          hosts,
          maxBackups
        ) || changed;
      });
      return { changed };
    }

    return { enrichBackups };
  }
);
