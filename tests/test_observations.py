from dataclasses import replace
import time

import pytest

from capmesh.market import DemandLedger, ObservationMarket
from capmesh.observations import EvidenceError, ObservationContract, ObservationVerifier, observation_request
from capmesh.protocol.auth import DEFAULT_SECRET, compute_hmac_sha256, receipt_message
from capmesh.protocol.identity import provisioned_observation_keys
from capmesh.provider.observation_provider import SimulatedContactProvider
from capmesh.transport.ble import BLETransportAdapter


def verifier(provider="sim-contact-01"):
    return ObservationVerifier({provider: DEFAULT_SECRET})


@pytest.mark.asyncio
@pytest.mark.parametrize("closed,decision", [(False, "DISPATCH"), (True, "WAIT")])
async def test_contact_changes_dispatch_decision(closed, decision):
    provider = SimulatedContactProvider(closed=closed)
    contract = ObservationContract()
    request = observation_request(provider.device_id, contract)
    receipt = await provider.invoke(provider.device_id, request)
    result = verifier().verify(receipt, request, contract)
    assert result["decision"] == decision
    assert result["evidence_mode"] == "simulated"
    assert result["confidence"] is None


@pytest.mark.asyncio
async def test_provider_and_buyer_reject_replay():
    provider = SimulatedContactProvider()
    contract = ObservationContract()
    request = observation_request(provider.device_id, contract)
    receipt = await provider.invoke(provider.device_id, request)
    buyer = verifier()
    buyer.verify(receipt, request, contract)
    with pytest.raises(EvidenceError, match="REPLAY_DETECTED"):
        buyer.verify(receipt, request, contract)
    replay = await provider.invoke(provider.device_id, request)
    assert replay.error["code"] == "REPLAY_DETECTED"


@pytest.mark.asyncio
async def test_provider_error_explains_rejection_without_accepting_unsigned_evidence():
    provider = SimulatedContactProvider()
    contract = ObservationContract()
    request = observation_request(provider.device_id, contract)
    receipt = await provider.invoke(provider.device_id, request)
    error = replace(receipt, status="error", nonce=None, provider=None, receipt_signature=None,
                    error={"code": "AUTH_EXPIRED", "message": "/private/ignored-detail"})
    with pytest.raises(EvidenceError, match="PROVIDER_ERROR: AUTH_EXPIRED") as caught:
        verifier().verify(error, request, contract)
    assert "/private/" not in str(caught.value)
    with pytest.raises(EvidenceError, match="CHALLENGE_MISMATCH"):
        verifier().verify(replace(error, request_id="other-request"), request, contract)
    with pytest.raises(EvidenceError, match="PROVIDER_ERROR: UNSPECIFIED"):
        verifier().verify(replace(error, error={"code": "/private/path"}), request, contract)


@pytest.mark.asyncio
@pytest.mark.parametrize("field,value", [("nonce", 0), ("completed_at", 0), ("started_at", 0),
                                         ("parameters", {"location": "elsewhere"}), ("provider", "fake")])
async def test_receipt_fields_bind_to_challenge(field, value):
    provider = SimulatedContactProvider()
    contract = ObservationContract()
    request = observation_request(provider.device_id, contract)
    receipt = await provider.invoke(provider.device_id, request)
    with pytest.raises(EvidenceError):
        verifier().verify(replace(receipt, **{field: value}), request, contract)


@pytest.mark.asyncio
@pytest.mark.parametrize("field,value", [("closed", True), ("sensor", "fake"), ("stable_samples", 2),
                                         ("total_samples", 100), ("metric", "room.occupancy")])
async def test_result_tampering_rejects_authentication(field, value):
    provider = SimulatedContactProvider()
    contract = ObservationContract()
    request = observation_request(provider.device_id, contract)
    receipt = await provider.invoke(provider.device_id, request)
    tampered = replace(receipt, result={**receipt.result, field: value})
    with pytest.raises(EvidenceError, match="INVALID_SIGNATURE"):
        verifier().verify(tampered, request, contract)


@pytest.mark.asyncio
async def test_authentic_unstable_or_future_evidence_is_rejected():
    provider = SimulatedContactProvider()
    contract = ObservationContract()
    request = observation_request(provider.device_id, contract)
    receipt = await provider.invoke(provider.device_id, request)
    receipt.result["stable_samples"] = 3
    receipt.receipt_signature = "v2:" + compute_hmac_sha256(DEFAULT_SECRET, receipt_message(receipt))
    with pytest.raises(EvidenceError, match="UNSTABLE_MEASUREMENT"):
        verifier().verify(receipt, request, contract)
    receipt.result["stable_samples"] = 5
    receipt.started_at = receipt.completed_at = int(time.time()) + 100
    receipt.receipt_signature = "v2:" + compute_hmac_sha256(DEFAULT_SECRET, receipt_message(receipt))
    with pytest.raises(EvidenceError, match="STALE_EVIDENCE"):
        verifier().verify(receipt, request, contract)


@pytest.mark.asyncio
async def test_cheaper_stale_evidence_loses_to_fresh_provider(tmp_path):
    stale = SimulatedContactProvider("cheap-stale", stale_seconds=60, price="0.0001")
    fresh = SimulatedContactProvider()
    ledger = DemandLedger(tmp_path / "demand.sqlite")
    result = await ObservationMarket([fresh, stale], {fresh.device_id: DEFAULT_SECRET, stale.device_id: DEFAULT_SECRET}, ledger).observe(ObservationContract())
    assert result["provider"] == fresh.device_id
    assert "STALE_EVIDENCE" in result["rejected_providers"][0]["reason"]
    assert result["mock_spent"] == "0.0021"
    ledger.close()
    reopened = DemandLedger(tmp_path / "demand.sqlite")
    assert reopened.summary()[0]["status"] == "served"
    reopened.close()


@pytest.mark.asyncio
async def test_unmet_demand_and_budget_stop_dispatch():
    fresh = SimulatedContactProvider()
    ledger = DemandLedger(":memory:")
    market = ObservationMarket([fresh], {fresh.device_id: DEFAULT_SECRET}, ledger)
    result = await market.observe(ObservationContract(max_price_usdc="0.0001"))
    assert result["status"] == "unmet"
    assert result["decision"]["decision"] == "WAIT"
    assert result["mock_spent"] == "0"
    assert ledger.summary()[0]["location"] == "demo-gate"
    missing = await market.observe(ObservationContract(location="missing-gate"))
    assert missing["status"] == "unmet"
    assert missing["mock_spent"] == "0"
    assert any(row["location"] == "missing-gate" for row in ledger.summary())
    ledger.close()


@pytest.mark.asyncio
async def test_provider_cannot_add_its_own_trust():
    provider = SimulatedContactProvider("unknown")
    ledger = DemandLedger(":memory:")
    result = await ObservationMarket([provider], {}, ledger).observe(ObservationContract())
    assert result["status"] == "unmet"
    assert "UNKNOWN_PROVIDER" in result["rejected_providers"][0]["reason"]
    ledger.close()


@pytest.mark.asyncio
@pytest.mark.hardware
async def test_live_contact_observation_and_replay():
    ble = BLETransportAdapter()
    manifests = await ble.discover(timeout=4)
    assert any(m.device_id == "esp32-c6-96a2" and any(c.id == "state.observe" for c in m.capabilities) for m in manifests)
    contract = ObservationContract()
    request = observation_request("esp32-c6-96a2", contract)
    receipt = await ble.invoke(request.device_id, request)
    decision = ObservationVerifier(provisioned_observation_keys()).verify(receipt, request, contract)
    assert decision["evidence_mode"] == "physical-contact-demo"
    assert decision["sample_agreement"] == "5/5"
    replay = await ble.invoke(request.device_id, request)
    assert replay.error["code"] == "REPLAY_DETECTED"
    # A signed request cannot authorize another nonce or location.
    tampered = replace(request, nonce=request.nonce + 1)
    rejected = await ble.invoke(request.device_id, tampered)
    assert rejected.error["code"] == "UNAUTHORIZED"
