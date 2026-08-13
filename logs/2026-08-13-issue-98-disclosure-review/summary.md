# Issue #98 — what `source/` discloses, and the root licence

2026-08-13. Branch `98-source-disclosure-review`, cut from `main` at `fd2d7c2`.

**Conclusion: the evidence supports option 1 — publish `source/` as it stands, then
flip. No history rewrite is required, and nothing is dispositioned redact or drop.**

This slice reads and judges. Nothing under `source/` was changed, no file was deleted,
repository visibility was not touched, and no history was rewritten. Those are steps 2,
4 and 5 in the issue and they are the founder's to make.

Two deliverables landed: the per-directory disposition, now recorded in
[`docs/INVENTORY.md`](../../docs/INVENTORY.md#publish-disposition) beside the record of
what was copied, and a root `LICENSE`.

## The finding that changed the question

Issue #98 frames `source/axial/` as "718 KB of a private project's internals" and
`source/global-workspace/` as "eval runs and benchmark numbers from that same private
work". Both claims were checked rather than assumed, and both are wrong.

| Repository | Visibility today |
| --- | --- |
| `Muhanad-husn/axial` | **PUBLIC** |
| `Muhanad-husn/Zij` | **PUBLIC** |
| `Muhanad-husn/axial-harness` | PRIVATE |
| `Muhanad-husn/AEO` | PRIVATE |

Axial is public under the founder's own name, with a README that describes the pipeline
stage by stage, a `specs/PRODUCT.md`, a decision log, and the entire gold-run post-mortem
including its cost and failure numbers. Zij is public too, with a README that names the
product, describes it as a maritime and air situational monitor, and states that
development is paused as of 2026-07-17.

So the disclosure question is not "should a private project be exposed". It is the much
narrower "which files in `source/` are not already public, and does exposing those cost
anything". That set was enumerated file by file through the GitHub contents API.

## What is genuinely not public

| Path | Why it is not public | Size |
| --- | --- | --- |
| `source/axial/dot-claude/` | `.claude/` is gitignored in axial; its history lives in the private `axial-harness` repo | 33 files |
| `source/axial/root/CLAUDE.local.md` | Gitignored | 139 lines |
| `source/axial/root/PR_BODY.generated.md` | Gitignored | 1 file |
| `source/axial/root/.tdd-branch-cleanup.log` | Gitignored | 1 file |
| `source/axial/docs/_found/` | Not at axial's HEAD | 13 files |
| `source/axial/docs/phase-a-rerun-2026-07-24.md` | Not at axial's HEAD | 1 file |
| `source/v1-archive/` | Zij's `.claude/`, `plans/` and `docs/tdd-evidence/` are absent from the public repo — this tree came out of the recycle bin, not out of git | 174 files |

Every one of those is engineering process: role agents, PowerShell gates, skill
definitions, slice plans, a PR body template, pytest transcripts, and a log of merged
branch names with their SHAs. Read in full, they contain no credentials, no corpus
content, no customer or third-party data, and no research material.

## The three directories the issue asked to scrutinise

### `source/global-claude/` — publishable

Three files, 1,337 bytes total, all read.

`CLAUDE.md` is not the founder's current global directives. It is a 498-byte snapshot
holding one section, "Core Principle", a general statement that semantic correctness
beats rigid contract adherence. Manifest 04 cites it as principles lineage, so it earns
its place.

`settings.json` discloses an enabled-plugin list, `effortLevel: xhigh`, `tui:
fullscreen`, an allow rule for `gh pr merge`, and a `D:\AEO` marketplace path. One line
is worth the founder's attention before the flip: `skipDangerousModePermissionPrompt:
true`. It is a local interface preference and grants a reader nothing, but it is the only
line in `source/` that describes the founder's own security posture rather than the work.
That is a judgement call, not a defect, and it is his to make.

`settings.local.json` is 77 bytes allowing one skill.

The issue's characterisation — "personal configuration applying to every repository on
the machine" — is accurate as far as it goes. The volume is what it misses: this is the
smallest directory under `source/` by an order of magnitude, and dropping it would cost
manifest 04 its lineage citation to save 1.3 KB.

### `source/axial/` — publishable

Mixed, and both halves were read.

The public half needs no argument. `README.md`, `CLAUDE.md`, `docs/DECISIONS.md`,
`pyproject.toml`, the CI workflow, and the whole `docs/postmortem/gold-run-2026-07/`
folder are all live on the public axial repository right now.

That post-mortem is the part a careful reader would flag, so it is worth being explicit
about. It records that a 40-hour run wasted 69% of its 182 logged compute hours, that 1
of 22 sources landed on the first attempt, that the corpus is scholarship on war and
political violence, that a moderation filter refused two attempts and cost one source
5.5 hours before it was abandoned, and that the fix is a per-refusal reroute to a
fallback model. Those are commercially and operationally candid numbers. **They are
already public, published by the founder, at
`github.com/Muhanad-husn/axial/tree/main/docs/postmortem/gold-run-2026-07`.** The AEO
copy adds nothing that is not already there.

The not-public half — the `.claude/` harness, `CLAUDE.local.md`, the branch-cleanup log,
the run-logging plans — is process. `CLAUDE.local.md` is a handbook about worktrees,
lanes, merge authority and build philosophy; it says of itself that "nothing here is
specific to it", meaning the product. The branch-cleanup log discloses branch names and
commit SHAs of a repository anyone can already clone. The harness skills mention "corpus"
as a generic noun and nothing about the domain.

There is no finding here that `source/axial/` cannot be published.

### `source/global-workspace/` — publishable

The issue calls this "eval runs and benchmark numbers from that same private work". It
is not. A search of all 185 files for `axial`, `zij`, `syria` and `hormuz` returns
nothing. The eval outputs are model-generated scaffolds of a synthetic repository named
`ai-enterprise-template`, graded by `grade_repo.py`. The `benchmark.json` figures — the
with-skill 1.0 against without-skill 0.27–0.45 that `docs/INVENTORY.md` already quotes —
measure the skill against that synthetic scaffold, not against any real product.

The only residue is a dozen `D:\eval-scratch` paths and the `ghp_example_replace_me`
placeholder that INVENTORY already records as a non-credential.

## The directory the issue did not name

`source/v1-archive/` is the largest genuinely-new disclosure in the tree, and #98 does
not mention it in the scrutiny table.

174 files, 956 KB: Zij's v1 harness (six role agents, hook library, gate tests, six
slash-command lanes), 53 slice plans with their GitHub issue links, two filed backlogs,
and 74 pytest evidence transcripts. None of it is on public Zij, because it was recovered
from the recycle bin rather than from the repository.

It is still publishable. The product is public and self-describing, the plans link to
issues in a public repo, and the transcripts are pytest output. What publishing adds is
the internal build record of a project the founder publicly archived — the backlog, the
slice-by-slice sequence, the branch names. That is a smaller step than #98 was worried
about for axial, but it is a real one and it was not on the list.

The transcripts carry local paths including `C:\Users\mou97\AppData\Local\Temp`.

## Personal identifiers

`C:\Users\mou97\` — the founder's Windows account name — appears throughout
`source/_manifests/` as the left-hand side of every provenance path, and in a handful of
`v1-archive` evidence transcripts. It also appears outside `source/`, in `docs/PLAN.md`,
`docs/MIGRATION.md`, and two Phase 7 logs.

It is an OS account name. It grants nothing, and the founder's GitHub identity and real
name are already public on two repositories. Redacting it from the manifests would break
the verbatim rule and would destroy exactly the record that made this review checkable.
Recorded as a residue, not a redaction.

## Credentials

A fresh sweep for key- and token-shaped strings across all 556 files under `source/`, and
separately across `docs/`, `logs/`, `plugin/`, `tests/` and `evals/`, returned one hit:
`ghp_example_replace_me` in a `secrets.example.toml` inside captured eval output, plus
the manifest line that already records it as a placeholder. This reproduces
`docs/INVENTORY.md`'s zero-redactions finding rather than relying on it.

## History

**No history rewrite is required before publishing.** Nothing in `source/` is of a kind
where deleting the file after the fact would be too late:

- No credential exists in the tree, in any commit, to be revoked.
- The one personal identifier is a Windows account name with no access value.
- Everything not already public is engineering process belonging to two products the
  founder has already published under his own name.

The scope of that statement is `source/`, which is what this slice was asked to review,
plus the credential sweep of the rest of the repository noted above. It is not a full
content review of `docs/` and `logs/`, which describe this repository's own work and were
written by the founder for this repository.

## Why not option 2

Option 2 — split the repository, publish `plugin/` and keep `source/`, `docs/` and
`logs/` private — is the issue's fallback **if and only if** the review concludes
`source/axial/` cannot be published. It does not. Axial is public, its post-mortem
numbers are public, and the residue is process material with no credentials and no
third-party data.

Paying option 2's cost against a finding that does not exist would be expensive. The
provenance seam breaks in four places at once: `docs/INVENTORY.md` and the seven files in
`source/_manifests/` describe a tree the public repository would no longer contain; every
`source/` citation in `docs/DECISIONS.md` and `docs/EVIDENCE.md` becomes a dangling
reference to a private path; `tests/skills/vendored-manifest.test.mjs` reads
`source/upstream-red-green-refactor/dot-claude/skills` directly and would fail in the
public repository; and two repositories would have to be kept in step by hand from then
on. That is a standing tax on every future slice, in exchange for concealing files whose
products are already public.

Option 3, staying private, keeps a plugin that Checkpoint 7 proved installable in a state
where nobody can install it.

## The licence

`LICENSE` added at the repository root: standard unmodified MIT text, (c) 2026 Muhanad
Abulhusn, matching the `"license": "MIT"` that `package.json` already declares.
`package.json` was not touched.

One caveat the founder should see before the flip, recorded in full in
[`docs/INVENTORY.md`](../../docs/INVENTORY.md#the-licence-caveat). A root MIT covers
AEO's own work but says nothing about the licence layering underneath `source/`:

| Tree | Its actual terms |
| --- | --- |
| `source/axial/` | PolyForm Noncommercial 1.0.0 — axial ships that licence, not MIT |
| `source/v1-archive/` | Zij has no licence file at all, which is all rights reserved |
| `source/upstream-red-green-refactor/` | MIT, (c) john-adeojo |
| `source/plugin-format/`, `source/eval-tooling/`, `source/global-skill/_deps/` | Apache-2.0, licence file with each |

The founder authored axial and Zij and may relicense his own work, so nothing here
infringes. It is a statement problem, not a rights problem: a bare root MIT would
represent terms for those trees that their own licences do not grant, and would nominally
sweep four third-party licences that are shipped intact. A one-paragraph scope note —
the licence covers AEO's own work; `source/` is a vendored snapshot under its own terms —
closes it. That note belongs in `README.md`, which #97 is rewriting for a public reader
anyway. It is not written here, because `README.md` is another actor's file.

## What the founder still has to decide

1. `skipDangerousModePermissionPrompt: true` in `source/global-claude/settings.json` —
   publish or not. This review says publishable; it is a preference, not an exposure.
2. `source/v1-archive/` — the review says publishable, but it was not on the issue's
   list, so the founder has not yet seen it framed as a disclosure.
3. The licence scope note, which lands in #97's README rewrite.
4. Steps 2, 4 and 5 of the issue: acting on the review, flipping visibility, and the
   README. None of them were touched here.

## Verification

- `npm test` — full fast tier, green.
- Repository visibilities read with `gh repo view --json visibility`; per-path public
  status read with `gh api repos/<owner>/<repo>/contents/<path>`.
- Every directory under `source/` was opened and read before it was dispositioned.
