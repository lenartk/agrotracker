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

# Javni izvoz NE vsebuje KMG_MID (osebni podatek) — pripadnost GERK-ov kmetiji
# in koordinate kmetije dobimo iz javnega pregledovalnika (GWT-RPC, isti podatki
# kot jih pokaže iskalnik na rkg.gov.si). Hash-a sta vezana na verzijo viewerja
# (3.2.4) — ob nadgradnji ju je treba osvežiti (glej memory/gerk_dostop).
VIEWER = "https://rkg.gov.si/GERK/WebViewer/gerk_viewer/"
GWT_PERM = "AE55636071371C8B699A4CB6B49F9507"
LPIS_HASH = "81B888269E0E76A133B491FB0F3B6892"
WFS_HASH = "B4E500A77CF3E8A8D96F1ED7F9034D90"
GWT_B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789$_"


def gwt_long(n: int) -> str:
    """GWT long literal (big-endian base64 z GWT abecedo)."""
    if n == 0:
        return "A"
    out = ""
    while n:
        out = GWT_B64[n & 63] + out
        n >>= 6
    return out


def gwt_post(endpoint: str, body: str) -> str:
    req = urllib.request.Request(
        VIEWER + endpoint,
        data=body.encode(),
        headers={
            "Content-Type": "text/x-gwt-rpc; charset=utf-8",
            "x-gwt-permutation": GWT_PERM,
            "x-gwt-module-base": VIEWER,
        },
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8", "replace")


def kmg_lookup(mid: str):
    """Vrne (center_lnglat | None, set GERK_PID | None). Ob napaki (None, None)."""
    import re as _re

    center = None
    pids = None
    try:
        body = (f"7|0|5|{VIEWER}|{LPIS_HASH}|com.sinergise.mkgp.common.service.lpis.LpisService|"
                f"getKMGInfo|com.sinergise.mkgp.common.service.lpis.GetKMGInfoRequest/148358538|"
                f"1|2|3|4|1|5|5|{mid}|")
        resp = gwt_post("lpis", body)
        m = _re.search(r'"(\d+\.\d+),(\d+\.\d+)"', resp)
        if m:
            center = (float(m.group(1)), float(m.group(2)))  # lng, lat
    except Exception as e:
        print(f"  opozorilo: getKMGInfo ni uspel ({e})")
    try:
        lit = gwt_long(int(mid))
        body = ("7|0|41|" + VIEWER + "|" + WFS_HASH +
                "|com.sinergise.common.gis.ogc.wfs.WFSService|getFeature|"
                "com.sinergise.common.gis.ogc.wfs.request.WFSGetFeatureRequest/950524315|"
                "[Lcom.sinergise.common.gis.filter.FilterDescriptor;/1206055961|"
                "com.sinergise.common.gis.filter.ComparisonOperation/2460168433|"
                "com.sinergise.common.gis.filter.PropertyName/668160754|KMG_MID|"
                "com.sinergise.common.gis.filter.Literal/1711290897|"
                "com.sinergise.common.util.property.LongProperty/1311190425|"
                "java.lang.Long/4227064769|[Ljava.util.HashSet;/1212085963|"
                "java.util.HashSet/3273092938|com.sinergise.common.gis.ogc.OGCRequestContext/2457951422|"
                "com.sinergise.common.util.state.gwt.StateGWT/1610259815|"
                "java.util.LinkedHashMap/3008245022|java.lang.String/2004016611|__null_state_|true|"
                "java.util.HashMap/1797211028|com.sinergise.common.util.web.HttpMethod/96969396|"
                "REQUEST|GetFeature|SERVICE|WFS|VERSION|1.1|EXCEPTIONS|INIMAGE|LOCALE|sl|"
                "FEATURE_COUNT|1000|TYPENAME|GERK_SDO|PROPERTYNAME||SORTBY|MAXQUERYFEATURES|"
                "-2147483648|1|2|3|4|1|5|5|6|1|7|8|9|0|524288|10|11|12|" + lit +
                "|0|0|1|13|1|14|0|15|16|17|0|0|17|0|1|18|19|18|20|0|21|0|22|1|16|17|0|0|17|0|10|"
                "18|23|18|24|18|25|18|26|18|27|18|28|18|29|18|30|18|31|18|32|18|33|18|34|18|35|"
                "18|36|18|37|18|38|18|39|-36|18|40|18|41|0|")
        resp = gwt_post("wfs_rpc", body)
        cand = set(_re.findall(r'"(\d{4,9})"', resp))
        cand.discard(mid)
        if cand:
            pids = cand
    except Exception as e:
        print(f"  opozorilo: WFS poizvedba ni uspela ({e})")
    return center, pids


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
        encoding="cp1250", encodingErrors="replace",  # DBF je v srednjeevropskem kodiranju
    )
    fields = [f[0] for f in r.fields[1:]]
    print(f"Atributi: {fields}")

    def fidx(*names):
        for n in names:
            for i, f in enumerate(fields):
                if f.upper() == n:
                    return i
        return None

    i_pid = fidx("GERK_PID")
    if i_pid is None:
        sys.exit(f"GERK_PID atributa ni med {fields}")
    i_ime = fidx("DOMACE_IME", "IME")
    i_raba = fidx("RABA_ID", "SIFRA_RABE", "RABA")
    i_opis = fidx("OPIS_RABE")
    i_pov = fidx("POV_GERK", "POVRSINA", "AREA")

    want = str(args.kmg_mid).strip()
    tr = Transformer.from_crs("EPSG:3794", "EPSG:4326", always_xy=True)
    tr_inv = Transformer.from_crs("EPSG:4326", "EPSG:3794", always_xy=True)

    # Javni izvoz nima KMG_MID — pripadnost in center dobimo iz pregledovalnika
    print(f"Poizvedba pregledovalnika za KMG-MID {want} ...")
    center_ll, my_pids = kmg_lookup(want)
    if not my_pids:
        sys.exit(f"Ne najdem GERK-ov za KMG-MID {want} (pregledovalnik ni vrnil "
                 f"seznama — preveri številko ali poskusi kasneje).")
    print(f"  GERK-i kmetije: {len(my_pids)} PID-ov")
    my_pids = {str(p) for p in my_pids}

    center = None
    if args.obmocje_km > 0:
        if center_ll:
            center = tr_inv.transform(center_ll[0], center_ll[1])
            print(f"  center kmetije: {center_ll[1]:.5f}N {center_ll[0]:.5f}E")
        rm = args.obmocje_km * 1000

    # 1. prehod čez izvoz: geometrije mojih PID-ov + fallback center iz njih
    if args.obmocje_km > 0 and center is None:
        boxes = [sr.shape.bbox for sr in r.iterShapeRecords()
                 if str(sr.record[i_pid]) in my_pids]
        if boxes:
            center = (sum((b[0] + b[2]) / 2 for b in boxes) / len(boxes),
                      sum((b[1] + b[3]) / 2 for b in boxes) / len(boxes))

    feats = []
    for sr in r.iterShapeRecords():
        rec = sr.record
        mine = str(rec[i_pid]) in my_pids
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
        opis = (rec[i_opis] or "").strip() if i_opis is not None else ""
        pov = rec[i_pov] if i_pov is not None else None
        props = {
            "name": ime or (f"{opis} · {pid}" if opis and pid else (f"GERK {pid}" if pid else "GERK")),
            "GERK_PID": pid,
            "KMG_MID": want if mine else "",
        }
        if i_raba is not None:
            props["RABA_ID"] = rec[i_raba]
        if opis:
            props["raba_opis"] = opis
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
