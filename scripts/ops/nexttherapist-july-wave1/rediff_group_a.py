#!/usr/bin/env python3
"""
Re-diff Group A against a fresh registrant export.

Writes:
  wave1_A_after_rediff.csv   — remaining sendable rows
  wave1_A_suppressed.csv     — rows removed by the export / always-suppress

Usage:
  python3 rediff_group_a.py --registrants /path/to/fresh_export.csv
"""

from __future__ import annotations

import argparse
import csv
from pathlib import Path

from send_wave1 import ALWAYS_SUPPRESS_EMAILS, DEFAULT_CSV, load_rows, load_suppress_emails

DIR = Path(__file__).resolve().parent


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--registrants", type=Path, required=True)
    parser.add_argument("--input", type=Path, default=DEFAULT_CSV["A"])
    parser.add_argument("--out-keep", type=Path, default=DIR / "wave1_A_after_rediff.csv")
    parser.add_argument("--out-drop", type=Path, default=DIR / "wave1_A_suppressed.csv")
    args = parser.parse_args()

    if not args.registrants.exists():
        raise SystemExit(f"Registrant export not found: {args.registrants}")

    suppress = load_suppress_emails(args.registrants)
    rows = load_rows(args.input)
    keep: list[dict[str, str]] = []
    drop: list[dict[str, str]] = []
    for row in rows:
        email = (row.get("lead_email") or "").strip().lower()
        if email in suppress:
            reason = (
                "always_suppress_alt_email"
                if email in ALWAYS_SUPPRESS_EMAILS
                else "registrant_export"
            )
            drop.append({**row, "suppress_reason": reason})
        else:
            keep.append(row)

    fieldnames = list(rows[0].keys()) if rows else [
        "lead_email",
        "thread_id",
        "lead_id",
        "sending_mailbox",
        "replied_yes_at",
        "last_outbound_at",
    ]
    with args.out_keep.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        w.writerows(keep)
    with args.out_drop.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=[*fieldnames, "suppress_reason"])
        w.writeheader()
        w.writerows(drop)

    print(f"input={len(rows)} keep={len(keep)} drop={len(drop)} suppress_emails={len(suppress)}")
    print(f"keep_csv={args.out_keep}")
    print(f"drop_csv={args.out_drop}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
