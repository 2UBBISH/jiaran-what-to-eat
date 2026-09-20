#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Validate the generated data in ``source_pic/`` without extra dependencies.

Run:
    python3 tools/validate_menu_data.py

Checks reference integrity, index consistency, price sanity, source-image
existence, the derived files (dishes/canteens/cuisines.json + menu_data.js) and
the JSON-Schema-ish structure of schema.json. Exits non-zero on any failure.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE_DIR = ROOT / "source_pic"

problems: list[str] = []
checks = 0


def check(condition: bool, message: str) -> None:
    global checks
    checks += 1
    if not condition:
        problems.append(message)


def load(name: str):
    path = SOURCE_DIR / name
    check(path.exists(), f"{name}: missing")
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:  # pragma: no cover
        problems.append(f"{name}: invalid JSON ({exc})")
        return None


def main() -> int:
    data = load("menu_data.json")
    if data is None:
        print("FAILED to load menu_data.json")
        return 1

    dishes = data["dishes"]
    canteens = data["canteens"]
    cuisines = data["cuisines"]
    indexes = data["indexes"]
    taxonomy = data["taxonomy"]

    canteen_ids = [c["id"] for c in canteens]
    cuisine_ids = {c["id"] for c in taxonomy["cuisines"]}
    review_ids = {r["id"] for r in taxonomy["reviewLevels"]}
    tag_ids = {t["id"] for t in taxonomy["tags"]}
    tag_names = {t["name"] for t in taxonomy["tags"]}
    slot_ids = {s["id"] for s in taxonomy["mealSlots"]}
    tier_ids = {t["id"] for t in taxonomy["priceTiers"]}
    floor_ids = {f["id"] for f in taxonomy["floors"]}
    review_weight = {r["id"]: r["drawWeight"] for r in taxonomy["reviewLevels"]}
    excluded = {r["id"]: r["excludedByDefault"] for r in taxonomy["reviewLevels"]}

    # ---- uniqueness -----------------------------------------------------
    dish_ids = [d["id"] for d in dishes]
    check(len(dish_ids) == len(set(dish_ids)), "dish ids are not unique")
    check(len(canteen_ids) == len(set(canteen_ids)), "canteen ids are not unique")
    cuisine_list = [c["id"] for c in cuisines]
    check(len(cuisine_list) == len(set(cuisine_list)), "cuisine ids are not unique")

    # ---- per-dish integrity ---------------------------------------------
    id_pattern = re.compile(r"^[a-z0-9_]+-[0-9]{2}$")
    for dish in dishes:
        did = dish["id"]
        check(bool(id_pattern.match(did)), f"{did}: id does not match canteen-NN pattern")
        check(dish["canteenId"] in canteen_ids, f"{did}: unknown canteenId {dish['canteenId']}")
        check(did.startswith(dish["canteenId"] + "-"), f"{did}: id prefix != canteenId")
        check(dish["type"] in ("dish", "stall_recommendation"), f"{did}: bad type")
        for cuisine in dish["cuisines"]:
            check(cuisine in cuisine_ids, f"{did}: unknown cuisine {cuisine}")
        if dish["cuisines"]:
            check(dish["primaryCuisine"] == dish["cuisines"][0], f"{did}: primaryCuisine mismatch")
        else:
            check(dish["primaryCuisine"] is None, f"{did}: primaryCuisine should be null")
        for tag in dish["tags"]:
            check(tag in tag_names, f"{did}: unknown tag {tag}")
        check(dish["reviewLevel"] in review_ids, f"{did}: unknown reviewLevel")
        check(dish["drawWeight"] == review_weight[dish["reviewLevel"]],
              f"{did}: drawWeight != taxonomy value")
        check(dish["excludedByDefault"] == excluded[dish["reviewLevel"]],
              f"{did}: excludedByDefault != taxonomy value")
        check(0 <= dish["spicyLevel"] <= 3, f"{did}: spicyLevel out of range")
        for slot in dish["mealSlots"]:
            check(slot in slot_ids, f"{did}: unknown mealSlot {slot}")
        check(dish["priceTier"] is None or dish["priceTier"] in tier_ids,
              f"{did}: unknown priceTier")
        price = dish["price"]
        check(price["currency"] == "CNY", f"{did}: currency != CNY")
        low, high = price["min"], price["max"]
        check(not (low is not None and high is not None and low > high),
              f"{did}: price.min > price.max")
        check(not (low is None and high is None) or price["text"] is None
              or bool(re.search(r"[^\d]", price["text"])),
              f"{did}: price text has digits but no parsed amount")
        if dish["floor"] is not None:
            check(dish["floor"] in floor_ids, f"{did}: unknown floor {dish['floor']}")
            check(dish["floorId"] == f"{dish['canteenId']}-{dish['floor'].lower()}",
                  f"{did}: floorId mismatch")
            check(dish["floorSource"] in ("section", "window"), f"{did}: bad floorSource")
        else:
            check(dish["floorId"] is None, f"{did}: floorId should be null")
            check(dish["floorSource"] is None, f"{did}: floorSource should be null")
        source = dish["source"]
        check((SOURCE_DIR / source["image"]).exists(),
              f"{did}: source image missing ({source['image']})")
        check(bool(re.match(r"^\d+/\d+$", source["page"])), f"{did}: bad source page")
        check(dish["type"] != "stall_recommendation" or not dish["excludedByDefault"],
              f"{did}: stall recommendation should not be excluded")

    # ---- canteen view ---------------------------------------------------
    def drawable(dish):
        return dish["type"] != "stall_recommendation" and not dish["excludedByDefault"]

    for canteen in canteens:
        own = [d for d in dishes if d["canteenId"] == canteen["id"]]
        check(canteen["dishCount"] == len(own), f"{canteen['id']}: dishCount mismatch")
        check(canteen["dishCount"] > 0, f"{canteen['id']}: canteen has no dishes")
        own_drawable = [d for d in own if drawable(d)]
        check(canteen["drawableDishCount"] == len(own_drawable),
              f"{canteen['id']}: drawableDishCount mismatch")
        check(canteen["drawWeight"] == sum(d["drawWeight"] for d in own_drawable),
              f"{canteen['id']}: canteen drawWeight mismatch")
        floors = canteen["floors"]
        check(sum(f["dishCount"] for f in floors) + canteen["unassignedFloorDishCount"]
              == canteen["dishCount"], f"{canteen['id']}: floor counts do not add up")
        for floor in floors:
            floor_dishes = [d for d in own if d["floor"] == floor["floor"]]
            check(floor["dishCount"] == len(floor_dishes),
                  f"{floor['id']}: floor dishCount mismatch")
            floor_drawable = [d for d in floor_dishes if drawable(d)]
            check(floor["drawableDishCount"] == len(floor_drawable),
                  f"{floor['id']}: floor drawableDishCount mismatch")
            check(floor["drawWeight"] == sum(d["drawWeight"] for d in floor_drawable),
                  f"{floor['id']}: floor drawWeight mismatch")

    # ---- cuisine view / indexes ----------------------------------------
    for cuisine in cuisines:
        expected = sorted(d["id"] for d in dishes if cuisine["id"] in d["cuisines"])
        check(sorted(cuisine["dishIds"]) == expected,
              f"{cuisine['id']}: dishIds mismatch")

    def regroup(key_fn):
        out: dict[str, list[str]] = {}
        for dish in dishes:
            for key in key_fn(dish):
                if key is None:
                    continue
                out.setdefault(key, []).append(dish["id"])
        return out

    expected_indexes = {
        "byCanteen": regroup(lambda d: [d["canteenId"]]),
        "byFloor": regroup(lambda d: [d["floorId"]]),
        "byCuisine": regroup(lambda d: d["cuisines"]),
        "byTag": regroup(lambda d: d["tags"]),
        "byReviewLevel": regroup(lambda d: [d["reviewLevel"]]),
        "byPriceTier": regroup(lambda d: [d["priceTier"]]),
        "byMealSlot": regroup(lambda d: d["mealSlots"]),
        "bySpicyLevel": regroup(lambda d: [f"L{d['spicyLevel']}"]),
    }
    for name, expected in expected_indexes.items():
        check(sorted(indexes[name]) == sorted(expected),
              f"indexes.{name}: key sets differ")
        for key, ids in expected.items():
            check(sorted(indexes[name].get(key, [])) == sorted(ids),
                  f"indexes.{name}.{key}: ids differ")

    check(sum(len(v) for v in indexes["byCuisine"].values())
          == sum(len(d["cuisines"]) for d in dishes),
          "byCuisine index does not cover every cuisine tag once")

    # ---- tags taxonomy unused check -------------------------------------
    used_tags = {t for d in dishes for t in d["tags"]}
    unused = sorted(tag_names - used_tags)
    check(not unused, f"taxonomy.tags entries never used: {unused}")

    # ---- derived files agree --------------------------------------------
    derived_dishes = load("dishes.json")
    check(derived_dishes == dishes, "dishes.json differs from menu_data.dishes")
    derived_canteens = load("canteens.json")
    check(derived_canteens == canteens, "canteens.json differs from menu_data.canteens")
    derived_cuisines = load("cuisines.json")
    check(derived_cuisines == cuisines, "cuisines.json differs from menu_data.cuisines")

    js_path = SOURCE_DIR / "menu_data.js"
    if js_path.exists():
        body = js_path.read_text(encoding="utf-8")
        match = re.search(r"module\.exports\s*=\s*(\{.*\})\s*$", body, re.S)
        check(match is not None, "menu_data.js: cannot find module.exports payload")
        if match:
            try:
                check(json.loads(match.group(1)) == data,
                      "menu_data.js payload differs from menu_data.json")
            except json.JSONDecodeError as exc:
                problems.append(f"menu_data.js: payload is not valid JSON ({exc})")
    else:
        problems.append("menu_data.js: missing")

    # ---- schema sanity ---------------------------------------------------
    schema = load("schema.json")
    if schema:
        props = schema.get("properties", {})
        check(schema.get("$schema", "").startswith("https://json-schema.org/"),
              "schema.json: unexpected $schema")
        check({"meta", "taxonomy", "canteens", "cuisines", "dishes", "indexes", "draw"}
              <= set(props), "schema.json: missing top-level properties")
        dish_required = set(props["dishes"]["items"]["required"])
        check({"id", "name", "canteenId", "cuisines", "price", "reviewLevel",
               "drawWeight", "source"} <= dish_required,
              "schema.json: dishes required fields incomplete")
        for dish in dishes:
            for key in dish_required:
                check(key in dish, f"{dish['id']}: missing schema-required field {key}")

    # ---- draw.js presence ------------------------------------------------
    check((SOURCE_DIR / "draw.js").exists(), "draw.js: missing")

    # ---- report ----------------------------------------------------------
    stats = data["meta"]["stats"]
    print(f"checked {checks} assertions over {stats['dishCount']} dishes, "
          f"{stats['canteenCount']} canteens, {stats['cuisineCount']} cuisines")
    if problems:
        print(f"\nFAILED with {len(problems)} problem(s):")
        for problem in problems[:40]:
            print("  -", problem)
        if len(problems) > 40:
            print(f"  ... and {len(problems) - 40} more")
        return 1
    print("OK: all integrity checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
