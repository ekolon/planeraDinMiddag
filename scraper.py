import json
import re
import sys
import time
from pathlib import Path
from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "." / "dataRecipies.json"
#EXTRA_URLS = ROOT / "scraper" / "urls.txt"  # egna recept-URL:er, en per rad (valfritt)

# Kategorisidor: tagg -> URL. Varje recept får de taggar för de listor det finns i.
# Ändra siffran i pageSize om du vill ha fler eller färre recept per lista.
CATEGORIES = {
    "middag": "https://www.ica.se/recept/middag/?pageSize=100",
    "under-30": "https://www.ica.se/recept/middag/under-30-minuter/?pageSize=100",
    "fisk": "https://www.ica.se/recept/fisk/middag/?pageSize=100",
    "kott": "https://www.ica.se/recept/kott/middag/?pageSize=100",
    "fagel": "https://www.ica.se/recept/fagel/middag/?pageSize=100",
}
DELAY = 1.5  # sekunder mellan sidor, var snäll mot servern
RECIPE_PATH = re.compile(r"^/recept/[^/]+-\d+/?$")  # t.ex. /recept/kottbullar-722216/

UNITS = "kg|hg|g|dl|cl|ml|l|msk|tsk|krm|förp|burk|paket|st"
ING_RE = re.compile(
    r"^\s*(?P<amount>\d+\s+\d+/\d+|\d+/\d+|\d+(?:[.,]\d+)?)?\s*"
    rf"(?:(?P<unit>{UNITS})(?=[\s.]))?\.?\s*(?P<name>.+?)\s*$",
    re.IGNORECASE,
)


def to_float(s):
    """'1 1/2' -> 1.5, '1,5' -> 1.5, '1/2' -> 0.5"""
    if not s:
        return None
    total = 0.0
    for part in s.replace(",", ".").split():
        if "/" in part:
            a, b = part.split("/")
            total += float(a) / float(b)
        else:
            total += float(part)
    return total


def parse_ingredient(raw):
    m = ING_RE.match(raw)
    if not m:
        return {"raw": raw, "amount": None, "unit": "", "name": raw.lower()}
    return {
        "raw": raw,
        "amount": to_float(m.group("amount")),
        "unit": (m.group("unit") or "").lower(),
        "name": m.group("name").lower(),
    }


def parse_minutes(iso):
    """'PT1H30M' -> 90"""
    if not iso:
        return None
    h = re.search(r"(\d+)H", iso)
    m = re.search(r"(\d+)M", iso)
    return (int(h.group(1)) * 60 if h else 0) + (int(m.group(1)) if m else 0)


def first_int(value):
    if isinstance(value, list):
        value = value[0] if value else None
    m = re.search(r"\d+", str(value or ""))
    return int(m.group()) if m else None


def find_recipe_jsonld(soup):
    for tag in soup.find_all("script", type="application/ld+json"):
        try:
            data = json.loads(tag.string or "")
        except json.JSONDecodeError:
            continue
        items = data if isinstance(data, list) else data.get("@graph", [data])
        for item in items:
            t = item.get("@type")
            if t == "Recipe" or (isinstance(t, list) and "Recipe" in t):
                return item
    return None


def get_image(item):
    img = item.get("image")
    if isinstance(img, list):
        img = img[0] if img else None
    if isinstance(img, dict):
        img = img.get("url")
    return img


def scrape_recipe(page, url):
    resp = page.goto(url, wait_until="domcontentloaded", timeout=30000)
    if resp is None or resp.status != 200:
        raise RuntimeError(f"HTTP {resp.status if resp else '?'}")
    item = find_recipe_jsonld(BeautifulSoup(page.content(), "html.parser"))
    if not item:
        return None
    # Vi sparar bara ingredienser och metadata, inte instruktionerna. Länka till ICA för tillagning.
    return {
        "url": url,
        "name": item.get("name"),
        "image": get_image(item),
        "servings": first_int(item.get("recipeYield")) or 4,
        "minutes": parse_minutes(item.get("totalTime")),
        "ingredients": [parse_ingredient(i) for i in item.get("recipeIngredient", [])],
    }


def collect_links(page, category_url):
    resp = page.goto(category_url, wait_until="domcontentloaded", timeout=30000)
    if resp is None or resp.status != 200:
        raise RuntimeError(f"HTTP {resp.status if resp else '?'}")
    page.wait_for_timeout(2000)
    for _ in range(4):  # scrolla för att ladda fler recept om sidan laddar dem dynamiskt
        page.mouse.wheel(0, 4000)
        page.wait_for_timeout(1000)
    hrefs = page.eval_on_selector_all("a[href]", "els => els.map(e => e.href)")
    links = set()
    for h in hrefs:
        full = urljoin(category_url, h)
        if RECIPE_PATH.match(urlparse(full).path):
            links.add(full.split("?")[0])
    return links


def main():
    max_new = int(sys.argv[1]) if len(sys.argv) > 1 else 40
    OUT.parent.mkdir(exist_ok=True)
    recipes = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else []
    # Ta bort exempelrecepten från första gången
    recipes = [r for r in recipes if r.get("url") != "#"]
    known = {r["url"] for r in recipes}

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()

        tags = {}  # url -> {taggar}
        for tag, cat in CATEGORIES.items():
            try:
                found = collect_links(page, cat)
                print(f"{tag}: hittade {len(found)} receptlänkar")
                for u in found:
                    tags.setdefault(u, set()).add(tag)
            except Exception as e:
                print(f"Kunde inte hämta {tag} ({cat}): {e}")
            time.sleep(DELAY)
        if EXTRA_URLS.exists():
            for u in EXTRA_URLS.read_text().splitlines():
                if u.strip():
                    tags.setdefault(u.strip(), set())

        # Uppdatera taggar på recept du redan har, utan att hämta om dem
        for r in recipes:
            r["tags"] = sorted(set(r.get("tags", [])) | tags.get(r["url"], set()))

        new = [u for u in sorted(tags) if u not in known][:max_new]
        for i, url in enumerate(new, 1):
            try:
                rec = scrape_recipe(page, url)
                if rec and rec["ingredients"]:
                    rec["tags"] = sorted(tags[url])
                    recipes.append(rec)
                    print(f"[{i}/{len(new)}] OK  {rec['name']}")
                else:
                    print(f"[{i}/{len(new)}] inget recept hittades: {url}")
            except Exception as e:
                print(f"[{i}/{len(new)}] fel: {url} ({e})")
            time.sleep(DELAY)
        browser.close()

    OUT.write_text(json.dumps(recipes, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"Klart. {len(recipes)} recept sparade i {OUT}")


if __name__ == "__main__":
    main()
