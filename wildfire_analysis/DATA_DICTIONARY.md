# Wildfire Decision Support — Data Dictionary

## 1. วัตถุประสงค์ (Purpose)
เอกสารนี้ใช้เป็นข้อกำหนดมาตรฐานในการเตรียมข้อมูล (Data Contract) ระหว่าง **Backend System** และ **Wildfire Analysis Engine** เพื่อกำหนด:
- แหล่งที่มาของข้อมูล (Data Source)
- ชื่อ Field และ Data Type
- การแปลงหน่วยจาก Raw Source ให้เป็นหน่วยที่ Model ต้องการ (Unit Conversion)
- กฎการตรวจสอบความถูกต้องก่อนส่งเข้าประมวลผล (Validation Rules)

---

## 2. แผนผังกระบวนการจัดการข้อมูล (Data Pipeline Flow)

```text
+-------------------------------------------------------------------+
| External Sources: NASA FIRMS, Air4Laos/GEOS-5, NASADEM, GFW, DW  |
+-------------------------------------------------------------------+
                                  │
                                  ▼
+-------------------------------------------------------------------+
| Backend Data Pipeline:                                            |
|   1. Query & Fetch API/Tile Data                                  |
|   2. CRS Projection: (Lat/Lon) ──> Projected Metres (x_m, y_m)     |
|   3. Unit Normalization: km/h ──> m/s, % ──> Fraction, etc.       |
|   4. JSON Schema & Range Validation                               |
+-------------------------------------------------------------------+
                                  │
                                  ▼ (MODEL_INPUT_SCHEMA.json)
+-------------------------------------------------------------------+
| Wildfire Analysis Engine (Rothermel & Propagation Simulation)     |
+-------------------------------------------------------------------+
                                  │
                                  ▼ (MODEL_OUTPUT_SCHEMA.json)
+-------------------------------------------------------------------+
| Backend ──> Convert Coordinates to GeoJSON ──> Frontend / Leaflet |
+-------------------------------------------------------------------+

---

## 3. หน่วยมาตรฐานของระบบ (Standard Unit Convention)

| มิติ (Dimension) | หน่วยของ Model | สัญลักษณ์ / รูปแบบ | หมายเหตุ |
| :--- | :--- | :--- | :--- |
| **พิกัดระนาบ (Coordinates)** | Metre | m | Projected Cartesian (เช่น UTM) |
| **ความเร็วลม (Wind Speed)** | Metre per second | m/s | แปลงจาก km/h ด้วย $\div 3.6$ |
| **ทิศทางลม / ด้านลาดชัน** | Degree | deg (0° - 360°) | อ้างอิงทิศเหนือ 0° ตามเข็มนาฬิกา |
| **อุณหภูมิ (Temperature)** | Degree Celsius | °C | หากมาจาก GEOS-5 (Kelvin) ให้ $- 273.15$ |
| **ความชื้น / สัดส่วน (Fraction)** | Fraction | 0.0 - 1.0 | แปลงจากเปอร์เซ็นต์ด้วย $\div 100$ |
| **ความลาดชัน (Slope)** | Degree | deg (0° - 90°) | Model จะแปลงเป็น Radian ภายในเอง |
| **ปริมาณเชื้อเพลิง (Fuel Load)** | Kilogram per m² | kg/m² | แปลงจาก ton/ha ด้วย $\times 0.1$ |
| **ความลึกเชื้อเพลิง (Fuel Depth)** | Metre | m | แปลงจาก cm ด้วย $\div 100$ |
| **ค่าความร้อน (Heat Content)** | Kilojoule per kg | kJ/kg | ถ้าเป็น J/kg ให้ $\div 1000$ |
| **ระยะเวลาจำลอง (Duration)** | Minute | min | จำนวนเต็มบวก |

---

## 4. รายละเอียดตัวแปรและการแปลงหน่วย (Field Specifications)

### 4.1 จุดกำเนิดไฟ (Ignition Data)
**แหล่งข้อมูลหลัก:** NASA FIRMS (VIIRS / MODIS)

| Field | Type | Raw Source | Model Unit | การแปลงข้อมูล | Validation Rule |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `ignition.x_m` | float | FIRMS Longitude | m | Reproject Lat/Lon ไปยัง Projected CRS ประจำโซน (เช่น WGS84 UTM Zone 48N) | ตัวเลขระบบ Cartesian |
| `ignition.y_m` | float | FIRMS Latitude | m | Reproject Lat/Lon ไปยัง Projected CRS ประจำโซน | ตัวเลขระบบ Cartesian |

> **ข้อควรระวัง:** ห้ามส่งพิกัด Degree Decimal (Lat/Lon) เข้าฟังก์ชันการลามไฟโดยเด็ดขาด เนื่องจากอัลกอริทึมต้องการระยะทางจริงบนพื้นดินเป็นหน่วยเมตร

---

### 4.2 สภาพอากาศ (Weather Data)
**แหล่งข้อมูลหลัก:** Air4Laos / NASA GEOS-5 / ERA5

| Field | Type | Raw Source | Model Unit | การแปลงข้อมูล | Validation Rule |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `weather.wind_speed_m_s` | float | km/h หรือ m/s | m/s | $\text{km/h} \div 3.6$ | $\ge 0.0$ |
| `weather.wind_direction_deg` | float | Degree | deg | Meteorological Convention (ทิศที่ลมพัดมา) | $0.0 \le \text{val} < 360.0$ |
| `weather.temperature_c` | float | °C หรือ Kelvin | °C | $\text{Kelvin} - 273.15$ | $-10.0 \le \text{val} \le 60.0$ |
| `weather.relative_humidity` | float | % (0–100) | fraction | $\% \div 100.0$ | $0.0 \le \text{val} \le 1.0$ |
| `weather.rainfall_mm_day` | float | mm/day | mm/day | คงเดิม | $\ge 0.0$ (Default: 0.0) |

---

### 4.3 ภูมิประเทศ (Terrain Data)
**แหล่งข้อมูลหลัก:** NASADEM (30m)

| Field | Type | Raw Source | Model Unit | การแปลงข้อมูล | Validation Rule |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `terrain.elevation_m` | float | NASADEM (m) | m | คงเดิม | $-500.0 \le \text{val} \le 9000.0$ |
| `terrain.slope_deg` | float | DEM Derived (deg) | deg | ส่งค่าเป็นองศาความชัน (Model แปลง Radian ภายใน) | $0.0 \le \text{val} \le 90.0$ |
| `terrain.aspect_deg` | float | DEM Derived (deg) | deg | ส่งค่าตาม GIS/DEM Standard (ทิศลาดลงเขา - Downslope):<br>0° = เหนือ, 90° = ตะวันออก, 180° = ใต้, 270° = ตะวันตก<br>*(Model จะคำนวณกลับทิศ Upslope ให้โดยอัตโนมัติ)* | $0.0 \le \text{val} < 360.0$ |

---

### 4.4 ชนิดและการกระจายตัวของเชื้อเพลิง (Fuel & Land Cover)
**แหล่งข้อมูลหลัก:** Dynamic World (10m), Hansen/GFW, Anderson 13 / Scott & Burgan 40

| Field | Type | Raw Source | Model Unit | การแปลงข้อมูล | Validation Rule |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `fuel.fuel_model` | string/null | DW + GFW Mapping | code/null | รหัสอ้างอิงตาม Model Lookup เช่น "TL1", "GS1", "DEMO"; ใช้ `null` สำหรับ non-burnable | Non-empty string หรือ null |
| `fuel.fuel_load_kg_m2` | float | Literature / Lookup | kg/m² | $\text{ton/ha} \times 0.1$ | $\ge 0.0$ |
| `fuel.fuel_bed_depth_m` | float | Literature / Lookup | m | $\text{cm} \div 100.0$ | $> 0.0$ |
| `fuel.fuel_moisture_fraction` | float | Weather Derived / Lookup | fraction | $\% \div 100.0$ | $0.0 \le \text{val} \le 1.0$ |
| `fuel.heat_content_kj_kg` | float | Literature | kJ/kg | $\text{J/kg} \div 1000.0$ | $> 0.0$ |
| `land_cover.class` | string | Dynamic World | string | ระบุคลาสตรงตัว | ต้องอยู่ใน enum 9 หมวดของ DW |
| `land_cover.tree_cover_fraction` | float | GFW / Hansen (%) | fraction | $\% \div 100.0$ | $0.0 \le \text{val} \le 1.0$ |

---

### 4.5 พารามิเตอร์การจำลอง (Grid & Simulation)

| Field | Type | Model Unit | การใช้งาน | Validation Rule |
| :--- | :--- | :--- | :--- | :--- |
| `grid.cell_size_m` | float | m | ความละเอียด Grid การจำลอง (เช่น 30.0 ม.) | $> 0.0$ |
| `grid.max_cells` | integer | cells | จำนวน cell สูงสุดต่อแกนสำหรับ arrival-time grid แบบ MVP | $\ge 3$ |
| `simulation.duration_minutes` | integer | min | เวลาทั้งหมดที่ต้องการทำนาย | $\ge 1$ |
| `simulation.output_intervals_minutes` | list[int] | min | จุดเวลาที่ต้องการให้สรุปกรอบการลามไฟ | Array ของ int ที่ $\le \text{duration}$ |
