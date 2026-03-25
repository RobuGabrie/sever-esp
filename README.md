# MQTT -> Supabase SQL (minimal)

Server simplu pentru cloud:
- se conecteaza la broker MQTT
- se aboneaza la topic
- salveaza periodic in Supabase PostgreSQL (implicit o data la 30 sec)

## 1) Setup rapid

```bash
cd cloud-server
cp .env.example .env
npm install
```

Ruleaza schema in Supabase:

```bash
psql "postgresql://postgres:gabigay1524@db.imdevwnnqmrnmxlwqxzn.supabase.co:5432/postgres" -f schema.sql
```

Pornire server:

```bash
npm start
```

Control interval scriere DB:

- `WRITE_INTERVAL_MS=30000` (default: 30 sec)

## 2) Date asteptate pe topic

Format compatibil cu ESP-ul tau (`hardandsoft/esp32/data`):

```json
{
  "ts": "2026-03-25 12:33:10",
  "up": 321,
  "temp": 24.1,
  "ldr": 120,
  "ldr_pct": 52.9,
  "rssi": -56,
  "cpu": 12.7,
  "v": 3.88,
  "ma": 75.3,
  "mw": 292.1,
  "mah": 110.5,
  "batt": 81.0,
  "batt_min": 165
}
```

## 3) Deploy cloud

Pe Render/Railway/Fly.io:
- build command: `npm install`
- start command: `npm start`
- seteaza variabilele din `.env` in dashboard-ul providerului.
# sever-esp
