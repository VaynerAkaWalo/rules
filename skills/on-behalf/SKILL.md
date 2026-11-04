---
name: on-behalf
description: Use whenever you post a comment or reply on a merge request, pull request, GitHub issue or Jira issue, so readers can tell your replies from the user's.
---

Start every comment and reply with an italic line like `_Claude (Opus 5.5) replying on behalf of john.doe._`, using `_` so it renders in both markdown and Jira. The user name is the part of `git config user.email` before the `@`, or after the `+` in a GitHub noreply address.

Titles and descriptions don't get this line.
