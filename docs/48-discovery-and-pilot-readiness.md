# 48 - London discovery brief and pilot-readiness checklist

Date: 2026-11-04
Purpose: preparation artefacts for the London market-validation programme.
Nothing in this document changes code, schema or production behaviour.

---

## 1. Discovery one-pager (for outreach calls)

**Who we are talking to:** owner, managing director or operations manager of an
independent London courier/delivery business, ~10-30 vehicles or regular
drivers, same-day + scheduled + multi-drop work, coordinating daily
assignments with spreadsheets, phones and messaging.

**First three targets:** Demarco Couriers, Drift Couriers, Courier Flex
Limited. (Abetta and Xtra Mile are benchmarks, not first prospects.)

**Opening script (≤2 minutes):**

> "We build dispatch software for independent London couriers. We're not
> selling today - we're trying to understand how your operation actually runs
> day to day. Would you spare 20 minutes to tell us how you allocate jobs,
> deal with last-minute changes, and handle late deliveries? In return we'll
> share what we've learned about what breaks in same-day operations."

**Rules for the call:**

1. Ask first, demo later. Never show the product in the first call.
2. The single most important question is the last one below.
3. Record answers immediately in the tracker table (Section 3).

**Question sheet (10 questions + 1 decisive):**

| # | Question | What it uncovers |
|---|---|---|
| 1 | How many deliveries do you complete daily? | Operational scale |
| 2 | How many vehicles and drivers do you coordinate? | Addressable workflow |
| 3 | How many dispatchers manage the fleet? | Labour cost |
| 4 | How do you allocate work today? (walk us through a typical morning) | Existing workflow |
| 5 | How often do assignments change after they are made? | Re-optimisation need |
| 6 | What happens when a job is late or a collection misses its window? | Exception gap |
| 7 | How much time do you spend updating customers by phone? | Admin burden |
| 8 | How do you prove a delivery was completed today? | POD requirement |
| 9 | What software do you pay for right now, and what does it not do? | Switching landscape |
| 10 | What would make you change your current system? | Purchasing motivation |
| ★ | **What is the most expensive operational problem you face every week that you still cannot solve efficiently?** | The answer sets our next build and the pilot KPIs |

**Call close:** ask permission for a 45-minute workflow walkthrough if their
pain matches; collect vehicle count, dispatcher count, current tools, contact
role.

## 2. Pilot-readiness checklist (must be true before any demo or pilot)

**Engineering (agent):**

- [ ] Full test suite green in a CI pipeline that does not depend on a
      manually managed local database.
- [ ] Restore drill completed on the current schema with a timed result.
- [ ] Production alerting channel proven (test alert delivered to a real
      destination).
- [ ] Proof-of-delivery customer export (PDF/audit trail) working.
- [ ] Second-tenant dry run: create, import vehicles/drivers/jobs, operate,
      offboard - all without source changes (the five repeatability tests).

**Trust pack v1 (owner + legal later):**

- [ ] Privacy notice (draft)
- [ ] Data Processing Agreement template
- [ ] DPIA support document (worker location monitoring)
- [ ] Retention and deletion policy
- [ ] Security statement (auth, encryption, RLS, backups)
- [ ] Sub-processor register (Postgres host, DNS/Tailscale, backup drive)
- [ ] Incident response procedure (one page)
- [ ] Support and escalation policy (one page)
- [ ] IP and licensing statement

**Pilot offer (ready to propose):**

- [ ] Scope: fleet/driver onboarding, tracking, assignment, planning,
      execution, exception records, weekly report, measured comparison.
- [ ] Price band agreed internally: £750-£1,250 for 4-6 weeks.
- [ ] 2-3 primary KPIs agreed with the operator before start (from: dispatch
      planning minutes, jobs/dispatcher, on-time %, exceptions-before-call,
      avoidable mileage, POD completion, manual calls, GPS trust incidents).
- [ ] Baseline recorded and signed before the pilot starts.
- [ ] Pilot fee creditable against conversion, agreed in advance.

## 3. Discovery tracker (fill per call)

| Field | Value |
|---|---|
| Company | |
| Contact / role | |
| Vehicles / drivers | |
| Dispatchers | |
| Deliveries/day | |
| Current tools | |
| Paid software now | |
| Expensive weekly problem (verbatim) | |
| Change triggers | |
| Demo interest (Y/N) | |
| Follow-up | |

## 4. What is NOT happening yet

- No implementation work (CI, restore drill, alerting, POD export, onboarding
  scripts) until the parallel work-split is confirmed.
- No contact with prospects until the owner confirms they will run the calls.
- No change to production, code, schema or documentation state beyond this
  planning file.
