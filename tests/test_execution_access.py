"""Access reports must not copy private device IDs, addresses, or command error contents."""

import json
import os
from types import SimpleNamespace

from scripts.check_execution_access import command_status, save_report


def result(stdout="", stderr="", returncode=0):
    return lambda *_args, **_kwargs: SimpleNamespace(stdout=stdout, stderr=stderr, returncode=returncode)


def test_device_access_reports_only_authorization_counts():
    report = command_status(["adb", "devices"], "adb", run=result(
        "List of devices attached\nPRIVATE_DEVICE_ID\tdevice\nPRIVATE_SECOND_ID\tunauthorized\n"))
    assert report == {"passed": True, "authorized_count": 1, "unauthorized_count": 1, "offline_count": 0}
    assert "PRIVATE" not in json.dumps(report)
    assert command_status(["adb", "devices"], "adb", run=result("List of devices attached\n"))["passed"] is False


def test_tailnet_status_excludes_peer_identity_and_error_contents():
    report = command_status(["tailscale", "status", "--json"], "tailscale", run=result(json.dumps({
        "BackendState": "Running", "Peer": {"PRIVATE_PUBLIC_KEY": {"HostName": "PRIVATE_HOST", "TailscaleIPs": ["PRIVATE_IP"]}}})))
    assert report == {"passed": True, "backend_state": "Running", "peer_count": 1}
    failed = command_status(["tailscale", "status"], "tailscale", run=result(
        stderr="PRIVATE_KEY_CONTENT Operation not permitted", returncode=1))
    assert failed == {"passed": False, "reason": "permission_denied", "exit_code": 1}
    assert "PRIVATE" not in json.dumps([report, failed])
    unsupported = command_status(["tailscale", "status"], "tailscale", run=result("PRIVATE_INVALID_JSON"))
    assert unsupported == {"passed": False, "reason": "unsupported_status"}


def test_saved_access_reports_are_owner_only_and_preserve_previous_runs(tmp_path):
    first = save_report({"spending": False}, tmp_path)
    second = save_report({"spending": False}, tmp_path)
    assert first != second
    assert json.loads(first.read_text()) == {"spending": False}
    if os.name == "posix":
        assert first.stat().st_mode & 0o777 == 0o600
