"""
Cartharsis — a fake-shopping dopamine app.
Flask backend: serves the UI and a LIVE product catalog (real product images)
sourced from the free DummyJSON product API — the whole catalog, refreshed on a TTL,
with a rotating "Trending now" feed so the app updates like a real store.

Run:
    pip install -r requirements.txt
    python app.py
    open http://localhost:5000
"""
import hashlib
import json
import os
import random
import threading
import time

import requests
from flask import Flask, jsonify, render_template, request

app = Flask(__name__)

# ---- config ----
API = "https://dummyjson.com/products/category/{cat}"
GROCERY_CAT = "groceries"
# (dummyjson category slug, department label shown as a chip)
STORE_CATS = [
    ("smartphones", "📱 Phones"),
    ("laptops", "💻 Laptops"),
    ("tablets", "📱 Tablets"),
    ("mobile-accessories", "🎧 Accessories"),
    ("mens-watches", "⌚ Watches"),
    ("womens-watches", "⌚ Watches"),
    ("sunglasses", "🕶️ Eyewear"),
    ("fragrances", "🧴 Fragrance"),
    ("beauty", "💄 Beauty"),
    ("skin-care", "✨ Skincare"),
    ("mens-shoes", "👟 Footwear"),
    ("womens-shoes", "👟 Footwear"),
    ("mens-shirts", "👕 Fashion"),
    ("tops", "👕 Fashion"),
    ("womens-dresses", "👕 Fashion"),
    ("womens-bags", "👜 Bags"),
    ("womens-jewellery", "💍 Jewellery"),
    ("sports-accessories", "🏅 Sports"),
    ("home-decoration", "🏠 Home"),
    ("kitchen-accessories", "🍳 Kitchen"),
    ("furniture", "🛋️ Furniture"),
]
GROCERY_RATE = 20     # USD -> INR (small, so daily items feel Indian-real)
STORE_RATE = 83       # USD -> INR
CACHE_TTL = 120       # seconds; how long the fetched catalog is cached ("live"-ish)

_cache = {"data": None, "ts": 0.0}
_building = {"flag": False}
_QUOTA_OUT = {"flag": False}   # set when RapidAPI says the monthly quota is exhausted
CACHE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "amazon_cache.json")
DISK_TTL = 6 * 3600   # reuse the saved Amazon catalog for 6 hours (no re-fetch on restart)


def _save_disk(data):
    try:
        with open(CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump({"ts": time.time(), "data": data}, f)
    except Exception:
        pass


def _load_disk():
    try:
        with open(CACHE_FILE, encoding="utf-8") as f:
            obj = json.load(f)
        if time.time() - obj.get("ts", 0) < DISK_TTL and (obj.get("data") or {}).get("store"):
            return obj["data"]
    except Exception:
        pass
    return None

# ---- Amazon (real live products, incl. iPhone 18) via RapidAPI ----
# To turn this ON: create a free RapidAPI account, subscribe to the
# "Real-Time Amazon Data" API, copy your key, then before running:
#     set RAPIDAPI_KEY=your_key_here   (Windows)   /   export RAPIDAPI_KEY=... (mac/linux)
# With no key, the app uses DummyJSON (works out of the box).
# For PRODUCTION use Amazon's official Product Advertising API (PA-API 5.0) via an
# approved Amazon Associates account — that also gives you the affiliate links (revenue).
def _load_api_key():
    """Key from env var RAPIDAPI_KEY, else the first real line of rapidapi_key.txt."""
    k = os.environ.get("RAPIDAPI_KEY", "").strip()
    if k:
        return k
    try:
        path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "rapidapi_key.txt")
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#"):
                    return line
    except Exception:
        pass
    return ""


RAPIDAPI_KEY = _load_api_key()
RAPIDAPI_HOST = os.environ.get("RAPIDAPI_HOST", "real-time-amazon-data.p.rapidapi.com").strip()
if RAPIDAPI_KEY:
    CACHE_TTL = 1800  # Amazon: refetch at most every 30 min to protect free-tier quota
                      # (Trending still reshuffles on every request from the cache = live feel)
AMZ_COUNTRY = os.environ.get("AMZ_COUNTRY", "IN").strip()
# search query -> department label (shown as a chip)
AMZ_QUERIES = [
    ("iPhone 18", "📱 Phones"),
    ("laptop", "💻 Laptops"),
    ("smartwatch", "⌚ Watches"),
    ("wireless earbuds", "🎧 Accessories"),
    ("running shoes", "👟 Footwear"),
    ("perfume", "🧴 Fragrance"),
    ("sunglasses", "🕶️ Eyewear"),
    ("backpack", "👜 Bags"),
]
# Quick (10-min) grocery search -> (query, category, pack size). Amazon also does fast grocery.
AMZ_QUICK = [
    ("fresh milk", "Dairy & Eggs", "1 L"),
    ("bananas fresh fruit", "Fresh", "6 pcs"),
    ("brown bread", "Snacks", "400 g"),
    ("farm eggs", "Dairy & Eggs", "6 pcs"),
    ("dark chocolate", "Snacks", "100 g"),
    ("lays potato chips", "Snacks", "52 g"),
    ("coca cola soft drink", "Drinks", "750 ml"),
    ("maggi noodles", "Instant", "4 pack"),
    ("amul butter", "Dairy & Eggs", "100 g"),
    ("basmati rice", "Kitchen", "1 kg"),
]


# ---- helpers ----
def _round5(n):
    return int(round(n / 5.0) * 5)


def inr(usd, rate):
    return max(5, _round5(usd * rate))


def mrp_of(price_inr, disc):
    if disc and disc > 0:
        return _round5(price_inr / (1 - disc / 100.0))
    return price_inr


def kfmt(n):
    return f"{n / 1000:.1f}k" if n >= 1000 else str(n)


def reviews_for(title):
    h = int(hashlib.md5(title.encode("utf-8")).hexdigest(), 16)
    return kfmt(800 + h % 22000)


def fetch_json(url, tries=3):
    for i in range(tries):
        try:
            r = requests.get(url, timeout=20)
            r.raise_for_status()
            return r.json()
        except Exception:
            time.sleep(0.5 * (i + 1))
    return None


def quick_qty(title):
    t = title.lower()
    if any(w in t for w in ["milk", "juice", "water", "oil", "drink"]):
        return "1 L"
    if "egg" in t:
        return "6 pcs"
    if any(w in t for w in ["rice", "powder", "onion", "potato", "flour"]):
        return "1 kg"
    if "ice cream" in t:
        return "700 ml"
    if "honey" in t:
        return "250 g"
    if any(w in t for w in ["coffee", "chocolate"]):
        return "100 g"
    if any(w in t for w in ["apple", "kiwi", "lemon", "strawberry", "mulberry",
                            "cucumber", "pepper", "steak", "meat", "fish", "chicken", "beef"]):
        return "500 g"
    if "tissue" in t:
        return "1 box"
    return "1 pack"


def quick_cat(title):
    t = title.lower()
    if any(w in t for w in ["apple", "kiwi", "lemon", "strawberry", "mulberry",
                            "cucumber", "pepper", "onion", "potato"]):
        return "Fresh"
    if any(w in t for w in ["milk", "egg", "honey"]):
        return "Dairy & Eggs"
    if any(w in t for w in ["juice", "soft drink", "water", "coffee", "nescafe"]):
        return "Drinks"
    if any(w in t for w in ["steak", "meat", "fish", "chicken", "beef", "oil", "rice", "protein"]):
        return "Kitchen"
    if any(w in t for w in ["cat food", "dog food", "tissue"]):
        return "Home"
    return "Snacks"


def map_quick(p):
    price = inr(p.get("price", 1), GROCERY_RATE)
    return {
        "id": p.get("id"),
        "name": p.get("title", ""),
        "price": price,
        "mrp": mrp_of(price, p.get("discountPercentage", 0)),
        "qty": quick_qty(p.get("title", "")),
        "cat": quick_cat(p.get("title", "")),
        "image": p.get("thumbnail"),
    }


def map_store(p, dept):
    price = inr(p.get("price", 1), STORE_RATE)
    return {
        "id": p.get("id"),
        "name": p.get("title", ""),
        "price": price,
        "mrp": mrp_of(price, p.get("discountPercentage", 0)),
        "rating": round(p.get("rating", 4.2), 1),
        "reviews": reviews_for(p.get("title", "")),
        "image": p.get("thumbnail"),
        "dept": dept,
    }


def _parse_price(txt):
    """'₹1,44,900.00' or '$999.99' -> 144900 (int)."""
    if not txt:
        return 0
    digits = "".join(ch for ch in str(txt).split(".")[0] if ch.isdigit())
    return int(digits) if digits else 0


def fetch_amazon(query, dept):
    url = f"https://{RAPIDAPI_HOST}/search"
    headers = {"X-RapidAPI-Key": RAPIDAPI_KEY, "X-RapidAPI-Host": RAPIDAPI_HOST}
    params = {"query": query, "country": AMZ_COUNTRY, "page": "1"}
    products = None
    for attempt in range(2):
        try:
            r = requests.get(url, headers=headers, params=params, timeout=25)
            if r.status_code == 429:
                if "monthly quota" in r.text.lower():
                    _QUOTA_OUT["flag"] = True    # exhausted for the month — stop trying
                    return []
                time.sleep(2.0)                  # transient rate limit → one retry
                continue
            r.raise_for_status()
            products = (r.json().get("data") or {}).get("products") or []
            break
        except Exception:
            time.sleep(0.8)
    if not products:
        return []
    out = []
    for p in products[:16]:
        price = _parse_price(p.get("product_price"))
        mrp = _parse_price(p.get("product_original_price")) or price
        if not price:
            continue
        out.append({
            "id": p.get("asin"),
            "name": p.get("product_title", ""),
            "price": price,
            "mrp": max(mrp, price),
            "rating": round(float(p.get("product_star_rating") or 4.2), 1),
            "reviews": kfmt(int(p.get("product_num_ratings") or 0)) if p.get("product_num_ratings") else "",
            "image": p.get("product_photo"),
            "dept": dept,
            "url": p.get("product_url"),   # affiliate link goes here in production
        })
    return out


def fetch_amazon_quick(query, cat, qty):
    out = []
    for it in fetch_amazon(query, cat)[:3]:
        out.append({
            "id": it["id"], "name": it["name"], "price": it["price"], "mrp": it["mrp"],
            "qty": qty, "cat": cat, "image": it["image"],
        })
    return out


def build_catalog_amazon():
    """Store from live Amazon (RapidAPI). Quick uses grocery data (this Amazon API
    doesn't return grocery/Fresh results — those need Amazon Fresh / a quick-commerce feed)."""
    sel = "select=title,price,discountPercentage,rating,thumbnail,stock"
    quick = []
    g = fetch_json(f"{API.format(cat=GROCERY_CAT)}?limit=0&{sel}")
    if g and g.get("products"):
        quick = [map_quick(p) for p in g["products"]]

    store, seen, depts = [], set(), []
    for query, dept in AMZ_QUERIES:
        if _QUOTA_OUT["flag"]:
            break
        got = fetch_amazon(query, dept)
        for it in got:
            if it["id"] in seen:
                continue
            seen.add(it["id"])
            store.append(it)
        if got and dept not in depts:
            depts.append(dept)
        time.sleep(1.5)   # space calls out so the burst doesn't trip the rate limit

    # NOTE: store may be empty if Amazon rate-limited us; the caller retries — we do
    # NOT silently fall back to DummyJSON here (that would show demo products as "Amazon").
    return {"quick": quick, "store": store, "depts": depts}


def build_catalog():
    """Pick the data source: live Amazon when a RapidAPI key is set, else DummyJSON."""
    if RAPIDAPI_KEY:
        return build_catalog_amazon()
    return build_catalog_dummyjson()


def build_catalog_dummyjson():
    sel = "select=title,price,discountPercentage,rating,thumbnail,stock"

    quick = []
    g = fetch_json(f"{API.format(cat=GROCERY_CAT)}?limit=0&{sel}")
    if g and g.get("products"):
        quick = [map_quick(p) for p in g["products"]]

    store, seen, depts = [], set(), []
    for slug, dept in STORE_CATS:
        d = fetch_json(f"{API.format(cat=slug)}?limit=0&{sel}")
        if d and d.get("products"):
            for p in d["products"]:
                if p.get("id") in seen:
                    continue
                seen.add(p.get("id"))
                store.append(map_store(p, dept))
            if dept not in depts:
                depts.append(dept)

    if not quick and not store:
        return FALLBACK
    return {"quick": quick, "store": store, "depts": depts}


def _kick_amazon_build(attempt=0):
    """Fetch the live Amazon catalog in the background, then swap it into the cache.
    If Amazon rate-limited us (empty store), retry a bit later — never blocks requests,
    never overwrites with demo data."""
    if not RAPIDAPI_KEY or _building["flag"]:
        return
    _building["flag"] = True

    def worker():
        got_it = False
        try:
            built = build_catalog_amazon()
            if built.get("store"):
                built["amazon"] = True
                _cache["data"], _cache["ts"] = built, time.time()
                _save_disk(built)   # persist so restarts don't re-fetch (saves quota)
                got_it = True
                print(f"[amazon] live catalog ready: store={len(built['store'])} depts={len(built['depts'])}", flush=True)
            else:
                # Amazon unavailable (quota/rate) → show the rich demo catalog so the app still works
                demo = build_catalog_dummyjson()
                demo["amazon"] = False
                _cache["data"], _cache["ts"] = demo, time.time()
                print("[amazon] unavailable -> showing demo catalog", flush=True)
        except Exception as e:
            print(f"[amazon] build error: {e}", flush=True)
        finally:
            _building["flag"] = False
        # retry only for a transient rate limit — never for an exhausted monthly quota
        if not got_it and not _QUOTA_OUT["flag"] and attempt < 5:
            print(f"[amazon] rate-limited, retrying in 45s (attempt {attempt + 1})", flush=True)
            threading.Timer(45, lambda: _kick_amazon_build(attempt + 1)).start()

    threading.Thread(target=worker, daemon=True).start()


def get_base():
    """Serve instantly, then let live Amazon fill in in the background."""
    if os.environ.get("CARTHARSIS_OFFLINE_DEMO") == "1":
        return FALLBACK
    now = time.time()
    if _cache["data"] is None:
        disk = _load_disk() if RAPIDAPI_KEY else None
        if disk:                                   # reuse yesterday's fetch — instant, no quota
            _cache["data"], _cache["ts"] = disk, now
        elif RAPIDAPI_KEY:
            # Quick (grocery) loads now; Store arrives from live Amazon in a moment.
            sel = "select=title,price,discountPercentage,rating,thumbnail,stock"
            g = fetch_json(f"{API.format(cat=GROCERY_CAT)}?limit=0&{sel}")
            quick = [map_quick(p) for p in g["products"]] if g and g.get("products") else []
            _cache["data"], _cache["ts"] = {"quick": quick, "store": [], "depts": []}, now
            _kick_amazon_build()
        else:
            _cache["data"], _cache["ts"] = build_catalog_dummyjson(), now
    elif RAPIDAPI_KEY and (now - _cache["ts"]) > CACHE_TTL:
        _kick_amazon_build()
    return _cache["data"]


def build_trending(store):
    """Rotating trending feed: top-rated items, reshuffled every request → feels live."""
    pool = [dict(s) for s in store if s.get("rating", 0) >= 4.5]
    if len(pool) < 12:
        pool = [dict(s) for s in store]
    random.shuffle(pool)
    picks = pool[:16]
    for i, it in enumerate(picks):
        it["trending"] = True
        it["rank"] = i + 1
    return picks


# Minimal offline fallback (real DummyJSON CDN images) if the API is unreachable.
FALLBACK = {
    "quick": [
        {"id": 1, "name": "Apple", "price": 40, "mrp": 45, "qty": "500 g", "cat": "Fresh",
         "image": "https://cdn.dummyjson.com/product-images/groceries/apple/thumbnail.webp"},
        {"id": 2, "name": "Milk", "price": 35, "mrp": 40, "qty": "1 L", "cat": "Dairy & Eggs",
         "image": "https://cdn.dummyjson.com/product-images/groceries/milk/thumbnail.webp"},
    ],
    "store": [], "depts": [],
}


# ---- routes ----
@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/catalog")
def api_catalog():
    base = get_base()
    return jsonify({
        "quick": base.get("quick", []),
        "store": base.get("store", []),
        "depts": base.get("depts", []),
        "trending": build_trending(base.get("store", [])),
        "updated": int(time.time()),
        "live": bool(base.get("amazon")),
        "quota_out": _QUOTA_OUT["flag"],
    })


def search_dummyjson(q):
    sel = "select=title,price,discountPercentage,rating,thumbnail,stock"
    d = fetch_json(f"https://dummyjson.com/products/search?q={q}&limit=24&{sel}")
    if not d or not d.get("products"):
        return []
    return [map_store(p, "🔎 Search") for p in d["products"]]


@app.route("/api/search")
def api_search():
    q = (request.args.get("q") or "").strip()
    if not q:
        return jsonify({"results": [], "q": q, "live": bool(RAPIDAPI_KEY)})
    if RAPIDAPI_KEY:
        results = fetch_amazon(q, "🔎 Search")
        if not results:                     # quota/err → fall back to demo search
            results = search_dummyjson(q)
    else:
        results = search_dummyjson(q)
    return jsonify({"results": results, "q": q, "live": bool(RAPIDAPI_KEY)})


@app.route("/api/refresh")
def api_refresh():
    _cache["ts"] = 0.0
    base = get_base()
    return jsonify({"ok": True, "quick": len(base.get("quick", [])), "store": len(base.get("store", []))})


if __name__ == "__main__":
    if RAPIDAPI_KEY:
        print("Catalog: Quick now, LIVE Amazon store loading in the background…")
    else:
        print("Catalog source: DummyJSON (no API key set)")
    get_base()
    print("Cartharsis running -> http://localhost:5000")
    app.run(host="0.0.0.0", port=5000, debug=False, use_reloader=False)
