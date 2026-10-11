"""Export the public receipt inspector. Whitelist assets and never copy local state."""

import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import tempfile
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parents[1]
ASSETS = {
    "review.html": "docs/review.html",
    "guide.html": "docs/HOW_IT_WORKS.html",
    "proof.js": "docs/proof.js",
    "settlement.mjs": "docs/settlement.mjs",
    "jobs.html": "docs/jobs.html",
    "jobs.mjs": "docs/jobs.mjs",
    "receipt-keys.json": "host/capmesh/protocol/receipt_keys.json",
    "evidence/device-signed-purchase.json": "docs/evidence/device-signed-purchase.json",
    "evidence/device-signed-purchase-20261011.json": "docs/evidence/device-signed-purchase-20261011.json",
    "evidence/device-signed-purchase-20261005.json": "docs/evidence/device-signed-purchase-20261005.json",
    "evidence/device-signed-purchase-click-20261005.json": "docs/evidence/device-signed-purchase-click-20261005.json",
    "evidence/device-signed-purchase-fast-20261005.json": "docs/evidence/device-signed-purchase-fast-20261005.json",
    "evidence/device-signed-contact-states.json": "docs/evidence/device-signed-contact-states.json",
    "assets/fieldproof-signed-receipt.webm": "docs/assets/fieldproof-signed-receipt.webm",
    "assets/fieldproof-service-boundaries.svg": "docs/assets/fieldproof-service-boundaries.svg",
    "assets/fieldproof-payment-to-observation.svg": "docs/assets/fieldproof-payment-to-observation.svg",
    "assets/fieldproof-evidence-window.svg": "docs/assets/fieldproof-evidence-window.svg",
}


def guide_links(page):
    def rewrite(match):
        target = match.group(1)
        if target == "http://127.0.0.1:4022/proof?present=1":
            return 'href="./index.html?present=1"'
        if target == "/jobs":
            return 'href="./jobs.html"'
        if target.startswith(("#", "https://", "http://")) or target.split("#")[0] in ASSETS:
            return match.group(0)
        # References stay in the public repository. Copy no linked directories or local state.
        allowed = {"README.md", "FOCUS.md", "REHEARSAL.md", "STRATEGY.md", "VERIFICATION.md", "DEMO.md",
                   "SUBMISSION.md", "BOUNTY_PLAN.md", "PEAQ_INTEGRATION.md", "CONTACT_SETUP.md", "HARDWARE_NEXT.md",
                   "CORROBORATION.md", "PROTOCOL.md", "RECEIPT_IDENTITY.md", "OVERVIEW.md",
                   "overview.html", "diagnostics.html", "JOBS.md", "evidence/contact-states.json", "evidence/devnet-purchase.json"}
        if target.split("#")[0] not in allowed:
            raise ValueError(f"The guide contains an unsupported local link: {target}")
        return f'href="https://github.com/epicexcelsior/fieldproof/blob/main/docs/{target}"'
    return re.sub(r'href="([^"]+)"', rewrite, page)


def export(output, *, job_manifest=None, provider_policy=None, require_peaq=False):
    public_job = None
    if job_manifest is not None:
        from scripts.peaq_rpc import load_policy
        from scripts.public_job_evidence import public_evidence
        if provider_policy is None:
            raise ValueError("A job export requires its independently approved public provider policy.")
        if job_manifest.stat().st_size > 65536:
            raise ValueError("Saved job manifest exceeds the 64 KB limit.")
        policy = load_policy(provider_policy)
        pins = json.loads((ROOT / "host/capmesh/protocol/receipt_keys.json").read_text())
        if (policy["provider"] != "esp32-c6-96a2" or policy["sensor"] != "gpio9-contact"
                or pins.get("providers", {}).get(policy["provider"]) != policy["receipt_public_key"]):
            raise ValueError("Public workbench export requires the installed GPIO9 provider and independently provisioned pin.")
        public_job = public_evidence(json.loads(job_manifest.read_text()), policy, require_peaq=require_peaq)
    elif provider_policy is not None or require_peaq:
        raise ValueError("A policy or peaq release gate requires a saved job manifest.")
    output = output.resolve()
    archive = output.with_name(output.name + ".zip")
    if output.exists() or archive.exists():
        raise ValueError("Output directory or archive already exists. Select a new name to preserve the existing package.")
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="fieldproof-export-", dir=output.parent) as scratch:
        stage = Path(scratch) / "site"
        stage.mkdir()
        for target, source in ASSETS.items():
            destination = stage / target
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / source, destination)
        job_page = (stage / "jobs.html").read_text()
        for old, new in [('href="/"', 'href="./index.html"'), ('href="/proof"', 'href="./index.html"'),
                         ('href="/learn"', 'href="./guide.html"'), ('src="/jobs.mjs"', 'src="./jobs.mjs"')]:
            job_page = job_page.replace(old, new)
        (stage / "jobs.html").write_text(job_page)
        review = (stage / "review.html").read_text()
        for old, new in [('href="/review"', 'href="./review.html"'), ('href="/proof', 'href="./index.html'),
                         ('href="/learn"', 'href="./guide.html"'), ('href="/jobs"', 'href="./jobs.html"'),
                         ('href="/assets/', 'href="./assets/'), ('href="/evidence/', 'href="./evidence/')]:
            review = review.replace(old, new)
        (stage / "review.html").write_text(review)
        page = (ROOT / "docs/proof.html").read_text()
        page = page.replace('src="/proof.js"', 'src="./proof.js"')
        page = page.replace('<a href="/">Back to dispatch desk</a>', '<a href="./index.html">Restart inspection</a>')
        page = page.replace('href="/learn"', 'href="./guide.html"')
        page = page.replace('<a id="watch-run" href="?live=1&amp;present=1">Watch one new buyer run from the configured local gateway</a>', 'The static package supports file inspection. Live monitoring requires the repository gateway.')
        page = page.replace('</main>', '<p><a href="./assets/fieldproof-signed-receipt.webm">Watch the captioned 2:30 walkthrough</a></p></main>')
        if public_job is not None:
            (stage / "evidence/current-job.json").write_text(json.dumps(public_job, indent=2, ensure_ascii=False) + "\n")
            page = page.replace('</main>',
                '<p><a href="./jobs.html">Inspect the reviewed peaq-linked job</a> · '
                '<a href="./evidence/current-job.json" download>Download original job and recorded readbacks</a></p></main>')
        (stage / "index.html").write_text(page)
        (stage / "guide.html").write_text(guide_links((stage / "guide.html").read_text()))
        (stage / "README.txt").write_text(
            "FieldProof: inspect recorded physical evidence\n\n"
            "1. Serve this directory on localhost or HTTPS.\n"
            "   python3 -m http.server 8787 --bind 127.0.0.1\n"
            "   Open http://127.0.0.1:8787/review.html for the one-minute feedback walkthrough.\n"
            "2. Open http://127.0.0.1:8787/guide.html for the story, radio explanation, and rehearsal.\n"
            "   Open http://127.0.0.1:8787 for actual recorded-receipt verification.\n"
            "3. Verify the original receipt, then alter its state, challenge, or public key.\n"
            "4. Select Verify recorded payment for a read-only Solana Devnet RPC query.\n"
            "5. Inspect the separately signed BOOT held/released input pair. Those checks moved no funds.\n"
            "6. Watch assets/fieldproof-signed-receipt.webm.\n\n"
            "Open jobs.html for the job workbench. Import a reviewed saved job or evidence manifest.\n"
            "Imported peaq snapshots remain recorded evidence, not a live registry query.\n\n"
            "For the October 5 real purchase, open Inspect a new paid buyer run.\n"
            "Select evidence/device-signed-purchase-20261005.json, then Verify buyer payment.\n"
            "The later one-click purchase is evidence/device-signed-purchase-click-20261005.json.\n"
            "The faster one-click purchase is evidence/device-signed-purchase-fast-20261005.json.\n"
            "Its authentic evidence is expired now. No new payment occurs.\n\n"
            "This package contains recorded evidence, public verification keys, and browser code.\n"
            "It contains no wallet, backend, private key, physical gateway, or payment endpoint.\n"
            "It never charges funds or measures hardware. Authentic expired evidence remains WAIT.\n"
            "The optional RPC check needs internet access and trusts api.devnet.solana.com.\n"
            "The installed code and public pin are the buyer configuration trust root.\n"
            "Use the repository README for the complete live MVP and simulated purchase rehearsal.\n"
            + ("\nA reviewed job is included at evidence/current-job.json.\n"
               "Open jobs.html and select Load reviewed job from this export.\n"
               "The saved readbacks are recorded evidence. This export made no live chain query.\n"
               "The original capture timestamp remains unchanged. Old evidence remains expired.\n"
               if public_job is not None else "")
        )
        manifest = {str(path.relative_to(stage)): hashlib.sha256(path.read_bytes()).hexdigest()
                    for path in sorted(stage.rglob("*")) if path.is_file()}
        (stage / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
        stage.rename(output)
    with ZipFile(archive, "x", compression=ZIP_DEFLATED) as bundle:
        for path in sorted(output.rglob("*")):
            if path.is_file():
                bundle.write(path, path.relative_to(output))
    return archive


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path, help="New output directory. Use an ignored .local path.")
    parser.add_argument("--job-manifest", type=Path, help="Saved peaq-event manifest. No database, journal, or wallet is copied.")
    parser.add_argument("--provider-policy", type=Path, help="Independently approved public provider policy for the saved job.")
    parser.add_argument("--require-peaq", action="store_true", help="Require matching recorded payment and finalized peaq readbacks.")
    args = parser.parse_args()
    print(export(args.output, job_manifest=args.job_manifest, provider_policy=args.provider_policy, require_peaq=args.require_peaq))
