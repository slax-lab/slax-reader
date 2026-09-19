# One-card verification (temporary)

This file exists only so a pull request can produce a real `pull_request` event
pair — `opened` plus the `review_requested` that GitHub sends for the team
`CODEOWNERS` assigns — and confirm that the notification bridge sends **one**
group card for it rather than two.

Expected in Feishu: a single card, `#<pr> 🙋 轮到团队 review`, whose body names
`@slax-lab/reader-core（团队）`. There should be **no** `📬 新 PR 待评审` card.

The pull request is closed without merging and this branch is deleted.
