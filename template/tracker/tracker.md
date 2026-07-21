# Tracker

File-based application log for tracking job applications through their lifecycle.

## CSV schema

The tracker is stored in `applications.csv` with the following columns. Read this file at the start of each session and surface any `Next_Action_Date` that is due or overdue.

| Column | Type | Notes |
|---|---|---|
| Role | Text | |
| Org | Text | |
| Status | Choice | Researching / Applying / Interviewing / Hired / Turned down |
| Date_Applied | Date | |
| Link | Text | posting URL |
| CV_Version | Text | the sent file, e.g. `applications/<slug>/cv.yaml` |
| Letter_Version | Text | the sent file |
| Source | Text | job board / recruiter / referral |
| Salary_Range | Text | |
| Deadline | Date | |
| Next_Action | Text | what the next step is |
| Next_Action_Date | Date | the date that stops applications going cold; keep populated |
| Fit | Choice | Strong / Possible / Stretch / Weak |
| Folder | Text | the `/applications` subfolder slug |
| Notes | Text | |

## Rules for CSV editing

When reading or writing the tracker:

- **Column order:** never reorder columns; they must stay as listed above.
- **Quoting:** quote any field containing commas using double quotes, e.g. `"Director of Design, In-House"`.
- **Dates:** use ISO format `YYYY-MM-DD` (e.g. `2026-07-11`); leave blank for null values.
- **Status and Fit:** use only the choice values listed in the schema table above.
