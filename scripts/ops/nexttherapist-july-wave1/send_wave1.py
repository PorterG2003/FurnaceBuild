#!/usr/bin/env python3
"""
Wave 1 reminder send — NextTherapist July Training.

Queues in-thread reply jobs only (never send-now). Default is dry-run.

Usage:
  python3 send_wave1.py --group B --dry-run
  python3 send_wave1.py --group B --live
  python3 send_wave1.py --group A --dry-run --suppress-csv /path/to/registrants.csv
  python3 send_wave1.py --group A --live --suppress-csv /path/to/registrants.csv

Env:
  FURNACE_API_KEY   required for lead fetch + live queue
  FURNACE_API_BASE  default https://api.getfurnace.io/v1
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

ACCOUNT_ID = "8fe822e5-fccc-4799-ba5f-08232765fb73"
CAMPAIGN_ID = "7548f6de-f2a1-4e30-b005-f3dc71186829"
EVENT_LINK = (
    "https://nexttherapist.com/events/"
    "navigating-ethical-dilemmas-through-slow-thinking-and-self-reflection-pt-1/"
)

DEFAULT_CSV = {
    "A": Path("/Users/porter/Downloads/wave1_A_reminder.csv"),
    "B": Path("/Users/porter/Downloads/wave1_B_never_got_link.csv"),
}

# Known registrants under a different address (from handoff).
ALWAYS_SUPPRESS_EMAILS = {
    "carli.slade@gmail.com",
    "levi.n.josefsson@gmail.com",
}

DIR = Path(__file__).resolve().parent


def tidy(raw: str | None) -> str | None:
    """Normalize campaign first_name for greeting."""
    if raw is None:
        return None
    text = " ".join(str(raw).split()).strip()
    if not text:
        return None
    parts = text.split(" ")
    # Drop a repeated leading token ("Daniel Daniel" -> "Daniel").
    while len(parts) >= 2 and parts[0].casefold() == parts[1].casefold():
        parts = parts[1:]
    token = parts[0]
    if "'" in token or "-" in token:
        segs = []
        buf = ""
        for ch in token:
            if ch in "'-":
                segs.append(buf)
                segs.append(ch)
                buf = ""
            else:
                buf += ch
        segs.append(buf)
        out = []
        for seg in segs:
            if seg in "'-":
                out.append(seg)
            elif not seg:
                continue
            elif seg.isupper() or seg.islower():
                out.append(seg[:1].upper() + seg[1:].lower())
            else:
                out.append(seg)
        return "".join(out)
    if token.isupper() or token.islower():
        return token[:1].upper() + token[1:].lower()
    return token


def template_a(first: str) -> str:
    return (
        f"Hi {first},<br><br>"
        "I'm not seeing your registration for Friday yet:<br><br>"
        f'<a href="{EVENT_LINK}">{EVENT_LINK}</a><br><br>'
        "Can't make 9am? Register anyway for the recording.<br><br>"
        "Take Care!<br><br>"
        "Stephanie Sonntag<br><br>"
        "Founder and Chief Therapist @ NextTherapist"
    )


def template_b(first: str) -> str:
    return (
        f"Hi {first},<br><br>"
        "Sorry for the slow reply, here's that registration link:<br><br>"
        f'<a href="{EVENT_LINK}">{EVENT_LINK}</a><br><br>'
        "It's this Friday, August 7th at 9am.<br><br>"
        "If that time doesn't work, register anyway and you'll get the recording.<br><br>"
        "Take Care!<br><br>"
        "Stephanie Sonntag<br><br>"
        "Founder and Chief Therapist @ NextTherapist"
    )


def api_base() -> str:
    return os.environ.get("FURNACE_API_BASE", "https://api.getfurnace.io/v1").rstrip("/")


def api_key() -> str:
    key = (os.environ.get("FURNACE_API_KEY") or "").strip()
    if not key:
        raise SystemExit("FURNACE_API_KEY is required")
    return key


def request_json(method: str, path: str, body: dict[str, Any] | None = None) -> Any:
    url = f"{api_base()}{path}"
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {api_key()}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"{method} {path} -> HTTP {exc.code}: {detail}") from exc


def load_rows(csv_path: Path) -> list[dict[str, str]]:
    with csv_path.open(newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def load_suppress_emails(path: Path | None) -> set[str]:
    emails = set(ALWAYS_SUPPRESS_EMAILS)
    if path is None:
        return emails
    with path.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        fields = [c.lower() for c in (reader.fieldnames or [])]
        # Prefer explicit email-ish columns.
        email_keys = [c for c in (reader.fieldnames or []) if "email" in c.lower()]
        if not email_keys and reader.fieldnames:
            email_keys = [reader.fieldnames[0]]
        for row in reader:
            for key in email_keys:
                val = (row.get(key) or "").strip().lower()
                if val and "@" in val:
                    emails.add(val)
    return emails


def load_sendlog(path: Path) -> dict[str, dict[str, str]]:
    if not path.exists():
        return {}
    with path.open(newline="", encoding="utf-8") as f:
        return {row["thread_id"]: row for row in csv.DictReader(f) if row.get("thread_id")}


def append_sendlog(path: Path, row: dict[str, str]) -> None:
    exists = path.exists()
    fieldnames = [
        "lead_email",
        "thread_id",
        "lead_id",
        "first_name",
        "status",
        "job_id",
        "error",
        "body_html",
    ]
    with path.open("a", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        if not exists:
            writer.writeheader()
        writer.writerow(row)


def resolve_first_name(
    lead_id: str,
    names_cache: dict[str, dict[str, Any]],
    *,
    allow_api: bool,
) -> tuple[str | None, str]:
    """Return (tidy_first, source). source is first_name|name|skip."""
    cached = names_cache.get(lead_id)
    if cached is None:
        if not allow_api:
            raise RuntimeError(f"lead {lead_id} missing from --names-cache and API disabled")
        payload = request_json("GET", f"/campaigns/{CAMPAIGN_ID}/leads/{lead_id}")
        data = payload.get("data") if isinstance(payload, dict) else payload
        cached = data if isinstance(data, dict) else {}
        names_cache[lead_id] = cached

    first = tidy(cached.get("first_name"))
    if first:
        return first, "first_name"
    fallback = tidy(cached.get("name"))
    if fallback:
        return fallback, "name"
    return None, "skip"


def build_body(group: str, first: str) -> str:
    return template_a(first) if group == "A" else template_b(first)


def main() -> int:
    parser = argparse.ArgumentParser(description="NextTherapist July Training wave 1 send")
    parser.add_argument("--group", choices=["A", "B"], required=True)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--dry-run", action="store_true")
    mode.add_argument("--live", action="store_true")
    parser.add_argument("--csv", type=Path, default=None, help="Override input CSV path")
    parser.add_argument(
        "--suppress-csv",
        type=Path,
        default=None,
        help="Registrant export CSV (email column) to exclude — required for safe Group A",
    )
    parser.add_argument("--sleep-ms", type=int, default=250)
    parser.add_argument(
        "--names-cache",
        type=Path,
        default=None,
        help="Optional JSON map lead_id -> {first_name,name} to avoid API fetches",
    )
    parser.add_argument(
        "--bodies-out",
        type=Path,
        default=None,
        help="Write rendered bodies (markdown) for review",
    )
    parser.add_argument("--limit", type=int, default=0, help="Process only first N rows (0=all)")
    args = parser.parse_args()

    if args.live and args.group == "A" and args.suppress_csv is None:
        raise SystemExit(
            "Refusing Group A --live without --suppress-csv (fresh registrant re-diff required)"
        )

    csv_path = args.csv or DEFAULT_CSV[args.group]
    if not csv_path.exists():
        raise SystemExit(f"CSV not found: {csv_path}")

    suppress = load_suppress_emails(args.suppress_csv)
    rows = load_rows(csv_path)
    if args.limit and args.limit > 0:
        rows = rows[: args.limit]

    sendlog_path = DIR / f"sendlog_{args.group}.csv"
    prior = load_sendlog(sendlog_path)

    names_cache: dict[str, dict[str, Any]] = {}
    if args.names_cache and args.names_cache.exists():
        names_cache = json.loads(args.names_cache.read_text(encoding="utf-8"))

    # Live always needs API. Dry-run can run fully offline when --names-cache is complete.
    allow_api = bool(args.live) or not names_cache
    if allow_api and not (os.environ.get("FURNACE_API_KEY") or "").strip():
        if args.live:
            raise SystemExit("FURNACE_API_KEY is required for --live")
        if not names_cache:
            raise SystemExit(
                "Dry-run needs FURNACE_API_KEY or a complete --names-cache JSON "
                "(lead_id -> {first_name, name})"
            )

    bodies_lines: list[str] = []
    stats = {"queued": 0, "skipped": 0, "failed": 0, "dry": 0}

    print(
        f"group={args.group} mode={'live' if args.live else 'dry-run'} "
        f"rows={len(rows)} suppress={len(suppress)} csv={csv_path}"
    )

    for i, row in enumerate(rows, start=1):
        lead_email = (row.get("lead_email") or "").strip()
        thread_id = (row.get("thread_id") or "").strip()
        lead_id = (row.get("lead_id") or "").strip()
        email_key = lead_email.lower()

        if not thread_id or not lead_id:
            append_sendlog(
                sendlog_path,
                {
                    "lead_email": lead_email,
                    "thread_id": thread_id,
                    "lead_id": lead_id,
                    "first_name": "",
                    "status": "skipped",
                    "job_id": "",
                    "error": "missing thread_id or lead_id",
                    "body_html": "",
                },
            )
            stats["skipped"] += 1
            continue

        if email_key in suppress:
            append_sendlog(
                sendlog_path,
                {
                    "lead_email": lead_email,
                    "thread_id": thread_id,
                    "lead_id": lead_id,
                    "first_name": "",
                    "status": "skipped",
                    "job_id": "",
                    "error": "suppressed_registrant",
                    "body_html": "",
                },
            )
            stats["skipped"] += 1
            print(f"[{i}/{len(rows)}] SKIP suppress {lead_email}")
            continue

        prev = prior.get(thread_id)
        if prev and prev.get("status") == "queued" and prev.get("job_id"):
            stats["skipped"] += 1
            print(f"[{i}/{len(rows)}] SKIP already queued {lead_email} job={prev.get('job_id')}")
            continue

        try:
            first, source = resolve_first_name(lead_id, names_cache, allow_api=allow_api)
        except Exception as exc:  # noqa: BLE001
            append_sendlog(
                sendlog_path,
                {
                    "lead_email": lead_email,
                    "thread_id": thread_id,
                    "lead_id": lead_id,
                    "first_name": "",
                    "status": "failed",
                    "job_id": "",
                    "error": f"lead_fetch: {exc}",
                    "body_html": "",
                },
            )
            stats["failed"] += 1
            print(f"[{i}/{len(rows)}] FAIL lead fetch {lead_email}: {exc}")
            continue

        if not first:
            append_sendlog(
                sendlog_path,
                {
                    "lead_email": lead_email,
                    "thread_id": thread_id,
                    "lead_id": lead_id,
                    "first_name": "",
                    "status": "skipped",
                    "job_id": "",
                    "error": "empty_first_name",
                    "body_html": "",
                },
            )
            stats["skipped"] += 1
            print(f"[{i}/{len(rows)}] SKIP empty name {lead_email}")
            continue

        body_html = build_body(args.group, first)
        bodies_lines.append(
            f"## {i}. {lead_email} ({first} via {source})\n"
            f"- thread: `{thread_id}`\n"
            f"- mailbox: `{row.get('sending_mailbox', '')}`\n\n"
            f"{body_html}\n\n---\n"
        )

        if args.dry_run:
            append_sendlog(
                sendlog_path,
                {
                    "lead_email": lead_email,
                    "thread_id": thread_id,
                    "lead_id": lead_id,
                    "first_name": first,
                    "status": "dry_run",
                    "job_id": "",
                    "error": "",
                    "body_html": body_html,
                },
            )
            stats["dry"] += 1
            print(f"[{i}/{len(rows)}] DRY {lead_email} -> Hi {first},")
            continue

        # Live: create reply job only — never send-now.
        try:
            payload = request_json(
                "POST",
                f"/threads/{thread_id}/reply",
                {"body_html": body_html},
            )
            job_id = ""
            if isinstance(payload, dict):
                data = payload.get("data")
                if isinstance(data, dict):
                    job_id = str(data.get("id") or "")
                elif isinstance(data, str):
                    job_id = data
            if not job_id:
                raise RuntimeError(f"unexpected reply response: {payload}")
            append_sendlog(
                sendlog_path,
                {
                    "lead_email": lead_email,
                    "thread_id": thread_id,
                    "lead_id": lead_id,
                    "first_name": first,
                    "status": "queued",
                    "job_id": job_id,
                    "error": "",
                    "body_html": body_html,
                },
            )
            prior[thread_id] = {"status": "queued", "job_id": job_id}
            stats["queued"] += 1
            print(f"[{i}/{len(rows)}] QUEUED {lead_email} job={job_id}")
        except Exception as exc:  # noqa: BLE001
            append_sendlog(
                sendlog_path,
                {
                    "lead_email": lead_email,
                    "thread_id": thread_id,
                    "lead_id": lead_id,
                    "first_name": first,
                    "status": "failed",
                    "job_id": "",
                    "error": str(exc),
                    "body_html": body_html,
                },
            )
            stats["failed"] += 1
            print(f"[{i}/{len(rows)}] FAIL queue {lead_email}: {exc}")

        if args.sleep_ms > 0:
            time.sleep(args.sleep_ms / 1000.0)

    bodies_out = args.bodies_out or (DIR / f"dryrun_{args.group}_bodies.md")
    bodies_out.write_text("\n".join(bodies_lines), encoding="utf-8")
    cache_out = DIR / f"names_cache_{args.group}.json"
    cache_out.write_text(json.dumps(names_cache, indent=2), encoding="utf-8")

    print(f"stats={stats}")
    print(f"sendlog={sendlog_path}")
    print(f"bodies={bodies_out}")
    print(f"names_cache={cache_out}")
    return 1 if stats["failed"] else 0


if __name__ == "__main__":
    sys.exit(main())
