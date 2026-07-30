"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const core = require("../src/core/rewrite.js");
const backup = require("../src/app/backup.js");
const sample = require("../src/app/sample.js");

test("shared core normalization remains unchanged by proxy adapters", () => {
  const source = Object.freeze({
    candidatePool: Object.freeze(["upos-sz-mirrorali.bilivideo.com"])
  });
  const config = core.normalizeConfig(source);

  assert.equal(config.candidatePool, source.candidatePool);
  assert.equal(Object.isFrozen(config.candidatePool), true);
  assert.deepEqual(source.candidatePool, ["upos-sz-mirrorali.bilivideo.com"]);
});

test("shared core replaces an empty frozen candidate pool safely", () => {
  const source = Object.freeze({
    candidatePool: Object.freeze([])
  });
  const config = core.normalizeConfig(source);

  assert.deepEqual(config.candidatePool, core.CANDIDATE_POOL);
  assert.equal(Object.isFrozen(config.candidatePool), false);
});

test("rewrites a PCDN media URL to the configured UPOS host", () => {
  const result = core.rewriteUrlDetail(
    "https://1.2.3.4:4483/upgcxcode/00/01/video.m4s?deadline=1",
    { pcdnHost: "upos-sz-mirrorali.bilivideo.com" }
  );

  assert.equal(result.changed, true);
  assert.equal(result.reason, "pcdn-host");
  assert.equal(new URL(result.url).hostname, "upos-sz-mirrorali.bilivideo.com");
});

test("wraps an MCDN resource URL with the configured proxy", () => {
  const result = core.rewriteUrlDetail(
    "https://xy1x2x3x4xy.mcdn.bilivideo.cn/v1/resource/file.m4s?os=mcdn",
    { mcdnStrategy: "proxy-all" }
  );

  const rewritten = new URL(result.url);
  assert.equal(result.changed, true);
  assert.equal(result.reason, "mcdn-proxy");
  assert.equal(rewritten.hostname, "proxy-tf-all-ws.bilivideo.com");
  assert.match(rewritten.searchParams.get("url"), /mcdn\.bilivideo\.cn/);
});

test("does not rewrite live media to a VOD UPOS host", () => {
  const original =
    "https://d1--cn-gotcha204.bilivideo.com:4483/live-bvc/123/live_1.flv?deadline=1";
  const result = core.rewriteUrlDetail(original);

  assert.equal(result.changed, false);
  assert.equal(result.reason, "live-skip");
  assert.equal(result.url, original);
});

test("injects candidate hosts into DASH backup URLs", () => {
  const payload = {
    data: {
      dash: {
        video: [{
          baseUrl:
            "https://upos-sz-mirrorcos.bilivideo.com/upgcxcode/00/01/video.m4s"
        }]
      }
    }
  };

  const result = backup.enrichBackups(payload, {
    candidatePool: [
      "upos-sz-mirrorcos.bilivideo.com",
      "upos-sz-mirrorali.bilivideo.com"
    ]
  });

  assert.equal(result.changed, true);
  assert.equal(
    new URL(payload.data.dash.video[0].backupUrl[0]).hostname,
    "upos-sz-mirrorali.bilivideo.com"
  );
});

test("finds a signed VOD sample while ignoring live media", () => {
  const vod =
    "https://upos-sz-mirrorcos.bilivideo.com/upgcxcode/00/01/video.m4s?deadline=9999999999";
  const payload = {
    live:
      "https://d1--cn-gotcha204.bilivideo.com/live-bvc/123/live.flv?deadline=9999999999",
    data: {
      dash: {
        video: [{ baseUrl: vod }]
      }
    }
  };

  assert.equal(sample.findMediaUrl(payload), vod);
});
