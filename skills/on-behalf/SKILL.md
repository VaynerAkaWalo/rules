---
name: on-behalf
description: Use whenever you post a comment or reply on a merge request, pull request, GitHub issue or Jira issue, so readers can tell your replies from the user's.
---

Start every comment and reply with one italic line that names you, your model and the user you act for, like `_Claude (Opus 5.5) replying on behalf of john.doe._` Use `_` because it renders as italic in both markdown and Jira wiki markup.

Name the user by the part of `git config user.email` before the `@`. For a GitHub noreply address like `12345+name@users.noreply.github.com`, use the part after the `+`.

Titles and descriptions of merge requests, pull requests, GitHub issues and Jira issues don't get this line.
