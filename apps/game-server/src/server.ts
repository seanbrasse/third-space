import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { LocalStore, createDataRouter } from "@third-space/data";
import { PartyRoom } from "./PartyRoom.js";

export function createGameServer(
  options: { dataPath?: string; origins?: string[] } = {},
) {
  const webPort = process.env.WEB_PORT || "3000";
  const origins = options.origins || [
    process.env.WEB_ORIGIN || `http://localhost:${webPort}`,
    `http://127.0.0.1:${webPort}`,
  ];
  const store = new LocalStore({
    path:
      options.dataPath || process.env.DATA_PATH || ".data/third-space.sqlite",
  });
  PartyRoom.store = store;
  const app = express();
  app.disable("x-powered-by");
  app.use(cors({ origin: origins, credentials: true }));
  app.use(express.json({ limit: "16kb" }));
  app.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    next();
  });
  app.get("/health", (_req, res) =>
    res.json({ ok: true, mode: "local", voice: "not_configured" }),
  );
  app.get("/ready", (_req, res) =>
    res.json({ ok: true, persistence: "sqlite", game: "colyseus" }),
  );
  app.get("/api/media/status", (_req, res) =>
    res.json({
      configured: false,
      provider: "livekit",
      privacyVerified: false,
      reason: "Native voice needs a configured, verified media service.",
    }),
  );
  app.post("/api/media/token", (_req, res) =>
    res
      .status(503)
      .json({
        error: {
          code: "MEDIA_NOT_CONFIGURED",
          message:
            "Native voice is awaiting a configured, verified media service.",
        },
      }),
  );
  app.use("/api", createDataRouter(store, { allowedOrigins: origins }));
  const httpServer = createServer(app);
  const transport = new WebSocketTransport({
    server: httpServer,
    maxPayload: 16 * 1024,
    verifyClient: (info: { origin: string }) =>
      !info.origin || origins.includes(info.origin),
  });
  const server = new Server({ transport, greet: false });
  server.define("party", PartyRoom).filterBy(["homeId"]);
  return { app, httpServer, server, store };
}
