# Design principles and proposed enhancements

Authored by the founder. This is the governing document for turning the
`agentic-engineering-org` skill into a reusable plugin. The fixed principles are
settled and are not up for renegotiation during migration. The proposed
enhancements are candidates, assessed in the enhancement disposition in
[DECISIONS.md](DECISIONS.md), where each carries the stable identifier **EN-*n***.

The skill was developed while working on other projects and still carries
repository-specific references and settings. Generalizing it means removing those
dependencies without losing the discipline that made it work.

*Numbering below is normalized; the source document repeated some numbers. No
wording was changed.*

## Fixed principles

1. **Practicality over perfectionism.** Apply the 80/20 rule: build the smallest
   solution that meets a strict acceptance bar. Once that bar is met, additional
   polishing requires a clear product or risk-reduction benefit; otherwise it is
   a process defect rather than diligence.

2. **Over-engineering tripwires.** Stop and simplify, or justify the decision in
   one sentence in the PR description, whenever the work introduces a hand-tuned
   constant or magic number in a heuristic, an abstraction with only one
   implementation, a configuration option that no one uses, or a fix that is
   larger than the bug it addresses. The default is simple: do not over-engineer.

3. **Specifications are working agreements, not immutable laws.** During
   planning, implementation, and testing, specifications, contracts, and
   constraints may be revised when a change resolves a persistent issue or
   materially improves efficiency without causing a significant change in product
   behaviour. However, any change to a specification or contract requires the
   founder's approval and must be documented with its rationale and expected
   impact.

4. **Red-Green-Refactor is the default** wherever it is applicable and logical.
   Not all surgical fixes or scratch code need to implement it.

5. **Organize each project into subprojects that reflect the product lifecycle.**
   Connect subprojects through explicit contracts that define their data flows
   and responsibilities. Divide each subproject into phases, each phase into
   stages. A stage is one complete end-to-end operation. For example, an
   Ingestion Pipeline phase might contain Parsing and Chunking stages.

6. **Do not reinvent the wheel.** Before building a custom solution, check
   whether an existing MCP server, plugin, tool, library, or a single
   well-designed LLM call can meet the requirement. Recommend new dependencies
   only when they provide a clear efficiency or reliability benefit, and obtain
   the founder's approval before installation.

7. **Measure, don't speculate.** When in doubt, prototype and measure rather than
   analyse indefinitely.

## Proposed enhancements

1. **Requirements before stack.** Understand the requirements before selecting
   the technology stack, project structure, environment setup, or configuration
   model. Python is preferred but not mandatory. Use another language or
   framework when it is demonstrably better suited to a component — for example
   TypeScript for agentic workflows, Ruby for data engineering, or Streamlit,
   Next.js, or React for the interface. These decisions must serve delivery
   efficiency and product quality rather than constrain them.

2. **Survey existing tooling first.** Once the environment and constraints are
   sufficiently understood, search both local resources and the internet for MCP
   servers, plugins, skills, and other tools that could reduce implementation time
   or improve reliability. Present only the most relevant options, including
   expected benefits and trade-offs, and obtain the founder's approval before
   installation.

3. **Independent review.** Use a fresh, independent agent for specification and
   code-quality reviews whenever practical. The reviewer should not share the
   implementation context or assumptions that could bias its assessment.

4. **Risk-based test scoping.** Design test suites for each delivery slice and use
   Red-Green-Refactor while implementing features. Run the smallest test set that
   gives sufficient confidence for the current change. Before running a full
   suite, determine whether an end-to-end test covering earlier stages or phases
   is necessary based on the change's scope and risk.

5. **Fast lane for surgical changes.** For surgical, on-the-fly changes, use the
   existing fix workflow where it is available and effective. Its test strategy
   must still follow the risk-based approach described above.

6. **Concurrency by default.** Use concurrency when tasks are independent and
   parallel execution will reduce completion time. The session orchestrator may
   launch the agents or workers needed for the work, while avoiding conflicting
   edits, duplicated effort, and unnecessary coordination overhead. Identify safe
   opportunities for parallel implementation during planning.

7. **Project tracker as source of truth** for scope, status, decisions, blockers,
   and next actions. Update it whenever a job or material modification is
   completed. At the start of each session, the session orchestrator reviews the
   tracker to determine current priorities and outstanding work.

8. **Preset agent or command for routine tasks** repeated often enough to justify
   automation. Existing examples include `safe-cleanup` and `safe-pr` or
   `pr-review-toolkit:review-pr`; verify whether the latter two overlap before
   standardizing either one.

9. **Claude Code is the initial target.** The session orchestrator should use the
   default model available and must be able to create worktrees, dispatch agents
   and workers, assign different models (Sonnet, Haiku, Opus) per task
   complexity, initiate tasks, and coordinate their results.

10. **Briefings, not code review.** The founder should not be expected to review
    code line by line. The session orchestrator must provide concise,
    plain-language briefings covering progress, decisions, risks, and next steps
    without unnecessary jargon. When founder input is required, present the issue,
    its impact, the available options, and a recommended course of action. Review
    the complete workflow for behaviour and efficiency, and evaluate every
    proposed enhancement against the practicality-first principle and the 80/20
    rule.

11. **Deterministic evidence.** Agents must produce deterministic evidence of
    completed work wherever practical. For example, an agent implementing an
    application flow can provide Playwright test results or recordings that
    demonstrate the expected behaviour.

12. **Independent verifier.** A separate verifier must review the evidence and
    test the result independently of the implementation agent. For UI work this
    may involve a fresh agent using Playwright and a browser MCP server to
    identify functional or usability issues.

13. **Verification gates deployment.** Code may merge only after the required
    tests, analysis, and independent verification pass. The depth of verification
    should be proportional to the change's risk and impact so that low-risk
    changes are not burdened with unnecessary ceremony. This extends the existing
    practice of using a fresh agent for specification and quality review into an
    automated verification loop. The guiding principle is that agents are
    probabilistic systems whose claims require external evidence; with independent
    verification they can be granted greater autonomy while reducing bugs,
    hallucinations, and unsafe outcomes.
