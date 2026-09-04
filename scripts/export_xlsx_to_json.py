#!/usr/bin/env python3
"""
Exports the legacy "Kicken_2026.xlsx" spreadsheet (Ergebnisse sheet) into a JSON
file the backend's historical-data importer can load.

The original spreadsheet recorded, per player per matchday, the exact POINTS
(4 win / 2 draw / 1 loss) and GOAL DIFFERENCE for that player. We preserve
those two numbers per player exactly (no recomputation), so the season
standings reconstructed from this import match the original spreadsheet's
table exactly. We additionally group players into team A (points == 4, or the
first half of a draw) / team B (points == 1, or the second half of a draw)
purely for display purposes - the legacy sheet never recorded actual team
rosters or the literal final score, so those are best-effort reconstructions
and are called out as such in the README.

Usage:
    python3 export_xlsx_to_json.py /path/to/Kicken_2026.xlsx /path/to/output.json
"""
import json
import sys
from datetime import datetime

import openpyxl


def main():
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(1)

    xlsx_path, out_path = sys.argv[1], sys.argv[2]
    wb = openpyxl.load_workbook(xlsx_path, data_only=True)
    ws = wb["Ergebnisse 2026"]

    rows = list(ws.iter_rows(values_only=True))
    name_row = rows[2]  # row index 2 (0-based) has player names in the "P" column of each pair
    header_row = rows[3]  # 'Spieltag','Datum','P','T','P2','T2', ...

    # Map each column index whose header starts with 'P' (points) to the player name
    # found in the same column of name_row, and record the paired goal-diff column.
    player_columns = []  # list of (points_col_idx, goaldiff_col_idx, player_name)
    for col_idx, header in enumerate(header_row):
        if header is None:
            continue
        header_str = str(header)
        if header_str.startswith("P") and not header_str.startswith("Punkte"):
            name = name_row[col_idx]
            if name:
                player_columns.append((col_idx, col_idx + 1, str(name).strip()))

    players = sorted({name for _, _, name in player_columns})

    gamedays = []
    for row in rows[4:]:
        spieltag = row[0]
        raw_date = row[1]
        if spieltag is None or raw_date is None:
            continue
        if isinstance(raw_date, datetime):
            date_str = raw_date.date().isoformat()
        else:
            date_str = str(raw_date)

        entries = []  # {name, points, goalDiff}
        for points_col, goaldiff_col, name in player_columns:
            points = row[points_col] if points_col < len(row) else None
            gd = row[goaldiff_col] if goaldiff_col < len(row) else None
            if points is None:
                continue
            entries.append({"name": name, "points": int(points), "goalDiff": int(gd or 0)})

        if not entries:
            continue

        winners = [e for e in entries if e["points"] == 4]
        losers = [e for e in entries if e["points"] == 1]
        drawers = [e for e in entries if e["points"] not in (4, 1)]

        if winners or losers:
            team_a = winners
            team_b = losers
        else:
            half = len(drawers) // 2
            team_a = drawers[:half]
            team_b = drawers[half:]

        # Best-effort placeholder score for display only (standings use the
        # exact per-player points/goalDiff above, not this reconstructed score).
        placeholder_diff = max((abs(e["goalDiff"]) for e in winners), default=0)

        gamedays.append(
            {
                "spieltag": spieltag,
                "date": date_str,
                "teamA": [{"name": e["name"], "points": e["points"], "goalDiff": e["goalDiff"]} for e in team_a],
                "teamB": [{"name": e["name"], "points": e["points"], "goalDiff": e["goalDiff"]} for e in team_b],
                "placeholderScoreA": placeholder_diff,
                "placeholderScoreB": 0,
            }
        )

    output = {
        "source": xlsx_path,
        "exportedAt": datetime.utcnow().isoformat() + "Z",
        "players": players,
        "gamedays": gamedays,
    }

    with open(out_path, "w") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    print(f"Wrote {len(players)} players and {len(gamedays)} played gamedays to {out_path}")


if __name__ == "__main__":
    main()
