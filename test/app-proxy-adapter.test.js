"use strict";

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const appRoot = path.resolve(__dirname, "../src/app");
const coreSource = readFileSync(
  path.resolve(appRoot, "../core/rewrite.js"),
  "utf8"
);
const envSource = readFileSync(path.join(appRoot, "env.js"), "utf8");
const sampleSource = readFileSync(path.join(appRoot, "sample.js"), "utf8");
const backupSource = readFileSync(path.join(appRoot, "backup.js"), "utf8");
const requestSource = readFileSync(path.join(appRoot, "request.js"), "utf8");
const responseSource = readFileSync(path.join(appRoot, "response.js"), "utf8");
const rankSource = readFileSync(path.join(appRoot, "rank.js"), "utf8");
const responseAdapterSource =
  `${sampleSource}\n${backupSource}\n${responseSource}`;

function runAdapter(entrySource, globals) {
  let result;
  const context = {
    URL,
    WeakSet,
    console,
    setTimeout,
    clearTimeout,
    $done(value) {
      result = value;
    },
    ...globals
  };

  vm.runInNewContext(
    `${coreSource}\n${envSource}\n${entrySource}`,
    context,
    { timeout: 1000 }
  );
  return result;
}

test("request adapter rewrites URL and authority header", () => {
  const result = runAdapter(requestSource, {
    $argument:
      "pcdnHost=upos-sz-mirrorali.bilivideo.com&mode=bad-only",
    $request: {
      url: "https://1.2.3.4:4483/upgcxcode/00/01/video.m4s?deadline=1",
      headers: {
        Host: "1.2.3.4:4483",
        "User-Agent": "test"
      }
    }
  });

  assert.equal(new URL(result.url).hostname, "upos-sz-mirrorali.bilivideo.com");
  assert.equal(result.headers.Host, "upos-sz-mirrorali.bilivideo.com");
  assert.equal(result.headers["User-Agent"], "test");
});

test("request adapter fails open for unsupported URLs", () => {
  const result = runAdapter(requestSource, {
    $request: {
      url: "https://example.com/video.mp4",
      headers: {}
    }
  });

  assert.deepEqual({ ...result }, {});
});

test("request adapter accepts an empty candidate pool", () => {
  const result = runAdapter(requestSource, {
    $argument: "candidatePool=&mode=bad-only",
    $request: {
      url: "https://1.2.3.4:4483/upgcxcode/00/01/video.m4s?deadline=1",
      headers: {}
    }
  });

  assert.equal(
    new URL(result.url).hostname,
    "upos-sz-mirrorcos.bilivideo.com"
  );
});

test("response adapter rewrites playback JSON and adds backups", () => {
  const payload = {
    data: {
      dash: {
        video: [{
          baseUrl:
            "https://1.2.3.4:4483/upgcxcode/00/01/video.m4s?deadline=1"
        }]
      }
    }
  };
  const result = runAdapter(responseAdapterSource, {
    $argument:
      "pcdnHost=upos-sz-mirrorali.bilivideo.com&mode=bad-only",
    $response: { body: JSON.stringify(payload) }
  });
  const body = JSON.parse(result.body);
  const video = body.data.dash.video[0];

  assert.equal(
    new URL(video.baseUrl).hostname,
    "upos-sz-mirrorali.bilivideo.com"
  );
  assert.ok(video.backupUrl.length > 0);
});

test("response adapter stores a short-lived signed sample without probing", () => {
  const store = {};
  const sample =
    "https://upos-sz-mirrorcos.bilivideo.com/upgcxcode/00/01/video.m4s?deadline=9999999999";
  let probes = 0;
  const result = runAdapter(responseAdapterSource, {
    $persistentStore: {
      read(key) {
        return store[key] || null;
      },
      write(value, key) {
        store[key] = value;
        return true;
      }
    },
    $httpClient: {
      head() {
        probes += 1;
      }
    },
    $response: {
      body: JSON.stringify({
        data: { dash: { video: [{ baseUrl: sample }] } }
      })
    }
  });
  const saved = JSON.parse(store["biliAccelerator.proxy.sample.v1"]);

  assert.equal(probes, 0);
  assert.equal(saved.url, sample);
  assert.ok(saved.expiresAt > saved.at);
  assert.equal(typeof result.body, "string");
});

test("response adapter filters live PCDN hosts", () => {
  const payload = {
    data: {
      playurl_info: {
        playurl: {
          stream: [{
            format: [{
              codec: [{
                url_info: [
                  { host: "https://1.2.3.4:4483", extra: "?os=mcdn" },
                  { host: "https://d1--cn-gotcha204.bilivideo.com", extra: "" }
                ]
              }]
            }]
          }]
        }
      }
    }
  };
  const result = runAdapter(responseAdapterSource, {
    $response: { body: JSON.stringify(payload) }
  });
  const info = JSON.parse(result.body)
    .data.playurl_info.playurl.stream[0].format[0].codec[0].url_info;

  assert.equal(info.length, 1);
  assert.equal(info[0].host, "https://d1--cn-gotcha204.bilivideo.com");
});

test("rank adapter probes candidates and persists fastest healthy host", () => {
  const first = "upos-sz-mirrorcos.bilivideo.com";
  const fastest = "upos-sz-mirrorali.bilivideo.com";
  const store = {
    "biliAccelerator.proxy.sample.v1": JSON.stringify({
      url:
        "https://upos-sz-mirrorcos.bilivideo.com/upgcxcode/00/01/video.m4s?deadline=9999999999",
      at: 1000,
      expiresAt: 9999999999000
    })
  };
  let clock = 1000;
  class FakeDate extends Date {
    static now() {
      return clock;
    }
  }

  const result = runAdapter(rankSource, {
    Date: FakeDate,
    $argument: `selection=auto&candidatePool=${first}|${fastest}`,
    $persistentStore: {
      read(key) {
        return store[key] || null;
      },
      write(value, key) {
        store[key] = value;
        return true;
      }
    },
    $httpClient: {
      head(options, callback) {
        const host = new URL(options.url).hostname;
        clock += host === fastest ? 10 : 40;
        callback(null, { status: 200 }, "");
      }
    }
  });
  const cached = JSON.parse(store["biliAccelerator.proxy.rank.v1"]);

  assert.deepEqual({ ...result }, {});
  assert.deepEqual(cached.ranking, [fastest, first]);
  assert.equal(store["biliAccelerator.proxy.sample.v1"], "");
});

test("request adapter applies the cached automatic ranking", () => {
  const winner = "upos-tf-all-hw.bilivideo.com";
  const store = {
    "biliAccelerator.proxy.rank.v1": JSON.stringify({
      ranking: [winner],
      samples: [{ host: winner, ttfb: 20, ok: true }],
      at: Date.now(),
      expiresAt: Date.now() + 60000
    })
  };
  const result = runAdapter(requestSource, {
    $argument: "selection=auto&mode=bad-only",
    $persistentStore: {
      read(key) {
        return store[key] || null;
      },
      write(value, key) {
        store[key] = value;
        return true;
      }
    },
    $request: {
      url: "https://1.2.3.4:4483/upgcxcode/00/01/video.m4s?deadline=9999999999",
      headers: {}
    }
  });

  assert.equal(new URL(result.url).hostname, winner);
  assert.equal(result.headers.Host, winner);
});
