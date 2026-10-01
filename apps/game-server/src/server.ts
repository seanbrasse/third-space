import { configuredOrigins, acceptsOrigin } from "./origin-policy.js";
import { Server, matchMaker, ServerError } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { LocalStore, createDataRouter } from "@third-space/data";
import { PartyRoom } from "./PartyRoom.js";

const originalAdmission=matchMaker.controller.invokeMethod;

export function createGameServer(
  options: { dataPath?: string; origins?: string[] } = {},
) {
  const production=process.env.NODE_ENV==="production";
  const origins=configuredOrigins(production,options.origins);
  const allowed=(origin:string|null|undefined)=>acceptsOrigin(origin,origins,production);
  // Colyseus admission routes precede Express. Apply both its CORS and
  // admission authority hooks; Express CORS alone cannot guard matchmaking.
  matchMaker.controller.getCorsHeaders=(headers)=>({"Access-Control-Allow-Origin":allowed(headers.get("origin"))?(headers.get("origin")??origins[0]!):"null","Vary":"Origin"});
  const invoke=originalAdmission;
  matchMaker.controller.invokeMethod=async function(method,roomName,clientOptions,authOptions){
    if(!allowed(authOptions?.headers.get("origin")))throw new ServerError(403,"Frontend origin is not allowed.");
    return invoke.call(this,method,roomName,clientOptions,authOptions);
  };
  const store = new LocalStore({
    path:
      options.dataPath || process.env.DATA_PATH || ".data/third-space.sqlite",
  });
  PartyRoom.store = store;
  const app = express();
  app.disable("x-powered-by");
  app.use((req,res,next)=>{if(req.path==="/health"||req.path==="/ready"||(!req.get("origin")&&["GET","HEAD"].includes(req.method))||allowed(req.get("origin")))return next();res.status(403).json({error:{code:"ORIGIN_DENIED",message:"Frontend origin is not allowed."}});});
  app.use(cors({ origin: origins, credentials: true }));
  app.use(express.json({ limit: "16kb" }));
  app.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    next();
  });
  app.get("/health", (_req, res) =>
    res.json({ ok: true, mode: production?"production":"local", voice: "not_configured" }),
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
  app.use("/api", createDataRouter(store, { allowedOrigins: origins, secureCookies: production }));
  const httpServer = createServer(app);
  const transport = new WebSocketTransport({
    server: httpServer,
    maxPayload: 16 * 1024,
    verifyClient: (info: { origin: string }) =>
      allowed(info.origin),
  });
  const server = new Server({ transport, greet: false });
  server.define("party", PartyRoom).filterBy(["homeId"]);
  return { app, httpServer, server, store };
}
