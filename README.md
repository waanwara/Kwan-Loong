# Kwan-Loong

Kwan-Loong คือระบบต้นแบบสำหรับสนับสนุนการตัดสินใจด้านไฟป่าใน สปป.ลาว ครอบคลุมการติดตามจุดความร้อน สภาพลม PM2.5 การประเมินแนวโน้มการลุกลาม การจัดการทีมภาคสนาม และรายงาน After Action Review (AAR)

> โครงการนี้เป็นงานวิจัยและ MVP สำหรับการทดลองเชื่อมข้อมูลกับแบบจำลองเท่านั้น ไม่ใช่ระบบพยากรณ์ไฟป่าที่ผ่านการรับรองสำหรับใช้ตัดสินใจด้านความปลอดภัยจริง

## ฟีเจอร์หลัก

- Dashboard รวม 4 มุมมอง: Strategic, Command, Dispatch และ AAR
- แผนที่ Leaflet พร้อมภาพดาวเทียม โหมดมืด ขอบเขตการปกครอง จุดความร้อน และเครื่องมือ tactical
- Strategic risk matrix รายพื้นที่ โดยใช้ลม PM2.5 เชื้อเพลิง จุดความร้อน FIRMS และแบบจำลอง Rothermel-inspired
- Dispatch map สำหรับเลือก hotspot เติมข้อมูลสภาพแวดล้อม และประเมินการลุกลามผ่าน Python model
- การจัดการทีมปฏิบัติการ เพิ่มทีม เลือกหลายทีม ส่งคำสั่ง และเก็บประวัติคำสั่งใน browser
- AAR dashboard สำหรับสรุปเหตุการณ์ แผนที่ กราฟ และพิมพ์หรือบันทึกเป็น PDF
- UI ภาษาไทย อังกฤษ และลาว
- Login/session แบบ HttpOnly cookie พร้อม SQLite
- API สำหรับ FIRMS, wind, PM2.5, environment, boundary, firebreak และ fire-spread estimate

## หน้าที่ใช้งาน

| URL | หน้าที่ |
|---|---|
| `/` หรือ `/index.html` | Login |
| `/dashboard.html` | Dashboard หลัก: Strategic, Command, Dispatch management และ AAR |
| `/dispatch.html` | Tactical dispatch map และ Rothermel estimate แบบละเอียด |
| `/aar-dashboard.html` | รายงาน AAR ฉบับเต็ม |

URL เดิม `/command.html`, `/strategic.html` และ `/aar.html` ยังใช้ได้ โดย server จะ redirect ไปยัง view ที่ตรงกันใน Dashboard

## Technology Stack

- Frontend: HTML, Tailwind CSS CDN, Leaflet และ Vanilla JavaScript
- Backend: Node.js, Express 5 และ SQLite (`better-sqlite3`)
- Model: Python 3 และ `pyproj`
- Authentication: signed HttpOnly session cookie อายุ 8 ชั่วโมง
- Deployment: Dockerfile และ Docker Compose

## Quick Start

### 1. ติดตั้ง Dependencies

ต้องมี Node.js 22+ และ Python 3.10+

```powershell
npm ci
python -m pip install -r requirements.txt
```

หากต้องการแยก Python environment:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

### 2. ตั้งค่า Environment

```powershell
Copy-Item .env.example .env
```

อย่างน้อยควรเปลี่ยนค่า:

```env
SESSION_SECRET=replace-with-a-long-random-secret
FIRMS_MAP_KEY=replace-with-your-nasa-firms-key
```

### 3. เริ่ม Server

โหลดค่าจาก `.env` โดยตรง:

```powershell
node --env-file=.env server.js
```

หรือใช้ environment ของ shell/default configuration:

```powershell
npm start
```

เปิด [http://localhost:3000](http://localhost:3000)

บัญชีเดโมสำหรับ repository:

```text
Email: demo@kwanloong.local
Password: KwanLoongDemo!
```

บัญชีนี้ถูก seed จาก `employees.js` ลง SQLite และมีไว้สำหรับการพัฒนา/สาธิตเท่านั้น ก่อนนำระบบขึ้น production ต้องเปลี่ยนระบบจัดการผู้ใช้และปิดบัญชีเดโม

## Environment Variables

### Application

| ตัวแปร | ค่าเริ่มต้น | คำอธิบาย |
|---|---|---|
| `PORT` | `3000` | Port ของ Express server |
| `SESSION_SECRET` | development fallback | Secret สำหรับลงลายเซ็น session; ต้องเปลี่ยนใน production |
| `COOKIE_SECURE` | `false` | ตั้ง `true` เมื่อให้บริการผ่าน HTTPS |
| `SQLITE_DB_PATH` | `./data/kwanlong.sqlite` | ตำแหน่งฐานข้อมูล SQLite |
| `PYTHON_BIN` | auto-detect | Python executable ที่ใช้เรียก model |

### FIRMS และ Environment

| ตัวแปร | ค่าเริ่มต้น/สถานะ | คำอธิบาย |
|---|---|---|
| `FIRMS_MAP_KEY` | ไม่มี | NASA FIRMS MAP_KEY |
| `FIRMS_DEFAULT_SOURCE` | `VIIRS_SNPP_NRT` | FIRMS source |
| `FIRMS_DEFAULT_BBOX` | `101.5,17.0,103.5,19.0` | พื้นที่ค้นหาเริ่มต้น |
| `FIRMS_DEFAULT_DAY_RANGE` | `1` | จำนวนวันย้อนหลัง |
| `WIND_API_URL` | AQ Tracker latest API | แหล่งข้อมูลลมหลัก |
| `WIND_CSV_PATH` | `laos_wind.csv` | CSV fallback ของข้อมูลลม |
| `WIND_CSV_DIRECTION_CONVENTION` | `to` | convention ของทิศลมใน CSV |
| `AQ_TRACKER_TTL_MS` | `300000` | อายุ cache ของ AQ Tracker |
| `FOREST_CSV_PATH` | `laos_forest.csv` | tree-cover CSV fallback |

### Optional Connectors

| ตัวแปร | การใช้งาน |
|---|---|
| `GFW_API_KEY` | เปิดการอ่าน tree-cover จาก Global Forest Watch |
| `GFW_GEOSTORE_URL`, `GFW_TREE_COVER_URL`, `GFW_TIMEOUT_MS` | ปรับ endpoint/timeout ของ GFW |
| `PM25_THREDDS_BASE`, `PM25_DATASET_DIR` | ปรับ ADPC SERVIR THREDDS source |
| `PM25_CSV_PATH` | CSV fallback ของ PM2.5 |
| `PM25_LOOKBACK_DAYS`, `PM25_DATASET_TTL_MS`, `PM25_POINT_TTL_MS`, `PM25_TIMEOUT_MS` | ปรับช่วงค้นหา cache และ timeout ของ PM2.5 |
| `NCM_WEATHER_URL_TEMPLATE` | เปิด NCM weather connector; รองรับ `{lat}`, `{lng}`, `{latitude}`, `{longitude}` |
| `NCM_API_TOKEN` | Bearer token สำหรับ NCM ถ้าจำเป็น |
| `ODM_BOUNDARY_PACKAGE_URL`, `ODM_BOUNDARY_GEOJSON_URL` | ปรับแหล่ง boundary GeoJSON |

## API Endpoints

ทุก endpoint ใน `/api/data` และ `/api/rothermel` ต้องมี session ที่ login แล้ว

### Authentication

| Method | Endpoint | หน้าที่ |
|---|---|---|
| `POST` | `/api/login` | Login และสร้าง session cookie |
| `GET` | `/api/me` | อ่านข้อมูลผู้ใช้ปัจจุบัน |
| `POST` | `/api/logout` | ล้าง session cookie |

### Data

| Method | Endpoint | หน้าที่ |
|---|---|---|
| `GET` | `/api/data/firms/hotspots` | จุดความร้อน NASA FIRMS |
| `GET` | `/api/data/boundaries/laos-admin` | ขอบเขตการปกครองลาว |
| `GET` | `/api/data/wind/latest` | ลมล่าสุดใกล้พิกัด |
| `GET` | `/api/data/wind/grid` | จุดลมแบบกริดสำหรับแสดงทิศทางบนแผนที่ |
| `GET` | `/api/data/pm25/latest` | PM2.5 ล่าสุดใกล้พิกัด |
| `GET` | `/api/data/environment` | รวม wind, weather, PM2.5, fuel และข้อมูลประกอบแบบจำลอง |
| `GET` | `/api/data/firebreaks` | อ่านแผนแนวกันไฟ |
| `POST` | `/api/data/firebreaks` | บันทึกแผนแนวกันไฟ |

### Rothermel Model

| Method | Endpoint | หน้าที่ |
|---|---|---|
| `GET` | `/api/rothermel/fuel-models` | อ่าน fuel model จาก SQLite |
| `POST` | `/api/rothermel/estimate` | ประเมิน spread จาก input หรือ live environment |
| `POST` | `/api/rothermel/estimate-from-hotspot` | ประเมินจาก FIRMS hotspot |

## Data Flow

### Strategic Risk

```text
dashboard.html
→ strategic-wind-risk.js
→ FIRMS hotspots + wind + PM2.5 + environment
→ POST /api/rothermel/estimate (persist: false)
→ Python wildfire model
→ provincial conditions + risk matrix
```

### Dispatch Estimate

```text
dispatch.html
→ dispatch-rothermel.js
→ GET /api/data/firms/hotspots
→ GET /api/data/environment
→ POST /api/rothermel/estimate
→ rothermelService.js
→ wildfireModelAdapter.js
→ python -m wildfire_analysis.cli
→ GeoJSON perimeter/arrival cells
→ Leaflet map
```

Backend จะแปลง latitude/longitude เป็น UTM ก่อนเข้า model และแปลงผลลัพธ์กลับเป็น GeoJSON `[longitude, latitude]` สำหรับแผนที่

## โครงสร้าง Repository

```text
.
├── public/
│   ├── index.html
│   ├── dashboard.html
│   ├── dispatch.html
│   ├── aar-dashboard.html
│   ├── js/
│   └── locales/
├── src/
│   ├── data/
│   ├── db/
│   ├── routes/
│   └── services/
├── wildfire_analysis/
│   ├── cli.py
│   ├── fire_propagation.py
│   ├── rothermel.py
│   └── tests/
├── scripts/test-integration.js
├── docs/
├── server.js
├── employees.js
├── Dockerfile
└── docker-compose.yml
```

ดูรายละเอียดเพิ่มเติม:

- [สถานะข้อมูลจริงและ Mock](docs/data-sources-status-th.md)
- [โครงสร้าง Repository](docs/repo-structure-th.md)
- [แผน Backend Rothermel](docs/rothermel-backend-plan.md)
- [Python Model](wildfire_analysis/README.md)
- [Backend Integration](wildfire_analysis/BACKEND_INTEGRATION.md)
- [Data Dictionary](wildfire_analysis/DATA_DICTIONARY.md)

## Tests

Node integration smoke tests:

```powershell
npm test
```

Python model tests:

```powershell
python -m unittest discover -s wildfire_analysis\tests
```

รันทั้งสองชุดต่อกัน:

```powershell
npm run check
```

รัน sample model:

```powershell
python -m wildfire_analysis.test_model
```

## Docker

ตั้ง `SESSION_SECRET` ก่อนเริ่มระบบ:

```powershell
$env:SESSION_SECRET = "replace-with-a-long-random-secret"
docker compose up --build
```

SQLite จะถูกเก็บใน named volume `kwanlong-sqlite`

Docker image ติดตั้ง Python และ dependencies ของแบบจำลองให้แล้ว จึงไม่ต้องติดตั้ง Python เพิ่มบนเครื่อง host

## เตรียมขึ้น GitHub

ตรวจรายการไฟล์ก่อน commit:

```powershell
git status --short
git check-ignore .env node_modules data/kwanlong.sqlite
npm run check
```

ไฟล์ `.env`, ฐานข้อมูล SQLite, dependencies และ CSV ที่สร้างหรือดาวน์โหลดในเครื่องถูกตัดออกด้วย `.gitignore` แล้ว ผู้ใช้ที่ clone repository สามารถเริ่มได้ด้วย `npm ci`, ติดตั้ง `requirements.txt`, คัดลอก `.env.example` เป็น `.env` และรัน `node --env-file=.env server.js`

## สถานะข้อมูลและข้อจำกัด

ข้อมูลที่เชื่อมกับแหล่งภายนอกแล้ว:

- NASA FIRMS hotspots
- AQ Tracker wind พร้อม CSV fallback
- ADPC SERVIR PM2.5 พร้อม CSV fallback
- Administrative boundaries
- Global Forest Watch tree cover เมื่อมี API key
- NCM weather เมื่อกำหนด endpoint

ส่วนที่ยังเป็น MVP, heuristic หรือ static:

- แบบจำลองเป็น Rothermel-inspired baseline ไม่ใช่ full validated Rothermel implementation
- fuel model อาจมาจาก tree-cover heuristic หรือ fallback `SH2`
- slope/aspect/elevation ยังไม่มี DEM pipeline ที่สมบูรณ์
- fuel moisture และ weather บางค่ามี default/fallback
- สถานะทีมและการส่งคำสั่งใน Dashboard เป็น client-side workflow ไม่ได้ส่งไปวิทยุจริง
- AAR และ dashboard metrics บางส่วนยังเป็นข้อมูลตัวอย่าง

ห้ามใช้ผลลัพธ์จาก MVP นี้เป็นคำแนะนำด้านความปลอดภัย การอพยพ หรือการสั่งการภาคสนามโดยไม่มีข้อมูลที่ผ่านการตรวจสอบและผู้เชี่ยวชาญรับรอง

## ไฟล์ Local/Generated ที่ไม่ควร Commit

- `.env`
- `node_modules/`
- `.venv/`
- `data/kwanlong.sqlite`
- `*.sqlite-wal`, `*.sqlite-shm`
- `laos_active_fires.csv`
- `laos_wind.csv`
- `laos_forest.csv`
- `laos_pm25.csv`
- `__pycache__/`

## แนวทางพัฒนาต่อ

1. เชื่อม DEM เพื่อคำนวณ slope, aspect และ elevation จริง
2. เพิ่ม fuel/land-cover classification ที่เหมาะกับพื้นที่ลาว
3. บันทึก weather, PM2.5 และ dispatch orders ลงฐานข้อมูล
4. เพิ่ม cache และ background worker สำหรับ external connectors
5. Validate แบบจำลองกับ incident perimeter และ FIRMS observations จริง
6. เพิ่ม JSON Schema validation ที่ API/model boundary
7. พิจารณา PostGIS เมื่อ spatial query และข้อมูล raster มีขนาดใหญ่ขึ้น
