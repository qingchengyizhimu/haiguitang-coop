#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_root="$(cd "${script_dir}/.." && pwd)"
worker="${project_root}/dist/server/index.js"

[[ -f "${worker}" ]] || {
  echo "Missing production Worker entry: dist/server/index.js" >&2
  exit 66
}
node --input-type=module - "${worker}" <<'NODE'
import { pathToFileURL } from "node:url";

const [workerPath] = process.argv.slice(2);

const workerUrl = pathToFileURL(workerPath);
workerUrl.searchParams.set("sites-validation", `${process.pid}-${Date.now()}`);
const worker = await import(workerUrl.href);
if (!worker.default || typeof worker.default.fetch !== "function") {
  throw new Error("dist/server/index.js must have an ESM default export with fetch(request, env, ctx)");
}
NODE

echo "Validated production artifact: ESM Worker default.fetch is present."
