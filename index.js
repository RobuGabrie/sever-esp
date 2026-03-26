import 'dotenv/config';
import http from 'http';
import mqtt from 'mqtt';
import pg from 'pg';

const { Pool } = pg;

const REQUIRED_VARS = ['MQTT_URL', 'MQTT_TOPIC', 'DATABASE_URL'];
for (const key of REQUIRED_VARS) {
  if (!process.env[key]) {
    console.error(`[BOOT] Missing env var: ${key}`);
    process.exit(1);
  }
}

const mqttUrl = process.env.MQTT_URL;
const mqttTopic = process.env.MQTT_TOPIC;
const appName = process.env.APP_NAME || 'mqtt-to-supasql';
const writeIntervalMs = Number(process.env.WRITE_INTERVAL_MS || 30000);
const port = Number(process.env.PORT || 10000);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const insertSql = `
  insert into public.sensor_readings (
    created_at,
    device_ts,
    uptime_s,
    temp_c,
    ldr_raw,
    ldr_pct,
    rssi_dbm,
    cpu_pct,
    voltage_v,
    current_ma,
    power_mw,
    used_mah,
    battery_pct,
    battery_min
  ) values (
    now(),
    $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13
  )
`;

let latestRow = null;
let flushTimer = null;
let lastFlushAttemptAt = Date.now();
let lastInsertedSignature = null;
let mqttConnected = false;

const server = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      ok: true,
      app: appName,
      mqttConnected,
      queued: Boolean(latestRow)
    }));
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('OK\n');
});

server.listen(port, '0.0.0.0', () => {
  console.log(`[HTTP] Listening on 0.0.0.0:${port}`);
});

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function buildSignature(row) {
  return `${row.device_ts}|${row.uptime_s}|${row.temp_c}|${row.ldr_raw}|${row.ldr_pct}|${row.rssi_dbm}|${row.cpu_pct}|${row.voltage_v}|${row.current_ma}|${row.power_mw}|${row.used_mah}|${row.battery_pct}|${row.battery_min}`;
}

function normalizePayload(payload) {
  return {
    device_ts: String(payload.ts || new Date().toISOString()),
    uptime_s: toNumber(payload.up, 0),
    temp_c: toNumber(payload.temp, 0),
    ldr_raw: toNumber(payload.ldr, 0),
    ldr_pct: toNumber(payload.ldr_pct, 0),
    rssi_dbm: toNumber(payload.rssi, 0),
    cpu_pct: toNumber(payload.cpu, 0),
    voltage_v: toNumber(payload.v, 0),
    current_ma: toNumber(payload.ma, 0),
    power_mw: toNumber(payload.mw, 0),
    used_mah: toNumber(payload.mah, 0),
    battery_pct: toNumber(payload.batt, 0),
    battery_min: toNumber(payload.batt_min, 0)
  };
}

async function saveReading(row) {
  await pool.query(insertSql, [
    row.device_ts,
    row.uptime_s,
    row.temp_c,
    row.ldr_raw,
    row.ldr_pct,
    row.rssi_dbm,
    row.cpu_pct,
    row.voltage_v,
    row.current_ma,
    row.power_mw,
    row.used_mah,
    row.battery_pct,
    row.battery_min
  ]);
}

async function flushLatest() {
  if (!latestRow) return;

  lastFlushAttemptAt = Date.now();

  const row = latestRow;
  latestRow = null;
  const signature = buildSignature(row);

  if (signature === lastInsertedSignature) {
    console.log('[DB] Duplicate sample skipped');
    return;
  }

  try {
    await saveReading(row);
    lastInsertedSignature = signature;
    console.log(`[DB] Inserted reading ts=${row.device_ts}`);
  } catch (err) {
    // Put the row back so it can be retried on next cycle.
    latestRow = row;
    console.error('[DB] Insert failed:', err.message);
  }
}

function scheduleFlush() {
  if (flushTimer) return;

  const elapsed = Date.now() - lastFlushAttemptAt;
  const delay = Math.max(0, writeIntervalMs - elapsed);

  flushTimer = setTimeout(async () => {
    flushTimer = null;
    await flushLatest();
    if (latestRow) scheduleFlush();
  }, delay);
}

const client = mqtt.connect(mqttUrl, {
  username: process.env.MQTT_USER || undefined,
  password: process.env.MQTT_PASS || undefined,
  reconnectPeriod: 2000,
  connectTimeout: 10000,
  keepalive: 30,
  clientId: `${appName}-${Math.random().toString(16).slice(2, 8)}`
});

client.on('connect', () => {
  mqttConnected = true;
  console.log(`[MQTT] Connected: ${mqttUrl}`);
  client.subscribe(mqttTopic, { qos: 0 }, (err) => {
    if (err) {
      console.error('[MQTT] Subscribe failed:', err.message);
      return;
    }
    console.log(`[MQTT] Subscribed: ${mqttTopic}`);
  });
});

client.on('message', async (topic, message) => {
  let parsed;
  try {
    parsed = JSON.parse(message.toString('utf8'));
  } catch {
    console.warn('[PARSE] Invalid JSON payload, skipped');
    return;
  }

  const row = normalizePayload(parsed);
  const incomingSignature = buildSignature(row);

  if (incomingSignature === lastInsertedSignature) {
    console.log('[MQTT] Duplicate incoming sample skipped');
    return;
  }

  latestRow = row;
  scheduleFlush();
  console.log(`[MQTT] Sample received topic=${topic}, queued for periodic DB write`);
});

client.on('error', (err) => {
  mqttConnected = false;
  console.error('[MQTT] Error:', err.message);
});

client.on('reconnect', () => {
  mqttConnected = false;
  console.log('[MQTT] Reconnecting...');
});

client.on('offline', () => {
  mqttConnected = false;
  console.log('[MQTT] Offline');
});

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

async function shutdown() {
  console.log('\n[APP] Shutting down...');
  if (flushTimer) clearTimeout(flushTimer);
  server.close();
  await flushLatest();
  client.end(true);
  await pool.end();
  process.exit(0);
}
