"""The spend ledger: a call over the cap is refused before it is made."""

from __future__ import annotations

import pytest

import budget


@pytest.fixture
def ledger(tmp_path, monkeypatch):
    monkeypatch.setattr(budget, "LEDGER", tmp_path / "spend.json")
    return tmp_path


def test_a_call_that_would_cross_the_cap_is_refused(ledger):
    budget.charge("llm", 0, usd=2.99)
    with pytest.raises(budget.BudgetExceeded):
        budget.check("llm", 1_000_000)  # $0.10 more


def test_charges_add_up(ledger):
    budget.charge("llm", 1000, usd=0.5)
    assert budget.charge("llm", 1000, usd=0.25) == pytest.approx(0.75)
    budget.check("llm", 1_000_000)
