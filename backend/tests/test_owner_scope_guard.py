# ruff: noqa: E501 — ROUTES is a data table; its reasons are kept on one line each.
"""Security S1 (C): every route the app serves is in the owner-scope sweep's table.

``ROUTES`` classifies each route: ``id`` (takes an object id, in the path or the body: another
account gets 404 and the owner's object is unchanged), ``list`` (another account sees none of the
owner's rows), ``own`` (acts only on the caller's own account, with no other account's ids) or
``public`` (by design, with the reason). An ``id`` or ``list`` route names the tests that prove it
(``tests/test_owner_scope_<family>.py``).

A route added without a row here fails ``test_every_route_is_in_the_sweep``: add its row, and for
``id``/``list`` its owner-scope test, so no new route skips the sweep."""

import importlib

from starlette.routing import Mount, Route

from tvashtr.main import app

# Served only by the production image (``main.mount_frontend``, when a built frontend exists).
IMAGE_ONLY = {
    "GET /{full_path:path}": ("public", "the built app shell for client-side routes (no data)"),
    "MOUNT /assets": ("public", "the built app's static files (no data)"),
}

ROUTES: dict[str, tuple[str, object]] = {
    "POST /api/ab-runs": (
        "own",
        "the body carries only idea and budget_cap_usd (ABRunRequest). It builds fresh ephemeral teams, and both runs are owned by the caller. It accepts no other account's id.",
    ),
    "GET /api/ab-runs/{pair_id}": ("id", ["test_owner_scope_runs::test_b_cannot_read_a_run"]),
    "GET /api/account/preferences": (
        "own",
        "reads only the caller's users.preferences and takes no id",
    ),
    "PATCH /api/account/preferences": (
        "own",
        "writes only the caller's users.preferences and takes no id",
    ),
    "GET /api/agents": (
        "id",
        [
            "test_owner_scope_connectors_toolkit::test_b_with_a_path_id_is_a_404_and_a_is_unchanged",
            "test_owner_scope_connectors_toolkit::test_agents_list_is_the_callers_only",
        ],
    ),
    "POST /api/auth/desktop/exchange": (
        "public",
        "Desktop auth exchange: redeems a one-time code with its PKCE verifier to get a session",
    ),
    "GET /api/auth/desktop/start": (
        "public",
        "Desktop browser sign-in start (hosted only); account=current reads only the caller's own session cookie",
    ),
    "GET /api/auth/github/callback": (
        "public",
        "GitHub OAuth sign-in callback; the OAuth exchange decides the owner",
    ),
    "GET /api/auth/github/start": (
        "public",
        "website GitHub sign-in start: sets a CSRF state cookie and redirects",
    ),
    "POST /api/auth/login": ("public", "login: how a session is obtained"),
    "POST /api/auth/logout": (
        "own",
        "only clears the caller's own tv_session cookie and takes no id",
    ),
    "GET /api/auth/me": (
        "own",
        "returns the caller's own identity from its session and takes no id",
    ),
    "POST /api/auth/register": (
        "public",
        "register: how a session is obtained (auth_router has no login dependency)",
    ),
    "GET /api/config": (
        "public",
        "public client bootstrap (hosted posture, provider and model slugs, embedding presets); no account data",
    ),
    "GET /api/connectors": (
        "list",
        ["test_owner_scope_connectors_toolkit::test_connectors_list_is_the_callers_only"],
    ),
    "POST /api/connectors": (
        "own",
        "Connects a catalog key or a custom URL for the caller and takes no account-owned id. The already-connected lookup (_by_key) filters by owner.",
    ),
    "GET /api/connectors/catalog": (
        "list",
        ["test_owner_scope_connectors_toolkit::test_catalog_marks_only_the_callers_connection"],
    ),
    "GET /api/connectors/oauth/callback": (
        "public",
        "connector OAuth callback: the finishing browser may have no session, so the owner comes from the row named by the unguessable state",
    ),
    "POST /api/connectors/oauth/confirm": (
        "public",
        "connector OAuth confirm button: the owner comes from the state row; a browser signed in as another account gets the other_account page",
    ),
    "GET /api/connectors/oauth/go": (
        "public",
        "connector OAuth hop: marks the browser for the sign-in named by the state and redirects to the provider; the state is a secret capability",
    ),
    "DELETE /api/connectors/{connection_id}": (
        "id",
        ["test_owner_scope_connectors_toolkit::test_b_with_a_path_id_is_a_404_and_a_is_unchanged"],
    ),
    "GET /api/connectors/{connection_id}": (
        "id",
        ["test_owner_scope_connectors_toolkit::test_b_with_a_path_id_is_a_404_and_a_is_unchanged"],
    ),
    "PATCH /api/connectors/{connection_id}": (
        "id",
        ["test_owner_scope_connectors_toolkit::test_b_with_a_path_id_is_a_404_and_a_is_unchanged"],
    ),
    "GET /api/connectors/{connection_id}/agents": (
        "id",
        ["test_owner_scope_connectors_toolkit::test_b_with_a_path_id_is_a_404_and_a_is_unchanged"],
    ),
    "PUT /api/connectors/{connection_id}/agents": (
        "id",
        [
            "test_owner_scope_connectors_toolkit::test_b_with_a_path_id_is_a_404_and_a_is_unchanged",
            "test_owner_scope_connectors_toolkit::test_b_with_a_node_ids_in_the_body_is_a_404_and_a_is_unchanged",
        ],
    ),
    "POST /api/connectors/{connection_id}/check": (
        "id",
        ["test_owner_scope_connectors_toolkit::test_b_with_a_path_id_is_a_404_and_a_is_unchanged"],
    ),
    "POST /api/connectors/{connection_id}/oauth/start": (
        "id",
        ["test_owner_scope_connectors_toolkit::test_b_with_a_path_id_is_a_404_and_a_is_unchanged"],
    ),
    "GET /api/connectors/{connection_id}/scope-options": (
        "id",
        ["test_owner_scope_connectors_toolkit::test_b_with_a_path_id_is_a_404_and_a_is_unchanged"],
    ),
    "GET /api/costs": ("list", ["test_owner_scope_runs::test_costs_are_owner_scoped"]),
    "POST /api/desktop-runner/claim": (
        "list",
        ["test_owner_scope_public_auth_desktop::test_claim_never_hands_another_account_a_job"],
    ),
    "POST /api/desktop-runner/jobs/{job_id}/events": (
        "id",
        [
            "test_owner_scope_public_auth_desktop::test_runner_job_route_is_a_404_for_another_account"
        ],
    ),
    "POST /api/desktop-runner/jobs/{job_id}/release": (
        "id",
        [
            "test_owner_scope_public_auth_desktop::test_runner_job_route_is_a_404_for_another_account"
        ],
    ),
    "POST /api/desktop-runner/jobs/{job_id}/result": (
        "id",
        [
            "test_owner_scope_public_auth_desktop::test_runner_job_route_is_a_404_for_another_account"
        ],
    ),
    "GET /api/desktop-runner/jobs/{job_id}/snapshot": (
        "id",
        [
            "test_owner_scope_public_auth_desktop::test_runner_job_route_is_a_404_for_another_account"
        ],
    ),
    "GET /api/desktop/release": (
        "public",
        "latest public desktop-v* GitHub release data; no account data",
    ),
    "POST /api/desktop/repo-snapshots": (
        "own",
        "creates a source bundle owned by the caller; the multipart form reads only bundle, label and base_ref (no foreign id), and its stale-purge filters on the caller's owner_id",
    ),
    "GET /api/documents": (
        "list",
        ["test_owner_scope_account_misc::test_documents_list_is_owner_scoped"],
    ),
    "GET /api/documents/{document_id}": (
        "id",
        ["test_owner_scope_account_misc::test_document_read_is_owner_scoped"],
    ),
    "POST /api/documents/{document_id}/versions": (
        "id",
        ["test_owner_scope_account_misc::test_document_version_append_is_owner_scoped"],
    ),
    "GET /api/domain-templates": (
        "own",
        "Static template catalogue (auth required): it takes no ids and returns no account rows",
    ),
    "GET /api/domains": ("list", ["test_owner_scope_domains::test_list_domains_shows_a_only_to_a"]),
    "POST /api/domains": (
        "own",
        "Creates a domain in the caller's account; the body is only a name, a template key and an embedding model slug, with no account-row ids",
    ),
    "DELETE /api/domains/{domain_id}": (
        "id",
        ["test_owner_scope_domains::test_delete_domain_is_404_for_b"],
    ),
    "GET /api/domains/{domain_id}": (
        "id",
        ["test_owner_scope_domains::test_reads_of_a_domain_are_404_for_b"],
    ),
    "PATCH /api/domains/{domain_id}": (
        "id",
        ["test_owner_scope_domains::test_patch_domain_is_404_for_b"],
    ),
    "GET /api/domains/{domain_id}/agents": (
        "id",
        ["test_owner_scope_domains::test_reads_of_a_domain_are_404_for_b"],
    ),
    "PUT /api/domains/{domain_id}/agents": (
        "id",
        ["test_owner_scope_domains::test_set_domain_agents_is_404_for_b"],
    ),
    "POST /api/domains/{domain_id}/ask": (
        "id",
        ["test_owner_scope_domains::test_ask_and_retrieve_are_404_for_b"],
    ),
    "GET /api/domains/{domain_id}/documents": (
        "id",
        ["test_owner_scope_domains::test_reads_of_a_domain_are_404_for_b"],
    ),
    "POST /api/domains/{domain_id}/documents": (
        "id",
        ["test_owner_scope_domains::test_upload_document_is_404_for_b"],
    ),
    "DELETE /api/domains/{domain_id}/documents/{document_id}": (
        "id",
        ["test_owner_scope_domains::test_delete_document_is_404_for_b"],
    ),
    "GET /api/domains/{domain_id}/documents/{document_id}/file": (
        "id",
        ["test_owner_scope_domains::test_document_reads_are_404_for_b"],
    ),
    "GET /api/domains/{domain_id}/documents/{document_id}/pieces": (
        "id",
        ["test_owner_scope_domains::test_document_reads_are_404_for_b"],
    ),
    "POST /api/domains/{domain_id}/duplicate": (
        "id",
        ["test_owner_scope_domains::test_duplicate_domain_is_404_for_b"],
    ),
    "POST /api/domains/{domain_id}/eval": (
        "id",
        ["test_owner_scope_domains::test_sync_eval_is_404_for_b"],
    ),
    "GET /api/domains/{domain_id}/eval/cases": (
        "id",
        ["test_owner_scope_domains::test_reads_of_a_domain_are_404_for_b"],
    ),
    "POST /api/domains/{domain_id}/eval/cases": (
        "id",
        [
            "test_owner_scope_domains::test_create_eval_case_on_a_domain_is_404_for_b",
            "test_owner_scope_domains::test_create_eval_case_with_a_file_id_is_refused_for_b",
        ],
    ),
    "DELETE /api/domains/{domain_id}/eval/cases/{case_id}": (
        "id",
        ["test_owner_scope_domains::test_delete_eval_case_is_404_for_b"],
    ),
    "PATCH /api/domains/{domain_id}/eval/cases/{case_id}": (
        "id",
        [
            "test_owner_scope_domains::test_patch_eval_case_is_404_for_b",
            "test_owner_scope_domains::test_patch_eval_case_with_a_file_id_is_refused_for_b",
        ],
    ),
    "GET /api/domains/{domain_id}/eval/runs": (
        "id",
        ["test_owner_scope_domains::test_reads_of_a_domain_are_404_for_b"],
    ),
    "POST /api/domains/{domain_id}/eval/runs": (
        "id",
        ["test_owner_scope_domains::test_start_eval_run_is_404_for_b"],
    ),
    "GET /api/domains/{domain_id}/eval/runs/latest": (
        "id",
        ["test_owner_scope_domains::test_reads_of_a_domain_are_404_for_b"],
    ),
    "GET /api/domains/{domain_id}/eval/runs/{run_id:uuid}": (
        "id",
        ["test_owner_scope_domains::test_eval_run_is_404_for_b"],
    ),
    "POST /api/domains/{domain_id}/ingest": (
        "id",
        ["test_owner_scope_domains::test_ingest_is_404_for_b"],
    ),
    "DELETE /api/domains/{domain_id}/messages": (
        "id",
        ["test_owner_scope_domains::test_clear_messages_is_404_for_b"],
    ),
    "GET /api/domains/{domain_id}/messages": (
        "id",
        ["test_owner_scope_domains::test_reads_of_a_domain_are_404_for_b"],
    ),
    "POST /api/domains/{domain_id}/reread": (
        "id",
        ["test_owner_scope_domains::test_reread_is_404_for_b"],
    ),
    "POST /api/domains/{domain_id}/retrieve": (
        "id",
        ["test_owner_scope_domains::test_ask_and_retrieve_are_404_for_b"],
    ),
    "GET /api/domains/{domain_id}/step-places": (
        "id",
        ["test_owner_scope_domains::test_reads_of_a_domain_are_404_for_b"],
    ),
    "POST /api/domains/{domain_id}/steps": (
        "id",
        ["test_owner_scope_domains::test_add_step_is_404_for_b"],
    ),
    "GET /api/domains/{domain_id}/usage": (
        "id",
        ["test_owner_scope_domains::test_reads_of_a_domain_are_404_for_b"],
    ),
    "GET /api/engines/subscriptions": (
        "list",
        ["test_owner_scope_account_misc::test_engine_subscriptions_list_is_owner_scoped"],
    ),
    "DELETE /api/engines/subscriptions/{provider}": (
        "id",
        ["test_owner_scope_account_misc::test_engine_subscription_delete_is_owner_scoped"],
    ),
    "PUT /api/engines/subscriptions/{provider}": (
        "own",
        "upserts the caller's own (owner, provider) status row; the provider is a fixed enum (claude/grok/codex), not another account's row id",
    ),
    "GET /api/engines/usage": (
        "list",
        ["test_owner_scope_runs::test_engine_usage_is_owner_scoped"],
    ),
    "GET /api/github/repos": (
        "list",
        ["test_owner_scope_account_misc::test_github_repos_list_is_owner_scoped"],
    ),
    "GET /api/github/repos/{owner}/{repo}/branches": (
        "id",
        ["test_owner_scope_account_misc::test_github_repo_routes_are_owner_scoped"],
    ),
    "GET /api/github/repos/{owner}/{repo}/subpaths": (
        "id",
        ["test_owner_scope_account_misc::test_github_repo_routes_are_owner_scoped"],
    ),
    "GET /api/github/status": (
        "list",
        ["test_owner_scope_account_misc::test_github_status_is_owner_scoped"],
    ),
    "GET /api/inbox": ("list", ["test_owner_scope_runs::test_inbox_is_owner_scoped"]),
    "POST /api/inbox/dismissals": (
        "id",
        ["test_owner_scope_runs::test_b_cannot_dismiss_an_item_of_a"],
    ),
    "DELETE /api/inbox/dismissals/{key:path}": (
        "id",
        ["test_owner_scope_runs::test_b_cannot_undo_a_dismissal_of_a"],
    ),
    "GET /api/memories": (
        "list",
        ["test_owner_scope_account_misc::test_memories_list_is_owner_scoped"],
    ),
    "POST /api/memories": (
        "id",
        ["test_owner_scope_account_misc::test_memory_create_refuses_another_accounts_node_id"],
    ),
    "GET /api/memories/counts": (
        "list",
        ["test_owner_scope_account_misc::test_memory_counts_are_owner_scoped"],
    ),
    "DELETE /api/memories/{memory_id}": (
        "id",
        ["test_owner_scope_account_misc::test_memory_id_routes_are_owner_scoped"],
    ),
    "PATCH /api/memories/{memory_id}": (
        "id",
        ["test_owner_scope_account_misc::test_memory_id_routes_are_owner_scoped"],
    ),
    "POST /api/memories/{memory_id}/pin": (
        "id",
        ["test_owner_scope_account_misc::test_memory_id_routes_are_owner_scoped"],
    ),
    "POST /api/memories/{memory_id}/promote": (
        "id",
        ["test_owner_scope_account_misc::test_memory_id_routes_are_owner_scoped"],
    ),
    "POST /api/memories/{memory_id}/reject": (
        "id",
        ["test_owner_scope_account_misc::test_memory_id_routes_are_owner_scoped"],
    ),
    "POST /api/memories/{memory_id}/requeue": (
        "id",
        ["test_owner_scope_account_misc::test_memory_id_routes_are_owner_scoped"],
    ),
    "POST /api/memories/{memory_id}/unpin": (
        "id",
        ["test_owner_scope_account_misc::test_memory_id_routes_are_owner_scoped"],
    ),
    "GET /api/memory/repos": (
        "list",
        [
            "test_owner_scope_account_misc::test_memory_repos_are_owner_scoped",
            "test_owner_scope_account_misc::test_memory_repos_include_github_is_owner_scoped",
        ],
    ),
    "GET /api/memory/review-mode": (
        "own",
        "reads only the caller's users.memory_review_mode and takes no id",
    ),
    "PATCH /api/memory/review-mode": (
        "own",
        "writes only the caller's users.memory_review_mode and takes no id",
    ),
    "GET /api/node-templates": (
        "own",
        "Returns the fixed, code-resident agent template list. The router is mounted behind get_current_user. It takes no id and reads no account rows.",
    ),
    "GET /api/providers": (
        "list",
        ["test_owner_scope_account_misc::test_providers_list_is_owner_scoped"],
    ),
    "POST /api/providers": (
        "own",
        "create-or-replace of the caller's own (owner, provider) key; the provider slug is a global vocabulary word, not another account's row id",
    ),
    "DELETE /api/providers/{provider}": (
        "id",
        ["test_owner_scope_account_misc::test_provider_delete_is_owner_scoped"],
    ),
    "GET /api/public/site": (
        "public",
        "public website facts (repo URL, star count, latest release); site_info reads no account rows",
    ),
    "POST /api/repo/inspect": (
        "own",
        "the body is a server filesystem path, not a row any account owns; hosted (multi-account) mode refuses it outright",
    ),
    "GET /api/runs": ("list", ["test_owner_scope_runs::test_run_list_is_owner_scoped"]),
    "POST /api/runs": ("id", ["test_owner_scope_runs::test_b_cannot_launch_on_a_object"]),
    "GET /api/runs/{run_id}": ("id", ["test_owner_scope_runs::test_b_cannot_read_a_run"]),
    "GET /api/runs/{run_id}/activity": (
        "id",
        ["test_owner_scope_runs::test_b_cannot_read_a_run"],
    ),
    "POST /api/runs/{run_id}/cancel": ("id", ["test_owner_scope_runs::test_b_cannot_cancel_a_run"]),
    "GET /api/runs/{run_id}/diff": ("id", ["test_owner_scope_runs::test_b_cannot_read_a_run"]),
    "GET /api/runs/{run_id}/documents": ("id", ["test_owner_scope_runs::test_b_cannot_read_a_run"]),
    "GET /api/runs/{run_id}/graph": ("id", ["test_owner_scope_runs::test_b_cannot_read_a_run"]),
    "GET /api/runs/{run_id}/memories": ("id", ["test_owner_scope_runs::test_b_cannot_read_a_run"]),
    "POST /api/runs/{run_id}/nodes/{node_id}/ask": (
        "id",
        ["test_owner_scope_runs::test_b_cannot_ask_a_node_of_a_run"],
    ),
    "GET /api/runs/{run_id}/resume": (
        "id",
        ["test_owner_scope_runs::test_b_cannot_read_or_resume_a_run"],
    ),
    "POST /api/runs/{run_id}/resume": (
        "id",
        ["test_owner_scope_runs::test_b_cannot_read_or_resume_a_run"],
    ),
    "GET /api/runs/{run_id}/next": (
        "id",
        ["test_start_from_run::test_start_from_routes_are_owner_scoped"],
    ),
    "POST /api/runs/{run_id}/next": (
        "id",
        ["test_start_from_run::test_start_from_routes_are_owner_scoped"],
    ),
    "GET /api/runs/{run_id}/carry": (
        "id",
        ["test_start_from_run::test_start_from_routes_are_owner_scoped"],
    ),
    "GET /api/runs/{run_id}/log": (
        "id",
        ["test_start_from_run::test_start_from_routes_are_owner_scoped"],
    ),
    "POST /api/runs/{run_id}/nodes/{node_id}/switch-backup": (
        "id",
        ["test_owner_scope_runs::test_b_cannot_switch_a_node_to_its_backup"],
    ),
    "GET /api/runs/{run_id}/ship-bundle": (
        "id",
        ["test_owner_scope_public_auth_desktop::test_ship_bundle_is_a_404_for_another_account"],
    ),
    "GET /api/runs/{run_id}/tasks": ("id", ["test_owner_scope_runs::test_b_cannot_read_a_run"]),
    "POST /api/runs/{run_id}/tasks/{task_id}/acknowledge": (
        "id",
        ["test_owner_scope_runs::test_b_cannot_acknowledge_a_nudge"],
    ),
    "POST /api/runs/{run_id}/tasks/{task_id}/resolve": (
        "id",
        ["test_owner_scope_runs::test_b_cannot_resolve_a_gate_task"],
    ),
    "GET /api/runs/{run_id}/trajectory": (
        "id",
        ["test_owner_scope_runs::test_b_cannot_read_a_run"],
    ),
    "GET /api/secrets": (
        "list",
        [
            "test_owner_scope_connectors_toolkit::test_secrets_list_is_the_callers_only",
            "test_owner_scope_connectors_toolkit::test_creating_with_a_name_a_has_makes_bs_own_and_leaves_as_alone",
        ],
    ),
    "POST /api/secrets": (
        "own",
        "Create-only, in the caller's account. Secret names are per account, so the name is not a foreign key.",
    ),
    "DELETE /api/secrets/{name}": (
        "id",
        ["test_owner_scope_connectors_toolkit::test_b_with_a_path_id_is_a_404_and_a_is_unchanged"],
    ),
    "PUT /api/secrets/{name}": (
        "id",
        ["test_owner_scope_connectors_toolkit::test_b_with_a_path_id_is_a_404_and_a_is_unchanged"],
    ),
    "GET /api/skill-library": (
        "list",
        ["test_owner_scope_connectors_toolkit::test_skill_library_list_is_the_callers_only"],
    ),
    "POST /api/skill-library": (
        "own",
        "Creates in the caller's library. Names are per account; ?on_conflict=replace upserts within the caller's rows only.",
    ),
    "POST /api/skill-library/import": (
        "own",
        "Creates rows in the caller's library from a URL, SHA and skill names. Name conflicts are looked up among the caller's rows only (skill_repo.import_skills filters by owner_id).",
    ),
    "POST /api/skill-library/scan": (
        "own",
        "Takes a GitHub URL and ref, not an account-owned id. It reads only with the caller's own GitHub App installations, and in_library is computed from the caller's own skill names.",
    ),
    "DELETE /api/skill-library/{item_id}": (
        "id",
        ["test_owner_scope_connectors_toolkit::test_b_with_a_path_id_is_a_404_and_a_is_unchanged"],
    ),
    "PATCH /api/skill-library/{item_id}": (
        "id",
        ["test_owner_scope_connectors_toolkit::test_b_with_a_path_id_is_a_404_and_a_is_unchanged"],
    ),
    "GET /api/skill-library/{skill_id}": (
        "id",
        ["test_owner_scope_connectors_toolkit::test_b_with_a_path_id_is_a_404_and_a_is_unchanged"],
    ),
    "GET /api/skill-library/{skill_id}/agents": (
        "id",
        ["test_owner_scope_connectors_toolkit::test_b_with_a_path_id_is_a_404_and_a_is_unchanged"],
    ),
    "PUT /api/skill-library/{skill_id}/agents": (
        "id",
        [
            "test_owner_scope_connectors_toolkit::test_b_with_a_path_id_is_a_404_and_a_is_unchanged",
            "test_owner_scope_connectors_toolkit::test_b_with_a_node_ids_in_the_body_is_a_404_and_a_is_unchanged",
        ],
    ),
    "POST /api/skill-library/{skill_id}/duplicate": (
        "id",
        ["test_owner_scope_connectors_toolkit::test_b_with_a_path_id_is_a_404_and_a_is_unchanged"],
    ),
    "GET /api/skill-presets": (
        "public",
        "Static skill presets served with no session (main.skill_presets has no auth dependency). They hold no account data.",
    ),
    "GET /api/spend": ("list", ["test_owner_scope_runs::test_spend_is_owner_scoped"]),
    "POST /api/spike/generate-doc": (
        "own",
        "takes only a topic; starts a doc_writer workflow under an id naming the caller (routers.spike_workflow_id)",
    ),
    "GET /api/spike/generate-doc/{workflow_id}": (
        "id",
        [
            "test_owner_scope_account_misc::test_spike_generate_doc_status_is_owner_scoped_run_workflow",
            "test_owner_scope_account_misc::test_spike_generate_doc_status_is_owner_scoped_started_workflow",
        ],
    ),
    "POST /api/spike/hello-durable": (
        "own",
        "starts a demo workflow under an id naming the caller (routers.spike_workflow_id); takes no id",
    ),
    "GET /api/spike/hello-durable/{workflow_id}": (
        "id",
        [
            "test_owner_scope_public_auth_desktop::test_hello_durable_status_is_a_404_for_another_account"
        ],
    ),
    "GET /api/spike/run-events/{run_id}": (
        "id",
        ["test_owner_scope_runs::test_b_cannot_read_a_run"],
    ),
    "GET /api/teams": ("list", ["test_owner_scope_teams::test_team_list_is_owner_scoped"]),
    "POST /api/teams": (
        "own",
        "Creates a team for the caller from {template, name, use_plans}. use_plans reads only the caller's own subscriptions. It takes no foreign id.",
    ),
    "DELETE /api/teams/{team_id}": (
        "id",
        ["test_owner_scope_teams::test_b_gets_404_for_a_path_ids"],
    ),
    "PATCH /api/teams/{team_id}": (
        "id",
        ["test_owner_scope_teams::test_b_gets_404_for_a_path_ids"],
    ),
    "POST /api/teams/{team_id}/duplicate": (
        "id",
        ["test_owner_scope_teams::test_b_gets_404_for_a_path_ids"],
    ),
    "POST /api/teams/{team_id}/edges": (
        "id",
        [
            "test_owner_scope_teams::test_b_gets_404_for_a_path_ids",
            "test_owner_scope_teams::test_edge_create_with_a_nodes_in_body_is_404",
        ],
    ),
    "DELETE /api/teams/{team_id}/edges/{edge_id}": (
        "id",
        [
            "test_owner_scope_teams::test_b_gets_404_for_a_path_ids",
            "test_owner_scope_teams::test_b_own_team_with_a_node_or_edge_is_404",
        ],
    ),
    "PATCH /api/teams/{team_id}/edges/{edge_id}": (
        "id",
        [
            "test_owner_scope_teams::test_b_gets_404_for_a_path_ids",
            "test_owner_scope_teams::test_b_own_team_with_a_node_or_edge_is_404",
        ],
    ),
    "GET /api/teams/{team_id}/nodes/{node_id}/tests": (
        "id",
        ["test_agent_tests::test_agent_tests_are_owner_scoped"],
    ),
    "POST /api/teams/{team_id}/nodes/{node_id}/tests": (
        "id",
        ["test_agent_tests::test_agent_tests_are_owner_scoped"],
    ),
    "GET /api/teams/{team_id}/nodes/{node_id}/tests/from-round": (
        "id",
        ["test_agent_tests::test_agent_tests_are_owner_scoped"],
    ),
    "DELETE /api/teams/{team_id}/nodes/{node_id}/tests/{test_id}": (
        "id",
        ["test_agent_tests::test_agent_tests_are_owner_scoped"],
    ),
    "POST /api/teams/{team_id}/nodes/{node_id}/tests/file/check": (
        "id",
        ["test_agent_tests::test_agent_tests_are_owner_scoped"],
    ),
    "POST /api/teams/{team_id}/nodes/{node_id}/tests/file": (
        "id",
        ["test_agent_tests::test_agent_tests_are_owner_scoped"],
    ),
    "POST /api/teams/{team_id}/nodes/{node_id}/tests/run": (
        "id",
        ["test_agent_tests::test_agent_tests_are_owner_scoped"],
    ),
    "POST /api/teams/{team_id}/nodes/{node_id}/tests/stop": (
        "id",
        ["test_agent_tests::test_agent_tests_are_owner_scoped"],
    ),
    "GET /api/teams/{team_id}/nodes/{node_id}/tests/results/{result_id}": (
        "id",
        ["test_agent_tests::test_agent_tests_are_owner_scoped"],
    ),
    "GET /api/teams/{team_id}/nodes/{node_id}/tests/{test_id}/answers": (
        "id",
        ["test_agent_tests::test_agent_tests_are_owner_scoped"],
    ),
    "POST /api/teams/{team_id}/nodes/{node_id}/tests/{test_id}/judge": (
        "id",
        ["test_agent_tests::test_agent_tests_are_owner_scoped"],
    ),
    "GET /api/my-agents": ("list", ["test_my_agents::test_my_agents_are_owner_scoped"]),
    "POST /api/my-agents": ("id", ["test_my_agents::test_my_agents_are_owner_scoped"]),
    "PATCH /api/my-agents/{agent_id}": ("id", ["test_my_agents::test_my_agents_are_owner_scoped"]),
    "DELETE /api/my-agents/{agent_id}": ("id", ["test_my_agents::test_my_agents_are_owner_scoped"]),
    "POST /api/my-agents/{agent_id}/update-team": (
        "id",
        ["test_my_agents::test_my_agents_are_owner_scoped"],
    ),
    "POST /api/my-agents/{agent_id}/use-in-team": (
        "id",
        ["test_my_agents::test_my_agents_are_owner_scoped"],
    ),
    "POST /api/teams/{team_id}/nodes/{node_id}/use-agent": (
        "id",
        ["test_my_agents::test_my_agents_are_owner_scoped"],
    ),
    "POST /api/teams/{team_id}/nodes/{node_id}/undo-agent": (
        "id",
        ["test_my_agents::test_my_agents_are_owner_scoped"],
    ),
    "POST /api/teams/{team_id}/nodes/{node_id}/detach-agent": (
        "id",
        ["test_my_agents::test_my_agents_are_owner_scoped"],
    ),
    "GET /api/recent-tasks": (
        "list",
        ["test_my_agents::test_recent_tasks_are_one_per_task_newest_first_and_only_yours"],
    ),
    "GET /api/teams/{team_id}/compare": (
        "id",
        ["test_compare::test_compare_routes_are_owner_scoped"],
    ),
    "GET /api/teams/{team_id}/compare/changes": (
        "id",
        ["test_compare::test_compare_routes_are_owner_scoped"],
    ),
    "POST /api/teams/{team_id}/compare": (
        "id",
        [
            "test_compare::test_compare_routes_are_owner_scoped",
            "test_task_sets::test_task_set_routes_are_owner_scoped",
        ],
    ),
    "GET /api/compares/{compare_id}": (
        "id",
        ["test_compare::test_compare_routes_are_owner_scoped"],
    ),
    "POST /api/compares/{compare_id}/stop": (
        "id",
        ["test_compare::test_compare_routes_are_owner_scoped"],
    ),
    "GET /api/teams/{team_id}/task-sets": (
        "id",
        ["test_task_sets::test_task_set_routes_are_owner_scoped"],
    ),
    "POST /api/teams/{team_id}/task-sets": (
        "id",
        ["test_task_sets::test_task_set_routes_are_owner_scoped"],
    ),
    "PATCH /api/task-sets/{set_id}": (
        "id",
        ["test_task_sets::test_task_set_routes_are_owner_scoped"],
    ),
    "DELETE /api/task-sets/{set_id}": (
        "id",
        ["test_task_sets::test_task_set_routes_are_owner_scoped"],
    ),
    "GET /api/teams/{team_id}/versions": (
        "id",
        ["test_team_versions::test_versions_are_owner_scoped"],
    ),
    "POST /api/teams/{team_id}/versions": (
        "id",
        [
            "test_team_versions::test_versions_are_owner_scoped",
            "test_task_sets::test_task_set_routes_are_owner_scoped",
        ],
    ),
    "GET /api/teams/{team_id}/versions/{number}": (
        "id",
        ["test_team_versions::test_versions_are_owner_scoped"],
    ),
    "GET /api/teams/{team_id}/versions/{number}/restore": (
        "id",
        ["test_team_versions::test_versions_are_owner_scoped"],
    ),
    "POST /api/teams/{team_id}/versions/{number}/restore": (
        "id",
        ["test_team_versions::test_versions_are_owner_scoped"],
    ),
    "GET /api/teams/{team_id}/nodes/{node_id}/instruction-history": (
        "id",
        ["test_team_versions::test_versions_are_owner_scoped"],
    ),
    "GET /api/teams/{team_id}/file": (
        "id",
        ["test_team_file::test_another_account_cannot_read_a_team_file"],
    ),
    "POST /api/teams/import-check": (
        "own",
        "a dry run over the posted file text against the caller's own Toolkit, connectors, keys and"
        " Domains; it takes no id and changes nothing",
    ),
    "POST /api/teams/import": (
        "own",
        "creates a NEW library team owned by the caller from the posted file text; it takes no id"
        " and never touches an existing team",
    ),
    "GET /api/teams/{team_id}/graph": (
        "id",
        ["test_owner_scope_teams::test_b_gets_404_for_a_path_ids"],
    ),
    "POST /api/teams/{team_id}/nodes": (
        "id",
        [
            "test_owner_scope_teams::test_b_gets_404_for_a_path_ids",
            "test_owner_scope_teams::test_node_create_with_a_domain_in_body_is_404",
        ],
    ),
    "DELETE /api/teams/{team_id}/nodes/{node_id}": (
        "id",
        [
            "test_owner_scope_teams::test_b_gets_404_for_a_path_ids",
            "test_owner_scope_teams::test_b_own_team_with_a_node_or_edge_is_404",
        ],
    ),
    "PATCH /api/teams/{team_id}/nodes/{node_id}": (
        "id",
        [
            "test_owner_scope_teams::test_b_gets_404_for_a_path_ids",
            "test_owner_scope_teams::test_b_own_team_with_a_node_or_edge_is_404",
            "test_owner_scope_teams::test_node_patch_with_a_domain_in_body_is_404",
            "test_owner_scope_teams::test_node_body_with_a_toolkit_id_is_404",
        ],
    ),
    "POST /api/teams/{team_id}/nodes/{node_id}/context-preview": (
        "id",
        [
            "test_owner_scope_teams::test_b_gets_404_for_a_path_ids",
            "test_owner_scope_teams::test_b_own_team_with_a_node_or_edge_is_404",
            "test_owner_scope_teams::test_context_preview_with_a_run_id_in_body_is_404",
            "test_owner_scope_teams::test_node_body_with_a_toolkit_id_is_404",
        ],
    ),
    "GET /api/teams/{team_id}/nodes/{node_id}/runs": (
        "id",
        [
            "test_owner_scope_teams::test_b_gets_404_for_a_path_ids",
            "test_owner_scope_teams::test_b_own_team_with_a_node_or_edge_is_404",
            "test_owner_scope_teams::test_node_runs_with_a_run_id_in_query_is_404",
        ],
    ),
    "PUT /api/teams/{team_id}/layout": (
        "id",
        ["test_owner_scope_teams::test_b_gets_404_for_a_path_ids"],
    ),
    "POST /api/teams/{team_id}/positions": (
        "id",
        [
            "test_owner_scope_teams::test_b_gets_404_for_a_path_ids",
            "test_owner_scope_teams::test_positions_with_a_node_in_body_leaves_a_unchanged",
            "test_owner_scope_teams::test_positions_with_a_node_in_body_is_refused_404",
        ],
    ),
    "GET /api/teams/{team_id}/runs": (
        "id",
        ["test_owner_scope_teams::test_b_gets_404_for_a_path_ids"],
    ),
    "GET /api/teams/{team_id}/validate": (
        "id",
        ["test_owner_scope_teams::test_b_gets_404_for_a_path_ids"],
    ),
    "GET /api/templates": (
        "own",
        "Returns the fixed starter-template list. With ?for=desktop it reads only the caller's own subscriptions. It takes no foreign id.",
    ),
    "GET /api/tool-catalog": (
        "public",
        "A static built-in MCP tool catalogue served with no session (main.tool_catalog has no auth dependency). It holds no account data.",
    ),
    "GET /api/tool-library": (
        "list",
        ["test_owner_scope_connectors_toolkit::test_tool_library_list_is_the_callers_only"],
    ),
    "POST /api/tool-library": (
        "own",
        "Create-only, in the caller's library. Names are per account. ${SECRET} names in server_config are looked up among the caller's secrets only.",
    ),
    "POST /api/tool-library/import": (
        "own",
        "Adds servers to the caller's library. Conflicts are looked up among the caller's tools only, and the same owner-scoped map serves the replace and rename modes.",
    ),
    "DELETE /api/tool-library/{item_id}": (
        "id",
        ["test_owner_scope_connectors_toolkit::test_b_with_a_path_id_is_a_404_and_a_is_unchanged"],
    ),
    "PATCH /api/tool-library/{item_id}": (
        "id",
        ["test_owner_scope_connectors_toolkit::test_b_with_a_path_id_is_a_404_and_a_is_unchanged"],
    ),
    "GET /api/tool-library/{tool_id}": (
        "id",
        ["test_owner_scope_connectors_toolkit::test_b_with_a_path_id_is_a_404_and_a_is_unchanged"],
    ),
    "PUT /api/tool-library/{tool_id}/agents": (
        "id",
        [
            "test_owner_scope_connectors_toolkit::test_b_with_a_path_id_is_a_404_and_a_is_unchanged",
            "test_owner_scope_connectors_toolkit::test_b_with_a_node_ids_in_the_body_is_a_404_and_a_is_unchanged",
        ],
    ),
    "POST /api/tool-library/{tool_id}/duplicate": (
        "id",
        ["test_owner_scope_connectors_toolkit::test_b_with_a_path_id_is_a_404_and_a_is_unchanged"],
    ),
    "GET /api/toolkit/summary": (
        "list",
        ["test_owner_scope_connectors_toolkit::test_toolkit_summary_counts_only_the_callers_rows"],
    ),
    "GET /docs": ("public", "Swagger UI page (docs): static, no account data"),
    "GET /docs/oauth2-redirect": (
        "public",
        "Swagger UI OAuth2 redirect helper page (docs): static",
    ),
    "GET /health": ("public", "health check (DB ping)"),
    "GET /healthz": ("public", "liveness probe that does not touch the DB"),
    "MOUNT /mcp/connectors": (
        "public",
        "run-token authenticated (Authorization: Bearer connector run token, owner-checked against the connection): tests/test_connector_proxy.py",
    ),
    "ROUTE /mcp/connectors": (
        "public",
        "run-token authenticated (Authorization: Bearer connector run token, owner-checked against the connection): tests/test_connector_proxy.py",
    ),
    "MOUNT /mcp/domains": (
        "public",
        "run-token authenticated (Authorization: Bearer Domains run token; the owner and the domains come from the token): tests/test_domains_run_token.py",
    ),
    "ROUTE /mcp/domains": (
        "public",
        "run-token authenticated (Authorization: Bearer Domains run token; the owner and the domains come from the token): tests/test_domains_run_token.py",
    ),
    "GET /oauth/client-metadata.json": (
        "public",
        "OAuth client ID metadata document that sign-in servers fetch",
    ),
    "GET /openapi.json": (
        "public",
        "FastAPI-generated OpenAPI schema: a static description of the API that reads no account data",
    ),
    "GET /redoc": ("public", "ReDoc page (docs): static"),
}


def _served() -> set[str]:
    served: set[str] = set()
    for route in app.routes:
        if isinstance(route, Mount):
            served.add(f"MOUNT {route.path}")
        elif isinstance(route, Route):
            methods = (route.methods or set()) - {"HEAD"}
            served.update(f"{m} {route.path}" for m in methods)
            if not methods:
                served.add(f"ROUTE {route.path}")
    return served


def test_every_route_is_in_the_sweep():
    served = _served()
    unlisted = sorted(served - ROUTES.keys() - IMAGE_ONLY.keys())
    assert not unlisted, (
        "Routes missing from the owner-scope sweep (tests/test_owner_scope_guard.py ROUTES): "
        f"{unlisted}. Classify each and add its owner-scope test."
    )
    gone = sorted(ROUTES.keys() - served)
    assert not gone, f"ROUTES lists routes the app no longer serves: {gone}"


def test_every_id_and_list_route_names_a_test_that_exists():
    for key, (kind, where) in ROUTES.items():
        assert kind in ("id", "list", "own", "public"), key
        if kind in ("own", "public"):
            assert isinstance(where, str) and where, f"{key}: say why it is {kind}"
            continue
        assert where, f"{key}: an {kind} route needs its owner-scope test"
        for ref in where:
            module, _, name = ref.partition("::")
            assert callable(getattr(importlib.import_module(module), name, None)), (
                f"{key}: {ref} doesn't exist"
            )
