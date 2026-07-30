import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const scriptsRoot = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptsRoot, "..");
const appRoot = path.join(projectRoot, "src", "app");
const coreRoot = path.join(projectRoot, "src", "core");
const templateRoot = path.join(projectRoot, "template");
const dist = path.join(projectRoot, "dist", "app");

const pkg = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8"));
const core = await readFile(path.join(coreRoot, "rewrite.js"), "utf8");
const env = await readFile(path.join(appRoot, "env.js"), "utf8");
const sample = await readFile(path.join(appRoot, "sample.js"), "utf8");
const backup = await readFile(path.join(appRoot, "backup.js"), "utf8");
const request = await readFile(path.join(appRoot, "request.js"), "utf8");
const response = await readFile(path.join(appRoot, "response.js"), "utf8");
const rank = await readFile(path.join(appRoot, "rank.js"), "utf8");
const loon = await readFile(path.join(templateRoot, "loon.plugin"), "utf8");
const surge = await readFile(path.join(templateRoot, "surge.sgmodule"), "utf8");

await mkdir(dist, { recursive: true });
await writeFile(
  path.join(dist, "bilibili-accelerator.request.js"),
  `${core}\n${env}\n${request}\n`
);
await writeFile(
  path.join(dist, "bilibili-accelerator.response.js"),
  `${core}\n${env}\n${sample}\n${backup}\n${response}\n`
);
await writeFile(
  path.join(dist, "bilibili-accelerator.rank.js"),
  `${core}\n${env}\n${rank}\n`
);
await writeFile(
  path.join(dist, "bilibili-accelerator.plugin"),
  loon.replaceAll("__VERSION__", pkg.version)
);
await writeFile(
  path.join(dist, "bilibili-accelerator.sgmodule"),
  surge.replaceAll("__VERSION__", pkg.version)
);

console.log("Built dist/app Loon and Surge artifacts");
