# Benjamin Tousifar — Data Engineer Portfolio

Single-page portfolio site, deployed on Netlify at
<https://benjamin-tousifar.netlify.app>.

Sections: Hero → Live system (Memora) → SQL console → Projects → Experience →
Credentials → Contact.

## Repo layout

```
netlify.toml        Build command, publish dir, security + cache headers
src/
  bundle.html       The Claude Design export (source of truth for the page)
  head-meta.html    Social/search metadata injected into <head>
  static/           Files copied verbatim to the site root
tools/
  unpack.js         Expands src/ into site/. No dependencies.
site/               Build output — generated, not committed
```

## Build

```bash
node tools/unpack.js     # writes site/
```

Netlify runs exactly this. There is nothing to `npm install`.

To preview:

```bash
node tools/unpack.js && python -m http.server 8080 --directory site
```

## Why there is a build step

`src/bundle.html` is a Claude Design export: a self-extracting bundle. Every
asset (hero image, 28 IBM Plex woff2 subsets, React 18 UMD, the Claude Design
runtime) is base64 inside a manifest, and the page itself is a JSON-encoded
template whose asset references are uuids. Opened directly, it decodes all of
that to blob URLs and swaps the document at runtime.

Served that way it worked, but cost roughly a megabyte and ~5.6s before
anything painted, and view-source showed the bundle rather than the page.

`tools/unpack.js` performs the same substitution ahead of time against real
files. Same markup, same behaviour — only delivery changes:

| | Bundled | Unpacked |
|---|---|---|
| HTML document | 984 KB | 80 KB |
| Font files fetched | 28 (all subsets, inlined) | 6 (latin only, on demand) |
| Font bytes | 384 KB | 134 KB |
| Content in raw HTML | none | all of it |
| Runtime CDN dependency | unpkg.com | none, self-hosted |

The font saving comes from `unicode-range`. Inlined as data URIs every subset is
paid for up front; as real files the browser fetches only the subsets the page
actually renders, so the Cyrillic, Greek and Vietnamese cuts are never touched.

Assets are content-hashed (`dc-runtime.8fe7df74.js`) so they can be cached for a
year without a re-export stranding anyone on a stale runtime. The hero image is
deliberately *not* hashed, because `head-meta.html` points social crawlers at it
by fixed URL.

## Editing the page

The markup is not plain HTML. It is a custom `x-dc` DSL (`<sc-if>`, `<sc-for>`,
`style-hover=`, `{{bindings}}`) inside a JSON string in the `__bundler/template`
island of `src/bundle.html`, alongside a React component class driving the SQL
console.

If you re-encode that JSON, **escape every `/` as `\u002F`**, the way the bundler
does. The template contains its own `</script>` tag; written literally it closes
the enclosing script element early, and the browser silently parses the rest of
the bundle as markup — element ids come out mangled and links break.

## Related

The Memora embed in section 01 frames <https://memoraapp.netlify.app>. That app
(repo: `BeTous8/gift-registry`) allows it via a CSP `frame-ancestors` allowlist
in `next.config.mjs`. If this site ever moves to another domain, that allowlist
needs the new origin or the embed goes back to rendering as a broken box.

## Outstanding

- No custom domain.
- Mobile layout has not been verified on a real device.
- The hero JPEG is 196 KB and unoptimised; a WebP/AVIF pass would cut it
  substantially.
