# bottlify-ui

The Bottlify launcher: a React app and the Node server that hosts it. The server puts the app, the
engine, the bottles and the network relay on one cross-origin-isolated origin, which the engine
needs for shared memory and sound.

The engine comes from npm: [`@bottlify/core`](https://www.npmjs.com/package/@bottlify/core),
[`@bottlify/installer`](https://www.npmjs.com/package/@bottlify/installer) and
[`@bottlify/networking`](https://www.npmjs.com/package/@bottlify/networking).

## Run

```
npm ci
npm run build
BUNDLES_DIR=/path/to/bundles npm start      # http://127.0.0.1:5180/
```

A bottle is a directory in `BUNDLES_DIR`: `<id>/manifest.json` and `<id>/bundle.btl`.

| Variable | Default | What it sets |
|---|---|---|
| `PORT` | `5180` | the port |
| `TLS_DIR` | none | a directory with `cert.pem` and `key.pem`: https, bound to every address |
| `BUNDLES_DIR` | `../bottlify/bundles` | where the bottles are |
| `RELAY_ALLOW` | none | hosts the relay may connect to beyond its rooms (`a.example.com,*.example.net`) |
| `BOTTLE_PORT` | `8788` | the bottle server that uploads are passed to |
| `ISOLATION` | on | `off` serves the page without cross-origin isolation, as on a page embedded elsewhere |
| `BOTTLIFY_SOURCE` | none | an engine checkout, served under `/source/` for the `/debug/` page |

Keep one origin. The browser keeps a person's saves and downloaded games per scheme, host and
port, so a launcher moved to another port or from https to http starts empty.

## Configure

`public/config.json` is read at run time and is absent by default; without it the page offers the
library and nothing else. `public/config.example.json` shows the fields:

| Field | What it turns on |
|---|---|
| `allowInstall` | installing a program from a setup, a disc image or an archive, and importing a `.btl` |
| `networking` | the network relay beside the page (`/networking/`, `/relay`) |
| `libraryTags` | filtering the library by kind, labels and status |
| `preloadBottles` | offering to download a bottle whole before it starts |
| `server` | the bottle server (`url`, `token`) that keeps bottles for everyone who opens the library |
| `editableTypes` | the file extensions the file explorer opens in its editor |
| `cork` | translator settings laid over every run |

`config.json` is served to every visitor, the `server` token included. Put a token there only on a
machine nobody else opens.

## Develop against an engine checkout

```
Projects/Bottlify/
  bottlify/      the engine (npm ci && npm run build)
  bottlify-ui/   this repository
```

`npm run dev:link` installs everything else from npm and puts `../bottlify/modules/*` in place of
the published packages without touching `package.json`. A change there is served once it is built
(`npm run build` in `bottlify`). A later `npm install` puts the published versions back.

`npm test` runs the unit tests, `npm run lint` the linter, `npm run dev` Vite's dev server.

## License

[Mozilla Public License 2.0](LICENSE).
