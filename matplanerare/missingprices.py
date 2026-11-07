import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
IGNORE = {"vatten", "isvatten", "kranvatten"}  # kostar ingenting


def find_price(name, prices):
    best = None
    for k in prices:
        if k in name and (best is None or len(k) > len(best)):
            best = k
    return best


def main():
    top = int(sys.argv[1]) if len(sys.argv) > 1 else 60
    recipes = json.loads((ROOT / "matplanerare" / "dataRecipies.json").read_text(encoding="utf-8"))
    prices = json.loads((ROOT / "matplanerare" / "dataPrice.json").read_text(encoding="utf-8"))

    in_recipes = Counter()      # ingrediens -> antal recept den finns i
    units = defaultdict(Counter)  # ingrediens -> vanliga enheter
    for r in recipes:
        seen = set()
        for ing in r["ingredients"]:
            name = ing["name"]
            if name in IGNORE or find_price(name, prices):
                continue
            if name not in seen:
                in_recipes[name] += 1
                seen.add(name)
            units[name][ing["unit"] or "st"] += 1

    total = len(recipes)
    covered = sum(
        all(i["name"] in IGNORE or find_price(i["name"], prices) for i in r["ingredients"])
        for r in recipes
    )
    print(f"{total} recept. {covered} av dem har pris på alla ingredienser.")
    print(f"{len(in_recipes)} olika ingredienser saknar pris. Mest förekommande:\n")

    todo = {}
    for name, n in in_recipes.most_common(top):
        unit = units[name].most_common(1)[0][0]
        print(f"{n:4d} recept  {name}   (vanligaste enhet: {unit})")
        todo[name] = {"price": 0, "per": "st" if unit == "st" else ("l" if unit in ("l", "dl", "cl", "ml", "msk", "tsk", "krm") else "kg")}

    out = ROOT / "matplanerare" / "dataPrice.json"
    out.write_text(json.dumps(todo, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\nMall sparad i {out}. Fyll i price (kr per kg, liter eller styck) och klistra in raderna i data/prices.json.")


if __name__ == "__main__":
    main()