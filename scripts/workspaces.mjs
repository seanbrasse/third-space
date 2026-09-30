import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { readdirSync, readFileSync } from "node:fs";
import { localEnvironment } from "./environment.mjs";
const require = createRequire(import.meta.url);
const mode = process.argv[2];
const run = (file, args, cwd) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [file, ...args], {
      cwd,
      stdio: "inherit",
      env: {
        ...localEnvironment(),
        ...(mode === "build" ? { NEXT_BUILD_DIR: ".next-production" } : {}),
      },
    });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${cwd}: command exited ${code}`)),
    );
  });
try {
  if (mode === "build") {
    await run(
      require.resolve("next/dist/bin/next", { paths: ["apps/web"] }),
      ["build", "--webpack"],
      "apps/web",
    );
  } else if (mode === "typecheck") {
    for (const root of ["packages", "apps"]) {
      for (const entry of readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const cwd = `${root}/${entry.name}`;
        const pkg = JSON.parse(readFileSync(`${cwd}/package.json`, "utf8"));
        if (pkg.scripts?.typecheck)
          await run(require.resolve("typescript/bin/tsc"), ["--noEmit"], cwd);
      }
    }
  } else throw new Error("Expected build or typecheck");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
