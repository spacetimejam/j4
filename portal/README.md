# Job Search Portal

A small web app for submitting job descriptions to a Claude-driven job-search project. Each submission runs an agent session inside your generated project. The session works in two stages: first it captures the role and replies in the portal with a full fit assessment, asking about anything that's blocking a judgment and whether you want to apply; only when you say yes does it tailor the CV and cover letter and email the rendered deliverables back to you.

Quick start:

```
cd portal
npm install
cp .env.example .env   # then edit
npm start
```

Full setup, deployment and security notes (including the bypassPermissions risk): see [docs/portal.md](../docs/portal.md).
