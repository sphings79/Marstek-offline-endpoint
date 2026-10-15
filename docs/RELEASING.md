# Releasing

> 🇩🇪 Deutsche Version: [RELEASING.de.md](RELEASING.de.md)

Two kinds of release, one repository.

| Release | Tag | What it is | How it reaches the endpoint |
|---|---|---|---|
| Container | `vX.Y.Z` | a new image (the workflow builds it for all architectures) | you pull it, the container restarts |
| Web | `web-vX.Y.Z` | the web side only: three signed files | the owner presses *Install* on the Updates card, no container restart |

Both appear on the Updates card with their release notes. The release notes are the changelog people read, so write them for
the owner of an endpoint.

## A web release

1. Change the code. Bump `version` in `src/web-version.json` (and `minContainer` if the new web side needs something that only a
   newer image provides, for example a new field in the conversation between the two processes; if the conversation itself
   changed, `IPC_VERSION` in `src/supervisor.cjs`, `src/webproc.cjs` and `tools/make-web-bundle.cjs` must change too, which needs a new
   image and a new release of both kinds).
2. Build and sign the three files:

   ```bash
   node tools/make-web-bundle.cjs --key ~/.config/marstek-endpoint/web-signing.key
   ```

   This writes `dist/marstek-endpoint-web-X.Y.Z.tar.gz`, `.manifest.json` and `.manifest.sig`.
3. Publish a release **tagged `web-vX.Y.Z`** with the three files as assets and the changelog as its text:

   ```bash
   gh release create web-vX.Y.Z dist/marstek-endpoint-web-X.Y.Z.* --title "Web X.Y.Z" --notes-file notes.md
   ```

   Do not mark it as a pre-release or draft: those are ignored by the endpoint.
4. The next image should carry the same web version (the Dockerfile copies the files and `src/web-version.json`); an installed update
   that is not newer than the files of the image is ignored.

## Before the first release: not yet tested against real services

Everything below was tested against mock servers only, or not at all. Tick each one off once it has worked for real.

- [x] Pushover (tested 2026-10-15)
- [x] Telegram: bot token and chat ID, test button (tested 2026-10-15; a real incident not yet)
- [x] Home Assistant notify (tested 2026-10-15): the service name needs the `mobile_app_` prefix in full (`notify.mobile_app_<device>` in Developer tools,
      Actions). A wrong name returns HTTP 404, which the test shows as such
- [x] Webhook: JSON and plain text against a real HTTP server, with an authorization header (tested 2026-10-15; without the header not tried)
- [x] MQTT measurements: mode *add* works against a real broker (tested 2026-10-15: entities appear with unit and device class, keys already served by Modbus are left out); a custom selection works too (tested 2026-10-15 with two keys: only those two entities remain, the earlier ones are removed); *all* was not tested (same code path as *add*, without the filter)
- [ ] Install a web update from a real signed release: publish `web-vX.Y.Z`, press *Install*, check the new web version and the
      rollback, and check that a tampered file is refused. Back up the signing key first
- [ ] The update check against real releases: the container and web lines on the Updates cards and their notifications
- [x] `APP_VERSION`: now a build argument in the Dockerfile and the image workflow (`vX.Y.Z` for a tag, `dev+<commit>` for main) (tested with the v2.0.0 image, 2026-10-16)
- [x] The documentation screenshots show version 2.0.0 (taken 2026-10-16)

## The signing key

The endpoint installs a web update only if the manifest's Ed25519 signature verifies with `src/webupdate.pub`, which is part of the
image. The **private key is not in the repository** and must not be: keep it where only you can read it
(`~/.config/marstek-endpoint/web-signing.key`, mode 600) and back it up. Without it no web release can be made; with it,
anyone can make one. If it is lost or leaks, generate a new pair, replace `src/webupdate.pub`, release a **new image** and tell
users to pull it: older images keep trusting the old key.

```bash
node -e "const c=require('crypto'),fs=require('fs');const k=c.generateKeyPairSync('ed25519');
fs.writeFileSync('web-signing.key',k.privateKey.export({type:'pkcs8',format:'pem'}),{mode:0o600});
fs.writeFileSync('src/webupdate.pub',k.publicKey.export({type:'spki',format:'pem'}))"
```

The signing key and its path are kept in `SIGNATURSCHLUESSEL.md`, which is listed in `.gitignore` and stays out of the public repository.

## Development without an image build

`tools/dev-push.sh user@dockerhost /host/path/to/data` copies the current web files into the data folder of a running endpoint
as an update that is always used and restarts only the web process. The endpoint that answers the batteries is not touched. It
is a test build, not a release: it is not signed. The data folder is the one mounted at `/data`.
