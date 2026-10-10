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
    (root / "secret.keypair.json").write_text("PRIVATE FIXTURE")
    monkeypatch.setattr(module, "ROOT", root)
    output = tmp_path / "site"
    archive = module.export(output)
    assert './proof.js' in (output / "index.html").read_text()
    assert 'href="./index.html"' in (output / "index.html").read_text()
    assert 'href="./guide.html"' in (output / "index.html").read_text()
    assert '?live=1' not in (output / "index.html").read_text()
    job_page = (output / "jobs.html").read_text()
    assert 'href="./index.html"' in job_page
    assert 'href="./guide.html"' in job_page
    assert 'src="./jobs.mjs"' in job_page
    assert 'Live monitoring requires the repository gateway.' in (output / "index.html").read_text()
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
    assert 'src="assets/fieldproof-service-boundaries.svg"' in guide
    assert 'href="./jobs.html"' in guide
    assert 'href="https://github.com/epicexcelsior/fieldproof/blob/main/docs/JOBS.md"' in guide
