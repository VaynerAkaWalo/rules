---
name: full-send
description: Use when I explicitly ask you to full send the current task, not when I only mention or ask about full send.
---

I'm not watching this thread and want the work taken all the way to merged PRs. Saying full send is my approval to merge every PR this task needs once each is ready, including in the deploys and secrets repos, so don't ask before merging them. Merge them in the order the rollout needs, wait until each change is applied and healthy in production before the next one, and tell me if it isn't. A merge that deletes data or removes something still in use, like a database, a volume or a secret, still needs me, as do the other ask-first actions.

Ready means the job counts as done under my instructions, the brothers-in-arms review agreed and no human reviewer asked for changes. Merge with the method the repo already uses and never bypass branch protection.

Nobody will prompt you again, so carry on until the last merge and rollout, picking the work back up each time the PR watcher wakes you, and never send a final report while checks or reviews are pending. Where the host has no PR watcher, wait with one background command that polls the PR. Ask through the question tool only when you can't continue, with the PR link and your recommendation. If no answer comes, leave the PR open and start your final message with the question.

The final report names the merge commits and every decision you made for me.
