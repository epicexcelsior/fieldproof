"""Check local execution access without payment, chain writes, key reads, or device installation."""

import argparse
import json
import os
from pathlib import Path
import shutil
import socket
import stat
import subprocess
import uuid

ROOT = Path(__file__).resolve().parents[1]
HOSTS = ("peaq-agung.api.onfinality.io", "api.devnet.solana.com", "github.com")


def command_status(command, kind, *, run=subprocess.run):
    """Return selected states only. Never return command output, device IDs, or account data."""
    try:
        result = run(command, capture_output=True, text=True, timeout=8)
    except (OSError, subprocess.TimeoutExpired):
        return {"passed": False, "reason": "command_unavailable_or_timed_out"}
    if result.returncode:
        text = (result.stdout + result.stderr).lower()
        reason = "permission_denied" if "operation not permitted" in text or "permission denied" in text else "command_failed"
        return {"passed": False, "reason": reason, "exit_code": result.returncode}
    if kind == "adb":
        states = [line.split()[1] for line in result.stdout.splitlines()
                  if len(line.split()) >= 2 and line.split()[1] in {"device", "unauthorized", "offline"}]
        return {"passed": "device" in states, "authorized_count": states.count("device"),
                "unauthorized_count": states.count("unauthorized"), "offline_count": states.count("offline")}
    if kind == "tailscale":
        try:
            data = json.loads(result.stdout)
            state = data.get("BackendState")
            allowed = {"Running", "Stopped", "NeedsLogin", "NeedsMachineAuth", "NoState", "Starting"}
            peers = data.get("Peer", {})
            if state not in allowed or not isinstance(peers, dict):
                raise ValueError("unsupported status")
            return {"passed": state == "Running", "backend_state": state, "peer_count": len(peers)}
        except (ValueError, AttributeError):
            return {"passed": False, "reason": "unsupported_status"}
    if kind == "bluetooth":
        powered = any(line.strip() == "Powered: yes" for line in result.stdout.splitlines())
        return {"passed": powered, "powered": powered}
    raise ValueError("Unsupported access check")


def probe(root=ROOT):
    checks = {}
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM):
            pass
        checks["network_socket"] = {"passed": True, "note": "Socket creation only, not external connectivity"}
    except OSError as error:
        checks["network_socket"] = {"passed": False, "reason": "socket_unavailable", "errno": error.errno}
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
            listener.bind(("127.0.0.1", 0))
            listener.listen(1)
        checks["loopback_server"] = {"passed": True}
    except OSError as error:
        checks["loopback_server"] = {"passed": False, "reason": "loopback_unavailable", "errno": error.errno}
    for host in HOSTS:
        if not checks["network_socket"]["passed"]:
            checks[host] = {"passed": False, "reason": "network_socket_prerequisite_failed"}
            continue
        try:
            socket.getaddrinfo(host, 443)
            checks[host] = {"passed": True, "note": "DNS only, not an RPC or TLS acceptance check"}
        except OSError as error:
            checks[host] = {"passed": False, "reason": "dns_unavailable", "errno": error.errno}
    for name, command in [("adb", ["adb", "devices"]), ("tailscale", ["tailscale", "status", "--json"]),
                          ("bluetooth", ["bluetoothctl", "show"])]:
        if not shutil.which(command[0]):
            checks[name] = {"passed": False, "reason": "tool_missing"}
        elif name == "adb" and not checks["loopback_server"]["passed"]:
            checks[name] = {"passed": False, "reason": "adb_tcp_prerequisite_failed"}
        elif name == "bluetooth" and not Path("/run/dbus/system_bus_socket").exists():
            checks[name] = {"passed": False, "reason": "system_bus_socket_unavailable"}
        else:
            checks[name] = command_status(command, name)
    serial = [*Path("/dev").glob("ttyUSB*"), *Path("/dev").glob("ttyACM*")]
    checks["serial_mapping"] = {"visible_count": len(serial), "note": "Presence does not establish usable board transport"}
    wallet = root / ".local/competition/agung-operator.secret"
    checks["agung_wallet_metadata"] = {"exists": wallet.is_file(), "contents_read": False,
        "owner_only_mode": stat.S_IMODE(wallet.stat().st_mode) == 0o600 if wallet.is_file() else False}
    checks["public_policy"] = {"exists": (root / ".local/competition/provider-policy.json").is_file(), "contents_read": False}
    checks["tools"] = {name: bool(shutil.which(name)) for name in ("node", "uv", "google-chrome", "ssh")}
    core = checks["network_socket"]["passed"] and checks["loopback_server"]["passed"] and all(checks[host]["passed"] for host in HOSTS)
    return {"schema": "fieldproof-execution-access-v1", "core_network_prerequisites": core, "checks": checks,
            "spending": False, "chain_write": False, "device_install": False, "private_key_read": False,
            "note": "Read-only access probes. Browser connection, live RPC, actual BLE capture, F5 SSH, Git writes and funding remain separate checks."}


def save_report(report, directory):
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    path = directory / (str(uuid.uuid4()) + ".json")
    with open(path, "x", opener=lambda name, flags: os.open(name, flags, 0o600)) as output:
        output.write(json.dumps(report, indent=2) + "\n")
    return path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-directory", type=Path, default=ROOT / ".local/competition/access-checks")
    args = parser.parse_args()
    report = probe()
    path = save_report(report, args.output_directory)
    print(json.dumps(report, indent=2))
    print("Saved access report: " + str(path))
    return 0 if report["core_network_prerequisites"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
