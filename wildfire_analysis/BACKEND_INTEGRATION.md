# Wildfire Decision Support — Backend Integration Guide

## 1. ขอบเขตความรับผิดชอบ (Service Boundaries)

| บริการ | ขอบเขตหน้าที่รับผิดชอบ |
| :--- | :--- |
| **Backend Service** | • Fetching ข้อมูลดาวเทียมและสภาพอากาศ (FIRMS, GEOS-5, NASADEM, Dynamic World)<br>• การแปลงระบบพิกัดจาก Geographic (WGS84 Lat/Lon) เป็น Projected Metric CRS<br>• การ Normalization แปลงหน่วยและ Validate ข้อมูลตาม Schema<br>• จัดทำ Input JSON เรียกใช้งาน Model และนำผลลัพธ์แปลงเป็น GeoJSON สู่ Frontend |
| **Model / Analysis** | • รับ Parameter ตาม `MODEL_INPUT_SCHEMA.json`<br>• คำนวณคุณสมบัติเชื้อเพลิงและการตอบสนองต่อความชื้น (`fuel_model.py`, `fuel_moisture.py`)<br>• คำนวณอัตราเร็วและทิศทางการลามไฟด้วย Rothermel-inspired heuristic baseline (`rothermel.py`)<br>• คำนวณ directional arrival-time grid และ perimeter vertices สำหรับ compatibility (`fire_propagation.py`)<br>• ส่งผลลัพธ์พิกัดการลามกลับตาม `MODEL_OUTPUT_SCHEMA.json` |

---

## 2. ขั้นตอนการเตรียมข้อมูลของ Backend (10-Step Operational Flow)

```text
[1. FIRMS] ──> [2. Weather] ──> [3. NASADEM] ──> [4. Dynamic World]
                                                        │
┌───────────────────────────────────────────────────────┘
▼
[5. Coordinate Reprojection (EPSG:4326 ──> UTM Projected Metre)]
▼
[6. Unit Conversion (km/h ──> m/s, % ──> Fraction, ton/ha ──> kg/m²)]
▼
[7. JSON Schema Validation vs MODEL_INPUT_SCHEMA.json]
▼
[8. Invoke Model Engine (Python Subprocess / REST API / Celery Task)]
▼
[9. Receive Model Result (Perimeter Vertices + Arrival-Time Grid in Metres)]
▼
[10. Unproject to WGS84 GeoJSON Polygons ──> Deliver to Client Map]
