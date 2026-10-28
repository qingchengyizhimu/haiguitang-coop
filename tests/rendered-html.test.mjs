import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

test("renders the standalone game shell", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  const response = await worker.fetch(
    new Request("http://localhost/", {
      headers: {
        accept: "text/html",
        "oai-authenticated-user-id": "render-test-owner",
      },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") ?? "",
    /^text\/html\b/i,
  );
  const html = await response.text();
  assert.match(html, /<title>海龟汤 · 人机共游版<\/title>/i);
  assert.match(html, /海龟汤/);
  assert.match(html, /演示模式 \/ Mock，不代表真实裁判结果/);
});

test("client bundle contains no soup bottoms or judge key elements", async () => {
  const samples = JSON.parse(
    await readFile(new URL("../samples/sample_soups.json", import.meta.url), "utf8"),
  );
  const clientRoot = new URL("../dist/client/", import.meta.url);
  const entries = await readdir(clientRoot, { recursive: true, withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile() && /\.(?:js|html)$/.test(entry.name));
  let bundle = "";
  for (const entry of files) {
    bundle += await readFile(`${entry.parentPath}/${entry.name}`, "utf8");
  }
  for (const soup of samples) {
    assert.equal(bundle.includes(soup.soup_bottom), false, `client leaked soup bottom: ${soup.id}`);
    for (const keyElement of soup.key_elements) {
      assert.equal(bundle.includes(keyElement), false, `client leaked key element: ${soup.id}`);
    }
  }
});
