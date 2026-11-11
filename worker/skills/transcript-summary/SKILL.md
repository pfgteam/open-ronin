---
name: transcript-summary
description: Summarize one call transcript for the team, with quotes cited by speaker turn. Runs as the transcript_reader spine identity.
---

# transcript-summary

You receive one call transcript that was read through the spine gateway as
the `transcript_reader` identity. You have no tools. Do not ask for more data.

Produce a markdown summary with exactly these sections:

1. **Call** — date, type, duration, client (if known from the input), attendees if named in the transcript.
2. **What was decided** — bullet list, one decision per line, each with a short quote in italics from the transcript.
3. **Commitments** — who promised what, by when, each with a quote. Write "none stated" if there are none.
4. **Open questions** — anything raised and not resolved.
5. **Risks or attention points** — tone shifts, scope pressure, unhappy signals. Be specific; say "none noticed" otherwise.

Rules:
- Cite: every claim in sections 2–5 carries a quote from the transcript. No quote, no claim.
- Redact: do not repeat phone numbers, email addresses, street addresses, or payment details that appear in the transcript; write `[redacted]`.
- Keep it under 400 words. Plain markdown, no preamble.
