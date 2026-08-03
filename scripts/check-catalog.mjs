import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const catalog = JSON.parse(await readFile(resolve(root, "catalog.json"), "utf8"));
const readme = await readFile(resolve(root, "README.md"), "utf8");
const expected = new Map([
  ["Roam Grid", "https://svyk.github.io/roam-grid"],
  ["Auto Attribute", "https://svyk.github.io/roam-auto-attribute"],
  ["TimeBlock Organizer", "https://svyk.github.io/roam-timeblock-organizer"],
  ["Live AI Toolkit", "https://svyk.github.io/roam-live-ai-toolkit"],
  ["Archive TODOs", "https://svyk.github.io/roam-archive-todos"],
  ["Hide DONE", "https://svyk.github.io/roam-hide-done"],
]);

if (catalog.schemaVersion !== 1) throw new Error("catalog schemaVersion must be 1");
if (!Array.isArray(catalog.extensions) || catalog.extensions.length !== expected.size) {
  throw new Error(`catalog must contain exactly ${expected.size} extensions`);
}

const seenUrls = new Set();
for (const extension of catalog.extensions) {
  const expectedUrl = expected.get(extension.name);
  if (!expectedUrl) throw new Error(`unexpected extension: ${extension.name}`);
  if (extension.installUrl !== expectedUrl) throw new Error(`wrong URL for ${extension.name}`);
  if (seenUrls.has(extension.installUrl)) throw new Error(`duplicate URL: ${extension.installUrl}`);
  if (!readme.includes(extension.installUrl)) throw new Error(`README omits ${extension.installUrl}`);
  if (!/^Svyk\/[a-z0-9-]+$/.test(extension.repository)) throw new Error(`invalid repository: ${extension.repository}`);
  seenUrls.add(extension.installUrl);
}

for (const name of expected.keys()) {
  if (!catalog.extensions.some((extension) => extension.name === name)) throw new Error(`missing ${name}`);
}

for (const path of [
  "legacy/manifest.json",
  "legacy/update-roam-js/script.js",
  "legacy/auto-attribute-todo/script.js",
  "legacy/daily-summary/script.js",
  "legacy/explain-block/script.js",
  "legacy/lori-review-button/script.js",
  "legacy/timeblock-organizer/script.js",
]) await access(resolve(root, path));

for (const retiredRootPath of ["manifest.json", "update-roam-js/script.js"]) {
  try {
    await access(resolve(root, retiredRootPath));
    throw new Error(`${retiredRootPath} must remain under legacy/`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

process.stdout.write("Catalog check passed: six canonical extensions and frozen legacy suite.\n");
