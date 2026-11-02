# 32 - Pilot baseline and 120-second rehearsal kit

Date: 2026-11-02  
Purpose: close the Phase 0/1 commercial gate with an operator, without
inventing numbers.

---

## 1. Operator baseline worksheet

Collect from the operator's **last normal week**, not from the demo.

| Metric | Definition | Operator value | Source |
|---|---|---|---|
| Stops per day | Completed stops across all drivers | | TMS / run sheets |
| Jobs per day | Jobs, not stop count | | TMS |
| Drivers per shift | Average active drivers | | Rota |
| Planning time | Minutes dispatcher spends building the day | | Interview / time sample |
| On-time % | Arrived inside promised window / total stops | | TMS |
| Exceptions per day | Failed, late or customer-called exceptions | | Phone/email log |
| Customer calls | Inbound "where is my delivery?" calls per day | | Phone log |
| Fuel or km per stop | Weekly km / weekly stops | | Fuel cards / odometer |
| Driver turnover / adoption | Drivers able to use a phone app | | Interview |
| Evidence disputes | Missing/lost POD per week | | Claims log |

### Definitions that must be agreed explicitly

- **On-time** means inside the promised customer window, not "same day".
- **Exception** includes late, failed, refused, damaged and address/access
  failure.
- **Planning time** excludes route execution and driver calls.
- **Baseline window** is a named week with no bank holiday or major disruption,
  or the disruption is recorded.

### Success criteria for the pilot

Choose at most three primary metrics before go-live. Suggested:

1. Planning minutes per day reduced by at least 25%.
2. On-time percentage improved by at least 5 points.
3. Customer "where is it?" calls reduced by at least 30%.
4. Evidence disputes reduced to zero for completed stops.

Do not promise all four. The operator signs the chosen three.

### Sign-off

```text
Operator:
Baseline week:
Primary metrics:
Pilot start / end:
Support window:
Signed by:
Date:
```

---

## 2. 120-second run sheet

Rehearse on the actual tablet and phone that will be used. Use the seeded
Morning Rush dataset; never use fabricated savings.

| Time | Act | Presenter action | Expected screen | Fallback |
|---|---|---|---|---|
| 0–15 s | Pain | Open Live Operations | Map, 3 active vehicles, unassigned count, one at-risk stop | Reload once; if tiles fail, use `?map=raster` |
| 15–40 s | Control | Open unassigned dock, select J-208, choose Sarah, show impact, confirm | Assignment dialog with ETA impact; job leaves queue | Use Emergency scenario if Morning Rush data stale |
| 40–65 s | Value | Open Route Optimisation, show policy and saved proposal evidence | Policy revision, limits, proposal history | Do not run a new solve during the pitch |
| 65–90 s | Trust | Open driver app, show active job and complete POD | Driver screen, signature/recipient, completed state | Pre-open driver screen on second device |
| 90–120 s | Close | Open Customer Tracking preview, show ETA and branding | Customer tracking page with job status | Use recorded screenshot only as last resort; label it |

### Hard rules

- The demo must fit **120 seconds including hand-offs**.
- Do not claim live traffic; OSRM is free-flow.
- Savings figures must come from a stored optimisation run on the demo dataset.
- If a step fails, skip forward rather than debug in front of the prospect.
- No customer data on screen; synthetic only.

---

## 3. Rehearsal record

Run at least three times; record every run.

| Run | Date | Presenter | Device | Total seconds | Failed step | Notes |
|---|---|---|---:|---:|---|---|
| 1 | | | | | | |
| 2 | | | | | | |
| 3 | | | | | | |

### Acceptance

```text
three consecutive runs <= 120 s
no console errors during the run
assignment confirmation <= 2 s
driver proof visible on the second device
customer page loads before 110 s
presenter never debugs in front of the prospect
```

### Automation floor already measured

The E2E suite proves the individual acts work on the current build:

```text
dispatcher assignment flow: pass
driver proof flow: pass
map movement/routes: pass
customer tracking components: present
```

The rehearsal is still a human timing gate. Automation does not replace it.

---

## 4. What the operator must provide

1. Baseline worksheet values and signed definitions.
2. A named pilot start date and support window.
3. Three primary success metrics.
4. Agreement that synthetic demo data is used until a DPIA/retention decision
   is signed.
5. A named dispatcher and at least two drivers for the pilot.

Until these exist, the product remains a pilot platform, not a validated £10k
sale.
