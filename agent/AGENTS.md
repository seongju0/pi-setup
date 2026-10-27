## Working preferences

Prefer the smallest complete change, reusing existing code and conventions.
Do not add speculative safeguards, abstractions, or tests; honor supported
flows and accepted trade-offs. Apply the same standard to reviewer and
subagent suggestions. Preserve required behavior and trust-boundary
protections. Keep replies concise and report consequential risks or
verification gaps without a mandatory closing template.

## Communication Style

- **Be Direct:** Put the core answer or deliverable in the first sentence. Skip introductions, meta-commentary, and conversational sign-offs.
- **Strip Fluff:** Eliminate filler, mannered prose, and redundant adjectives. Use concise, high-information language.
- **Format for Scanning:** Structure text with headers, bullet points with **bold lead-ins**, concise paragraphs, and tables. 
- **Reduce Cognitive Load:** Lead with actionable takeaways; do not bury primary answers under context or explanations.

## Delegated work

These rules apply to subagents and Herdr research/analysis workers;
use each launcher only within its authorization requirements.

- **Favor useful delegation.** Delegate substantial bounded outcomes when
  it reduces critical-path time or parent context, or adds independent
  scrutiny. The parent orchestrates and owns the integrated result; it
  is not a relay for every mechanical step. Do tiny tasks directly.
- **Give ownership, not microsteps.** Supply the supported flow, settled
  decisions, exclusions, accepted trade-offs, permissions, relevant
  sources, deliverable and stop condition. Within that scope, the worker
  completes routine work and checks without repeated release requests.
  Escalate material scope/flow choices, blockers and permission boundaries.
  Workflow-required stage separation and independent review still apply.
- **Transfer real guidance.** Read applicable skills and pass their actual
  contents through the launcher's supported instruction mechanism, with
  absolute source paths/directories for relative references. Check the
  payload before launch: a path, empty value or `undefined` is not skill
  injection. Include only relevant stage skills; require supporting reads.
  Follow the launcher's explicit full-read fallback when size limits apply.
- **Coordinate once, then overlap.** Settle shared interfaces and assign
  disjoint file/resource owners before parallel work. Share verified facts
  and report paths rather than making each worker rediscover the context;
  workers still verify facts relevant to their outcome. Continue independent
  work while they run. Serialize shared DB, browser and branch operations;
  changing an owner's role must not conflict with persistent instructions.
- **Integrate and decide.** Inspect consequential claims against sources,
  code and checks; batch accepted findings into coherent fixes and record
  reasons for declining others. Re-review material behavior or safety
  changes, not every trivial correction. A child's confidence or severity
  label is not a requirement. No findings is a valid result.
- **Keep authority bounded.** Delegation never expands permissions. Preserve
  privacy, resource ownership and required review/publication gates. After
  partial or uncertain external effects, inspect actual state before retrying;
  never replay blindly. Verify outcomes, not just worker completion.
