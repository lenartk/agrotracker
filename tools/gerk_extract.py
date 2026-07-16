#!/usr/bin/env python3
"""Izvleček GERK-ov za KMG-MID iz uradnega javnega izvoza → GeoJSON za AgroTracker.

Uporaba:
    pip install pyshp pyproj
    python3 tools/gerk_extract.py 123456789 [-o moje-parcele.geojson]

Prenese uradni izvoz vseh GERK-ov (~208 MB zip, enkratno — cache v ~/.cache),
filtrira po KMG_MID, reproicira D96/TM (EPSG:3794) → WGS84 in zapiše GeoJSON,
ki ga uvoziš v AgroTracker (Nastavitve → Uvozi GeoJSON).

Podatki: MKGP javni izvoz (OPSI). GERK grafični podatki so javni.
"""
import argparse
import io
import json
import os
import sys
import urllib.request
import zipfile

GERK_ZIP_URL = "https://rkg.gov.si/razno/portal_analysis/GERK_RKG_30jun_2025.zip"
CACHE = os.path.expanduser("~/.cache/agrotracker")


def download(url: str, dest: str):
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    if os.path.exists(dest) and os.path.getsize(dest) > 1_000_000:
        print(f"Cache: {dest}")
        return dest
    print(f"Prenašam {url} (~200 MB, enkratno) ...")

    def hook(n, bs, total):
        if total > 0 and n % 50 == 0:
            print(f"  {n * bs / 1e6:.0f}/{total / 1e6:.0f} MB", end="\r")

    urllib.request.urlretrieve(url, dest, reporthook=hook)
    print()
    return dest


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("kmg_mid", help="KMG-MID številka kmetije (9 mest)")
    ap.add_argument("-o", "--out", default=None, help="izhodna GeoJSON datoteka")
    ap.add_argument("--obmocje-km", type=float, default=0, metavar="KM",
                    help="poleg tvojih izvozi VSE GERK-e v radiju KM okoli kmetije "
                         "(GERK knjižnica za 'dodaj GERK tukaj' v aplikaciji)")
    args = ap.parse_args()

    try:
        import shapefile  # pyshp
        from pyproj import Transformer
    except ImportError:
        sys.exit("Namesti odvisnosti: pip install pyshp pyproj")

    zpath = download(GERK_ZIP_URL, os.path.join(CACHE, os.path.basename(GERK_ZIP_URL)))

    zf = zipfile.ZipFile(zpath)
    shp_name = next(n for n in zf.namelist() if n.lower().endswith(".shp"))
    base = shp_name[:-4]
    print(f"Berem {shp_name} ...")
    r = shapefile.Reader(
        shp=io.BytesIO(zf.read(base + ".shp")),
        dbf=io.BytesIO(zf.read(base + ".dbf")),
        shx=io.BytesIO(zf.read(base + ".shx")),
    )
    fields = [f[0] for f in r.fields[1:]]
    print(f"Atributi: {fields}")

    def fidx(*names):
        for n in names:
            for i, f in enumerate(fields):
                if f.upper() == n:
                    return i
        return None

    i_mid = fidx("KMG_MID")
    if i_mid is None:
        sys.exit(f"KMG_MID atributa ni med {fields}")
    i_pid = fidx("GERK_PID")
    i_ime = fidx("DOMACE_IME", "IME")
    i_raba = fidx("RABA_ID", "SIFRA_RABE", "RABA")
    i_pov = fidx("POV_GERK", "POVRSINA", "AREA")

    want = str(args.kmg_mid).strip()
    tr = Transformer.from_crs("EPSG:3794", "EPSG:4326", always_xy=True)

    # 1. prehod: bbox-i tvojih GERK-ov (za center območja pri --obmocje-km)
    center = None
    if args.obmocje_km > 0:
        boxes = [sr.shape.bbox for sr in r.iterShapeRecords()
                 if str(sr.record[i_mid]).strip() == want]
        if not boxes:
            sys.exit(f"Ni GERK-ov za KMG-MID {want} — preveri številko.")
        cx = sum((b[0] + b[2]) / 2 for b in boxes) / len(boxes)
        cy = sum((b[1] + b[3]) / 2 for b in boxes) / len(boxes)
        center = (cx, cy)
        rm = args.obmocje_km * 1000
        print(f"Območje: {args.obmocje_km} km okoli kmetije (D96 center {cx:.0f},{cy:.0f})")

    feats = []
    for sr in r.iterShapeRecords():
        rec = sr.record
        mine = str(rec[i_mid]).strip() == want
        if not mine:
            if center is None:
                continue
            b = sr.shape.bbox
            bx, by = (b[0] + b[2]) / 2, (b[1] + b[3]) / 2
            if (bx - center[0]) ** 2 + (by - center[1]) ** 2 > rm * rm:
                continue
        shp = sr.shape.__geo_interface__
        # reprojekcija vseh koordinat
        def rp(coords):
            if isinstance(coords[0], (int, float)):
                x, y = tr.transform(coords[0], coords[1])
                return [round(x, 7), round(y, 7)]
            return [rp(c) for c in coords]

        geom = {"type": shp["type"], "coordinates": rp(list(shp["coordinates"]))}
        pid = rec[i_pid] if i_pid is not None else None
        ime = (rec[i_ime] or "").strip() if i_ime is not None else ""
        pov = rec[i_pov] if i_pov is not None else None
        props = {
            "name": ime or (f"GERK {pid}" if pid else "GERK"),
            "GERK_PID": pid,
            "KMG_MID": str(rec[i_mid]).strip(),
        }
        if i_raba is not None:
            props["RABA_ID"] = rec[i_raba]
        if pov:
            try:
                props["ha"] = round(float(pov) / 10000.0, 4)  # m2 -> ha
            except (TypeError, ValueError):
                pass
        feats.append({"type": "Feature", "properties": props, "geometry": geom})

    if not feats:
        sys.exit(f"Ni GERK-ov za KMG-MID {want} — preveri številko.")

    mine_n = sum(1 for f in feats if f["properties"]["KMG_MID"] == want)
    out = args.out or (f"gerk-obmocje-{want}.geojson" if center else f"gerki-{want}.geojson")
    with open(out, "w", encoding="utf-8") as f:
        json.dump({"type": "FeatureCollection", "features": feats}, f, ensure_ascii=False)
    tot = sum(f["properties"].get("ha", 0) for f in feats if f["properties"]["KMG_MID"] == want)
    print(f"OK: {len(feats)} GERK-ov (tvojih {mine_n}, {tot:.2f} ha) -> {out}")
    if center:
        print("Uvozi v AgroTracker: Nastavitve -> Uvozi GERK območje (vpiši KMG-MID prej)")
    else:
        print("Uvozi v AgroTracker: Nastavitve -> Uvozi navaden GeoJSON")


if __name__ == "__main__":
    main()
