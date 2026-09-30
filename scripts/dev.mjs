import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { localEnvironment } from "./environment.mjs";
const require = createRequire(import.meta.url);
if (Number(process.versions.node.split(".")[0]) < 24) {
  console.error(
    "Third Space requires Node 24 or newer (local persistence uses node:sqlite).",
  );
  process.exit(1);
}
const production = process.argv.includes("--production");
const env = {
  ...localEnvironment(),
  ...(production ? { NEXT_BUILD_DIR: ".next-production" } : {}),
};
const jobs = [
  spawn(
    process.execPath,
    [require.resolve("tsx/cli"), "apps/game-server/src/index.ts"],
    { stdio: "inherit", env },
  ),
  spawn(
    process.execPath,
    [
      require.resolve("next/dist/bin/next", { paths: ["apps/web"] }),
      production ? "start" : "dev",
      ...(!production ? ["--webpack"] : []),
      "--hostname",
      "127.0.0.1",
      "--port",
      process.env.WEB_PORT || "3000",
    ],
    { cwd: "apps/web", stdio: "inherit", env },
  ),
];
let stopping = false;
const stop = (code = 0) => {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  jobs.forEach((job) => job.kill("SIGTERM"));
  setTimeout(() => process.exit(code), 1200).unref();
};
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
for (const job of jobs)
  job.on("exit", (code) => {
    if (!stopping) stop(code || 1);
  });
