import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve, join } from "node:path";

// Exercise the compiled Next server with in-memory request/response streams.
// This does not verify a network listener, browser hydration or backend APIs.
const appDir = resolve("apps/web");
const require = createRequire(join(appDir, "package.json"));
process.env.NODE_ENV = "production";
process.env.NEXT_BUILD_DIR = ".next-production";
const next = require("next");
const {
  createRequestResponseMocks,
} = require("next/dist/server/lib/mock-request");
const app = next({
  dev: false,
  customServer: false,
  dir: appDir,
  hostname: "localhost",
  port: 3000,
});

try {
  await access(join(appDir, ".next-production/BUILD_ID"));
  await app.prepare();
  for (const [url, expectedStatus, expectedText] of [
    ["/", 200, "Your space starts here."],
    ["/icon.svg", 200, "<svg"],
    ["/not-a-real-route", 404, "404"],
  ]) {
    const chunks = [];
    const { req, res } = createRequestResponseMocks({
      url,
      headers: { host: "localhost:3000" },
      resWriter: (chunk) => {
        chunks.push(Buffer.from(chunk));
        return true;
      },
    });
    await app.getRequestHandler()(req, res);
    await res.hasStreamed;
    const body = Buffer.concat(chunks).toString();
    assert.equal(
      res.statusCode,
      expectedStatus,
      `Unexpected status for ${url}`,
    );
    assert(body.includes(expectedText), `Missing rendered content for ${url}`);
    const assets = new Set(
      [...body.matchAll(/(?:src|href)="(\/_next\/static\/[^"?#]+)/g)].map(
        (match) => match[1],
      ),
    );
    if (url === "/")
      assert(
        assets.size > 0,
        "Production page must reference compiled client assets",
      );
    for (const asset of assets)
      await access(
        join(appDir, ".next-production", asset.replace("/_next/", "")),
      );
    console.log(
      `${url}: ${res.statusCode}; rendered ${Buffer.byteLength(body)} bytes; ${assets.size} client assets present`,
    );
  }
} finally {
  await app.close();
}
