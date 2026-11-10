"""Fill a local database with the M2 canvas's sample data (prompts/m2-design), no model calls.

    DATABASE_URL=postgresql://…/tvashtr_scratch \\
        backend/.venv/bin/python scripts/m2_seed.py --email you@tvashtr.local --state drafts

``--state drafts`` (Draft dialog, Drafts tab, a drafting and a stopped batch, Needs you): "Claims
triage" on test set v4 (50 tests) and training set v2 (120 examples), a finished batch of 30
drafts from the Example builder (the canvas's four cards first; the Reviewer checked 10 and sent
back once), five earlier drafting runs at $0.003 a draft (so the dialog's estimate reads "about
$0.09 … your last 6 runs"), the Domains "Claims handbook" (14 files) and "Policy wordings" (6), and the teams "Example
builder" and "Example builder, two reviewers". Two more models carry a drafting and a stopped batch.

``--state accepted`` (the locked Tests tab, the Training tab, the canvas, empty states): "Claims
triage" after accepting — test set v5 with 59 tests (1–3 by hand; 51–54 from drafts, with sources)
and training set v3 with 138 examples (121–127 the canvas's rows), and "Support email router" with
nothing drafted or trained yet.

The account is made when missing (password ``models-seed-pass``) with dummy keys for Google Cloud
and DeepSeek. Refuses ``tvashtr_film`` and any database that isn't on this machine.
"""

import argparse
import os
import sys
import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))
sys.path.insert(0, os.path.dirname(__file__))

from models_seed import (  # noqa: E402
    PASSWORD,
    _choice_answers,
    _refuse_foreign_databases,
    _run,
    _version,
)
from sqlalchemy import select  # noqa: E402

from tvashtr.auth import hash_password  # noqa: E402
from tvashtr.control_plane.credentials import encrypt_secret  # noqa: E402
from tvashtr.control_plane.teams import (  # noqa: E402
    build_example_builder_team,
    ensure_example_builder,
)
from tvashtr.db import session_scope  # noqa: E402
from tvashtr.models import (  # noqa: E402
    AgentInvocation,
    AgentNode,
    Domain,
    DomainDocument,
    ModelExampleBatch,
    ModelExampleDraft,
    ModelTestCase,
    ModelTrainingExample,
    ModelTrainingSetVersion,
    ProviderCredential,
    Run,
    TeamGraph,
    User,
    UserModel,
)

NOW = datetime.now(UTC)
FLASH = "vertex_ai/gemini-3-flash-preview"
DEEPSEEK = "deepseek/deepseek-chat"
CHOICES = ["Motor", "Property", "Health", "Travel", "Fraud review", "Other"]
JOB = "Reads a new insurance claim and picks the team that should handle it."
HAND = [
    (
        "Rear-ended at a red light on NH-48. Bumper and tail lamp damaged; the other driver "
        "admits fault.",
        "Motor",
    ),
    (
        "Water from the flat above came through the ceiling during the storm. Plaster and a sofa "
        "ruined.",
        "Property",
    ),
    (
        "Admitted for dengue for four days at a network hospital. Cashless claim declined at "
        "discharge.",
        "Health",
    ),
]
FROM_DRAFTS = [  # TestsLocked.dc.html tests 51–54
    (
        "My parked car was hit by a reversing truck in the office lot. The driver left a note; "
        "rear door dented.",
        "Motor",
        "motor-claims-guide.pdf",
        "page 4",
        "Damage caused by another vehicle, moving or parked, is handled by Motor.",
    ),
    (
        "Missed a connecting flight in Doha because the first leg was late. Paid for a hotel "
        "night.",
        "Travel",
        "travel-policy-wording.pdf",
        "page 9",
        "Missed connections caused by a delayed earlier leg are covered under Travel.",
    ),
    (
        "Two claims for the same phone within a week, with invoices from a shop that has since "
        "closed.",
        "Fraud review",
        "fraud-signals.md",
        None,
        "Repeat claims for one item within 30 days go to Fraud review.",
    ),
    (
        "Asking whether hearing aids for my father are covered under the family floater.",
        "Other",
        "health-cashless-rules.pdf",
        "page 7",
        "Questions about cover, with no loss, are answered by the help desk, not a claims team.",
    ),
]
TRAINING = [  # Training.dc.html examples 121–127
    ("Claiming for a laptop stolen on a train. The bill is dated two days after the theft report.",
     "Fraud review", "fraud-signals.md", None,
     "Send to Fraud review any claim where a purchase document is dated after the loss.", False),
    ("Bike hit a pothole and the rider fractured a wrist. The front wheel rim is cracked.",
     "Motor", "motor-claims-guide.pdf", "page 6",
     "Own-damage to two-wheelers, with or without injury to the rider, goes to Motor.", False),
    ("Kitchen fire spread to the dining room. Cupboards, the fridge and the false ceiling burned.",
     "Property", "property-cover.pdf", "page 3",
     "Fire damage to the building and its contents is handled by Property.", False),
    ("Passport stolen at a hotel in Bali, so I missed the flight home and had to stay two more "
     "nights.", "Travel", "travel-policy-wording.pdf", "page 12",
     "Loss of passport abroad, and the extra stay it causes, is covered under Travel.", False),
    ("Reimbursement for physiotherapy after knee surgery last month at a non-network clinic.",
     "Health", "health-cashless-rules.pdf", "page 5",
     "Post-hospital treatment within 60 days is reimbursed by the Health team.", False),
    ("Want to add my newborn to the family policy. No claim to make.",
     "Other", "health-cashless-rules.pdf", "page 7",
     "Questions about cover, with no loss, are answered by the help desk.", True),
    ("Third windscreen claim this year on the same car, each from a different garage.",
     "Fraud review", "fraud-signals.md", None,
     "Three or more claims of one kind on one policy in a year go to Fraud review.", False),
]  # fmt: skip
CARDS = [  # Drafts.dc.html, the four cards
    dict(
        kind="test", answer="Motor",
        input="My parked car was hit by a reversing truck in the office lot. The driver left a "
        "note with his number; rear door dented.",
        file="motor-claims-guide.pdf", locator="page 4",
        quote="Damage to an insured vehicle caused by another vehicle, whether moving or parked, "
        "is handled by the Motor team, including hit-and-run cases.",
        review="ok", note="the quote covers a parked car hit by another vehicle; Motor is right.",
    ),
    dict(
        kind="training", answer="Fraud review",
        input="Claiming for a laptop stolen on a train. The bill is dated two days after the "
        "theft report.",
        file="fraud-signals.md", locator="section 2",
        quote="Send to Fraud review any claim where a purchase document is dated after the loss "
        "it supports.",
        review="none", note=None,
    ),
    dict(
        kind="test", answer="Property",
        input="A tree fell on my car in the society parking during the cyclone. The windscreen "
        "and roof are crushed.",
        file="property-cover.pdf", locator="page 11",
        quote="Storm, cyclone and flood damage to the insured building and its contents is "
        "handled by the Property team.",
        review="flagged",
        note="the quote covers the building and contents, not a car. A car hit by a tree is "
        "likely Motor. Fix the answer or reject it.",
    ),
    dict(
        kind="training", answer="Health",
        input=HAND[2][0],
        file="health-cashless-rules.pdf", locator="page 2",
        quote="Declined or partly approved cashless claims at network hospitals go to the Health "
        "team for review.",
        review="none", note=None,
    ),
]  # fmt: skip


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
    for provider in {"vertex_ai", "deepseek"} - held:
        session.add(
            ProviderCredential(
                owner_id=user.id,
                provider=provider,
                secret_encrypted=encrypt_secret("dummy-seed-key-0000"),
                key_last4="0000",
            )
        )
    return user.id


def _source(file, locator, quote):
    out = {"file": file, "quote": quote}
    if locator:
        out["locator"] = locator
    return out


def _domains(session, owner) -> uuid.UUID:
    first = None
    for name, n in (("Claims handbook", 14), ("Policy wordings", 6)):
        d = Domain(owner_id=owner, name=name, template="blank", config={})
        session.add(d)
        session.flush()
        first = first or d.id
        for i in range(n):
            session.add(
                DomainDocument(
                    domain_id=d.id,
                    filename=f"file-{i + 1}.md",
                    content_type="text/markdown",
                    storage_path=f"m2-seed/{uuid.uuid4().hex}",
                    byte_size=100,
                    ingest_status="ready",
                )
            )
    return first


def _teams(owner) -> tuple[uuid.UUID, str]:
    builder = uuid.UUID(ensure_example_builder(owner))
    second = uuid.UUID(build_example_builder_team(name="Example builder, two reviewers"))
    with session_scope() as session:
        team = session.get(TeamGraph, second)
        team.is_library, team.owner_id = True, owner
        for graph in (builder, second):
            for node in session.execute(
                select(AgentNode).where(AgentNode.team_graph_id == graph)
            ).scalars():
                if node.role_name in ("reader", "writer"):
                    node.model = FLASH
                elif node.role_name == "reviewer":
                    node.model = DEEPSEEK
    return builder, "Example builder"


def _model(session, owner, name, tests: int, training: int, test_v: int, train_v: int):
    model = UserModel(
        owner_id=owner,
        name=name,
        job=JOB,
        answer_kind="choice",
        choices=CHOICES,
        current_version=test_v,
        training_version=train_v,
        created_at=NOW - timedelta(days=3),
    )
    session.add(model)
    session.flush()
    return model


def _tests(session, model, owner, count, from_drafts: bool):
    rows = []
    for i in range(count):
        n = i + 1
        if n <= 3:
            input_, answer = HAND[i]
            rows.append(
                ModelTestCase(
                    model_id=model.id,
                    case_key=uuid.uuid4(),
                    input=input_,
                    expected=answer,
                    scoring="exact",
                    origin="hand",
                )
            )
        elif from_drafts and 51 <= n <= 54:
            input_, answer, file, loc, quote = FROM_DRAFTS[n - 51]
            rows.append(
                ModelTestCase(
                    model_id=model.id,
                    case_key=uuid.uuid4(),
                    input=input_,
                    expected=answer,
                    scoring="exact",
                    origin="draft",
                    origin_note="Example builder",
                    source=_source(file, loc, quote),
                )
            )
        elif from_drafts and n > 50:
            rows.append(
                ModelTestCase(
                    model_id=model.id,
                    case_key=uuid.uuid4(),
                    input=f"Drafted claim {n} about a motor accident.",
                    expected="Motor",
                    scoring="exact",
                    origin="draft",
                    origin_note="Example builder",
                    source=_source(
                        "motor-claims-guide.pdf",
                        "page 4",
                        "Damage caused by another vehicle, moving or parked, is handled by Motor.",
                    ),
                )
            )
        else:
            rows.append(
                ModelTestCase(
                    model_id=model.id,
                    case_key=uuid.uuid4(),
                    input=f"Claim {n}: a car scraped in a car park.",
                    expected=CHOICES[n % 6],
                    scoring="exact",
                    origin="hand",
                )
            )
    session.add_all(rows)
    session.flush()
    return rows


def _training(session, model, count, first_from_canvas: int | None):
    rows = []
    for i in range(count):
        n = i + 1
        if first_from_canvas and first_from_canvas <= n < first_from_canvas + len(TRAINING):
            input_, answer, file, loc, quote, edited = TRAINING[n - first_from_canvas]
        else:
            input_, answer, file, loc, quote, edited = (
                f"Training claim {n}: a phone lost at a mall.", "Other", "fraud-signals.md", None,
                "Questions about cover, with no loss, are answered by the help desk.", False,
            )  # fmt: skip
        rows.append(
            ModelTrainingExample(
                model_id=model.id,
                example_key=uuid.uuid4(),
                input=input_,
                answer=answer,
                source=_source(file, loc, quote),
                origin="draft",
                origin_note="Example builder",
                edited=edited,
            )  # fmt: skip
        )
    session.add_all(rows)
    session.flush()
    return rows


def _train_version(session, model, number, ids, note, owner, when):
    session.add(
        ModelTrainingSetVersion(
            model_id=model.id,
            version=number,
            example_ids=[str(i) for i in ids],
            change_note=note,
            created_by=owner,
            created_at=when,
        )  # fmt: skip
    )


def _run_row(session, owner, team_id, status, when) -> uuid.UUID:
    run = Run(
        id=uuid.uuid4(), team_graph_id=team_id, owner_id=owner, idea="Draft examples",
        workflow_id=str(uuid.uuid4()), status=status, library_team_id=team_id, created_at=when,
    )  # fmt: skip
    session.add(run)
    session.flush()
    return run.id


def _batch(session, model, owner, team_id, domain_id, *, status, run_status, when, cost,
           drafts_open: int, cards: bool, sent_back=0, reviewed=0, wanted=(10, 20),
           verdicts=()):  # fmt: skip
    run_id = _run_row(session, owner, team_id, run_status, when)
    batch = ModelExampleBatch(
        model_id=model.id, owner_id=owner, run_id=run_id, domain_id=domain_id,
        domain_name="Claims handbook", team_id=team_id, team_name="Example builder",
        tests_wanted=wanted[0], training_wanted=wanted[1], status=status,
        review_rounds=sent_back + 1, sent_back=sent_back,
        cost_usd=Decimal(str(cost)) if cost is not None else None,
        estimate_usd=Decimal("0.09"), created_at=when - timedelta(minutes=6),
        completed_at=when if status == "ready" else None,
    )  # fmt: skip
    session.add(batch)
    session.flush()
    for i in range(drafts_open):
        n = i + 1
        if cards and n <= len(CARDS):
            c = CARDS[i]
        else:
            kind = "test" if n <= 12 else "training"
            c = dict(
                kind=kind,
                answer=CHOICES[n % 6],
                input=f"Drafted case {n}: water damage after a pipe burst.",
                file="property-cover.pdf",
                locator="page 3",
                quote="Fire damage to the building and its contents is handled by Property.",
                review="ok" if 4 < n <= reviewed + 2 else "none",
                note="The quote supports the answer." if 4 < n <= reviewed + 2 else None,
            )
        if cards and n == 13:  # the canvas's second flagged draft
            c = {**c, "review": "flagged", "note": "The input reads like a quote from the file."}
        review = c["review"]
        session.add(
            ModelExampleDraft(
                batch_id=batch.id,
                model_id=model.id,
                position=n,
                kind=c["kind"],
                input=c["input"],
                answer=c["answer"],
                must_contain=[],
                source=_source(c["file"], c["locator"], c["quote"]),
                review=review,
                review_note=c["note"],
                reviewed_by="Reviewer" if review != "none" else None,
                was_flagged=review == "flagged",
                state="open",
            )  # fmt: skip
        )
    if verdicts:
        reviewer = session.execute(
            select(AgentNode.id).where(
                AgentNode.team_graph_id == team_id, AgentNode.role_name == "reviewer"
            )
        ).scalar_one()
        for i, outcome in enumerate(verdicts, 1):
            session.add(
                AgentInvocation(
                    run_id=str(run_id),
                    node_id=reviewer,
                    iteration=i,
                    status="done",
                    outcome=outcome,
                    started_at=when - timedelta(minutes=4 - i),
                    ended_at=when,
                )  # fmt: skip
            )
    return batch


def seed_drafts(owner) -> None:
    builder, _ = _teams(owner)
    with session_scope() as session:
        domain_id = _domains(session, owner)
        model = _model(session, owner, "Claims triage", 50, 120, 4, 2)
        tests = _tests(session, model, owner, 50, from_drafts=False)
        version = _version(session, model, 4, [t.id for t in tests], "Added test 50", owner,
                           NOW - timedelta(hours=2))  # fmt: skip
        for v in (1, 2, 3):
            _version(session, model, v, [t.id for t in tests[: 40 + v]], f"Added test {40 + v}",
                     owner, NOW - timedelta(days=4 - v))  # fmt: skip
        training = _training(session, model, 120, None)
        _train_version(
            session,
            model,
            1,
            [e.id for e in training[:100]],
            "Imported 100 examples from seed.csv",
            owner,
            NOW - timedelta(days=2),
        )
        _train_version(
            session,
            model,
            2,
            [e.id for e in training],
            "Added 20 examples from Example builder",
            owner,
            NOW - timedelta(days=1),
        )
        for slug in ("anthropic/claude-sonnet-5-5", DEEPSEEK, "groq/openai/gpt-oss-120b"):
            _run(session, model, version, tests, slug, _choice_answers({}), owner, cost=0.02,
                 latency_ms=1200, when=NOW - timedelta(hours=1))  # fmt: skip
        # Five earlier drafting runs ($0.03 for 10 drafts each, all accepted) and the canvas's own
        # make the dialog's "your last 6 runs".
        for k in range(5):
            b = _batch(session, model, owner, builder, domain_id, status="ready",
                       run_status="completed", when=NOW - timedelta(days=5 + k), cost=0.03,
                       drafts_open=10, cards=False)  # fmt: skip
            for d in session.execute(
                select(ModelExampleDraft).where(ModelExampleDraft.batch_id == b.id)
            ).scalars():
                d.state = "accepted"
        # The canvas's batch: 30 drafts, the Reviewer checked 10 and sent back once.
        _batch(session, model, owner, builder, domain_id, status="ready", run_status="completed",
               when=NOW - timedelta(minutes=3), cost=0.08, drafts_open=30, cards=True,
               sent_back=1, reviewed=9,
               verdicts=("changes_requested", "approved"))  # fmt: skip
        # A team still drafting, and one that stopped.
        busy = _model(session, owner, "Support email router", 0, 0, 0, 0)
        _batch(session, busy, owner, builder, domain_id, status="drafting", run_status="running",
               when=NOW - timedelta(minutes=1), cost=None, drafts_open=7, cards=False,
               wanted=(4, 6))  # fmt: skip
        stopped = _model(session, owner, "Refund triage", 0, 0, 0, 0)
        _batch(session, stopped, owner, builder, domain_id, status="drafting",
               run_status="failed", when=NOW - timedelta(minutes=20), cost=0.02, drafts_open=5,
               cards=False, wanted=(4, 6))  # fmt: skip


def seed_accepted(owner) -> None:
    _teams(owner)
    with session_scope() as session:
        _domains(session, owner)
        model = _model(session, owner, "Claims triage", 59, 138, 5, 3)
        tests = _tests(session, model, owner, 59, from_drafts=True)
        order = tests[:3] + tests[50:54] + tests[3:50] + tests[54:]
        _version(session, model, 4, [t.id for t in tests[:50]], "Added test 50", owner,
                 NOW - timedelta(hours=3))  # fmt: skip
        version = _version(session, model, 5, [t.id for t in order],
                           "Added 9 tests from Example builder", owner,
                           NOW - timedelta(minutes=12))  # fmt: skip
        current = [t for t in order[:3]]
        for slug in ("anthropic/claude-sonnet-5-5", DEEPSEEK, "groq/openai/gpt-oss-120b"):
            _run(session, model, version, current, slug, _choice_answers({}), owner, cost=0.02,
                 latency_ms=1200, when=NOW - timedelta(minutes=5))  # fmt: skip
        examples = _training(session, model, 138, 121)
        canvas = examples[120:127]
        rest = examples[:120] + examples[127:]
        _train_version(
            session,
            model,
            2,
            [e.id for e in examples[:120]],
            "Added 20 examples from Example builder",
            owner,
            NOW - timedelta(days=1),
        )
        _train_version(session, model, 3, [e.id for e in canvas + rest],
                       "Added 18 examples from Example builder", owner,
                       NOW - timedelta(minutes=12))  # fmt: skip
        for i, e in enumerate(canvas + rest):
            e.created_at = NOW - timedelta(minutes=12) + timedelta(seconds=i)
        _model(session, owner, "Support email router", 0, 0, 0, 0)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--email", required=True)
    parser.add_argument("--state", choices=("drafts", "accepted"), required=True)
    args = parser.parse_args()
    _refuse_foreign_databases()
    with session_scope() as session:
        owner = _account(session, args.email)
    (seed_drafts if args.state == "drafts" else seed_accepted)(owner)
    print(f"seeded {args.email} ({args.state}; password: {PASSWORD})")


if __name__ == "__main__":
    main()
