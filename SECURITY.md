# Security

This project deals with **children's voice and conversation logs**.
If you deploy this anywhere outside your private environment, assume it is sensitive personal data.

Minimum recommendations:
- Keep R2 buckets private (no public access).
- Do not store secrets in the repo.
- Lock down any AI automation workflows in GitHub Actions (do not allow untrusted triggers).
- Add proper authentication for parent dashboard and any log export endpoints.
