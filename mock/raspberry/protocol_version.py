"""Protocol versions for THIS Pi build. Keep in sync with the other ends:

  ESP_PI_PROTO  must equal esp/src/protocol.h  ESP_PI_PROTOCOL
  PI_VPS_PROTO  must equal central/fastapi/app/versioning.py  PI_VPS_PROTO

Bump a number only on an INCOMPATIBLE wire change to that interface. The repo
test (sim/tests/test_protocol_versions.py) fails if the two ends of an interface
disagree, so a half-bump cannot merge; the runtime handshakes catch deploy-time
drift (one piece updated, another not).
"""
ESP_PI_PROTO = 1   # ESP32 <-> Pi   (UART JSON: arm / verdict / ready)
PI_VPS_PROTO = 1   # Pi    <-> VPS  (websocket: turn_end / verdict / move)

PI_FW = "garra-pi-0.1.0"   # human build id, informational only
