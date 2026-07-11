# Job Search Portal

A small web app for submitting job descriptions to a Claude-driven job-search project. Each submission runs an agent session inside your generated project, follows its WORKFLOW.md, and emails the rendered deliverables back to you.

Quick start:

```
cd portal
npm install
cp .env.example .env   # then edit
npm start
```

Full setup, deployment and security notes (including the bypassPermissions risk): see [docs/portal.md](../docs/portal.md).
