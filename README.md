# SAC Skill Tracker

SAC Skill Tracker is a modern web application designed to help organizations track, analyze, and visualize skill development over time. Originally built for the Shippensburg Aquatic Club, the platform enables coaches and instructors to monitor individual progress, evaluate performance, and make data-driven decisions.

---

## 🚀 Overview

The platform provides a centralized system where organizations can:

* Track individual skill progression
* Record evaluations and feedback
* Monitor engagement and growth over time
* Visualize performance trends through intuitive dashboards

SAC Skill Tracker is built with scalability in mind, making it adaptable for any organization focused on skill development—not just swimming programs.

---

## 🛠️ Tech Stack

**Frontend**

* Next.js (React)
* TypeScript
* 
**Backend**

* Supabase (PostgreSQL + Auth + Realtime)

**Deployment**

* Vercel (Frontend)
* Supabase Cloud (Backend)

---

## ⚙️ Core Features

### 📊 Skill Tracking

* Add and manage skills for individuals
* Track progress across multiple categories
* View historical development over time

### 🧑‍🏫 Instructor Dashboard

* Evaluate members during or after sessions
* Submit structured feedback
* Simplified evaluation workflows

### 📈 Analytics & Visualization

* Visual dashboards for performance insights
* Identify strengths and improvement areas
* Track engagement trends

### 🔐 Authentication & Roles

* Secure login system powered by Supabase Auth
* Role-based access (e.g., admin, instructor, member)

### ⚡ Real-time Updates

* Instant data sync across users
* No manual refresh required

---

## 🧠 Architecture

The application follows a modern full-stack architecture:

* **Frontend (Next.js)** handles UI and client-side interactions
* **Supabase** manages:

  * Database (PostgreSQL)
  * Authentication
  * Real-time subscriptions

This setup ensures:

* Low latency
* Easy scalability
* Minimal backend maintenance

---

## 📂 Project Structure

```
SAC-Skill-Tracker/
│
├── frontend/        # Next.js application
├── supabase/        # Database schema and SQL
├── scripts/         # Utility scripts (data import, etc.)
├── .vscode/         # Editor configs
└── README.md
```

---

## 🌐 Live Demo

👉 https://sac-skill-tracker-nine.vercel.app/

---

## 🧪 Future Improvements

* Multi-organization (multi-tenant) support
* Advanced analytics
* Mobile optimization
* Notifications & alerts for progress milestones
* Export reports (PDF/CSV)

---

## 🤝 Contributors

* Nishant Neupane
* Yashaswe Amatya
* aidanm247
* llzulloll

---

## 📌 Use Cases

While originally built for swim programs, SAC Skill Tracker can be adapted for:

* Sports teams
* Educational programs
* Training organizations
* Student advisory committees
* Corporate skill development tracking

---

