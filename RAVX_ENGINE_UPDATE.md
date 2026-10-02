# RAVX engine update

## What changed

- Replaced the incomplete protection module with a module that exports the functions used by the bot and website.
- Server Lua checks its license before running. A temporary license-site outage triggers retries every 15 seconds. Once running, the resource checks again every 60 seconds.
- Admins can change the allowed IP from the dashboard. They can also enter a saved license code in the admin unprotect panel to create an editable ZIP.
- The license endpoint ignores caller-supplied `?ip=` values. It compares the connection address seen by the service.
- The manifest files `fxmanifest.lua` and `__resource.lua` are excluded from obfuscation.

## Deployment notes

- Set `BASE_URL` to the public HTTPS address of this bot/site.
- If the app is behind a trusted reverse proxy that overwrites `X-Forwarded-For`, set `TRUST_PROXY=true`. Do not enable it when clients can connect directly to the app.
- Keep a persistent disk mounted at the project's `storage/` directory. License records and generated ZIPs are stored there.
- IP changes are picked up by the next license check, usually within one minute.

## Protection limits

The Lua layer uses obfuscation and an online server-side license check. The decoder is part of any self-running Lua file, so this does not provide unbreakable encryption or prevent a server owner from inspecting code running on their own machine. No hardware identifiers are collected or sent to Discord.
