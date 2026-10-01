# Integration needed before public hosting

Deployment preparation is based on verified commit cf0892500367212f4c62b39090e83228ccb546b0. Existing source files remain owned by the implementation lead.

1. In apps/game-server/src/index.ts, use `GAME_PORT || PORT || 2567` for the port and `GAME_HOST || "127.0.0.1"` for the listen host. Containers explicitly set GAME_HOST=0.0.0.0; local preview remains unchanged. Validate the configured port as an integer 1..65535.
2. In apps/game-server/src/server.ts, production must use only explicitly configured WEB_ORIGIN (validated exact HTTPS origin) and fail startup if missing. Keep localhost defaults only in development. Pass `secureCookies: process.env.NODE_ENV === "production"` into createDataRouter. It already supports this option. The stable Vercel origin reaches the backend through `/api` rewrites and directly through WSS/matchmaking. No wildcard origins or permanent preview-origin access.
3. Ensure /health reports runtime mode accurately; native voice is still unconfigured. /ready must be healthy only after SQLite opens successfully.
4. Confirm matchmaker CORS uses the same explicit origin list (Colyseus may supply matchmaker headers separately from Express cors middleware). Test both admission HTTP and WS upgrades from the stable frontend origin, and denial from another browser origin.

No change to package scripts is required: Docker starts Node with `--import tsx`. Use one backend instance and one persistent disk. No SQLite/user data is copied into the image.
