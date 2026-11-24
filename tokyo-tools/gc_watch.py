#!/usr/bin/env python3
# gc_watch.py - GreenCloud stock & announcement watcher (runs on Tokyo node-us)
import html as htmllib
import json, os, re, sys, urllib.request

BASE = os.path.dirname(os.path.abspath(__file__))
STATE = os.path.join(BASE, "state.json")
TOPIC = open(os.path.join(BASE, "topic.txt")).read().strip()
PAGES = {
    "Budget KVM Sale": "https://greencloudvps.com/billing/store/budget-kvm-sale",
    "Premium KVM Sale": "https://greencloudvps.com/billing/store/premium-kvm-sale",
}
ANN_URL = "https://greencloudvps.com/billing/announcements"
UA = {"User-Agent": "Mozilla/5.0"}
APAC_KEYS = ("JP", "HK", "SG", "TOKYO", "IIJ", "SOFTBANK", "HONG", "SINGAPORE", "TYO", "OSAKA")

def fetch(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=40) as r:
        return r.read().decode("utf-8", "ignore")

def parse_products(page):
    out = {}
    names = list(re.finditer(r'id="product\d+-name">([^<]+)</span>', page))
    for i, m in enumerate(names):
        end = names[i + 1].start() if i + 1 < len(names) else len(page)
        seg = page[m.end():end]
        q = re.search(r'class="qty">\s*(\d+)\s*Available', seg)
        if q:
            out[m.group(1).strip()] = int(q.group(1))
    return out

def parse_categories(page):
    return set(re.findall(r'store/([a-z0-9][a-z0-9-]*)', page))

def parse_headings(page):
    out = set()
    for raw in re.findall(r'<h[23][^>]*>(.*?)</h[23]>', page, re.S):
        text = re.sub(r'<[^>]+>', '', raw)
        text = htmllib.unescape(re.sub(r'\s+', ' ', text)).strip()
        if 4 <= len(text) <= 120:
            out.add(text)
    return out

def notify(title, message):
    data = json.dumps({"topic": TOPIC, "title": title, "message": message}).encode()
    req = urllib.request.Request("https://ntfy.sh/", data=data, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.status

def is_apac(name):
    u = name.upper()
    return any(k in u for k in APAC_KEYS)

def main():
    if "--test" in sys.argv:
        print(notify("greencloud-alert", "TEST canary: gc_watch chain test from Tokyo, please ignore."))
        return
    state = {"products": {}, "cats": [], "annh": [], "baseline": False}
    if os.path.exists(STATE):
        with open(STATE) as f:
            state = json.load(f)
    merged_new = {}
    cats_new = set()
    ok = True
    for label, url in PAGES.items():
        try:
            page = fetch(url)
            if "just a moment" in page.lower() or len(page) < 20000:
                ok = False
                continue
            for k, v in parse_products(page).items():
                merged_new[k] = v
            cats_new |= parse_categories(page)
        except Exception:
            ok = False
    annh_new = None
    try:
        apage = fetch(ANN_URL)
        if "just a moment" not in apage.lower() and len(apage) > 10000:
            annh_new = parse_headings(apage)
    except Exception:
        annh_new = None
    if not ok:
        return
    if not state.get("baseline"):
        state["products"] = merged_new
        state["cats"] = sorted(cats_new)
        state["annh"] = sorted(annh_new) if annh_new else []
        state["baseline"] = True
        with open(STATE, "w") as f:
            json.dump(state, f)
        apac = {k: v for k, v in merged_new.items() if is_apac(k)}
        lines = ["GreenCloud watch baseline established.", "APAC-related stock:"]
        for k in sorted(apac):
            lines.append(k + ": " + str(apac[k]))
        lines.append("Total products: " + str(len(merged_new)) + ", categories: " + str(len(state["cats"])))
        notify("greencloud-baseline", "\n".join(lines))
        return
    alerts = []
    merged_old = state.get("products", {})
    for name, qty in sorted(merged_new.items()):
        old = merged_old.get(name)
        if old is None:
            alerts.append("NEW PLAN: " + name + " (stock " + str(qty) + ")")
        elif old == 0 and qty > 0 and is_apac(name):
            alerts.append("APAC RESTOCK: " + name + " now has " + str(qty) + " available")
    state["products"] = merged_new
    old_cats = set(state.get("cats", []))
    if not old_cats:
        state["cats"] = sorted(cats_new)
    else:
        fresh_cats = sorted(cats_new - old_cats)
        for c in fresh_cats:
            alerts.append("NEW STORE CATEGORY: " + c + " (possible new promotion)")
        state["cats"] = sorted(cats_new)
    if annh_new is not None:
        old_annh = set(state.get("annh", []))
        if not old_annh:
            state["annh"] = sorted(annh_new)
        else:
            fresh_h = sorted(annh_new - old_annh)
            for h in fresh_h[:5]:
                alerts.append("NEW ANNOUNCEMENT HEADING: " + h)
            state["annh"] = sorted(annh_new)
    with open(STATE, "w") as f:
        json.dump(state, f)
    if alerts:
        notify("greencloud-alert", "GreenCloud watch:\n" + "\n".join(alerts) + "\nStore: https://greencloudvps.com/billing/store")

if __name__ == "__main__":
    main()
