# Project Rules

1. Think Before Coding
Don't assume. Don't hide confusion. Surface tradeoffs.

Before implementing:

State your assumptions explicitly. If uncertain, ask.
If multiple interpretations exist, present them - don't pick silently.
If a simpler approach exists, say so. Push back when warranted.
If something is unclear, stop. Name what's confusing. Ask.
Never guess business requirements.

2. Simplicity First
Minimum code that solves the problem. Nothing speculative.

No features beyond what was asked.
No abstractions for single-use code.
No "flexibility" or "configurability" that wasn't requested.
No error handling for impossible scenarios.
If you write 200 lines and it could be 50, rewrite it.
Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

3. Surgical Changes
Touch only what you must. Clean up only your own mess.

When editing existing code:

Don't "improve" adjacent code, comments, or formatting.
Don't refactor things that aren't broken.
Match existing style, even if you'd do it differently.
If you notice unrelated dead code, mention it - don't delete it.
When your changes create orphans:

Remove imports/variables/functions that YOUR changes made unused.
Don't remove pre-existing dead code unless asked.
The test: Every changed line should trace directly to the user's request.

4. Goal-Driven Execution
Define success criteria. Loop until verified.

Transform tasks into verifiable goals:

"Add validation" → "Write tests for invalid inputs, then make them pass"
"Fix the bug" → "Write a test that reproduces it, then make it pass"
"Refactor X" → "Ensure tests pass before and after"
For multi-step tasks, state a brief plan:

1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.
4. Architecture First
Before writing code:

- Understand the existing architecture.
- Reuse existing modules before creating new ones.
- Extend existing patterns instead of introducing new ones.
- Keep architecture consistent throughout the project.
- Explain why a new architectural pattern is needed before introducing it.

Never create a second way of solving the same problem.

6. Verify Existing Code First
Before implementing anything:

- Search for existing implementations.
- Search for reusable utilities.
- Search for similar components.
- Search for existing services.
- Reuse before creating.

Avoid duplicate functionality.

7. Root Cause First
Never patch symptoms.

Before fixing a bug:

1. Reproduce the issue.
2. Identify the root cause.
3. Explain the cause.
4. Fix only the cause.
5. Verify similar scenarios remain unaffected.

Every bug fix should prevent regression.

8. Code Quality
Write code that is:

- readable
- maintainable
- concise
- self-explanatory

Prefer expressive naming over comments.

Keep comments only for:

- architectural decisions
- complex business rules
- non-obvious algorithms

9. Naming
Choose names that describe intent.

Avoid generic names such as:

- Helper
- Utils
- Common
- Temp
- New
- Data2

Prefer domain-specific names.

10. File Size

Prefer small files.

Guidelines:

- Target under **300 lines**
- Warn when exceeding **500 lines**
- Split by responsibility rather than using region comments

11. Dependencies
Before adding a dependency:

- Check whether it already exists.
- Prefer built-in APIs.
- Prefer existing project libraries.
- Explain why a new dependency is necessary.

Avoid dependencies for trivial functionality.

12. Logging

- No debug logging in production.
- Remove temporary logs before completion.
- Follow the project's logging conventions.

13. Testing
Testing is required for:

- new business logic
- bug fixes
- validation logic
- reusable utilities

Guidelines:

- Every bug fix must include a regression test.
- Every business rule should have tests.
- Prefer integration tests over excessive mocking.
- Do not modify tests simply to make them pass.
- Target **at least 70% code coverage** for core business logic.

14. Performance
Measure before optimizing.
Avoid premature optimization.

When optimization is required:

- Explain the bottleneck.
- Explain why the optimization is needed.
- Prefer readability unless performance is proven to matter.

15. Security
Never expose:

- API keys
- passwords
- tokens
- secrets

Always:

- validate external input
- sanitize user input
- use parameterized queries
- escape user-generated output
- follow secure authentication practices

Security takes precedence over convenience.

16. User Experience
Applications should provide:

- intuitive user interfaces
- responsive layouts
- accessibility compliance (WCAG)
- multilingual support
- responsive design for desktop, tablet, and mobile

Performance targets:

- Initial response within **3 seconds**
- Fast perceived interaction

17. Default Technology Stack
Unless explicitly requested otherwise, use:

- SvelteKit
- TypeScript
- Tailwind CSS
- shadcn-svelte
- Zod
- Lucide Icons
- Playwright
- ESLint
- Prettier
- npm

Avoid introducing alternative frameworks without justification.

18. Default Technology Stack
Unless explicitly requested otherwise, use:

- SvelteKit
- TypeScript
- Tailwind CSS
- shadcn-svelte
- Zod
- Lucide Icons
- Playwright
- ESLint
- Prettier
- npm

Avoid introducing alternative frameworks without justification.

19. Project Documentation Rules

All project documents must be stored under 'docs/'
All project requirement documents must be stored under 'docs/requirements'
All project plan documents must be stored under 'docs/plans'
All project design documents must be stored under 'docs/design'

Design specifications should follow: [https://github.com/google-labs-code/design.md](https://github.com/google-labs-code/design.md)

20. Completion Checklist

Before considering a task complete, verify:

- Code compiles successfully.
- Tests pass.
- Lint passes.
- Formatting passes.
- No unused imports remain.
- No dead code introduced.
- No temporary debug logs remain.
- No unfinished TODOs remain.
- Documentation updated when necessary.
- Design updated when UI changes.
- OKF updated when project knowledge changes.

Only after all applicable items are satisfied should a task be considered complete.


# Rules

- When reporting information to me, be extremely concise and sacrifice grammar for the sake of concision. 
- When reporting to me talk in Korean.

