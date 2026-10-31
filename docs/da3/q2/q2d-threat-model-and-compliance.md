# BACSE344 Cloud Infrastructure and Architecture — Digital Assignment 3 (DA3)
## Question 2(d): Threat Modeling, Security Controls, and Regulatory Compliance

---

### Executive Summary

Cloud-connected electric vehicle (EV) charging platforms operate at the intersection of power grid infrastructure, driver personal data, and public web APIs. This makes them attractive targets for both unauthenticated external adversaries and authenticated malicious users. This document presents a threat model, control mapping, and regulatory applicability assessment for the **EVolve** EV Charging Management Platform, grounded strictly in the verified codebase ([`backend/app.js`](file:///c:/Users/Arushi%20Grover/OneDrive/EVolve/backend/app.js), [`backend/auth.js`](file:///c:/Users/Arushi%20Grover/OneDrive/EVolve/backend/auth.js), [`backend/logging.js`](file:///c:/Users/Arushi%20Grover/OneDrive/EVolve/backend/logging.js), and [`backend/Dockerfile`](file:///c:/Users/Arushi%20Grover/OneDrive/EVolve/backend/Dockerfile)).

---

### 1. Threat Agent Identification & Attack Analysis

#### Threat Agent 1: Opportunistic External Threat Actor (Automated Attacker / Script Kiddie)

* **Profile & Motivation:**
  * **Motivation:** Financial gain, unauthorized energy consumption, botnet recruitment, or generalized service disruption.
  * **Capabilities:** Low-to-moderate technical skill. Utilizes automated scanning tools (OWASP ZAP, Nmap, Nikto), credential-stuffing/brute-force tools (Hydra, Burp Suite intruder), public exploit databases, and pre-compiled credential wordlists.
  * **Access Level:** Unauthenticated external network access targeting public HTTP routes (`/api/login`, `/api/stations`, `/health`) and exposed container ports.

* **Attack Vectors & Scenarios against EVolve:**
  1. **Automated Credential Stuffing & Password Guessing:**
     * *Vector:* High-volume dictionary attacks against `POST /api/login` leveraging leaked credential lists or legacy default passwords (such as the legacy backdoor `demo123`).
     * *Target Asset:* User account credentials and administrative access tokens.
  2. **Denial of Service (DoS) & Connection Starvation:**
     * *Vector:* Concurrently flooding unauthenticated public endpoints (`GET /api/stations`, `POST /api/login`) with HTTP requests.
     * *Target Asset:* Node.js event-loop capacity and Neon PostgreSQL database connection pools.
  3. **Container Infrastructure Probing:**
     * *Vector:* Probing running container endpoints for known Common Vulnerabilities and Exposures (CVEs) in base OS libraries or unpatched runtime dependencies.
     * *Target Asset:* Host operating system isolation and container execution boundaries.

* **Security Properties at Risk:**
  * **Availability:** Station outage or connection starvation preventing legitimate EV drivers from viewing or reserving charging stations.
  * **Confidentiality:** Exposure of user profile data or password hashes if authentication controls are bypassed.
  * **Integrity:** Unauthorized modifications to station availability if administrative sessions are compromised.

---

#### Threat Agent 2: Malicious Registered User / Tenant (Insider Threat)

* **Profile & Motivation:**
  * **Motivation:** Billing evasion (charging without paying the full tariff), competitive sabotage (reserving charging bays to starve rival commercial fleets), or unauthorized privilege elevation (accessing operator/admin controls).
  * **Capabilities:** Moderate technical skill. Familiar with browser developer tools, HTTP interception proxies (Burp Suite, OWASP ZAP, Postman, `curl`), and valid application workflows.
  * **Access Level:** Authenticated tenant with valid registered credentials, verified TOTP MFA challenge, and an active signed HMAC-SHA256 session token (`role: 'user'`).

* **Attack Vectors & Scenarios against EVolve:**
  1. **Horizontal Privilege Escalation (Broken Object Level Authorization — BOLA / IDOR):**
     * *Vector:* Manipulating path parameters in `PUT /api/bookings/:id` or `DELETE /api/bookings/:id`.
     * *Target Asset:* Competing drivers' charging bookings and reservation schedules.
  2. **Vertical Privilege Escalation (Role Bypass):**
     * *Vector:* Submitting user-level session tokens to mutating administrative endpoints (`PUT /api/stations/:id`, `DELETE /api/stations/:id`, `PUT /api/sessions/:id`).
     * *Target Asset:* Station operational state, charger hardware status, and global charging session records.
  3. **Energy Metric & Billing Manipulation:**
     * *Vector:* Transmitting falsified `energy_used_kwh` values in `POST /api/sessions/:id/complete`.
     * *Target Asset:* Electricity tariff revenue and financial audit trails.

* **Security Properties at Risk:**
  * **Integrity:** Falsified energy consumption figures, corrupted reservation calendars, and illegitimate station state transitions.
  * **Confidentiality:** Leakage of competing drivers' reservation locations, timestamps, and travel patterns.
  * **Availability:** Blocking legitimate drivers from reserving slots through bad-faith booking hoarding.

---

### 2. Security Controls Mapping

Controls are classified into **Preventive**, **Detective**, and **Corrective** categories. To ensure strict documentation integrity, each control is explicitly designated as **IMPLEMENTED** (with source code citations) or **PROPOSED** (recommended operational enhancement).

#### Threat-to-Control Matrix

| Threat Agent | Attack Vector | Category | Status | Technical Mechanism & Implementation Reference |
| :--- | :--- | :--- | :--- | :--- |
| **External Attacker** | Credential Stuffing / Brute Force | **Preventive** | **IMPLEMENTED** | • **Salted bcrypt hashing (cost factor 12):** [`backend/app.js#L19-L37`](file:///c:/Users/Arushi%20Grover/OneDrive/EVolve/backend/app.js#L19-L37). Prevents rainbow-table and dictionary pre-computation.<br>• **Removal of default `demo123` bypass:** [`backend/app.js#L483-L492`](file:///c:/Users/Arushi%20Grover/OneDrive/EVolve/backend/app.js#L483-L492). Requires exact cryptographic match against `user.password_hash`.<br>• **RFC 6238 TOTP Multi-Factor Authentication:** [`backend/auth.js#L30-L54`](file:///c:/Users/Arushi%20Grover/OneDrive/EVolve/backend/auth.js#L30-L54) and [`backend/app.js#L495-L509`](file:///c:/Users/Arushi%20Grover/OneDrive/EVolve/backend/app.js#L495-L509). Neutralizes stolen passwords by requiring a time-synchronized 6-digit one-time code. |
| **External Attacker** | Credential Stuffing / Brute Force | **Preventive** | **PROPOSED** | • **Login rate limiting & account lockout:** Enforce `express-rate-limit` on `POST /api/login` (e.g., 5 failed attempts per IP/account per 15-minute window). |
| **External Attacker** | Session Token Forgery / Replay | **Preventive** | **IMPLEMENTED** | • **HMAC-SHA256 Token Signing:** [`backend/auth.js#L68-L94`](file:///c:/Users/Arushi%20Grover/OneDrive/EVolve/backend/auth.js#L68-L94). Signs `userId`, `role`, `iat`, and `exp`. Rejects tampered payloads or expired sessions.<br>• **Separation of MFA tokens:** Challenge tokens (`mfaVerified: false`) cannot access protected routes ([`backend/auth.js#L108-L113`](file:///c:/Users/Arushi%20Grover/OneDrive/EVolve/backend/auth.js#L108-L113)). |
| **External Attacker** | Container & OS Exploitation | **Preventive** | **IMPLEMENTED** | • **Multi-stage Docker hardening:** [`backend/Dockerfile#L1-L32`](file:///c:/Users/Arushi%20Grover/OneDrive/EVolve/backend/Dockerfile#L1-L32). Upgrades Alpine packages, removes `npm`/`yarn` build tooling from the runtime image, and runs as unprivileged user `node` (`uid=1000`).<br>• **Vulnerability Verification:** Confirmed **0 HIGH and 0 CRITICAL** vulnerabilities in Trivy v0.76.1 scan ([`docs/da3/q2/trivy-hardened-clean.txt`](file:///c:/Users/Arushi%20Grover/OneDrive/EVolve/docs/da3/q2/trivy-hardened-clean.txt)). |
| **External Attacker** | High-Rate Endpoint Probing | **Detective** | **PROPOSED** | • **Ingress WAF & Anomaly Monitoring:** Deploy cloud WAF (e.g., AWS WAF / Cloudflare) to detect abnormal request spikes and trigger automated IP rate limiting. |
| **External Attacker** | Host / Container Compromise | **Corrective** | **PROPOSED** | • **Automated Container Replacement:** Re-deploy container tasks from immutable registry; automated secret rotation for `SESSION_SECRET` and database credentials. |
| **Malicious Insider** | Vertical Privilege Escalation | **Preventive** | **IMPLEMENTED** | • **Role-Based Access Control (`authorizeRoles`):** [`backend/auth.js#L126-L137`](file:///c:/Users/Arushi%20Grover/OneDrive/EVolve/backend/auth.js#L126-L137). Enforced on mutating routes for stations ([`backend/app.js#L241`](file:///c:/Users/Arushi%20Grover/OneDrive/EVolve/backend/app.js#L241), [`backend/app.js#L277`](file:///c:/Users/Arushi%20Grover/OneDrive/EVolve/backend/app.js#L277)), chargers ([`backend/app.js#L385`](file:///c:/Users/Arushi%20Grover/OneDrive/EVolve/backend/app.js#L385), [`backend/app.js#L421`](file:///c:/Users/Arushi%20Grover/OneDrive/EVolve/backend/app.js#L421)), and sessions ([`backend/app.js#L1242`](file:///c:/Users/Arushi%20Grover/OneDrive/EVolve/backend/app.js#L1242), [`backend/app.js#L1281`](file:///c:/Users/Arushi%20Grover/OneDrive/EVolve/backend/app.js#L1281)). Restricts modifications to `operator` and `admin` roles. |
| **Malicious Insider** | Horizontal IDOR (Booking Hijack) | **Preventive** | **IMPLEMENTED** | • **Ownership Validation on Bookings:** [`backend/app.js#L904-L914`](file:///c:/Users/Arushi%20Grover/OneDrive/EVolve/backend/app.js#L904-L914) (`PUT`) and [`backend/app.js#L944-L952`](file:///c:/Users/Arushi%20Grover/OneDrive/EVolve/backend/app.js#L944-L952) (`DELETE`). Queries `SELECT user_id FROM bookings WHERE id = $1` and enforces `existing.rows[0].user_id === req.user.userId` for regular users. Overriding `user_id` in request body is prevented. Operators and admins bypass ownership check for operational management. |
| **Malicious Insider** | Billing / Energy Manipulation | **Preventive** | **IMPLEMENTED** | • **Server-side Tariff Calculation:** [`backend/app.js#L1233-L1234`](file:///c:/Users/Arushi%20Grover/OneDrive/EVolve/backend/app.js#L1233-L1234). Enforces fixed rate of ₹12.0/kWh; client cannot override unit price or calculated billing amount.<br>• **Authentication, Authorization & Ownership:** [`backend/app.js#L1184-L1228`](file:///c:/Users/Arushi%20Grover/OneDrive/EVolve/backend/app.js#L1184-L1228). `POST /api/sessions/:id/complete` enforces `requireAuth, requireRole("operator", "admin", "user")`. Regular users cannot complete another driver's session (`session.user_id === req.user.userId`); operators and admins retain full management access.<br>• **Strict Input Validation:** [`backend/app.js#L1186-L1208`](file:///c:/Users/Arushi%20Grover/OneDrive/EVolve/backend/app.js#L1186-L1208). Rejects invalid session IDs and missing, non-numeric, negative, infinite, NaN, boolean, or empty energy values with 400 Bad Request. |
| **Malicious Insider** | Meter Telemetry Integration | **Preventive** | **PROPOSED** | • **Cryptographic Smart Meter / OCPP Ingestion:** Ingest signed telemetry directly from OCPP 1.6/2.0.1 charge point controllers rather than accepting client-reported energy values. |
| **Malicious Insider** | Information Leakage in Logs | **Detective** | **IMPLEMENTED** | • **Sanitized Error Logging:** [`backend/logging.js#L1-L6`](file:///c:/Users/Arushi%20Grover/OneDrive/EVolve/backend/logging.js#L1-L6). `logError` logs only `${context} [${code}]` using 5-character SQLSTATE error codes. Strips SQL queries, parameters, database credentials, connection strings, and stack traces. |
| **Malicious Insider** | Structured Audit Logging | **Detective** | **PROPOSED** | • **Structured Security Audit Logs:** Log request metadata (timestamp, authenticated user ID, client IP, route, HTTP method) to a tamper-resistant append-only store. *(Note: General request logging is currently not implemented in the application middleware).* |
| **Malicious Insider** | Session Revocation | **Corrective** | **PROPOSED** | • **Token Revocation List:** Implement a distributed Redis blocklist or token generation version counter to immediately invalidate active JWTs upon role downgrade or account suspension. |

---

### 3. Regulatory and Compliance Framework Analysis

#### 3.1 General Data Protection Regulation (GDPR — Regulation (EU) 2016/679)

* **Territorial and Material Scope (Articles 2 & 3):**
  * **Material Scope (Art. 2):** Covers the processing of personal data wholly or partly by automated means. EVolve processes personal data including user identifiers (`id`, `email`, `name`), vehicle charging reservation history, booking timestamps, and session locations.
  * **Territorial Applicability (Art. 3):**
    * *Article 3(1):* Applies to the processing of personal data in the context of the activities of an establishment of a controller or processor in the European Union, regardless of whether the processing takes place in the Union.
    * *Article 3(2):* Applies to a controller or processor *not established in the Union* where processing activities relate to:
      1. The offering of goods or services (paid or free) to data subjects in the Union (Art. 3(2)(a)); or
      2. The monitoring of their behavior as far as their behavior takes place within the Union (Art. 3(2)(b)).
    * *Legal Distinction:* Under Recital 23, the mere accessibility of an online application or website from within the Union is **insufficient** to establish applicability. There must be an evident intention to offer services to individuals in the EU (e.g., use of EU languages, EU currency, or targeting EU consumers). Because EVolve is developed as an academic project configured for domestic Indian infrastructure (denominating tariffs in INR `₹12/kWh`), GDPR does not impose mandatory statutory obligations on this deployment by default.

* **Technical Measures and Article 32 (Security of Processing):**
  * Article 32(1) obligates controllers and processors to implement technical and organizational measures to ensure a level of security appropriate to the risk, taking into account the state of the art, implementation costs, nature, scope, context, and purposes of processing, as well as the severity and likelihood of risks to data subjects.
  * *Relationship to EVolve Controls:* The security mechanisms implemented in EVolve—namely salted `bcrypt` password hashing (cost factor 12), RFC 6238 TOTP MFA, signed HMAC-SHA256 session tokens, role-based authorization, and container vulnerability minimization—represent **technical measures that may contribute toward achieving risk-appropriate security** under Article 32. Article 32 sets a standard of risk-based security rather than individually mandating specific algorithms, libraries, or deployment patterns.
  * *Additional Requirements for Formal Compliance:* A production EU deployment would additionally require formal Data Protection Impact Assessments (DPIAs under Art. 35), data processing agreements (Art. 28), consent management workflows (Art. 7), automated mechanisms for data subject rights (e.g., Right to Erasure / Art. 17), and encryption of personal data at rest in PostgreSQL.

---

#### 3.2 Network and Information Systems Directive 2 (NIS 2 — Directive (EU) 2022/2555)

* **Scope and Applicability Criteria (Articles 2 & 3, Annexes I & II):**
  * **Sectoral Classification:** NIS 2 covers sectors of high criticality (Annex I) and other critical sectors (Annex II). Annex I, Item 1 (Energy - Electricity) includes operators of recharging points (Charging Point Operators — CPOs) under Directive 2014/94/EU / Regulation (EU) 2023/1804 (AFIR).
  * **CPO Infrastructure vs. Software Applications:**
    * *Critical Distinction:* A statutory CPO is an entity responsible for the physical and operational management of electric vehicle recharging points. A software application or charging management system (CMS) like EVolve is a software component, not intrinsically an operator of recharging infrastructure.
    * Software suppliers only fall under NIS 2 if they operate the physical recharging network themselves, qualify as digital providers / managed service providers (MSPs under Annex I, item 8), or are specifically designated by a Member State.
  * **Entity Size Criteria & Exceptions (Article 2):**
    * *Size-Cap Rule (Art. 2(1)):* NIS 2 generally applies to entities that qualify as medium-sized enterprises (at least 50 employees and annual turnover/balance sheet exceeding €10M) or large enterprises (at least 250 employees or turnover $> €50\text{M}$ / balance sheet $> €43\text{M}$) under Commission Recommendation 2003/361/EC.
    * *Essential vs. Important Entities:* Large entities in Annex I sectors are classified as *Essential*, while medium entities in Annex I sectors and medium/large entities in Annex II sectors are classified as *Important* (Art. 3).
    * *Exceptions to Size Thresholds (Art. 2(2)):* Regardless of size, entities fall under NIS 2 if they are sole providers of an essential service, if disruption could have significant cross-border impact, or if identified by national Member State transposition. Small and micro-enterprises ($< 50$ staff, $< €10\text{M}$ turnover) are otherwise excluded unless explicitly designated.
  * *Application to EVolve:* As an educational/prototyping software project, EVolve has no statutory obligations under NIS 2.

* **Cybersecurity Risk-Management Measures (Article 21):**
  * Under Article 21, entities in scope must implement all-hazards cybersecurity risk-management measures. EVolve’s technical controls align with several Article 21 principles as voluntary best-practice engineering:
    * *Multi-Factor Authentication (Art. 21(2)(j)):* Addressed via RFC 6238 TOTP verification and separate session token signing.
    * *Supply Chain and Container Security (Art. 21(2)(d)):* Addressed by stripping build tools (`npm`, `yarn`) and building unprivileged container artifacts.
    * *Basic Cyber Hygiene & Vulnerability Handling (Art. 21(2)(e)):* Addressed through automated container vulnerability scanning.

---

#### 3.3 Indian Digital Personal Data Protection Act (DPDP Act 2023)

* **Relevance to EVolve Context:**
  * As EVolve models Indian EV charging stations (tariffs denominated in Indian Rupees `₹12.0/kWh` in [`backend/app.js#L1210`](file:///c:/Users/Arushi%20Grover/OneDrive/EVolve/backend/app.js#L1210)), India's **Digital Personal Data Protection Act (DPDP Act) 2023** represents the primary applicable domestic framework for commercialization within India.
* **Status of Enforcement and Commencement:**
  * Although the DPDP Act received presidential assent in August 2023, its substantive operational provisions, administrative rules, Data Protection Board operations, and penalty structures are subject to phased commencement via Central Government gazette notifications.
  * Statutory compliance obligations (e.g., Data Fiduciary obligations under Section 6–8, notice requirements, and breach reporting) must be verified against official commencement notifications rather than assumed to be wholly active.
* **Architectural Alignment:**
  * Implementing salted hashing, multi-factor authentication, and sanitized error logging establishes technical safeguards that support reasonable security safeguards under Section 8(5) of the Act when fully commenced.

---

#### 3.4 Summary: Legal Obligations vs. Voluntary Security Best Practices

To avoid conflating compliance mandates with good engineering practices, the distinction is summarized below:

| Dimension | Mandatory Legal Obligation | Voluntary Engineering Best Practice |
| :--- | :--- | :--- |
| **Applicability Basis** | Arises solely when an entity legally meets jurisdictional, material, sectoral, and size criteria defined in statute (e.g., GDPR Art. 3, NIS 2 Art. 2). | Applied by engineers to safeguard system integrity, resilience, and user trust regardless of regulatory thresholds. |
| **EVolve Prototype Status** | **None.** As an academic demonstration prototype, EVolve is not a commercial enterprise or statutory critical entity. | **High.** All implemented security controls (bcrypt, TOTP, RBAC, container stripping) serve as voluntary cyber-hygiene. |
| **Enforcement Mechanism** | Regulatory audits, administrative orders, binding fines from Data Protection Authorities / National CSIRTs. | Peer review, continuous integration tests (117 passing backend tests), static container scans. |

---

### 4. Vulnerability Scan Verification & Limitations

* **Scanner Configuration & Version:**
  * Scanner: Trivy v0.76.1 (`aquasec/trivy:latest`) executed via Docker engine.
  * Target: `evolve-backend:hardened` (Alpine Linux 3.23.4, Node.js 20 runtime).
  * Filter: Explicitly executed with `--severity HIGH,CRITICAL`.
* **Confirmed Scanner Results:**
  * **0 CRITICAL and 0 HIGH** vulnerabilities confirmed across base OS packages and bundled application npm dependencies ([`docs/da3/q2/trivy-hardened-clean.txt`](file:///c:/Users/Arushi%20Grover/OneDrive/EVolve/docs/da3/q2/trivy-hardened-clean.txt)).
* **Scan Scope Limitation:**
  * Because the scanner was executed with `--severity HIGH,CRITICAL`, vulnerabilities of **LOW, MEDIUM, or UNKNOWN** severity were not evaluated in this scan report and cannot be claimed to be zero.

---

### 5. Summary of Verified Controls & Status

| Area | Status | Verified Code Reference | Note / Remaining Limitation |
| :--- | :--- | :--- | :--- |
| **Password Hashing** | Verified | [`backend/app.js#L19-L37`](file:///c:/Users/Arushi%20Grover/OneDrive/EVolve/backend/app.js#L19-L37) | Uses `bcrypt` with 12 salt rounds; rejects empty passwords. |
| **Password Verification** | Verified | [`backend/app.js#L485`](file:///c:/Users/Arushi%20Grover/OneDrive/EVolve/backend/app.js#L485) | `verifyPassword` via `bcrypt.compare`; default `demo123` bypass absent. |
| **MFA Workflow** | Verified | [`backend/app.js#L495-L726`](file:///c:/Users/Arushi%20Grover/OneDrive/EVolve/backend/app.js#L495-L726), [`backend/auth.js#L30-L54`](file:///c:/Users/Arushi%20Grover/OneDrive/EVolve/backend/auth.js#L30-L54) | RFC 6238 TOTP with separate challenge token. |
| **Session Signing** | Verified | [`backend/auth.js#L68-L94`](file:///c:/Users/Arushi%20Grover/OneDrive/EVolve/backend/auth.js#L68-L94) | HMAC-SHA256 signing; validates `exp`, `iat`, `role`. |
| **RBAC Enforcement** | Verified | [`backend/auth.js#L126-L137`](file:///c:/Users/Arushi%20Grover/OneDrive/EVolve/backend/auth.js#L126-L137) | Enforced on 8 mutating endpoints (`PUT`/`DELETE` for stations, chargers, bookings, sessions). |
| **Booking Ownership** | Verified | [`backend/app.js#L904-L914`](file:///c:/Users/Arushi%20Grover/OneDrive/EVolve/backend/app.js#L904-L914), [`backend/app.js#L944-L952`](file:///c:/Users/Arushi%20Grover/OneDrive/EVolve/backend/app.js#L944-L952) | Regular users restricted to own bookings; operators/admins manage all. |
| **Tariff Calculation** | Verified | [`backend/app.js#L1210-L1211`](file:///c:/Users/Arushi%20Grover/OneDrive/EVolve/backend/app.js#L1210-L1211) | Computed server-side at ₹12.0/kWh. |
| **Session Completion Security** | Verified | [`backend/app.js#L1184-L1230`](file:///c:/Users/Arushi%20Grover/OneDrive/EVolve/backend/app.js#L1184-L1230) | Protected via `requireAuth, requireRole("operator", "admin", "user")`. Enforces ownership for regular users; operators/admins can complete any session; rejects MFA challenge tokens and unauthorized roles. |
| **Energy Input & Telemetry** | Limitation | [`backend/app.js#L1193-L1208`](file:///c:/Users/Arushi%20Grover/OneDrive/EVolve/backend/app.js#L1193-L1208) | Validates finite non-negative numbers, but accepts client-supplied `energy_used_kwh` in absence of trusted hardware/smart-meter telemetry. |
| **Error Sanitization** | Verified | [`backend/logging.js#L1-L6`](file:///c:/Users/Arushi%20Grover/OneDrive/EVolve/backend/logging.js#L1-L6) | Logs only context and 5-character SQLSTATE code; strips SQL/parameters. |
| **Request Access Logging** | Proposed | None | Structured request logging (IP, user ID, route) is not implemented. |
| **Container Hardening** | Verified | [`backend/Dockerfile#L1-L32`](file:///c:/Users/Arushi%20Grover/OneDrive/EVolve/backend/Dockerfile#L1-L32) | Multi-stage build, unprivileged user `node`, 0 HIGH/CRITICAL CVEs confirmed. |
