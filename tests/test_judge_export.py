import importlib.util
import json
from pathlib import Path
from zipfile import ZipFile

import pytest


def load_exporter():
    path = Path(__file__).resolve().parents[1] / "scripts/export_judge_demo.py"
    spec = importlib.util.spec_from_file_location("judge_export", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_judge_package_contains_only_public_assets_and_works_under_a_url_prefix(tmp_path, monkeypatch):
    module = load_exporter()
    root = tmp_path / "source"
    for relative in module.ASSETS.values():
        path = root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("public fixture")
    (root / "docs/proof.html").write_text('<main><a href="/">Back to dispatch desk</a><a href="/learn">Learn</a>'
                                         '<a id="watch-run" href="?live=1&amp;present=1">Watch one new buyer run from the configured local gateway</a>'
                                         '</main><script src="/proof.js"></script>')
    (root / "docs/HOW_IT_WORKS.html").write_text('<a href="http://127.0.0.1:4022/proof?present=1">Inspect</a>'
                                              '<a href="PROTOCOL.md#request">Protocol</a>')
    (root / "docs/jobs.html").write_text('<a href="/proof">Inspect</a><a href="/learn">Learn</a><script src="/jobs.mjs"></script>')
    (root / "docs/review.html").write_text('<a href="/review">Start</a><a href="/proof?record=20261011&amp;present=1">Inspect today</a>'
                                          '<a href="/assets/fieldproof-signed-receipt.webm">Video</a>'
                                          '<a href="/evidence/device-signed-purchase-20261011.json">Evidence</a>'
                                          '<a href="/learn">Guide</a><a href="/jobs">Jobs</a><script src="/review.mjs"></script>')
    (root / "docs/feedback.html").write_text('<html><head></head><body>Guided visual story</body></html>')
    (root / "secret.keypair.json").write_text("PRIVATE FIXTURE")
    monkeypatch.setattr(module, "ROOT", root)
    output = tmp_path / "site"
    archive = module.export(output)
    assert './proof.js' in (output / "proof.html").read_text()
    assert 'href="./index.html"' in (output / "proof.html").read_text()
    assert 'href="./guide.html"' in (output / "proof.html").read_text()
    assert '?live=1' not in (output / "proof.html").read_text()
    assert 'Guided visual story' in (output / "index.html").read_text()
    assert 'location.replace("./proof.html"+location.search+location.hash)' in (output / "index.html").read_text()
    job_page = (output / "jobs.html").read_text()
    assert 'href="./proof.html"' in job_page
    assert 'href="./guide.html"' in job_page
    assert 'src="./jobs.mjs"' in job_page
    assert 'Live monitoring requires the repository gateway.' in (output / "proof.html").read_text()
    review = (output / "review.html").read_text()
    assert 'href="./proof.html?record=20261011&amp;present=1"' in review
    assert 'href="./assets/fieldproof-signed-receipt.webm"' in review
    assert 'href="./evidence/device-signed-purchase-20261011.json"' in review
    assert 'href="./guide.html"' in review
    assert 'href="./jobs.html"' in review
    assert 'src="./review.mjs"' in review
    guide = (output / "guide.html").read_text()
    assert 'href="./index.html?present=1"' in guide
    assert 'href="https://github.com/epicexcelsior/fieldproof/blob/main/docs/PROTOCOL.md#request"' in guide
    with ZipFile(archive) as bundle:
        assert set(bundle.namelist()) == {*module.ASSETS, "index.html", "README.txt", "manifest.json"}
        assert all(b"PRIVATE FIXTURE" not in bundle.read(name) for name in bundle.namelist())
    manifest = json.loads((output / "manifest.json").read_text())
    assert set(manifest) == {*module.ASSETS, "index.html", "README.txt"}
    with pytest.raises(ValueError, match="already exists"):
        module.export(output)


def test_existing_archive_preserves_both_paths(tmp_path):
    module = load_exporter()
    output = tmp_path / "site"
    archive = tmp_path / "site.zip"
    archive.write_bytes(b"existing package")
    with pytest.raises(ValueError, match="already exists"):
        module.export(output)
    assert not output.exists()
    assert archive.read_bytes() == b"existing package"


def test_guide_rejects_private_or_unknown_local_references():
    module = load_exporter()
    with pytest.raises(ValueError, match="unsupported local link"):
        module.guide_links('<a href="../.local/private.keypair.json">Private</a>')


def test_current_founder_guide_has_only_supported_export_links():
    module = load_exporter()
    source = (module.ROOT / "docs/HOW_IT_WORKS.html").read_text()
    guide = module.guide_links(source)
    assert 'href="./index.html?present=1"' in guide
    assert 'href="HARDWARE_NEXT.md"' not in guide
    assert 'src="assets/fieldproof-payment-to-observation.svg"' in guide
    assert 'href="./jobs.html"' in guide
    assert 'href="https://github.com/epicexcelsior/fieldproof/blob/main/docs/JOBS.md"' in guide


@pytest.mark.parametrize("page", ["start.html", "feedback.html"])
def test_material_hub_local_links_resolve_within_the_public_export(page):
    from html.parser import HTMLParser
    from urllib.parse import urlsplit
    module = load_exporter()

    class Links(HTMLParser):
        def __init__(self):
            super().__init__()
            self.targets = []

        def handle_starttag(self, tag, attrs):
            self.targets.extend(value for key, value in attrs if key in {"href", "src"})

    links = Links()
    links.feed((module.ROOT / "docs" / page).read_text())
    local = [urlsplit(target).path for target in links.targets
             if not urlsplit(target).scheme and urlsplit(target).path]
    assert local
    assert set(local) <= {*module.ASSETS, "index.html"}
    assert "competition/fieldproof-pitch.pdf" in local
    if page == "start.html":
        assert "competition/fieldproof-pitch.pptx" in local
    assert all(not target.startswith(("/", ".local", "..")) for target in local)


def public_source(tmp_path, monkeypatch, module):
    root = tmp_path / "source"
    for relative in module.ASSETS.values():
        path = root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("public fixture")
    (root / "docs/proof.html").write_text('<main>Original public inspector</main><script src="/proof.js"></script>')
    (root / "docs/HOW_IT_WORKS.html").write_text('<a href="/jobs">Jobs</a>')
    (root / "docs/jobs.html").write_text('<script src="/jobs.mjs"></script>')
    from test_peaq_job_identity import policy
    (root / "host/capmesh/protocol/receipt_keys.json").write_text(json.dumps({"providers": {
        policy()["provider"]: policy()["receipt_public_key"]}}))
    monkeypatch.setattr(module, "ROOT", root)


def test_job_export_includes_one_reviewed_manifest_and_keeps_original_bytes(tmp_path, monkeypatch):
    from test_public_job_evidence import manifest
    from test_peaq_job_identity import policy
    from scripts.prepare_peaq_event import canonical
    module = load_exporter()
    public_source(tmp_path, monkeypatch, module)
    source = manifest()
    manifest_path, policy_path = tmp_path / "saved-manifest.json", tmp_path / "public-policy.json"
    manifest_path.write_text(json.dumps(source))
    policy_path.write_text(json.dumps(policy()))
    output = tmp_path / "site"
    archive = module.export(output, job_manifest=manifest_path, provider_policy=policy_path)
    exported = json.loads((output / "evidence/current-job.json").read_text())
    assert canonical(exported["job"]) == canonical(source["job"])
    assert "PRIVATE FIXTURE" not in (output / "evidence/current-job.json").read_text()
    assert 'href="./jobs.html"' in (output / "proof.html").read_text()
    assert "Load reviewed job from this export" in (output / "README.txt").read_text()
    with ZipFile(archive) as bundle:
        assert "evidence/current-job.json" in bundle.namelist()
        hashes = json.loads(bundle.read("manifest.json"))
        import hashlib
        assert hashes["evidence/current-job.json"] == hashlib.sha256(bundle.read("evidence/current-job.json")).hexdigest()


def test_job_release_gate_rejects_unconfirmed_or_unapproved_evidence_before_writing(tmp_path, monkeypatch):
    from test_public_job_evidence import manifest
    from test_peaq_job_identity import policy
    module = load_exporter()
    public_source(tmp_path, monkeypatch, module)
    manifest_path, policy_path = tmp_path / "saved-manifest.json", tmp_path / "public-policy.json"
    manifest_path.write_text(json.dumps(manifest()))
    policy_path.write_text(json.dumps(policy()))
    output = tmp_path / "site"
    with pytest.raises(ValueError, match="approved public provider policy"):
        module.export(output, job_manifest=manifest_path)
    with pytest.raises(ValueError, match="confirmed event"):
        module.export(output, job_manifest=manifest_path, provider_policy=policy_path, require_peaq=True)
    with pytest.raises(ValueError, match="saved job manifest"):
        module.export(output, require_peaq=True)
    assert not output.exists()
    assert not output.with_suffix(".zip").exists()


def test_confirmed_job_release_keeps_the_recorded_label_and_excludes_private_journal(tmp_path, monkeypatch):
    pytest.importorskip("eth_utils", reason="The isolated SDK supplies event Keccak hashing")
    from test_public_job_evidence import manifest
    from test_peaq_job_identity import policy
    module = load_exporter()
    public_source(tmp_path, monkeypatch, module)
    manifest_path, policy_path = tmp_path / "saved-manifest.json", tmp_path / "public-policy.json"
    manifest_path.write_text(json.dumps(manifest(confirmed=True)))
    policy_path.write_text(json.dumps(policy()))
    output = tmp_path / "site"
    archive = module.export(output, job_manifest=manifest_path, provider_policy=policy_path, require_peaq=True)
    with ZipFile(archive) as bundle:
        job = json.loads(bundle.read("evidence/current-job.json"))
        assert job["peaq_event"]["state"] == "confirmed"
        assert "no independent live chain read" in job["verification_note"]
        assert "PRIVATE FIXTURE" not in json.dumps(job)
