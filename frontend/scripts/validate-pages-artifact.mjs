import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const artifactRoot = path.join(projectRoot, "dist", "client");
const basePath = "/haiguitang-coop/";
const indexPath = path.join(artifactRoot, "index.html");
const html = await readFile(indexPath, "utf8");

assert.match(
  html,
  /演示模式\s*\/\s*Mock，不代表真实裁判结果/,
  "exported HTML must disclose that results are only a Mock demo",
);

const assetUrls = [
  ...html.matchAll(/(?:src|href)=["']([^"']+)["']/g),
].map((match) => match[1]).filter((url) => /\.(?:css|js|svg)(?:\?|$)/.test(url));

assert.ok(assetUrls.length > 0, "exported HTML must reference static assets");
for (const url of assetUrls) {
  assert.ok(
    url.startsWith(basePath),
    `static asset URL must start with ${basePath}: ${url}`,
  );
  const relative = decodeURIComponent(url.slice(basePath.length)).split("?")[0];
  const localPath = path.join(artifactRoot, relative);
  assert.ok(
    (await stat(localPath)).isFile(),
    `referenced static asset must exist: ${relative}`,
  );
}

const textFiles = [];
async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) await collect(entryPath);
    else if (/\.(?:css|html|js|json|svg|txt)$/.test(entry.name)) textFiles.push(entryPath);
  }
}
await collect(artifactRoot);

const forbidden = [
  [/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)/i, "local network address"],
  [/(?:ccarenv_|codex[^\s"']*(?:cloud|environment))/i, "temporary Codex environment address"],
  [/\bsk-[A-Za-z0-9_-]{20,}\b/, "API-key-like value"],
  [/(?:JUDGE|DEEPSEEK|OPENAI)_API_KEY\s*[:=]/i, "model API key assignment"],
  [/(?:data\/private|SOUP_DATA_PATH)/i, "private soup-library path"],
];

for (const file of textFiles) {
  const content = await readFile(file, "utf8");
  for (const [pattern, label] of forbidden) {
    assert.doesNotMatch(
      content,
      pattern,
      `${path.relative(artifactRoot, file)} contains forbidden ${label}`,
    );
  }
}

console.log(
  `Validated GitHub Pages artifact: ${assetUrls.length} referenced assets use ${basePath}; ${textFiles.length} text files passed the public-content scan.`,
);
