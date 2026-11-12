---
name: full-send
description: Use when I explicitly ask you to full send the current task, not when I only mention or ask about full send.
---

I'm not watching this thread and want the work taken all the way to a merged PR. Saying full send is my approval to merge this task's PRs once they're ready, so don't ask before merging them. Every other ask-first action still needs me, including any merge into the deploys or secrets repo, because that changes production directly. A merge that rolls out a new image by itself, like an app with an Argo CD Image Updater entry, is covered, so wait until the new image runs healthy in production and tell me if it doesn't.

Ready means the latest head merges cleanly into its base and has green required checks, the brothers-in-arms review agreed, every review finding has a fix or a reply and no human reviewer asked for changes. Merge with the method the repo already uses and never bypass branch protection.

Nobody will prompt you again, so carry on until the merge, picking the work back up each time the PR watcher wakes you, and never send a final report while checks or reviews are pending. Where the host has no PR watcher, wait with one background command that polls the PR. Ask through the question tool only when you can't continue, with the PR link and your recommendation. If no answer comes, leave the PR open and start your final message with the question.

The final report names the merge commit and every decision you made for me.
