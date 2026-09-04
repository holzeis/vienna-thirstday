import { Router } from "express";
import { db } from "../db/client";
import { players } from "../db/schema";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middleware/auth";
import { asyncHandler } from "../utils/asyncHandler";

const router = Router();

router.use(requireAuth);

/** List all registered (non-guest) players - used for admin team assignment, guest pickers, etc. */
router.get(
  "/",
  asyncHandler(async (_req, res) => {
    const all = await db.query.players.findMany({
      where: eq(players.isGuest, false),
      orderBy: (p, { asc }) => asc(p.name),
    });
    res.json({ players: all });
  })
);

export default router;
