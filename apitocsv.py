#librarians
import requests
import pandas as pd
import io
import numpy as np
import ast
import json
import time
import os

#forestToken ใช้เพื่อสร้าง forest_Key เพื่อดึง api อีกที เก็บไว้ข้าง ๆ กัน
fire_KEY = os.environ.get("FIRMS_MAP_KEY", "")
wind_API = "https://aq-tracker-servir.adpc.net/latest/"
forest_KEY = os.environ.get("GFW_API_KEY", "")

def fire():
    if not fire_KEY:
        raise RuntimeError("FIRMS_MAP_KEY is not configured")

    AREA = "100.0,13.5,107.8,22.5" 

    SOURCE = "VIIRS_SNPP_NRT"
    DAY_RANGE = "1"

    url = f"https://firms.modaps.eosdis.nasa.gov/api/area/csv/{fire_KEY}/{SOURCE}/{AREA}/{DAY_RANGE}"

    response = requests.get(url)

    if response.status_code == 200:
        df = pd.read_csv(io.StringIO(response.text))
        
        print(df.head())
        
        filename = "laos_active_fires.csv"
        df.to_csv(filename, index=False)
        print(f"\nsaved in '{filename}'")
    else:
        print(f"check fire_KEY")

    return None

def wind():
    headers = {
        "User-Agent": "Mozilla/5.0"
    }

    response = requests.get(
        wind_API,
        headers=headers,
        timeout=30
    )

    response.raise_for_status()

    records = response.json()

    u_record = next(
        r for r in records
        if r["header"]["parameterNumberName"] == "U-component_of_wind"
    )

    v_record = next(
        r for r in records
        if r["header"]["parameterNumberName"] == "V-component_of_wind"
    )

    header = u_record["header"]

    nx = header["nx"]
    ny = header["ny"]

    lon_start = header["lo1"]
    lat_start = header["la1"]

    dx = header["dx"]
    dy = header["dy"]

    u = np.array(u_record["data"]).reshape(ny, nx)
    v = np.array(v_record["data"]).reshape(ny, nx)

    lons = lon_start + np.arange(nx) * dx
    lats = lat_start - np.arange(ny) * dy

    lon_grid, lat_grid = np.meshgrid(lons, lats)

    wind_speed = np.sqrt(u**2 + v**2)

    wind_direction = (
        np.degrees(np.arctan2(u, v)) + 360
    ) % 360

    wind_table = pd.DataFrame({
        "latitude": lat_grid.ravel(),
        "longitude": lon_grid.ravel(),
        "u": u.ravel(),
        "v": v.ravel(),
        "wind_speed": wind_speed.ravel(),
        "wind_direction": wind_direction.ravel()
    })

    laos_wind = wind_table[
        (wind_table["latitude"] >= 13.5) &
        (wind_table["latitude"] <= 22.5) &
        (wind_table["longitude"] >= 100.0) &
        (wind_table["longitude"] <= 107.8)
    ].copy()

    output_file = "laos_wind.csv"

    laos_wind.to_csv(
        output_file,
        index=False,
        encoding="utf-8-sig"
    )

    print("\nSample Data:")
    print(laos_wind.head())

    print(f"\nRows: {len(laos_wind):,}")
    print(f"Saved: {output_file}")

    return None


def make_bbox_geojson(lat, lon, half_res=0.25):
    return {
        "geometry": {
            "type": "Polygon",
            "coordinates": [[
                [lon - half_res, lat - half_res],
                [lon + half_res, lat - half_res],
                [lon + half_res, lat + half_res],
                [lon - half_res, lat + half_res],
                [lon - half_res, lat - half_res],
            ]]
        }
    }

def get_avg_tree_cover(lat, lon, headers, geostore_url, query_url, retries=3):
    geo_payload = make_bbox_geojson(lat, lon)
    geo_r = requests.post(geostore_url, headers=headers, json=geo_payload)
    if geo_r.status_code != 200:
        return None
    geostore_id = geo_r.json()["data"]["gfw_geostore_id"]

    params = {
        "sql": "SELECT AVG(umd_tree_cover_density_2000__percent) AS avg_tree_cover FROM umd_tree_cover_density_2000",
        "geostore_id": geostore_id,
        "geostore_origin": "gfw",
    }

    for attempt in range(retries):
        r = requests.get(query_url, headers=headers, params=params)
        if r.status_code == 200:
            data = r.json()["data"]
            return data[0]["avg_tree_cover"] if data else None
        elif r.status_code == 504:
            time.sleep(2)
            continue
        else:
            print(f"  -> failed ({r.status_code}) for ({lat}, {lon}): {r.text[:200]}")
            return None
    return None

def forest():
    if not forest_KEY:
        raise RuntimeError("GFW_API_KEY is not configured")

    headers = {"x-api-key": forest_KEY}

    geostore_url = "https://data-api.globalforestwatch.org/geostore"
    query_url = "https://data-api.globalforestwatch.org/dataset/umd_tree_cover_density_2000/v1.8/query/json"

    df_wind = pd.read_csv("laos_wind.csv", encoding="utf-8-sig")
    grid_points = df_wind[["latitude", "longitude"]].drop_duplicates()

    records = []
    for i, row in grid_points.iterrows():
        lat, lon = row["latitude"], row["longitude"]
        avg_tc = get_avg_tree_cover(lat, lon, headers, geostore_url, query_url)
        records.append({"latitude": lat, "longitude": lon, "tree_cover_pct": avg_tc})
        print(f"[{len(records)}/{len(grid_points)}] ({lat}, {lon}) -> {avg_tc}")

    df_forest = pd.DataFrame(records)
    df_forest.to_csv("laos_forest.csv", index=False)
    print("Saved laos_forest.csv")

    return None
def main():
    fire()
    wind()
    forest()

    return None

if __name__ == "__main__":
    main()
