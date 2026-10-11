#!/usr/bin/env python3
"""Sync derived template files from SOURCE-OF-TRUTH.md sections."""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path


BEGIN_RE = re.compile(r"^## BEGIN (.+?)\s*$")
END_RE = re.compile(r"^## END (.+?)\s*$")


def parse_sections(text: str) -> dict[str, str]:
    sections: dict[str, list[str]] = {}
    current_name: str | None = None
    buffer: list[str] = []

    for line in text.splitlines():
        begin_match = BEGIN_RE.match(line)
        end_match = END_RE.match(line)

        if begin_match:
            if current_name is not None:
                raise ValueError(f"Nested BEGIN detected: {current_name}")
            current_name = begin_match.group(1).strip()
            if current_name in sections:
                raise ValueError(f"Duplicate section: {current_name}")
            buffer = []
            continue

        if end_match:
            end_name = end_match.group(1).strip()
            if current_name is None:
                raise ValueError(f"END without BEGIN: {end_name}")
            if end_name != current_name:
                raise ValueError(f"END mismatch: expected {current_name}, got {end_name}")

            # Trim a single leading/trailing empty line to avoid accidental padding.
            if buffer and buffer[0] == "":
                buffer = buffer[1:]
            if buffer and buffer[-1] == "":
                buffer = buffer[:-1]

            sections[current_name] = buffer
            current_name = None
            buffer = []
            continue

        if current_name is not None:
            buffer.append(line)

    if current_name is not None:
        raise ValueError(f"Unclosed section: {current_name}")

    return {name: "\n".join(lines) + "\n" for name, lines in sections.items()}


def main() -> int:
    parser = argparse.ArgumentParser(description="Sync files from SOURCE-OF-TRUTH.md sections")
    parser.add_argument(
        "--source",
        help="Path to SOURCE-OF-TRUTH.md (default: alongside this script)",
        default=None,
    )
    parser.add_argument(
        "--output-dir",
        help="Directory to write derived files (default: alongside source file)",
        default=None,
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print planned writes without modifying files",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="Fail when a derived file is missing or differs from its source section",
    )
    parser.add_argument(
        "--list",
        action="store_true",
        help="List detected sections and exit",
    )
    args = parser.parse_args()

    script_dir = Path(__file__).resolve().parent
    source_path = Path(args.source) if args.source else script_dir / "SOURCE-OF-TRUTH.md"
    if not source_path.exists():
        print(f"Source file not found: {source_path}", file=sys.stderr)
        return 2

    output_dir = Path(args.output_dir) if args.output_dir else source_path.parent

    text = source_path.read_text(encoding="utf-8")
    sections = parse_sections(text)

    if args.list:
        for name in sorted(sections.keys()):
            print(name)
        return 0

    if args.dry_run and args.check:
        parser.error("--dry-run and --check are mutually exclusive")

    if not sections:
        print("No sections found.", file=sys.stderr)
        return 2

    stale_targets: list[Path] = []
    for name, content in sections.items():
        target_path = output_dir / name
        if args.check:
            if not target_path.exists() or target_path.read_text(encoding="utf-8") != content:
                stale_targets.append(target_path)
            continue
        if args.dry_run:
            print(f"[DRY RUN] Would write {target_path}")
            continue

        target_path.parent.mkdir(parents=True, exist_ok=True)
        target_path.write_text(content, encoding="utf-8")
        print(f"Wrote {target_path}")

    if args.check:
        if stale_targets:
            for target_path in stale_targets:
                print(f"STALE: {target_path}", file=sys.stderr)
            print("Run sync-source-of-truth.py to regenerate derived files.", file=sys.stderr)
            return 1
        print(f"All {len(sections)} derived files are current in {output_dir}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
