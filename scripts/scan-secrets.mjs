import { readFile, readdir } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ignored = new Set([".git", ".idea", "node_modules"]);
const rules = [
  ["private-key", /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g],
  ["roam-token", /\broam-(?:graph|local)-token-[A-Za-z0-9_-]{16,}\b/g],
  ["openai-key", /\bsk-(?!ant-)(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b/g],
  ["anthropic-key", /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g],
  ["github-token", /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g],
  ["google-api-key", /\bAIza[0-9A-Za-z_-]{30,}\b/g],
  ["aws-access-key", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
];

async function files(directory, output = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink() || ignored.has(entry.name)) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await files(path, output);
    else if (entry.isFile() && entry.name !== ".DS_Store") output.push(path);
  }
  return output;
}

const findings = [];
for (const path of await files(root)) {
  const content = await readFile(path);
  if (content.includes(0)) continue;
  const lines = content.toString("utf8").split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    for (const [id, pattern] of rules) {
      pattern.lastIndex = 0;
      if (pattern.test(lines[index])) findings.push(`${id} at ${relative(root, path)}:${index + 1}`);
    }
  }
}

if (findings.length) throw new Error(`Potential secrets:\n${findings.join("\n")}`);
process.stdout.write("Secret scan passed.\n");
