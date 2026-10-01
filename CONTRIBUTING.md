# Contributing

Thanks for wanting to share something with the Haven community!

## What can I submit?

Anything that integrates with Haven via the [bot/webhook API](https://github.com/ancsemi/Haven/blob/main/GUIDE.md#-bot--webhook-developer-guide):

- **Bots** — services that send messages to a Haven channel and/or react to slash commands
- **Webhooks** — bridges from another service (GitHub, RSS, IFTTT, etc.) into a Haven channel
- **Snippets / examples** — small useful examples in any language

Pick whichever language you like. Node.js, Python, Go, PHP, Cloudflare Workers, a single bash script — all welcome.

## How to submit

1. Fork this repo.
2. Create a new folder under `bots/<your-bot-name>/` or `webhooks/<your-webhook-name>/`.
3. Include at minimum:
   - A `README.md` explaining what it does, what env vars / config it needs, and how to deploy it.
   - The actual code.
   - A `LICENSE` file (MIT recommended; any OSI-approved license is fine).
   - A `.env.example` if your bot reads environment variables.
4. Add a one-line entry to the catalog table in the root [`README.md`](README.md).
5. Open a PR using the template — fill in the checklist honestly.

## Things about Haven's bot API that catch people out

- **Who ran a command.** A slash command reaches your bot as
  `{ "event": "slash_command", "command", "args", "channelCode", "author": { "id", "username" } }`.
  The person is `author`, not `user`.
- **Command names are letters only.** `/b64` or `/say-echo` can never be typed.
  Some names belong to Haven itself and can't be registered (or never leave the
  app): `afk`, `bbs`, `boobs`, `brb`, `butt`, `clear`, `disapprove`, `flip`,
  `gif`, `hug`, `lenny`, `me`, `nick`, `play`, `poll`, `roll`, `schedule`,
  `shrug`, `spoiler`, `tableflip`, `time`, `tts`, `unflip`, `wave`.
- **A second `/` makes it chat.** Text like `/tz 3pm America/New_York` is posted as
  an ordinary message, so don't make people type paths or URLs after a command.
- **Private replies.** Post with `"ephemeral": true` and `"recipient_id": <author.id>`
  to answer one person only. Use it for errors, usage hints and anything personal.
- **Haven doesn't tell your bot anyone's roles.** A command only some people should
  use needs its own list of allowed user ids, and an empty list must mean nobody,
  not everybody.
- **Answer 200 once you've acted.** If your bot returns a 5xx, Haven sends the
  same event again 5 seconds later, so anything it already did happens twice.
- **Running the bot on the same machine or network as Haven.** Haven refuses to
  call back to private addresses unless the server sets
  `HAVEN_ALLOW_PRIVATE_CALLBACKS=true`; say so in your README.
- **Rate limit.** Haven accepts 30 webhook posts a minute from one address, shared
  by every bot on that machine.
- **Loading `.env`.** Node doesn't read `.env` by itself. `node --env-file=.env server.js`
  (Node 20.6 or newer) does.

## What we check before merging

- Code does what the README claims and doesn't contain anything malicious or obviously broken.
- README is clear enough that someone unfamiliar with your project can deploy it.
- License file exists.
- No bundled secrets / API keys / tokens.
- No phone-home telemetry to your own servers without disclosure.

We do not deep-audit your code. Users who deploy your bot do so at their own risk, and that's made clear in the root README.

## What we won't accept

- Anything that requires the user to give a third party (you or anyone else) their bot token or admin credentials.
- Bots designed to spam, harass, scrape, or evade moderation.
- Code that's just an unrelated project with a Haven sticker on it — it needs to actually integrate with Haven.
- Bundled binaries you don't have source for.

## Listing a project that lives in its own repo

If your integration is actively developed elsewhere (a plugin for another app,
a bot with its own release cycle), you do not have to copy the code here. Add a
row to the **Integrations that live elsewhere** table in the root `README.md`
with the name, a one-line description, a link to your repository, and your
name. Keep developing in your own repo; only come back here if the name, link,
or description changes. The same rules on secrets, telemetry, and actually
integrating with Haven apply.

## Updating your bot

You own your folder. PR updates / fixes / version bumps as needed. If you stop maintaining it, the catalog entry stays but we may mark it as unmaintained.

## Removing a bot

Email or open an issue if you want yours taken down.
