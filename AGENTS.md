# Fair Flow Booking multi-agent rules

Read `BOOKING_MASTER_SPEC.md` before starting any Booking task.

Canonical integration branch: `feature/booking`  
Checkpoint these rules were written against: `f587bd8a27c250173b2e31ed4ce281c853ba26fa`

---

## FAIR FLOW BOOKING MULTI-AGENT RULES

1. Read `BOOKING_MASTER_SPEC.md` before starting any Booking task.

2. The canonical integration branch is: `feature/booking`

3. Parallel agents must work in their own branch/worktree.

4. Never work directly on `main`.

5. Never deploy production.

6. Never modify production Firebase data.

7. Firebase production project: `fairflowapp-db841`  
   Treat it as forbidden unless Shiri explicitly authorizes production work.

8. Firebase staging project: `fair-flow-staging`

9. Never run a Firebase deploy command unless the assigned task explicitly authorizes deployment.

10. Never use a Firebase command without an explicit `--project` argument.

11. Do not discard, reset, overwrite, or clean another agent's work.

12. Do not force push.

13. Routine engineering decisions should be made autonomously.

    Do **not** stop to ask Shiri about:

    - naming
    - internal component structure
    - minor spacing
    - ordinary validation
    - loading states
    - error handling
    - routine tests
    - small implementation details

14. Stop and escalate only when a decision materially changes:

    - core product behavior
    - appointment schema
    - shared Firestore schema
    - architecture used by other Booking modules
    - permissions / security
    - pricing / business logic
    - production behavior

15. Before declaring a task complete:

    - inspect the existing implementation
    - implement the full acceptance criteria
    - run relevant tests
    - test actual user flows where possible
    - fix issues discovered
    - report anything still incomplete

16. Existing unrelated test failures must be reported but should not cause agents to rewrite unrelated systems.

    Known current pre-existing failure: `scripts/test-booking-clients-ui.js`

17. Avoid editing shared high-conflict files unless the assigned task explicitly owns them.

    High-conflict files include:

    - `public/index.html`
    - `public/booking/shell.js`
    - `public/booking/sidebar.js`
    - `public/booking/state.js`
    - `public/booking/calendar.js`
    - `public/booking/calendar-state.js`
    - `public/booking/calendar-drag.js`
    - `public/booking/appointments/model.js`
    - `public/booking/appointments/data.js`
    - `public/booking/clients/model.js`
    - `public/booking/clients/data.js`
    - `public/booking/sales/model.js`
    - `public/booking/sales/data.js`
    - `public/booking/availability.js`
    - `firestore.rules`
    - `firestore.indexes.json`
    - `firebase.json`
    - `.firebaserc`
    - `settings-cloud.js`
    - `tickets-catalog-data.js`

    Prefer new isolated modules when practical.

18. Do not add script tags to `public/index.html` from multiple parallel branches. Integration/wiring should happen after isolated work is reviewed.

19. Every completed agent task should report:

    - branch / worktree
    - files changed
    - what was implemented
    - tests run
    - test results
    - decisions made autonomously
    - decisions requiring Shiri
    - known remaining issues
    - commit hash

---

## Additional Booking constraints

These match existing Fair Flow Booking development rules and the current codebase.

- Do not merge Booking into `main`, `sync/production`, or any production-connected branch without explicit approval.
- Production hosting is `fairflowapp-db841`. Staging hosting is `fair-flow-staging`.
- “Deploy” / “refresh” without naming production means staging only, and only if the task authorizes deploy.
- Booking lives in small purpose-specific modules (guideline ~500–800 lines). Split by responsibility when a file grows or mixes concerns.
- One source of truth: reuse existing Fair Flow employees, salon/workspace, locations, services, permissions, Live Floor, and auth.
- Do not create a new Booking branch if `feature/booking` already exists as the integration branch; parallel work uses **topic branches from** `feature/booking`, not a second canonical Booking branch.
- Do not create worktrees unless the assigned task says to.

Preserve implemented Booking behavior unless the task explicitly requires changing it.
