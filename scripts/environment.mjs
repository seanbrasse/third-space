import { existsSync } from "node:fs";
export function localEnvironment() {
  if (existsSync(".env")) process.loadEnvFile(".env");
  const gamePort = process.env.GAME_PORT || "2567";
  const webPort = process.env.WEB_PORT || "3000";
  return {
    ...process.env,
    GAME_HTTP_URL: process.env.GAME_HTTP_URL || `http://127.0.0.1:${gamePort}`,
    WEB_ORIGIN: process.env.WEB_ORIGIN || `http://localhost:${webPort}`,
    NEXT_PUBLIC_GAME_SERVER_URL:
      process.env.NEXT_PUBLIC_GAME_SERVER_URL || `ws://localhost:${gamePort}`,
    WATCHPACK_POLLING: process.env.WATCHPACK_POLLING || "true",
  };
}
