# BACSE344 DA3 Question 2(c): Trivy Vulnerability Scan & Docker Hardening Summary

## Executive Summary

As part of **EVolve Digital Assignment 3 (DA3) Question 2(c)**, container vulnerability scanning and Docker image hardening were conducted to evaluate and minimize security risks in the production runtime container. Scanning was performed using **Trivy v0.76.1** against container images based on **Alpine Linux 3.23.4** and **Node.js 20**.

Through multi-stage container optimization, base OS security updates, and removal of unneeded build tools, vulnerabilities evaluated at **HIGH and CRITICAL** severity were reduced from **28 to 0 (a 100.0% reduction)**.

---

## 1. Verified Scan Progression & Metrics

The table below summarizes the three independently verified scan stages. All counts are grounded strictly in the recorded scan evidence files.

| Metric / Dimension | Stage 1: Initial (Before) | Stage 2: Intermediate | Stage 3: Final Hardened (Clean) | Absolute Delta | % Reduction |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Image Identifier** | `evolve-backend:latest` | `evolve-backend:hardened` | `evolve-backend:hardened` | — | — |
| **Base Operating System** | Alpine Linux 3.23.4 | Alpine Linux 3.23.4 | Alpine Linux 3.23.4 | — | — |
| **Runtime Target** | Node.js 20 (`node:20-alpine`) | Node.js 20 (`node:20-alpine`) | Node.js 20 (`node:20-alpine`) | — | — |
| **Total Scanned Targets** | 402 targets | 388 targets | 90 targets | -312 targets | -77.6% |
| **Alpine OS CVEs (CRITICAL)** | 0 | 0 | 0 | 0 | 0.0% |
| **Alpine OS CVEs (HIGH)** | 4 | 0 | 0 | -4 | **-100.0%** |
| **Node Packages CVEs (CRITICAL)** | 2 | 1 | 0 | -2 | **-100.0%** |
| **Node Packages CVEs (HIGH)** | 22 | 21 | 0 | -22 | **-100.0%** |
| **Combined CRITICAL Count** | **2** | **1** | **0** | **-2** | **-100.0%** |
| **Combined HIGH Count** | **26** | **21** | **0** | **-26** | **-100.0%** |
| **Total Evaluated Findings** | **28** | **22** | **0** | **-28** | **-100.0%** |

---

## 2. Scan Scope & Severity Limitation

> [!IMPORTANT]
> **Severity Scope Limitation:**
> The vulnerability scans were executed explicitly with the filter:
> ```bash
> trivy image --severity HIGH,CRITICAL evolve-backend:hardened
> ```
> Therefore, this verification confirms **zero (0) HIGH and zero (0) CRITICAL** vulnerabilities. Vulnerabilities of **LOW, MEDIUM, or UNKNOWN** severity were not evaluated in this scan scope and are not claimed to be zero.

---

## 3. Dockerfile Hardening Directives & Technical Mechanisms

All hardening controls are implemented in [`backend/Dockerfile`](../../backend/Dockerfile):

1. **Multi-Stage Build Pattern (`backend/Dockerfile#L1-L10`):**
   - **Stage 1 (`builder`):** `FROM node:20-alpine AS builder` handles dependency resolution (`npm ci --omit=dev && npm cache clean --force`).
   - **Stage 2 (`runner`):** `FROM node:20-alpine AS runner` creates a lean, isolated production environment that copies only the pruned production `node_modules`.

2. **Base OS Security Patching (`backend/Dockerfile#L12-L14`):**
   - Directives: `RUN apk update && apk upgrade --no-cache`
   - **Impact:** Upgraded base packages (including `libcrypto3` and `libssl3`), completely eliminating the 4 HIGH OS-level CVEs observed in Stage 1.

3. **Pruning of Build-Time Package Managers (`backend/Dockerfile#L13-L14`):**
   - Directives: `rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx /opt/yarn*`
   - **Impact:** In Stage 2, 22 vulnerabilities still existed because the base Node image ships with `npm` and bundled sub-dependencies (`tar`, `minimatch`, `brace-expansion`). Stripping these unneeded build tools reduced the total scanned target count from 388 down to 90 and eliminated all 22 remaining CVEs.

4. **Non-Root Runtime Execution (`backend/Dockerfile#L18-L23`):**
   - Directives:
     ```dockerfile
     COPY --from=builder --chown=node:node /app/node_modules ./node_modules
     COPY --chown=node:node . .
     USER node
     ```
   - **Impact:** Drops root privileges and executes the Node.js application process under the unprivileged standard `node` user account (`UID 1000`).

---

## 4. Evidence File Traceability

| Artifact | Location | Lines / Section | Key Verified Evidence |
| :--- | :--- | :--- | :--- |
| **Stage 1 Scan** | [`docs/da3/q2/trivy-before.txt`](./trivy-before.txt) | L21, L638, L660 | `evolve-backend:latest`: 4 HIGH OS CVEs; 22 HIGH + 2 CRITICAL Node CVEs. |
| **Stage 2 Scan** | [`docs/da3/q2/trivy-after.txt`](./trivy-after.txt) | L20, L643 | `evolve-backend:hardened`: 0 OS CVEs; 21 HIGH + 1 CRITICAL inside `/usr/local/lib/node_modules/npm`. |
| **Stage 3 Scan** | [`docs/da3/q2/trivy-hardened-clean.txt`](./trivy-hardened-clean.txt) | L7, L9–L185, L187–L189 | `evolve-backend:hardened`: 90 targets evaluated, all showing `0` vulnerabilities. Concludes with `0: Clean`. |
| **Compliance & Threat Model** | [`docs/da3/q2/q2d-threat-model-and-compliance.md`](./q2d-threat-model-and-compliance.md) | L75, L153–L163, L181 | Documents Docker hardening, Trivy v0.76.1 scanner parameters, and scope boundaries. |
| **Dockerfile** | [`backend/Dockerfile`](../../backend/Dockerfile) | L1–L27 | Multi-stage build, `apk upgrade`, package manager stripping, and `USER node`. |

---

## 5. Verified Terminal Output Representation

Below is the clean in-memory representation of the Stage 3 scan Report Summary header and footer:

```text
Report Summary

┌─────────────────────────────────────────────────────────────────────┬──────────┬─────────────────┬─────────┐
│                               Target                                │   Type   │ Vulnerabilities │ Secrets │
├─────────────────────────────────────────────────────────────────────┼──────────┼─────────────────┼─────────┤
│ evolve-backend:hardened (alpine 3.23.4)                             │  alpine  │        0        │    -    │
├─────────────────────────────────────────────────────────────────────┼──────────┼─────────────────┼─────────┤
│ app/node_modules/accepts/package.json                               │ node-pkg │        0        │    -    │
├─────────────────────────────────────────────────────────────────────┼──────────┼─────────────────┼─────────┤
│ app/node_modules/bcrypt/package.json                                │ node-pkg │        0        │    -    │
├─────────────────────────────────────────────────────────────────────┼──────────┼─────────────────┼─────────┤
│ app/node_modules/body-parser/package.json                           │ node-pkg │        0        │    -    │
├─────────────────────────────────────────────────────────────────────┼──────────┼─────────────────┼─────────┤
... (86 additional clean runtime package targets omitted for brevity) ...
├─────────────────────────────────────────────────────────────────────┼──────────┼─────────────────┼─────────┤
│ app/package.json                                                    │ node-pkg │        0        │    -    │
├─────────────────────────────────────────────────────────────────────┼──────────┼─────────────────┼─────────┤
│ usr/local/lib/node_modules/corepack/package.json                    │ node-pkg │        0        │    -    │
└─────────────────────────────────────────────────────────────────────┴──────────┴─────────────────┴─────────┘
Legend:
- '-': Not scanned
- '0': Clean (no security findings detected)
```
