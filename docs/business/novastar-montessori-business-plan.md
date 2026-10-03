# Novastar Montessori School — Digital Transformation Plan
## Executive Summary for Stakeholders

**Prepared for:** School Owner & Mediator Review  
**Prepared by:** Development Team  
**Date:** September 2026  
**Version:** 1.0 (Non-Technical Summary)

---

## 1. What We're Building

We are creating a **complete digital system** for Novastar Montessori School that has two main parts:

### Part A: Public Website (Marketing & Admissions)
- A beautiful, professional website that shows the school to the world
- Parents can learn about programs, fees, facilities, and apply online
- Works in **English and Twi** (language toggle)
- Mobile-friendly — works perfectly on phones, tablets, and computers

### Part B: School Portal (Daily Operations)
- A private, secure system used by staff, teachers, and management **every day**
- Works **offline** (no internet needed) — critical for Ghana connectivity
- Syncs automatically when internet returns
- Accessible on any device: laptop, tablet, phone

---

## 2. Key Problems This Solves

| Current Challenge | How This System Fixes It |
|-------------------|--------------------------|
| Paper records, lost files | All student/staff data digital, searchable, backed up |
| Manual fee tracking, errors | Automated invoices, MTN MoMo payments, real-time balances |
| No central communication | One platform for announcements, messages, emails to parents/staff |
| Headmaster can't see everything | **Single dashboard** showing all school activity in real-time |
| Staff need developer for changes | **Admin configures everything** — no coding needed |
| Internet outages stop work | **Offline-first** — works without internet, syncs later |
| Hard to generate reports | One-click reports: academics, attendance, finance, GES compliance |
| Can't delegate when busy | Headmaster **delegates any task** to any staff temporarily |

---

## 3. What the Portal Does (By Role)

### Headmaster / Headmistress (School Leader)
- **See everything:** Live dashboard — student count, fee collection %, attendance, pending approvals
- **Delegate work:** Assign any task to any staff (e.g., "You handle promotions this term while I'm away")
- **Approve decisions:** Teacher promotions, student advancement, fee waivers, leave requests
- **Send messages:** Broadcast to all parents, specific classes, or individual staff
- **Generate any report:** Academic, finance, attendance, staff performance — one click

### Assistant Headmaster / Academic Coordinator
- Manage academic calendar: terms, exam dates, SBA windows
- Build and publish timetables (drag-and-drop, conflict-free)
- Oversee assessments: review teacher scores, moderate, approve reports
- Run promotion process: system checks rules, you approve class advancement

### Bursar / Finance Officer
- Set up fee structures per class/term (tuition, uniforms, books, transport, etc.)
- Generate invoices in bulk, email to parents
- Record payments: **MTN MoMo, Bank Transfer, Cash** — all tracked
- Daily cash sheets, bank reconciliation, financial reports
- Payroll: staff contracts, deductions, payslips

### Class Teacher
- Mark student attendance (quick, offline-capable)
- Enter assessment scores (SBA, mid-term, end-term) — works offline
- View student profiles: academics, attendance, behaviour, fees
- Communicate with parents of own class
- Generate terminal reports for own class

### Subject Teacher
- Enter scores for own subjects across classes
- View class lists, schemes of work
- Mark attendance for own periods

### Registrar / Admin Officer
- Admissions: manage applications, enrol new students
- Student records: documents, transfers, graduation
- Staff records: contracts, leave, attendance
- Communication: news, events, calendar management

### Parents (Parent Portal)
- View child's: reports, attendance, fee balance, announcements
- Pay fees via MTN MoMo
- Message teachers
- Receive push notifications

---

## 4. Everything Is Configurable (No Hardcoding)

**The school admin can change ANYTHING without calling the developer:**

| Category | What You Can Edit |
|----------|-------------------|
| **Academic Structure** | Academic years, term dates, class names (KG1, B1, JHS 1...), streams (A/B/C) |
| **Subjects** | Add/remove subjects, assign to classes, set periods per week |
| **Grading System** | Create custom grading scales (A-F, Exemplary/Proficient/Developing, or your own) |
| **Assessment Types** | Define SBA, Mid-term, End-term, Project, Practical — weights, max scores |
| **Fees** | Fee categories, amounts per class/term, due dates, mandatory vs optional |
| **Payment Methods** | Enable/disable: MTN MoMo, Bank Transfer, Cash — with instructions |
| **Staff Roles** | Create custom roles (e.g., "Exam Officer", "Sports Coordinator"), assign permissions |
| **Permissions** | Who can do what — granular control (e.g., "Can approve promotions but not fees") |
| **Delegation Rules** | Who can delegate what to whom, with/without approval |
| **Attendance Rules** | Late threshold, absent threshold, auto-alert triggers |
| **Promotion Rules** | Minimum average %, attendance %, SBA % to advance |
| **Branding** | School name, logo, motto, colors, contact info |
| **Content** | News, announcements, events, calendar — bilingual (English/Twi) |
| **Report Templates** | Design your own report cards, transcripts, certificates |

**Default Ghana/NaCCA setup included** — you just customize from there.

---

## 5. Ghana Education System Compliance

- **NaCCA Curriculum:** 5 Key Phases (KG → Primary → JHS → SHS) built-in
- **3-Term System:** Term 1, 2, 3 with configurable dates
- **Assessment:** SBA 1/2/3, Mid-term, End-term windows
- **Grading:** NaCCA standards-based (Exemplary/Proficient/Developing/Emerging) + custom
- **BECE/WASSCE:** Export formats ready for exam registration
- **EMIS/NaSIA:** Compliance reports generated automatically
- **Montessori:** Work cycles, material tracking, observations configurable

---

## 6. Technology Choices (Why These Matter to You)

| Choice | What It Means for the School |
|--------|------------------------------|
| **Cloud-first (Free tier start)** | Zero server costs Year 1 — runs on free tiers of Neon, Supabase, Vercel |
| **Offline-first** | Portal works during internet outages — teachers mark attendance, enter scores anytime |
| **Auto-sync** | When internet returns, everything syncs automatically — no manual work |
| **Local backup option** | Can run on a Mini PC in the school (₵8k-12k) for full independence |
| **MTN MoMo integration** | Parents pay fees via mobile money — instant confirmation, no cash handling |
| **Multi-language** | English default, Twi toggle — ready for more languages later |

---

## 7. Decisions Already Made (Your Input Confirmed)

| Decision | Choice | Why |
|----------|--------|-----|
| **Languages** | English + Twi toggle | Ghana context, parents' preference |
| **Payments** | MTN MoMo + Bank + Cash | Covers 99% of parent payment methods |
| **Biometric Attendance** | **Excluded** | Too expensive, not needed — QR/manual works |
| **SMS/USSD** | Deferred | Not available yet; in-app + email + push first |
| **Transport/Hostel** | Hold for later | Not needed now; plugin-ready when needed |
| **Historical Data** | Import later | Build import tool later; run when data ready |
| **Formal Audit** | Not required pre-launch | Compliance features built-in; audit post-launch if needed |
| **Support Model** | Remote IT + 2-week hypercare | Cost-effective, responsive |

---

## 8. What We Need From You (School Side)

1. **Brand Assets** — Logo, photos, school colors, final mission statement
2. **Fee Structure** — Current fees per class/term (we'll digitize)
3. **Academic Calendar** — Term dates, holidays, exam weeks for 2026/2027
4. **Staff List** — Names, roles, phone/email for account creation
5. **Student Data** — Current enrolment (Excel/CSV) for migration
6. **Grading Preferences** — Confirm NaCCA defaults or customize
7. **Key Decisions** — Review this document, flag changes/additions

---

## 9. What Happens After You Approve

1. **Initial Setup:** We set up the system foundation, design system, free cloud accounts
2. **Config Engine:** You start seeing editable settings — the control panel for everything
3. **Public Website Goes Live:** Parents can see school, apply online
4. **Portal Modules Roll Out:** Features delivered in stages — you test each as it's ready
5. **Full Integration:** System integration testing, data migration, staff training
6. **Go-Live:** Intensive support period, then ongoing remote support

---

## 10. Risks & How We Handle Them

| Risk | Mitigation |
|------|------------|
| Internet unreliable | Offline-first design; local Mini PC backup |
| Staff not tech-savvy | Intuitive UI, role-based training, ongoing remote support |
| Scope creep | Fixed phases, config-first reduces code changes |
| Data loss | Triple backup: Neon (primary) + Supabase (mirror) + Local (Mini PC) |
| MoMo API changes | Plugin architecture — swap provider without rewriting |
| Curriculum changes | Fully configurable — admin updates, no developer needed |

---

## 11. Next Steps

1. **You (Mediator/Owner)** review this document
2. **Mark any changes/additions** — we'll incorporate before starting
3. **Sign off** — we begin
4. **Regular check-ins** — review progress
5. **Demo sessions** — see working features, give feedback

---

## 12. Contact & Questions

**Developer:** Samuel Hughes  
**Availability:** Remote  
**Communication:** Email (samuel.hughes.23@outlook.com), WhatsApp (+233 55 441 6937), Snapchat (pekay001)

---

*This document is a living plan. Changes are expected and welcome — the system is designed to adapt. The technical team will handle all complexity; you only need to define **what** the school needs, not **how** it's built.*

---

**Appendix: Glossary of Terms**
- **NaCCA** — National Council for Curriculum and Assessment (Ghana curriculum body)
- **GES** — Ghana Education Service
- **SBA** — School-Based Assessment (continuous assessment)
- **BECE** — Basic Education Certificate Exam (JHS 3)
- **MTN MoMo** — Mobile Money (MTN Ghana)
- **EMIS** — Education Management Information System (government reporting)
- **PWA** — Progressive Web App (works offline, installs like an app)
- **CRUD** — Create, Read, Update, Delete (standard data operations)
- **RBAC** — Role-Based Access Control (who can do what)
- **CRDT** — Conflict-free Replicated Data Type (tech for offline sync)