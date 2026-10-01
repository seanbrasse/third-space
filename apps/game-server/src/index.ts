import { createGameServer } from "./server.js";

const port = Number(process.env.GAME_PORT || process.env.PORT || 2567);
if(!Number.isInteger(port)||port<1||port>65535)throw new Error("GAME_PORT or PORT must be an integer between 1 and 65535.");
const host=process.env.GAME_HOST||"127.0.0.1";
const { server, store } = createGameServer();
await server.listen(port, host);
console.log(`Third Space game and local API: http://${host}:${port}`);
let stopping = false;
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  await server.gracefullyShutdown(false);
  store.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
