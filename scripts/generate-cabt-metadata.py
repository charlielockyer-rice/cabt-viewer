#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import json
import sys
from dataclasses import asdict, is_dataclass
from enum import IntEnum
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate CABT viewer metadata from the provided engine and card CSV.",
    )
    parser.add_argument(
        "--card-csv",
        type=Path,
        default=ROOT.parent / "agent-lab" / "data" / "EN_Card_Data.csv",
        help="Path to EN_Card_Data.csv.",
    )
    parser.add_argument(
        "--sample-submission",
        type=Path,
        default=ROOT.parent / "agent-lab" / "official" / "sample_submission",
        help="Path to the Kaggle sample_submission directory containing cg/.",
    )
    parser.add_argument(
        "--out-dir",
        type=Path,
        default=ROOT / "src" / "lib" / "cabt",
        help="Directory for cardData.generated.json and attackData.generated.json.",
    )
    return parser.parse_args()


def jsonable(value: Any) -> Any:
    if is_dataclass(value):
        return {key: jsonable(item) for key, item in asdict(value).items()}
    if isinstance(value, IntEnum):
        return int(value)
    if isinstance(value, list):
        return [jsonable(item) for item in value]
    if isinstance(value, dict):
        return {key: jsonable(item) for key, item in value.items()}
    return value


def nullable_int(value: str | None) -> int | None:
    if value is None:
        return None
    cleaned = value.strip()
    if not cleaned or cleaned.lower() == "n/a":
        return None
    return int(cleaned)


def nullable_text(value: str | None) -> str:
    if value is None:
        return ""
    cleaned = value.strip()
    return "" if cleaned.lower() == "n/a" else cleaned


def load_csv_rows(path: Path) -> dict[int, dict[str, Any]]:
    rows: dict[int, dict[str, Any]] = {}
    with path.open("r", encoding="utf-8-sig", newline="") as file:
        for row in csv.DictReader(file):
            card_id = int(row["Card ID"])
            rows[card_id] = {
                "id": card_id,
                "name": nullable_text(row["Card Name"]),
                "set": nullable_text(row["Expansion"]),
                "setNumber": nullable_text(row["Collection No."]),
                "kind": nullable_text(row["Stage (Pokémon)/Type (Energy and Trainer)"]),
                "rule": nullable_text(row["Rule"]) or "n/a",
                "evolvesFrom": nullable_text(row["Previous stage"]),
                "hp": nullable_int(row["HP"]),
                "type": nullable_text(row["Type"]),
                "retreat": nullable_int(row["Retreat"]),
                "attackName": nullable_text(row["Move Name"]),
                "attackCost": nullable_text(row["Cost"]),
                "attackDamage": nullable_text(row["Damage"]),
                "attackText": nullable_text(row["Effect Explanation"]),
            }
    return rows


def load_engine_metadata(sample_submission: Path) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    sys.path.insert(0, str(sample_submission.resolve()))
    from cg.api import all_attack, all_card_data  # type: ignore

    cards = [jsonable(card) for card in all_card_data()]
    attacks = [jsonable(attack) for attack in all_attack()]
    return cards, attacks


def merge_card_rows(engine_cards: list[dict[str, Any]], csv_rows: dict[int, dict[str, Any]]) -> list[dict[str, Any]]:
    merged: list[dict[str, Any]] = []
    for engine in engine_cards:
        card_id = int(engine["cardId"])
        csv_row = csv_rows.get(card_id)
        if csv_row:
            row = {
                **csv_row,
                "cardId": card_id,
                "cardType": engine["cardType"],
                "retreatCost": engine["retreatCost"],
                "weakness": engine["weakness"],
                "resistance": engine["resistance"],
                "energyType": engine["energyType"],
                "basic": engine["basic"],
                "stage1": engine["stage1"],
                "stage2": engine["stage2"],
                "ex": engine["ex"],
                "megaEx": engine["megaEx"],
                "tera": engine["tera"],
                "aceSpec": engine["aceSpec"],
                "engineEvolvesFrom": engine["evolvesFrom"],
                "skills": engine["skills"],
                "attacks": engine["attacks"],
            }
        else:
            row = {
                "id": card_id,
                "name": engine["name"],
                "set": "",
                "setNumber": "",
                "kind": "",
                "rule": "n/a",
                "evolvesFrom": engine["evolvesFrom"] or "",
                "hp": engine["hp"] or None,
                "type": "",
                "retreat": engine["retreatCost"] or None,
                "attackName": "",
                "attackCost": "",
                "attackDamage": "",
                "attackText": "",
                **engine,
            }
        merged.append(row)
    return merged


def write_json(path: Path, value: Any) -> None:
    path.write_text(
        json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )


def main() -> None:
    args = parse_args()
    if not args.card_csv.exists():
        raise FileNotFoundError(f"Card CSV not found: {args.card_csv}")
    if not (args.sample_submission / "cg").exists():
        raise FileNotFoundError(f"sample_submission/cg not found: {args.sample_submission}")

    csv_rows = load_csv_rows(args.card_csv)
    engine_cards, attacks = load_engine_metadata(args.sample_submission)
    cards = merge_card_rows(engine_cards, csv_rows)

    args.out_dir.mkdir(parents=True, exist_ok=True)
    write_json(args.out_dir / "cardData.generated.json", cards)
    write_json(args.out_dir / "attackData.generated.json", attacks)

    csv_only = len(set(csv_rows) - {int(card["cardId"]) for card in engine_cards})
    print(f"Wrote {len(cards)} CABT-supported cards to {args.out_dir / 'cardData.generated.json'}")
    print(f"Wrote {len(attacks)} CABT attacks to {args.out_dir / 'attackData.generated.json'}")
    print(f"Ignored {csv_only} unique CSV card IDs not reported by cg.api.all_card_data()")


if __name__ == "__main__":
    main()
