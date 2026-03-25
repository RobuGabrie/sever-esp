import mqtt from 'mqtt';

const url = process.env.MQTT_URL || 'mqtt://broker.emqx.io:1883';
const topic = process.env.MQTT_TOPIC || 'hardandsoft/esp32/data';

const client = mqtt.connect(url, {
  username: process.env.MQTT_USER || 'emqx',
  password: process.env.MQTT_PASS || 'public'
});

client.on('connect', () => {
  const payload = {
    ts: new Date().toISOString().slice(0, 19).replace('T', ' '),
    up: 1,
    temp: 24.5,
    ldr: 100,
    ldr_pct: 60,
    rssi: -55,
    cpu: 10.2,
    v: 3.92,
    ma: 72.1,
    mw: 282.7,
    mah: 123.4,
    batt: 84.5,
    batt_min: 210
  };

  client.publish(topic, JSON.stringify(payload), { qos: 0 }, () => {
    console.log('[TEST] message sent');
    client.end(true);
  });
});
