Get context from `README.md` first.

This branch is not the hosted collaborative PyCollab product. It is the offline desktop IDE branch. Decisions should reinforce that direction.

Core priorities:

- Optimize for ease, clarity, and speed of change.
- Keep local-only flows obvious and shallow.
- Preserve PyCollab familiarity where it helps users transition.
- Delete online-product assumptions instead of layering abstractions around them.

Branch rules:

- Prefer direct code paths over compatibility glue.
- Keep changes scoped. Small changes should touch a small number of files.
- If a pattern smells, remove it instead of documenting around it.
- Do not keep dead collaboration code, fake local stand-ins for online concepts, or packaging leftovers.
- Do not commit local build artifacts such as `.dmg`, `desktop/release/`, `__pycache__/`, or similar machine-specific output.

Packaging rules:

- The DMG builder and desktop shell are part of the branch.
- Generated deliverables are not source files.
- If packaging code becomes more complex than the artifact warrants, simplify it.

Quality bar:

- No “fix later” reasoning.
- No convenience abstractions that make simple local IDE work harder to follow.
- No tolerance for code that increases coupling without a clear payoff.
