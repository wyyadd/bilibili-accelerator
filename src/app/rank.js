// Periodic CDN ranker for Loon and Surge. It consumes a short-lived signed
// sample captured by response.js, so probing never delays playback.
(function runBiliAcceleratorRank(root) {
  "use strict";

  const core = root.BiliAcceleratorCore;
  const env = root.BiliAcceleratorProxyEnv;
  const PROBE_TIMEOUT_SECONDS = 2;
  const OVERALL_TIMEOUT_MS = 8000;
  const MAX_CANDIDATES = 6;
  let completed = false;
  let overallTimer = null;

  function finish() {
    if (completed) {
      return;
    }
    completed = true;
    if (overallTimer) {
      clearTimeout(overallTimer);
    }
    if (typeof $done === "function") {
      $done({});
    }
  }

  function describeSamples(samples) {
    return samples.map(function describe(sample) {
      return sample.host + "=" +
        (sample.ok ? String(sample.ttfb) + "ms" : "failed");
    }).join(", ");
  }

  function swapHost(value, host) {
    try {
      const url = new URL(value);
      url.protocol = "https:";
      url.host = host;
      if (host.indexOf(":") === -1) {
        url.port = "";
      }
      return url.toString();
    } catch (_) {
      return null;
    }
  }

  function probeHost(host, sampleUrl, callback) {
    const url = swapHost(sampleUrl, host);
    if (!url || typeof $httpClient === "undefined" ||
        !$httpClient || typeof $httpClient.head !== "function") {
      callback({ host, ttfb: null, ok: false });
      return;
    }

    const startedAt = Date.now();
    try {
      $httpClient.head({
        url,
        timeout: PROBE_TIMEOUT_SECONDS,
        headers: {
          "Cache-Control": "no-cache"
        },
        "auto-redirect": false
      }, function onProbe(error, response) {
        const status = response && Number(
          response.status !== undefined ? response.status : response.statusCode
        );
        callback({
          host,
          ttfb: error ? null : Date.now() - startedAt,
          ok: !error && status >= 200 && status < 400
        });
      });
    } catch (_) {
      callback({ host, ttfb: null, ok: false });
    }
  }

  if (!core || !env) {
    finish();
    return;
  }

  try {
    const config = env.loadConfig(core);
    if (!config.enabled || config.mode === "off" ||
        config.selection !== "auto") {
      finish();
      return;
    }

    const cached = env.loadRanking();
    if (cached) {
      env.log("rank", "skipped: cached winner=" + cached.ranking[0]);
      finish();
      return;
    }

    const sample = env.loadProbeSample();
    if (!sample) {
      env.log("rank", "skipped: no valid playback sample");
      finish();
      return;
    }

    const seen = {};
    const hosts = (config.candidatePool || []).filter(function uniqueHost(host) {
      const clean = String(host || "").trim();
      if (!clean || seen[clean]) {
        return false;
      }
      seen[clean] = true;
      return true;
    }).slice(0, MAX_CANDIDATES);

    if (!hosts.length) {
      env.log("rank", "skipped: no candidate hosts");
      finish();
      return;
    }

    const samples = [];
    env.log("rank", "probing " + hosts.length + " candidate(s)");
    overallTimer = setTimeout(function onOverallTimeout() {
      env.log(
        "rank",
        "timed out: completed " + samples.length + "/" + hosts.length
      );
      env.clearProbeSample();
      finish();
    }, OVERALL_TIMEOUT_MS);

    hosts.forEach(function eachHost(host) {
      probeHost(host, sample.url, function onResult(result) {
        if (completed) {
          return;
        }
        samples.push(result);
        if (samples.length !== hosts.length) {
          return;
        }

        const healthy = samples.filter(function isHealthy(item) {
          return item.ok;
        });
        const ranking = core.rankHosts(healthy);
        if (ranking.length) {
          env.saveRanking(ranking, samples);
          env.log(
            "rank",
            describeSamples(samples) + "; winner=" + ranking[0]
          );
        } else {
          env.log("rank", describeSamples(samples) + "; no healthy candidate");
        }
        env.clearProbeSample();
        finish();
      });
    });
  } catch (error) {
    env.logError("rank", error);
    finish();
  }
})(
  typeof globalThis !== "undefined"
    ? globalThis
    : (typeof self !== "undefined" ? self : this)
);
