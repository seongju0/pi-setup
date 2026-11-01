# Usage

Run **`/usage`** (or **`/usage month`**) for the current month, or **`/usage week`** for the current week, to compare locally recorded token usage and cost estimates across providers in an on-demand Pi overlay. It scans local sessions **and subagents**, not just the current conversation. The centered modal uses the todo extension's rounded border and padded layout, with an aligned provider comparison on wider terminals and stacked summaries on narrow ones. Model details and coverage notes expand on demand. Nothing is added to the footer, and there is no background polling.

## Managed installation and rename

This extension is included explicitly in `manifests/resources.json` and linked as
`extensions/usage` by pi-setup. The command is `/usage`; no `/meter` alias is
registered. Setup does not remove the old standalone `extensions/meter` directory.
After installing this resource, retire that old copy explicitly if you no longer
want `/meter` available. No session history or personal settings need to move.

## Controls

| Key | Action |
| --- | --- |
| `W` / `M` | Current week / current calendar month; reset period navigation |
| `←` / `→` | Previous / next period (never beyond the current period) |
| `R` | Refresh from local metadata |
| `B` | Expand/collapse per-model details, including provider identity |
| `C` | Expand/collapse coverage notes |
| `↑` / `↓` | Scroll |
| `Esc` or configured cancel binding | Close |

Weeks run **Monday–Sunday** and months follow the **local calendar/timezone**. The panel shows period boundaries (end exclusive), timezone, and refresh time. Token counts are raw recorded totals, with input, output, cache-read, and cache-write buckets; reasoning, when available, is a subset of output, not an additional token bucket. Different models use different tokenizers, so cross-provider token totals are useful usage indicators, not equal-work measurements.

## Cache reuse

**Cached input %** is the share of recorded input tokens served from cache:

```text
cacheRead / (input + cacheRead + cacheWrite) × 100
```

Provider and per-model percentages use summed token buckets, not an average of
request percentages. Cache writes are included in the denominator, not counted
as hits; output and reasoning are excluded. The **Input (uncached)** row and
model **In** value exclude separately listed cache reads and cache writes.
A period or model with no input volume shows **—**; positive input with no
recorded cache reads shows **0.0%**.

Existing retained history supplies these counters, including saved cache-warming
usage. Refresh and week/month history navigation recalculate the view without a
new ledger or background collector. Missing cache reporting may appear as zero;
zero recorded reads do not prove caching was unavailable. This is a token share,
**not the percentage of requests with cache hits**. No request-hit count or
cache-specific dollar savings are inferred.

## Personal configuration

Set the monthly subscription reference in **`~/.pi/agent/settings.json`**:

```json
{
  "usage": {
    "subscriptionMonthlyUsd": 100
  }
}
```

The default is **100 USD/month**. Existing `meter.subscriptionMonthlyUsd` settings
remain supported when the `usage` section is absent; `usage` takes precedence.
Settings are read, never rewritten. This is personal configuration only; project settings do not override it. It is a configured comparison reference, **not a historical invoice** or a record of changes to your subscription price.

## Reading the comparison

- **Codex:** recorded API-equivalent catalog cost versus the configured monthly subscription reference. Monthly **cost avoided** is recorded equivalent minus one monthly fee; a negative result is labeled **difference below plan**. Weekly views do not calculate savings or prorate the fee. The fee applies once to the provider group, never once per model.
- **Anthropic:** estimated spend from recorded catalog cost. It is not a verified provider bill.
- **Other:** recorded usage and catalog estimates for other providers, excluded from the Codex/Anthropic comparison; their billing modes are not inferred.
- **Unattributed overhead:** recorded tokens and cost estimates without reliable provider/model attribution, not inferred provider charges.
- **Unpriced records:** displayed costs are known subtotals. Monthly differences are labeled partial when the Codex group has unpriced records; missing prices are not evidence of free usage.

There is deliberately **no combined hypothetical-plus-actual dollar total**. Catalog estimates are the cost metadata recorded with usage, not a current price lookup or an exact historical price archive.

Provider/model labels do not prove the authentication or billing method used. **`openai` and `openai-codex` are grouped as Codex based on this user's subscription setup**; API-key usage with the same labels may not be subscription-covered. Review that assumption before treating the comparison as personal cost avoidance.

## Scope, privacy, and limits

- Reads local usage **metadata only**; does not display prompts, responses, credentials, transcript content, or session paths.
- Requires **no extra credentials, network access, or provider calls**. It does not query live subscription quotas, rate limits, billing APIs, or account balances.
- Covers retained local sessions and subagents. It is **not a permanent ledger**: deleted session history is gone from subsequent reports.
- Historical compaction and helper/service activity may have **unknown coverage**. Missing counters, unrecorded requests, external activity, and service/helper fees can make the view incomplete. Expand **Coverage** for report-specific notes.
- Reload the extension with `/reload` after changing its implementation. Refresh scans only when opening the panel or explicitly requesting a refresh or another period.
