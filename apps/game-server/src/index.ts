import { createGameServer } from "./server.js";

const port = Number(process.env.GAME_PORT || 2567);
const { server, store } = createGameServer();
await server.listen(port, "127.0.0.1");
console.log(`Third Space game and local API: http://127.0.0.1:${port}`);
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
