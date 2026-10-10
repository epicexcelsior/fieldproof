"""Run the focused competition checks. This command never pays or installs firmware."""

import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import uuid

ROOT = Path(__file__).resolve().parents[1]
PYTHON_TESTS = ["tests/test_peaq_job_identity.py", "tests/test_peaq_job_event.py",
                "tests/test_peaq_operator.py", "tests/test_peaq_registry_discovery.py",
                "tests/test_phone_evidence.py", "tests/test_judge_export.py"]
NODE_TESTS = ["gateway/test/job.test.js", "gateway/test/event-store.test.js", "gateway/test/paid-job.test.js",
              "gateway/test/job-view.test.js", "gateway/test/peaq-event.test.js", "gateway/test/settlement.test.js",
              "gateway/test/buyer-recovery.test.js", "gateway/test/buyer-key.test.js"]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--build-phone", action="store_true", help="Also build and verify the local debug APK. No install.")
    parser.add_argument("--live-read-only", action="store_true", help="Also read Agung registry discovery and approved identity. No signer.")
    parser.add_argument("--policy", default=".local/competition/provider-policy.json", help="Public policy for the live identity read.")
    args = parser.parse_args()
    run_directory = ROOT / ".local" / "competition" / "checks" / str(uuid.uuid4())
    run_directory.mkdir(parents=True, mode=0o700)
    env = dict(os.environ)
    env.setdefault("UV_CACHE_DIR", "/tmp/fieldproof-uv-cache")
    commands = [
        ("gateway", ["node", "--test", "--test-isolation=none", *NODE_TESTS], 60),
        ("python", ["uv", "run", "--offline", "--project", "host", "pytest", "-q", *PYTHON_TESTS], 60),
    ]
    if args.build_phone:
        commands.append(("phone-build", ["bash", "mobile/seeker-inspector/build-offline.sh"], 90))
    if args.live_read_only:
        python = env.get("FIELDPROOF_PEAQ_PYTHON")
        if not python:
            print("Set FIELDPROOF_PEAQ_PYTHON to an isolated peaq-os-sdk==0.10.0 environment before live reads.", file=sys.stderr)
            return 1
        commands.extend([
            ("agung-registry", [python, "-m", "scripts.discover_peaq_event_registry"], 60),
            ("agung-identity", [python, "-m", "scripts.resolve_peaq_identity", "--policy", args.policy], 60),
        ])
    results = []
    for name, command, timeout in commands:
        print(f"Run {name}. No payment or chain write.", flush=True)
        try:
            result = subprocess.run(command, cwd=ROOT, env=env, capture_output=True, text=True, timeout=timeout)
            output, code = result.stdout + result.stderr, result.returncode
        except (OSError, subprocess.TimeoutExpired) as error:
            output, code = f"Check could not complete: {type(error).__name__}", 1
        (run_directory / f"{name}.log").write_text(output)
        results.append({"check": name, "passed": code == 0, "exit_code": code, "log": f"{name}.log"})
        print(f"{name}: {'PASS' if code == 0 else 'BLOCKED OR FAILED'}. {output[-500:].strip()}", flush=True)
    report = {"schema": "fieldproof-competition-check-v1", "checks": results,
              "spending": False, "device_install": False, "live_read_only": args.live_read_only,
              "note": "Focused checks. Optional SDK tests can skip in the core environment. This is not a complete hardware rehearsal."}
    (run_directory / "result.json").write_text(json.dumps(report, indent=2) + "\n")
    print(f"Check logs: {run_directory.relative_to(ROOT)}")
    return 0 if all(row["passed"] for row in results) else 1


if __name__ == "__main__":
    sys.exit(main())
