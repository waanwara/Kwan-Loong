# โครงสร้าง Repo: Kwan-Long Wildfire Analysis MVP

เอกสารนี้เป็นแผนที่แบบย่อของ repo ว่าแต่ละส่วนทำอะไร และข้อมูลไหลจากหน้าเว็บไป backend/API/Python model อย่างไร

## ภาพรวมสั้นๆ

โปรเจกต์นี้แบ่งเป็น 3 ชั้นหลัก:

- `public/` คือ frontend หน้าเว็บ
- `src/` คือ backend services, routes และ database
- `wildfire_analysis/` คือ Python model สำหรับคำนวณ fire spread

ตอนนี้ข้อมูลจริงที่เชื่อมแล้วคือ NASA FIRMS hotspot และ AQ Tracker wind ส่วน fuel/terrain ยังเป็น MVP heuristic หรือ fallback

## โครงสร้างหลัก

```text
.
├── server.js
├── package.json
├── README.md
├── docs/
├── public/
├── src/
├── wildfire_analysis/
├── scripts/
├── apitocsv.py
├── employees.js
├── requirements.txt
├── Dockerfile
├── docker-compose.yml
├── .env.example
└── .gitignore
```

## Root Files

| ไฟล์ | ใช้ทำอะไร |
|---|---|
| `server.js` | entrypoint ของ Express app, จัดการ auth/session, serve frontend และ mount API |
| `package.json` | npm scripts และ Node dependencies |
| `package-lock.json` | lock version ของ npm packages |
| `README.md` | README หลักของโปรเจกต์ |
| `requirements.txt` | dependency ฝั่ง Python |
| `employees.js` | seed user สำหรับ login |
| `apitocsv.py` | script ดึง FIRMS/wind/tree cover แล้ว export CSV ใช้เป็น batch/fallback |
| `.env.example` | ตัวอย่าง env vars เช่น FIRMS key, bbox, wind API |
| `.gitignore` | กัน secret, node_modules, database, generated CSV และ data ขนาดใหญ่ |
| `Dockerfile` | build container ของ app |
| `docker-compose.yml` | run app ผ่าน Docker Compose |

## Frontend: `public/`

| ไฟล์ | ใช้ทำอะไร |
|---|---|
| `index.html` | หน้า login |
| `dashboard.html` | dashboard หลัก รวม Command, Strategic, Dispatch management และ AAR |
| `dispatch.html` | หน้า dispatch map หลัก เชื่อม FIRMS, wind, environment และ model estimate |
| `aar-dashboard.html` | AAR dashboard/readiness view |
| `style.css` | CSS กลางบางส่วน |
| `script.js` | script frontend เดิม โดยเฉพาะ login flow |
| `login.avif` | ภาพหน้า login |

## Frontend JS

| ไฟล์ | ใช้ทำอะไร |
|---|---|
| `public/js/api-client.js` | helper เรียก backend API พร้อม session cookie |
| `public/js/dispatch-rothermel.js` | logic หน้า Dispatch: โหลด hotspots, environment, fuel models และเรียก estimate |
| `public/js/header-actions.js` | interaction ของกระดิ่ง, ฟันเฟือง, profile และ logout |
| `public/js/mock-data.js` | ค่า default/fallback สำหรับ MVP UI |

## Backend: `src/`

| ไฟล์ | ใช้ทำอะไร |
|---|---|
| `src/db/index.js` | สร้าง SQLite schema, seed users/fuel models, query และ save scenario |
| `src/data/rothermelFuelModels.js` | fuel models ฝั่ง Node: `GR1`, `SH2`, `TU5` |
| `src/routes/dataRoutes.js` | endpoints ข้อมูลจริง: FIRMS, wind, environment |
| `src/routes/rothermelRoutes.js` | endpoints model: fuel models, estimate, estimate-from-hotspot |
| `src/services/firmsService.js` | ดึงและ parse NASA FIRMS CSV |
| `src/services/windService.js` | ดึง AQ Tracker wind, แปลง U/V เป็น speed + direction |
| `src/services/environmentService.js` | รวม wind + tree-cover heuristic เป็น environment ตามพิกัด |
| `src/services/rothermelService.js` | normalize input, enrich environment, เรียก model และ save scenario |
| `src/services/wildfireModelAdapter.js` | bridge จาก Node ไป Python model และแปลง output เป็น GeoJSON |
| `src/services/geoProjection.js` | แปลง WGS84 lat/lng ↔ UTM meters |

## Python Model: `wildfire_analysis/`

| ไฟล์ | ใช้ทำอะไร |
|---|---|
| `__init__.py` | ทำให้เป็น Python package |
| `cli.py` | stdin/stdout CLI ที่ Node ใช้เรียก model |
| `fire_propagation.py` | orchestration หลัก: validate, simulate, สร้าง arrival grid/perimeter |
| `rothermel.py` | Rothermel-inspired rate-of-spread heuristic |
| `fuel_model.py` | helper/structure ของ fuel model |
| `fuel_moisture.py` | estimate fuel moisture แบบ MVP |
| `fuel_mapping.json` | mapping `DEMO_GRASS`, `DEMO_SHRUB`, `DEMO_FOREST` |
| `MODEL_INPUT_SCHEMA.json` | contract input ของ model |
| `MODEL_OUTPUT_SCHEMA.json` | contract output ของ model |
| `sample_input.json` | ตัวอย่าง input |
| `sample_output.json` | ตัวอย่าง output |
| `test_model.py` | script manual test |
| `README.md` | README เฉพาะ Python package |
| `BACKEND_INTEGRATION.md` | boundary ระหว่าง backend กับ model |
| `DATA_DICTIONARY.md` | ความหมาย field, units และ normalization rules |

## Tests

| ไฟล์ | ใช้ทำอะไร |
|---|---|
| `scripts/test-integration.js` | smoke test ฝั่ง Node: projection, FIRMS parser, wind parser, fuel heuristic, Python bridge |
| `wildfire_analysis/tests/test_fuel_moisture.py` | test fuel moisture logic |
| `wildfire_analysis/tests/test_rothermel.py` | test Rothermel-inspired ROS behavior |
| `wildfire_analysis/tests/test_propagation.py` | test propagation, validation และ arrival grid |

## API Flow สำคัญ

### FIRMS Hotspot

```text
dispatch-rothermel.js
→ GET /api/data/firms/hotspots
→ dataRoutes.js
→ firmsService.js
→ NASA FIRMS API
→ marker บน Leaflet map
```

### Wind/Environment

```text
dispatch-rothermel.js
→ GET /api/data/environment?lat=...&lng=...
→ dataRoutes.js
→ environmentService.js
→ windService.js
→ AQ Tracker wind API หรือ laos_wind.csv fallback
→ auto-fill form
```

### Fire Spread Estimate

```text
dispatch-rothermel.js
→ POST /api/rothermel/estimate
→ rothermelRoutes.js
→ rothermelService.js
→ wildfireModelAdapter.js
→ python -m wildfire_analysis.cli
→ fire_propagation.simulate_fire()
→ GeoJSON กลับไป render บน map
```

## ข้อมูลจริง vs MVP

ข้อมูลจริงที่เชื่อมแล้ว:

- FIRMS hotspot
- AQ Tracker wind
- lat/lng -> UTM projection
- Python model bridge
- GeoJSON rendering บน dispatch map

ยังเป็น MVP/heuristic:

- fuel model จาก tree cover CSV หรือ fallback `SH2`
- slope/aspect ยังไม่ได้ดึงจาก DEM จริง
- fuel moisture ยังเป็นค่า form/default
- dashboard/command/strategic บางส่วนยังเป็น mock UI
- AAR metrics ยัง pending เพราะยังไม่มี incident logs จริง

## ไฟล์ที่ไม่ควร Commit

ไฟล์เหล่านี้เป็น runtime/generated/local:

- `.env`
- `node_modules/`
- `data/kwanlong.sqlite`
- `*.sqlite-wal`, `*.sqlite-shm`
- `laos_active_fires.csv`
- `laos_wind.csv`
- `laos_forest.csv`
- `__pycache__/`

## ทิศทางพัฒนาต่อ

1. เพิ่ม DEM เพื่อคำนวณ slope/aspect จริง
2. เพิ่ม fuel/land-cover proxy ที่ละเอียดกว่า tree cover
3. เก็บ weather observations ลง database
4. เพิ่ม cache ให้ external API
5. เพิ่ม background worker สำหรับดึงข้อมูลตามรอบเวลา
6. ย้ายไป PostGIS เมื่อ query แผนที่เริ่มซับซ้อน
7. อัปเกรด model ไป full Rothermel/cellular propagation เมื่อข้อมูล fuel/terrain/weather พร้อม
