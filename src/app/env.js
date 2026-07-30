// Shared Loon/Surge environment adapter.
(function initBiliAcceleratorProxyEnv(root) {
  "use strict";

  const CONFIG_KEY = "biliAccelerator.proxy.config.v1";
  const RANK_KEY = "biliAccelerator.proxy.rank.v1";
  const SAMPLE_KEY = "biliAccelerator.proxy.sample.v1";
  const RANK_TTL_MS = 6 * 60 * 60 * 1000;
  const SAMPLE_TTL_MS = 15 * 60 * 1000;
  const PLUGIN_KEYS = Object.freeze({
    enabled: "baEnabled",
    mode: "baMode",
    pcdnHost: "baPcdnHost",
    mcdnStrategy: "baMcdnStrategy",
    proxyHost: "baProxyHost",
    rewriteAkamai: "baRewriteAkamai",
    portHeuristic: "baPortHeuristic",
    selection: "baSelection",
    candidatePool: "baCandidatePool",
    maxDepth: "baMaxDepth"
  });

  function decode(value) {
    try {
      return decodeURIComponent(String(value || "").replace(/\+/g, " "));
    } catch (_) {
      return String(value || "");
    }
  }

  function parseArgument(argument) {
    if (argument && typeof argument === "object") {
      const result = {};
      Object.keys(argument).forEach(function copyArgument(key) {
        result[key] = argument[key];
      });
      return result;
    }
    const result = {};
    String(argument || "").replace(/^["']|["']$/g, "").split("&")
      .forEach(function eachPair(pair) {
        const index = pair.indexOf("=");
        if (index <= 0) {
          return;
        }
        const key = decode(pair.slice(0, index));
        const value = decode(pair.slice(index + 1));
        if (key) {
          result[key] = value;
        }
      });
    return result;
  }

  function readStore(key) {
    try {
      if (typeof $persistentStore !== "undefined" &&
          $persistentStore && typeof $persistentStore.read === "function") {
        return $persistentStore.read(key);
      }
    } catch (_) {}
    return null;
  }

  function writeStore(value, key) {
    try {
      if (typeof $persistentStore !== "undefined" &&
          $persistentStore && typeof $persistentStore.write === "function") {
        return $persistentStore.write(String(value || ""), key);
      }
    } catch (_) {}
    return false;
  }

  function readJson(key) {
    const raw = readStore(key);
    if (!raw) {
      return null;
    }
    try {
      const value = JSON.parse(raw);
      return value && typeof value === "object" ? value : null;
    } catch (_) {
      return null;
    }
  }

  function writeJson(key, value) {
    try {
      return writeStore(JSON.stringify(value), key);
    } catch (_) {
      return false;
    }
  }

  function readStoredConfig() {
    return readJson(CONFIG_KEY) || {};
  }

  function readPluginOptions() {
    const result = {};
    Object.keys(PLUGIN_KEYS).forEach(function eachKey(key) {
      const value = readStore(PLUGIN_KEYS[key]);
      if (value !== null && value !== undefined && value !== "") {
        result[key] = value;
      }
    });
    return result;
  }

  function booleanValue(value) {
    if (value === true || value === false) {
      return value;
    }
    const normalized = String(value || "").toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "on") {
      return true;
    }
    if (normalized === "false" || normalized === "0" || normalized === "off") {
      return false;
    }
    return value;
  }

  function coerce(values) {
    /** @type {Record<string, any>} */
    const next = {};
    Object.keys(values || {}).forEach(function copyValue(key) {
      const value = values[key];
      next[key] = Array.isArray(value) ? value.slice() : value;
    });
    ["enabled", "rewriteAkamai", "portHeuristic"].forEach(function eachBoolean(key) {
      if (key in next) {
        next[key] = booleanValue(next[key]);
      }
    });
    if ("maxDepth" in next) {
      const depth = parseInt(next.maxDepth, 10);
      if (depth > 0) {
        next.maxDepth = depth;
      } else {
        delete next.maxDepth;
      }
    }
    if (typeof next.candidatePool === "string") {
      next.candidatePool = next.candidatePool.split(/[|,]/)
        .map(function trim(host) { return host.trim(); })
        .filter(Boolean);
    }
    return next;
  }

  function loadConfig(core) {
    let argument = null;
    try {
      argument = typeof $argument !== "undefined" ? $argument : null;
    } catch (_) {}
    const merged = Object.assign(
      {},
      readStoredConfig(),
      readPluginOptions(),
      parseArgument(argument)
    );
    const config = core.normalizeConfig(coerce(merged));
    const cached = loadRanking();
    if (config.selection === "auto" && cached) {
      const allowed = config.candidatePool.map(function candidateKey(host) {
        return String(host || "").trim().toLowerCase();
      });
      const ranking = cached.ranking.filter(function validHost(host) {
        return typeof host === "string" && host.trim() !== "" &&
          allowed.indexOf(host.trim().toLowerCase()) !== -1;
      });
      if (ranking.length) {
        const rest = config.candidatePool.filter(function notRanked(host) {
          return ranking.indexOf(host) === -1;
        });
        config.pcdnHost = ranking[0];
        config.candidatePool = ranking.concat(rest);
      }
    }
    return config;
  }

  function loadRanking() {
    const cached = readJson(RANK_KEY);
    if (!cached || !Array.isArray(cached.ranking) ||
        cached.ranking.length === 0 ||
        !(cached.expiresAt > Date.now())) {
      return null;
    }
    return cached;
  }

  function saveRanking(ranking, samples) {
    if (!Array.isArray(ranking) || ranking.length === 0) {
      return false;
    }
    const now = Date.now();
    return writeJson(RANK_KEY, {
      ranking: ranking.slice(),
      samples: Array.isArray(samples) ? samples.slice() : [],
      at: now,
      expiresAt: now + RANK_TTL_MS
    });
  }

  function sampleDeadline(value, now) {
    try {
      const deadline = parseInt(new URL(value).searchParams.get("deadline"), 10);
      if (deadline > 0) {
        return Math.min(now + SAMPLE_TTL_MS, deadline * 1000);
      }
    } catch (_) {}
    return now + SAMPLE_TTL_MS;
  }

  function saveProbeSample(url) {
    if (typeof url !== "string" || !url) {
      return false;
    }
    const now = Date.now();
    const expiresAt = sampleDeadline(url, now);
    if (expiresAt <= now) {
      return false;
    }
    return writeJson(SAMPLE_KEY, { url, at: now, expiresAt });
  }

  function loadProbeSample() {
    const sample = readJson(SAMPLE_KEY);
    if (!sample || typeof sample.url !== "string" ||
        !(sample.expiresAt > Date.now())) {
      return null;
    }
    return sample;
  }

  function clearProbeSample() {
    return writeStore("", SAMPLE_KEY);
  }

  function log(scope, message) {
    try {
      if (typeof console !== "undefined" &&
          console && typeof console.log === "function") {
        console.log(
          "[BiliAccelerator][" + String(scope || "app") + "] " +
          String(message || "")
        );
      }
    } catch (_) {}
  }

  function logError(scope, error) {
    const name = error && typeof error.name === "string"
      ? error.name
      : "Error";
    log(scope, "failed open (" + name + ")");
  }

  function rewriteAuthority(headers, targetHost) {
    const next = {};
    let sawHost = false;
    Object.keys(headers || {}).forEach(function copyHeader(key) {
      const lower = key.toLowerCase();
      if (lower === "host" || lower === ":authority") {
        next[key] = targetHost;
        sawHost = true;
      } else {
        next[key] = headers[key];
      }
    });
    if (!sawHost) {
      next.Host = targetHost;
    }
    return next;
  }

  root.BiliAcceleratorProxyEnv = {
    CONFIG_KEY,
    RANK_KEY,
    SAMPLE_KEY,
    PLUGIN_KEYS,
    parseArgument,
    loadConfig,
    loadRanking,
    saveRanking,
    saveProbeSample,
    loadProbeSample,
    clearProbeSample,
    log,
    logError,
    rewriteAuthority
  };
})(
  typeof globalThis !== "undefined"
    ? globalThis
    : (typeof self !== "undefined" ? self : this)
);
