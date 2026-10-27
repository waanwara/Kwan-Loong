# สถานะข้อมูลจริง vs Mock

เอกสารนี้สรุปว่าในระบบ Kwan-Long ตอนนี้ข้อมูลส่วนไหนดึงจาก API/แหล่งจริงแล้ว ส่วนไหนยังเป็น MVP heuristic, fallback หรือ mock/static

## สรุปสั้น

| หมวดข้อมูล | สถานะตอนนี้ |
|---|---|
| จุดความร้อน/ไฟ | ดึงจริงจาก NASA FIRMS |
| ลม | ดึงจริงจาก AQ Tracker และมี CSV fallback |
| พิกัด/Projection | คำนวณจริงใน backend |
| Fire spread model | รัน Python model จริง แต่ยังเป็น Rothermel-inspired MVP |
| Fuel model | กึ่งจริง/heuristic จาก tree cover CSV ถ้ามี ไม่ใช่ full fuel classification |
| Slope/Aspect | ยังเป็นค่า input/default ยังไม่ได้ดึง DEM จริง |
| Fuel moisture | ยังเป็นค่า input/default |
| Dashboard/Command/Strategic metrics | ยังมี mock/static หลายส่วน |
| AAR metrics | pending/mock เพราะยังไม่มี incident logs จริง |

## ข้อมูลที่ดึงจริงแล้ว

| ข้อมูล | Source | ใช้ตรงไหน | ไฟล์ที่เกี่ยวข้อง |
|---|---|---|---|
| FIRMS hotspots | NASA FIRMS Area CSV API | marker บนหน้า Dispatch, hotspot count ใน AAR dashboard | `src/services/firmsService.js`, `src/routes/dataRoutes.js`, `public/js/dispatch-rothermel.js`, `public/dispatch.html`, `public/aar-dashboard.html` |
| Wind speed/direction | AQ Tracker latest API | auto-fill ช่อง Wind/Dir ในหน้า Dispatch และใช้เข้า estimate | `src/services/windService.js`, `src/services/environmentService.js`, `public/js/dispatch-rothermel.js` |
| Lat/Lng to UTM | คำนวณใน backend | แปลงพิกัดก่อนส่งเข้า Python model | `src/services/geoProjection.js`, `src/services/wildfireModelAdapter.js` |
| Model execution | Python local package | คำนวณ spread rate, direction, arrival cells, perimeter | `src/services/wildfireModelAdapter.js`, `wildfire_analysis/cli.py`, `wildfire_analysis/fire_propagation.py` |
| GeoJSON output | แปลงจาก model output | render fire perimeter/arrival cells บน Leaflet map | `src/services/geoProjection.js`, `public/dispatch.html` |

## ข้อมูลกึ่งจริง / Heuristic / Fallback

| ข้อมูล | วิธีใช้ตอนนี้ | ข้อจำกัด |
|---|---|---|
| Fuel model | ถ้ามี `laos_forest.csv` จะใช้ `tree_cover_pct` ใกล้พิกัดแล้ว map เป็น `GR1`, `SH2`, `TU5` | ยังเป็น heuristic จาก tree cover ไม่ใช่ fuel-bed parameter ครบแบบ Rothermel |
| Fuel model fallback | ถ้าไม่มี tree cover จะใช้ `SH2` | เป็นค่า default เพื่อให้ model รันได้ |
| Wind CSV fallback | ถ้า AQ Tracker API ใช้ไม่ได้และมี `laos_wind.csv` จะอ่านจาก CSV | CSV ต้องถูก generate มาก่อนจาก `apitocsv.py` |
| Flame length | คำนวณ summary จาก spread rate และ fuel load | เป็น UI estimate แบบง่าย ยังไม่ใช่ operational flame model |
| Risk index | คำนวณจาก spread rate/flame length | เป็น heuristic สำหรับ UI ไม่ใช่ risk model ที่ validate แล้ว |
| Fire spread | ใช้ Python model จริง | แต่ model ยังเป็น Rothermel-inspired baseline ไม่ใช่ full Rothermel/cellular propagation |

## ข้อมูลที่ยังเป็น Mock / Static / Default

| ข้อมูล | ตอนนี้อยู่ตรงไหน | หมายเหตุ |
|---|---|---|
| Slope percent | ช่อง form/default ใน Dispatch | ยังไม่ได้ดึงจาก DEM/NASADEM |
| Aspect | default ใน backend | ยังไม่ได้คำนวณจาก terrain จริง |
| Elevation | default ใน backend | ยังไม่ได้ดึง DEM จริง |
| Fuel moisture | ช่อง form/default | ยังไม่ได้คำนวณจาก weather/fuel moisture model จริง |
| Temperature/RH/Rainfall | default ใน backend | ยังไม่ได้เชื่อม weather source เต็มรูปแบบ |
| Team status/O2/HR/fuel | `public/dispatch.html` | เป็น mock UI สำหรับ tactical view |
| Unit readiness | `public/dispatch.html` | เป็น mock/static |
| Safety lead time countdown | `public/dispatch.html` | เป็น UI simulation ไม่ได้ผูกกับตำแหน่งทีมจริง |
| Dashboard overview numbers | `public/dashboard.html` | ยังเป็น static/mock หลายจุด |
| Command/Strategic views | `public/dashboard.html` | รวมอยู่ใน dashboard หลัก; Strategic เชื่อมข้อมูลลม PM2.5 และแบบจำลองความเสี่ยงแล้ว |
| AAR performance metrics | `public/aar-dashboard.html` | เปลี่ยนเป็น pending/readiness แล้ว แต่ยังไม่มี incident metrics จริง |

## Endpoint ที่ใช้ข้อมูลจริง

| Endpoint | สถานะ | อธิบาย |
|---|---|---|
| `GET /api/data/firms/hotspots` | จริง | ดึง NASA FIRMS ตาม bbox/day range ใน `.env` |
| `GET /api/data/wind/latest?lat=...&lng=...` | จริง | ดึง AQ Tracker wind แล้วเลือก grid ที่ใกล้พิกัด |
| `GET /api/data/environment?lat=...&lng=...` | ผสม | รวม wind จริง + fuel heuristic/fallback |
| `GET /api/rothermel/fuel-models` | local database | ดึง fuel model seed จาก SQLite |
| `POST /api/rothermel/estimate` | ผสม | ใช้ input จาก frontend + model จริง แต่บาง field ยัง default |
| `POST /api/rothermel/estimate-from-hotspot` | ผสม | ใช้ hotspot จริง + environment จริงบางส่วน + fallback field |

## Data Flow ปัจจุบันในหน้า Dispatch

```text
เปิด dispatch.html
→ โหลด fuel models จาก backend
→ โหลด FIRMS hotspots จาก NASA FIRMS
→ โหลด environment จาก lat/lng ปัจจุบัน
→ AQ Tracker เติม wind speed/direction
→ fuel ใช้ tree cover CSV ถ้ามี หรือ fallback SH2
→ ผู้ใช้กด Estimate Spread
→ backend แปลง lat/lng เป็น UTM
→ เรียก Python wildfire model
→ แปลง output เป็น GeoJSON
→ render perimeter/arrival cells บนแผนที่
```

## ข้อความที่ควรอธิบายเวลา Demo

ระบบนี้ไม่ได้เป็น mock ทั้งหมดแล้ว ตอนนี้ hotspot และ wind เป็นข้อมูลจริงจาก API ส่วนโมเดลรันจริงผ่าน Python backend แต่ยังเป็น MVP research model ไม่ใช่ operational fire forecasting system

สิ่งที่ยังต้องเพิ่มเพื่อให้เข้าใกล้ full Rothermel มากขึ้นคือข้อมูลเชื้อเพลิงละเอียด, DEM slope/aspect, fuel moisture/weather ที่ครบกว่าเดิม และ validation กับเหตุการณ์จริง
