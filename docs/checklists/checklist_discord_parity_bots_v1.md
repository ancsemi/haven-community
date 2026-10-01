# Checklist: Discord-parity community bots v2

Goal: bring `ancsemi/haven-community` closer to Discord ecosystem coverage via deployable Haven bots.

Pace: **2 bots every 15 minutes** until the queue is empty.

## Wave 1 — core Discord parity (20)

| # | Bot | Discord analogue | Status |
|---|-----|------------------|--------|
| 1 | `rss` | RSS / Dyno feeds | [x] |
| 2 | `welcome` | MEE6 / ProBot welcome | [x] |
| 3 | `reminders` | Carl / YAGPDB remind | [x] |
| 4 | `automod` | Dyno / Carl automod | [x] |
| 5 | `custom-commands` | Carl custom commands | [x] |
| 6 | `leveling` | MEE6 XP | [x] |
| 7 | `starboard` | Starboard bots | [x] |
| 8 | `twitch-live` | Twitch go-live | [x] |
| 9 | `youtube` | YouTube uploads | [x] |
| 10 | `polls` | Simple poll bots | [x] |
| 11 | `giveaway` | GiveawayBot | [x] |
| 12 | `uptime` | Status / uptime pings | [x] |
| 13 | `translate` | Translate bots | [x] |
| 14 | `weather` | Weather bots | [x] |
| 15 | `reddit` | Reddit feed bots | [x] |
| 16 | `scheduled-announce` | Scheduled messages | [x] |
| 17 | `tickets` | Ticket Tool | [x] |
| 18 | `suggestions` | Suggestion boxes | [x] |
| 19 | `moderation` | Dyno mod slash cmds | [x] |
| 20 | `afk` | AFK bots | [x] |

## Wave 2 — extended parity (fun / utility / dev)

| # | Bot | Discord analogue | Status |
|---|-----|------------------|--------|
| 21 | `counting` | Counting channels | [x] |
| 22 | `quotes` | Quote books | [x] |
| 23 | `define` | Dictionary | [x] |
| 24 | `crypto` | Crypto price bots | [x] |
| 25 | `world-clock` | Timezone boards | [x] |
| 26 | `gitlab-releases` | GitLab release posts | [x] |
| 27 | `steam-news` | Steam news | [x] |
| 28 | `hackernews` | HN feed | [x] |
| 29 | `karma` | Reddit-style karma | [x] |
| 30 | `confessions` | Confession bots | [x] |
| 31 | `say` | Admin announce-as-bot | [x] |
| 32 | `purge` | Bulk delete helpers | [x] |
| 33 | `dice` | RPG dice | [x] |
| 34 | `choose` | Pick-one bots | [x] |
| 35 | `wikipedia` | Wiki lookup | [x] |
| 36 | `math` | Calculator | [x] |
| 37 | `joke` | Joke bots | [x] |
| 38 | `animal-pics` | Cat/dog image bots | [x] |
| 39 | `github-issues` | Issue webhooks | [x] |
| 40 | `npm-releases` | npm package updates | [x] |
| 41 | `birthday` | Birthday bots | [x] |
| 42 | `rsvp` | Event RSVP | [x] |
| 43 | `bump-reminder` | Disboard-style bump | [x] |
| 44 | `lastfm` | Last.fm now-playing | [x] |
| 45 | `trivia` | Trivia bots | [x] |
| 46 | `warns` | Warn systems | [x] |
| 47 | `report` | User report bots | [x] |
| 48 | `sticky` | Sticky message bots | [x] |
| 49 | `timezone-convert` | TZ convert | [x] |
| 50 | `urbandict` | Urban Dictionary | [x] |
| 51 | `color` | Hex/color tools | [x] |
| 52 | `uuid-tool` | UUID generators | [x] |
| 53 | `base64` | Encode/decode utils | [x] |
| 54 | `password-gen` | Password generators | [x] |
| 55 | `echo-once` | Ephemeral echo / DM-style | [x] |
| 56 | `mod-notes` | Staff notes | [x] |

Already elsewhere: `github-releases` (upstream), `discord-bridge` (fork branch `feat/discord-bridge`).

## Per-bot deliverables

- [ ] `bots/<name>/server.js`
- [ ] `bots/<name>/package.json`
- [ ] `bots/<name>/.env.example`
- [ ] `bots/<name>/README.md`
- [ ] Root `README.md` catalog row
- [ ] Commit on `community-bots-parity`

## Batches

- [x] Batches 1–8: through scheduled-announce
- [x] Batch 9: tickets + suggestions
- [x] Batch 10: moderation + afk (wave 1 complete)
- [x] Batch 11: counting + quotes
- [x] Batch 12: define + crypto
- [x] Batch 13: world-clock + gitlab-releases
- [x] Batch 14: steam-news + hackernews
- [x] Batch 15: karma + confessions
- [x] Batch 16: say + purge
- [x] Batch 17: dice + choose
- [x] Batch 18: wikipedia + math
- [x] Batch 19: joke + animal-pics
- [x] Batch 20: github-issues + npm-releases
- [x] Batch 21: birthday + rsvp
- [x] Batch 22: bump-reminder + lastfm
- [x] Batch 23: trivia + warns
- [x] Batch 24: report + sticky
- [x] Batch 25: timezone-convert + urbandict
- [x] Batch 26: color + uuid-tool
- [x] Batch 27: base64 + password-gen
- [x] Batch 28: echo-once + mod-notes
- [x] Queue empty (v2 expanded Discord-parity list complete on fork)
- [ ] Open PR to ancsemi/haven-community (or keep on Amnibro fork)

## Notes

- Match style of `bots/github-releases` (Node 18+, Express when needed, env-only config).
- Verify Haven HMAC: event callbacks use `sha256=<hex>`; slash callbacks may send bare hex — accept both.
- Events available: `message`, `member-joined`, `reaction-added`.
- Moderation REST requires admin-enabled `can_moderate` on the webhook bot.
