"""Live BLE/Wi-Fi checks and a local status page for CapMesh development."""

import argparse
import asyncio
import base64
import json
import threading
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import requests

from capmesh.protocol.auth import create_auth_payload, generate_nonce, verify_receipt
from capmesh.protocol.models import InvocationRequest
from capmesh.transport.ble import BLETransportAdapter
from capmesh.transport.http import HTTPTransportAdapter

ROOT = Path(__file__).resolve().parents[1]
OVERVIEW = ROOT / "docs" / "diagnostics.html"


def led_request(device_id: str) -> InvocationRequest:
    nonce = generate_nonce()
    now = int(time.time())
    request_id = f"loop-{nonce & 0xffff:04x}"
    parameters = {"duration": 1, "count": 1}
    return InvocationRequest(
        request_id=request_id,
        device_id=device_id,
        capability="led.blink",
        parameters=parameters,
        nonce=nonce,
        timestamp=now,
        expiration=now + 120,
        authorization=create_auth_payload(
            request_id, "led.blink", nonce, now + 120,
            device_id=device_id, parameters=parameters, timestamp=now,
        ),
    )


async def check_device(wifi_url: str, active: bool) -> dict:
    checks = {}
    ble = BLETransportAdapter()
    device = None
    try:
        manifests = await ble.discover(timeout=4.0)
        device = next((m for m in manifests if "led.blink" in [c.id for c in m.capabilities]), None)
        checks["ble"] = {
            "state": "pass" if device else "fail",
            "detail": f"Found {device.device_id}" if device else "No CapMesh LED provider found",
        }
    except Exception as exc:
        checks["ble"] = {"state": "fail", "detail": f"BLE scan failed: {type(exc).__name__}"}

    wifi_manifests = []
    try:
        wifi = HTTPTransportAdapter(default_base_url=wifi_url)
        wifi_manifests = await wifi.discover(timeout=2.0)
        checks["wifi"] = {
            "state": "pass" if wifi_manifests else "fail",
            "detail": f"Found {wifi_manifests[0].device_id}" if wifi_manifests else f"No manifest at {wifi_url}; join the device Wi-Fi to test it",
        }
    except Exception as exc:
        checks["wifi"] = {"state": "fail", "detail": f"Wi-Fi probe failed: {type(exc).__name__}"}

    checks["ble_invoke"] = {"state": "skipped", "detail": "Start with --active to blink the LED once per cycle"}
    if active and device:
        try:
            receipt = await ble.invoke(device.device_id, led_request(device.device_id))
            valid = verify_receipt(receipt, require_delivery_proof=True)
            checks["ble_invoke"] = {
                "state": "pass" if valid else "fail",
                "detail": "Signed receipt and GPIO pad sample verified" if valid else f"Invocation or receipt failed: {receipt.status}",
            }
        except Exception as exc:
            checks["ble_invoke"] = {"state": "fail", "detail": f"Invocation failed: {type(exc).__name__}"}

    checks["wifi_invoke"] = {"state": "skipped", "detail": "Join device Wi-Fi and start with --active"}
    if active and wifi_manifests:
        try:
            wifi_device = wifi_manifests[0]
            receipt = await wifi.invoke(wifi_device.device_id, led_request(wifi_device.device_id))
            valid = verify_receipt(receipt, require_delivery_proof=True)
            checks["wifi_invoke"] = {
                "state": "pass" if valid else "fail",
                "detail": "Signed HTTP receipt and GPIO pad sample verified" if valid else f"HTTP invocation or receipt failed: {receipt.status}",
            }
        except Exception as exc:
            checks["wifi_invoke"] = {"state": "fail", "detail": f"HTTP invocation failed: {type(exc).__name__}"}

    try:
        created = requests.post("http://127.0.0.1:4021/requests", json={"nonce": generate_nonce()}, timeout=5)
        created.raise_for_status()
        response = requests.get(created.json()["observe_url"], timeout=5)
        encoded = response.headers.get("PAYMENT-REQUIRED", "")
        challenge = json.loads(base64.b64decode(encoded))
        offer = challenge["accepts"][0]
        valid = (
            response.status_code == 402 and challenge["x402Version"] == 2
            and offer["network"] == "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1"
            and offer["amount"] == "1000"
            and offer["payTo"] == "CaQAKBcwf7G5vXeu2RNuNGJafnJ8724Uj4wv9ivfxfQA"
        )
        checks["x402"] = {
            "state": "pass" if valid else "fail",
            "detail": "Unpaid request received exact Devnet USDC 402 challenge" if valid else "x402 challenge does not match the configured offer",
        }
    except Exception as exc:
        checks["x402"] = {"state": "fail", "detail": f"Gateway offline or invalid: {type(exc).__name__}"}

    return {"checked_at": datetime.now(timezone.utc).isoformat(), "checks": checks}


class StatusServer(ThreadingHTTPServer):
    status = {"checked_at": None, "checks": {}}


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/status":
            body = json.dumps(self.server.status).encode("utf-8")
            content_type = "application/json"
        elif self.path in ("/", "/overview.html"):
            body = OVERVIEW.read_bytes()
            content_type = "text/html; charset=utf-8"
        elif self.path in ("/README.md", "/docs/FOCUS.md", "/docs/PROTOCOL.md"):
            body = (ROOT / self.path.lstrip("/")).read_bytes()
            content_type = "text/markdown; charset=utf-8"
        else:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def run_checks(server: StatusServer, wifi_url: str, active: bool, interval: int) -> None:
    while True:
        server.status = asyncio.run(check_device(wifi_url, active))
        time.sleep(interval)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--wifi-url", default="http://192.168.4.1")
    parser.add_argument("--active", action="store_true", help="Blink the real ESP32 once per cycle")
    parser.add_argument("--interval", type=int, default=60)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--once", action="store_true", help="Print one check as JSON and exit")
    args = parser.parse_args()
    if args.interval < 10:
        parser.error("--interval must be at least 10 seconds")
    if args.once:
        print(json.dumps(asyncio.run(check_device(args.wifi_url, args.active)), indent=2))
        return
    server = StatusServer((args.host, args.port), Handler)
    threading.Thread(target=run_checks, args=(server, args.wifi_url, args.active, args.interval), daemon=True).start()
    print(f"Open http://{args.host}:{server.server_port}/ for legacy LED diagnostics", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
