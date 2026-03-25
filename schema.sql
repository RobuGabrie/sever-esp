create table if not exists public.sensor_readings (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  device_ts text not null,
  uptime_s integer not null,
  temp_c real,
  ldr_raw integer,
  ldr_pct real,
  rssi_dbm integer,
  cpu_pct real,
  voltage_v real,
  current_ma real,
  power_mw real,
  used_mah real,
  battery_pct real,
  battery_min integer
);

create index if not exists sensor_readings_created_at_idx
  on public.sensor_readings (created_at desc);
