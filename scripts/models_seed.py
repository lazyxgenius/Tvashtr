"""Fill a local database for one account with the Models canvas's sample data (no model calls).

    DATABASE_URL=postgresql://…/tvashtr_scratch \
        backend/.venv/bin/python scripts/models_seed.py --email you@tvashtr.local [--verdicts]

"Claims triage": a choice model on test set v4, 50 tests of which the first 8 are the canvas's rows,
three finished runs on v4 matching the Results cards and the 7 differing tests, two runs on v3.
"Support email router": a text model on test set v2, 18 tests of which 7 are the canvas's rows.
``--verdicts`` adds its two runs, which give test 7 the canvas's judge verdicts. It's a second step
because the list's picture shows that model "Not run yet" while the drawer's shows its verdicts.

The account is created when missing (password ``models-seed-pass``), with dummy keys for Anthropic,
Groq and DeepSeek so the Run tests dialog looks like the canvas's. Refuses ``tvashtr_film`` and any
database that isn't on this machine.
"""

import argparse
import os
import sys
import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from urllib.parse import urlparse

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from sqlalchemy import select  # noqa: E402

from tvashtr.auth import hash_password  # noqa: E402
from tvashtr.config import get_settings  # noqa: E402
from tvashtr.control_plane.credentials import encrypt_secret  # noqa: E402
from tvashtr.db import session_scope  # noqa: E402
from tvashtr.models import (  # noqa: E402
    ModelTestCase,
    ModelTestResult,
    ModelTestRun,
    ModelTestSetVersion,
    ProviderCredential,
    User,
    UserModel,
)

PASSWORD = "models-seed-pass"
NOW = datetime.now(UTC)
TWO_H_AGO = NOW - timedelta(hours=2)
SONNET = "anthropic/claude-sonnet-5-5"
DEEPSEEK = "deepseek/deepseek-chat"
GROQ = "groq/openai/gpt-oss-120b"
HAIKU = "anthropic/claude-haiku-5-5"
CHOICES = ["Motor", "Property", "Health", "Travel", "Fraud review", "Other"]

# The canvas's rows, by test number (Tests.dc.html and Results.dc.html).
CLAIMS = {
    1: (
        "Rear-ended at a red light on NH-48. Bumper and tail lamp damaged; the other driver admits "
        "fault.",
        "Motor",
    ),
    2: (
        "Water from the flat above came through the ceiling during the storm. Plaster and a sofa "
        "ruined.",
        "Property",
    ),
    3: (
        "Admitted for dengue for four days at a network hospital. Cashless claim declined at "
        "discharge.",
        "Health",
    ),
    4: (
        "Flight to Singapore cancelled. Lost one hotel night and bought a new ticket for the next "
        "day.",
        "Travel",
    ),
    5: (
        'Third claim this month for a phone "stolen" from the same car. The invoices look edited.',
        "Fraud review",
    ),
    6: ("Asking whether the policy covers surgery for a pet dog.", "Other"),
    7: (
        "Scooter skidded on gravel. Rider broke an arm; the front fork is bent.",
        "Motor",
    ),
    8: (
        "Trip cut short because a parent was admitted to hospital back home. Return flight "
        "rebooked.",
        "Travel",
    ),
    12: (
        "Pipe burst in the office pantry over the weekend. Flooring and a fridge damaged.",
        "Property",
    ),
    19: ("Car hit while parked. CCTV shows the van’s number plate.", "Motor"),
    27: (
        "Bag lost on a domestic flight. The airline paid part of the value.",
        "Travel",
    ),
    33: (
        "The same accident filed under two policies, with different dates.",
        "Fraud review",
    ),
}
# The rest of the 50: plain claims of each kind.
MORE = {
    "Motor": "Dented door in a car park; repair estimate attached (claim {n}).",
    "Property": "Kitchen fire damaged the chimney and two cabinets (claim {n}).",
    "Health": "Knee surgery at a network hospital; pre-authorisation attached (claim {n}).",
    "Travel": "Connection missed after a delayed first flight; hotel receipt attached (claim {n}).",
    "Fraud review": "Same bill submitted twice with different dates (claim {n}).",
    "Other": "Asking how to change the nominee on the policy (claim {n}).",
}
# Where each run is wrong: test number -> its answer. Sonnet vs Groq are the canvas's 7 differences
# (6 + 1) plus 3 both wrong. Row 8 is Sonnet's miss; DeepSeek misses 7, its rows 1-8 as Groq's.
SONNET_WRONG = {8: "Health", 20: "Other", 30: "Other", 40: "Other"}
GROQ_WRONG = {
    5: "Motor",
    7: "Health",
    12: "Other",
    19: "Fraud review",
    27: "Other",
    33: "Motor",
    20: "Other",
    30: "Other",
    40: "Other",
}
DEEPSEEK_WRONG = {
    5: "Motor",
    7: "Health",
    20: "Other",
    30: "Other",
    40: "Other",
    44: "Other",
    47: "Other",
}

SUPPORT = [
    (
        "I was charged twice for this month’s plan. Please refund one of them.",
        "Product: Billing. Urgency: Medium.",
        "contains",
        ["billing", "medium"],
        None,
    ),
    (
        "How do I export my invoices as a CSV?",
        "Product: Web dashboard. Urgency: Low.",
        "contains",
        ["web dashboard", "low"],
        None,
    ),
    (
        "The checkout page is blank on Safari since this morning. Customers can’t pay.",
        "Product: Checkout. Urgency: High.",
        "judge",
        [],
        "Names checkout as the product. Marks it high urgency, because customers can't pay.",
    ),
    (
        "Can I add a second admin to our account?",
        "Product: Web dashboard. Urgency: Low.",
        "contains",
        ["web dashboard", "low"],
        None,
    ),
    (
        "Your API returns 500 errors for every order we send. Our shop is down.",
        "Product: API. Urgency: High.",
        "judge",
        [],
        "Names the API as the product. Marks it high urgency, because the shop is down.",
    ),
    (
        "Push notifications arrive an hour late on Android.",
        "Product: Mobile app. Urgency: Medium.",
        "judge",
        [],
        "Names the mobile app as the product. Marks it medium urgency.",
    ),
    (
        "Since last night's update the app logs me out every time I open it. I have deliveries to "
        "send out at 9 am and can't see the order list.",
        "Product: Mobile app. Urgency: High, because it blocks work tomorrow morning.",
        "judge",
        [],
        "Names the mobile app as the product. Marks it high urgency, because it blocks work within "
        "a day. Extra advice is fine but not needed.",
    ),
]


def _refuse_foreign_databases() -> None:
    url = urlparse(get_settings().database_url)
    if url.path.lstrip("/") == "tvashtr_film" or url.hostname not in (
        "localhost",
        "127.0.0.1",
        "::1",
    ):
        sys.exit(f"Refusing to seed {url.hostname}{url.path}: local scratch databases only.")


def _account(session, email: str) -> uuid.UUID:
    user = session.execute(select(User).where(User.email == email)).scalar_one_or_none()
    if user is None:
        user = User(email=email, password_hash=hash_password(PASSWORD))
        session.add(user)
        session.flush()
    held = set(
        session.execute(
            select(ProviderCredential.provider).where(ProviderCredential.owner_id == user.id)
        ).scalars()
    )
    for provider in {"anthropic", "groq", "deepseek"} - held:
        session.add(
            ProviderCredential(
                owner_id=user.id,
                provider=provider,
                secret_encrypted=encrypt_secret("dummy-seed-key-0000"),
                key_last4="0000",
            )
        )
    return user.id


def _version(session, model, number, case_ids, note, owner, when) -> ModelTestSetVersion:
    row = ModelTestSetVersion(
        model_id=model.id,
        version=number,
        job=model.job,
        answer_kind=model.answer_kind,
        choices=list(model.choices),
        case_ids=[str(i) for i in case_ids],
        change_note=note,
        created_by=owner,
        created_at=when,
    )
    session.add(row)
    session.flush()
    return row


def _run(
    session,
    model,
    version,
    cases,
    slug,
    answers,
    owner,
    *,
    cost,
    latency_ms,
    when,
    judge=None,
    judge_cost=0.0,
) -> None:
    """A finished run. ``answers(n, case)`` -> (answer, verdict, reason)."""
    run = ModelTestRun(
        model_id=model.id,
        version_id=version.id,
        version=version.version,
        model_slug=slug,
        status="completed",
        cases_total=len(cases),
        price_known=True,
        estimate_usd=Decimal(str(cost)),
        started_by=owner,
        created_at=when,
        completed_at=when,
    )
    session.add(run)
    session.flush()
    per_case = Decimal(str(cost)) / len(cases)
    tally = {"pass": 0, "fail": 0, "error": 0}
    for n, case in enumerate(cases, 1):
        answer, verdict, reason = answers(n, case)
        tally[verdict] += 1
        session.add(
            ModelTestResult(
                run_id=run.id,
                case_id=case.id,
                case_key=case.case_key,
                position=n,
                answer=answer,
                verdict=verdict,
                reason=reason,
                model_used=slug,
                latency_ms=latency_ms,
                prompt_tokens=120,
                completion_tokens=4,
                cost_usd=per_case,
                judge_model=judge if case.scoring == "judge" else None,
                judge_cost_usd=Decimal(str(judge_cost)) if case.scoring == "judge" else Decimal(0),
                created_at=when,
            )
        )
    run.passed, run.failed, run.errors = tally["pass"], tally["fail"], tally["error"]
    run.cost_usd = Decimal(str(cost))
    run.judge_cost_usd = Decimal(0)
    run.avg_latency_ms = latency_ms


def _choice_answers(wrong: dict[int, str]):
    def answers(n, case):
        if n in wrong:
            return wrong[n], "fail", None
        return case.expected, "pass", None

    return answers


def seed_claims(session, owner: uuid.UUID) -> None:
    model = UserModel(
        owner_id=owner,
        name="Claims triage",
        job="Reads a new insurance claim and picks the team that should handle it.",
        answer_kind="choice",
        choices=CHOICES,
        current_version=4,
    )
    session.add(model)
    session.flush()
    cases = []
    for n in range(1, 51):
        if n in CLAIMS:
            input_, expected = CLAIMS[n]
        else:
            expected = CHOICES[n % len(CHOICES)]
            input_ = MORE[expected].format(n=n)
        cases.append(
            ModelTestCase(
                model_id=model.id,
                case_key=uuid.uuid4(),
                input=input_,
                expected=expected,
                scoring="exact",
                created_at=NOW - timedelta(days=3),
            )
        )
    session.add_all(cases)
    session.flush()
    ids = [c.id for c in cases]
    # Test 50 was edited for v4: v1-v3 held its older revision.
    older = ModelTestCase(
        model_id=model.id,
        case_key=cases[49].case_key,
        input=cases[49].input + " Old wording.",
        expected=cases[49].expected,
        scoring="exact",
        created_at=NOW - timedelta(days=4),
    )
    session.add(older)
    session.flush()
    before = [*ids[:49], older.id]
    days = lambda d: NOW - timedelta(days=d)  # noqa: E731
    _version(
        session,
        model,
        1,
        before[:48],
        "Imported 48 tests from claims.csv",
        owner,
        days(4),
    )
    _version(session, model, 2, before[:49], "Added test 49", owner, days(3))
    v3 = _version(session, model, 3, before, "Added test 50", owner, days(2))
    v4 = _version(
        session,
        model,
        4,
        ids,
        "Edited test 50",
        owner,
        TWO_H_AGO - timedelta(minutes=5),
    )
    # Cards read newest first: Sonnet, DeepSeek, Groq.
    _run(
        session, model, v4, cases, GROQ, _choice_answers(GROQ_WRONG), owner,
        cost=0.02, latency_ms=600, when=TWO_H_AGO,
    )  # fmt: skip
    _run(
        session, model, v4, cases, DEEPSEEK, _choice_answers(DEEPSEEK_WRONG), owner,
        cost=0.04, latency_ms=2100, when=TWO_H_AGO + timedelta(seconds=1),
    )  # fmt: skip
    _run(
        session, model, v4, cases, SONNET, _choice_answers(SONNET_WRONG), owner,
        cost=0.21, latency_ms=1400, when=TWO_H_AGO + timedelta(seconds=2),
    )  # fmt: skip
    old_cases = [*cases[:49], older]
    for slug, cost, latency in ((DEEPSEEK, 0.04, 2300), (GROQ, 0.02, 700)):
        _run(
            session, model, v3, old_cases, slug, _choice_answers({2: "Other"}), owner,
            cost=cost, latency_ms=latency, when=days(2),
        )  # fmt: skip


def seed_support(session, owner: uuid.UUID) -> None:
    model = UserModel(
        owner_id=owner,
        name="Support email router",
        job="Reads a support email and says which product it is about and how urgent it is.",
        answer_kind="text",
        choices=[],
        current_version=2,
    )
    session.add(model)
    session.flush()
    rows = list(SUPPORT)
    for n in range(8, 19):
        rows.append(
            (
                f"Question {n} about the web dashboard.",
                "Product: Web dashboard. Urgency: Low.",
                "contains",
                ["web dashboard", "low"],
                None,
            )
        )
    cases = [
        ModelTestCase(
            model_id=model.id,
            case_key=uuid.uuid4(),
            input=input_,
            expected=expected,
            scoring=scoring,
            must_contain=phrases,
            rubric=rubric,
            judge_model=HAIKU if scoring == "judge" else None,
            created_at=NOW - timedelta(days=1),
        )
        for input_, expected, scoring, phrases, rubric in rows
    ]
    session.add_all(cases)
    session.flush()
    ids = [c.id for c in cases]
    _version(
        session,
        model,
        1,
        ids[:17],
        "Imported 17 tests from support.csv",
        owner,
        NOW - timedelta(days=1),
    )
    _version(session, model, 2, ids, "Added test 18", owner, NOW - timedelta(hours=3))


def seed_verdicts(session, owner: uuid.UUID) -> None:
    """The two runs behind the drawer's Last run box on Support email router's test 7."""
    model = session.execute(
        select(UserModel).where(
            UserModel.owner_id == owner, UserModel.name == "Support email router"
        )
    ).scalar_one()
    version = session.execute(
        select(ModelTestSetVersion).where(
            ModelTestSetVersion.model_id == model.id, ModelTestSetVersion.version == 2
        )
    ).scalar_one()
    by_id = {
        c.id: c
        for c in session.execute(
            select(ModelTestCase).where(ModelTestCase.model_id == model.id)
        ).scalars()
    }
    cases = [by_id[uuid.UUID(i)] for i in version.case_ids]
    when = NOW - timedelta(hours=1)

    def good(reason):
        def answers(n, case):
            if n == 7:
                return case.expected, *reason
            return case.expected, "pass", None

        return answers

    _run(
        session, model, version, cases, GROQ,
        good(("fail", "Marks it medium urgency, though it blocks work tomorrow.")), owner,
        cost=0.01, latency_ms=700, when=when, judge=HAIKU,
    )  # fmt: skip
    _run(
        session, model, version, cases, SONNET,
        good(("pass", "Names the app and marks it high.")), owner,
        cost=0.05, latency_ms=1500, when=when + timedelta(seconds=1), judge=HAIKU,
    )  # fmt: skip


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--email", required=True)
    parser.add_argument("--verdicts", action="store_true", help="add test 7's verdict runs")
    args = parser.parse_args()
    _refuse_foreign_databases()
    with session_scope() as session:
        owner = _account(session, args.email)
        if args.verdicts:
            seed_verdicts(session, owner)
        else:
            seed_claims(session, owner)
            seed_support(session, owner)
    print(f"seeded {args.email} (password: {PASSWORD})")


if __name__ == "__main__":
    main()
