"""The two ends of each protocol interface must declare the same version.

Static — reads the source, needs no running stack. It catches the mistake the
runtime handshakes can't: bumping one side of a wire contract and forgetting the
other. A half-bump can't merge.

  ESP_PI_PROTO : esp firmware  vs  raspberry/server  vs  mock/raspberry
  PI_VPS_PROTO : raspberry/server  vs  central/fastapi
"""
import re
from pathlib import Path

import pytest

pytestmark = pytest.mark.static

REPO = Path(__file__).resolve().parents[2]


def _int_const(path: Path, name: str) -> int:
    text = path.read_text()
    # matches `NAME = 1` (py) and `... NAME = 1;` (cpp)
    m = re.search(rf"{name}\s*=\s*(\d+)", text)
    assert m, f"{name} not found in {path.relative_to(REPO)}"
    return int(m.group(1))


def test_esp_pi_proto_agrees_across_esp_pi_and_mock():
    esp = _int_const(REPO / "esp/src/protocol.h", "ESP_PI_PROTOCOL")
    pi = _int_const(REPO / "raspberry/server/protocol_version.py", "ESP_PI_PROTO")
    mock = _int_const(REPO / "mock/raspberry/protocol_version.py", "ESP_PI_PROTO")
    assert esp == pi == mock, (
        f"ESP<->Pi protocol out of sync: firmware={esp}, pi={pi}, mock={mock}. "
        "Bump all three together, and reflash the ESP."
    )


def test_pi_vps_proto_agrees_across_pi_vps_and_mock():
    pi = _int_const(REPO / "raspberry/server/protocol_version.py", "PI_VPS_PROTO")
    vps = _int_const(REPO / "central/fastapi/app/versioning.py", "PI_VPS_PROTO")
    mock = _int_const(REPO / "mock/raspberry/protocol_version.py", "PI_VPS_PROTO")
    assert pi == vps == mock, (
        f"Pi<->VPS protocol out of sync: pi={pi}, vps={vps}, mock={mock}. "
        "Bump both ends in the same commit."
    )
