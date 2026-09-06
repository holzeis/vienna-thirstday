import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import { config } from "./config";
import { ApiError } from "./utils/errors";
import { optionalAuth } from "./middleware/auth";

import authRouter from "./routes/auth";
import adminUsersRouter from "./routes/adminUsers";
import adminPlayersRouter from "./routes/adminPlayers";
import adminInvitesRouter from "./routes/adminInvites";
import invitesRouter from "./routes/invites";
import guestsRouter from "./routes/guests";
import playersRouter from "./routes/players";
import gamedaysRouter from "./routes/gamedays";
import standingsRouter from "./routes/standings";
import hallOfFameRouter from "./routes/hallOfFame";
import pushRouter from "./routes/push";

export function createApp() {
  const app = express();

  app.use(cors({ origin: config.corsOrigin, credentials: true }));
  app.use(express.json());
  app.use(optionalAuth);

  app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

  app.use("/api/auth", authRouter);
  app.use("/api/admin/users", adminUsersRouter);
  app.use("/api/admin/players", adminPlayersRouter);
  app.use("/api/admin/invites", adminInvitesRouter);
  app.use("/api/invites", invitesRouter);
  app.use("/api/guests", guestsRouter);
  app.use("/api/players", playersRouter);
  app.use("/api/gamedays", gamedaysRouter);
  app.use("/api/seasons", standingsRouter);
  app.use("/api/hall-of-fame", hallOfFameRouter);
  app.use("/api/push", pushRouter);

  app.use((_req, _res, next) => next(ApiError.notFound("Route not found")));

  // Central error handler
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ApiError) {
      return res.status(err.status).json({ error: err.message, details: err.details });
    }
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  });

  return app;
}
