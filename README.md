# Benjamin Tousifar — Data Engineer Portfolio

Single-page portfolio site. Static, no build step, deployed on Netlify.

Sections: Hero → Live system (Memora) → SQL console → Projects → Experience → Credentials → Contact.

## Repo layout

```
netlify.toml     Netlify config — publish dir + security/cache headers
site/            The deployed site (publish root)
  index.html     The page
```

## Local preview

Any static file server works; the page is plain HTML/JS with no build step.

```bash
python -m http.server 8080 --directory site
# or
npx serve site
```

Then open http://localhost:8080.

## Deploying

Netlify builds from `main`. There is no build command — it publishes `site/`
verbatim. Pushing to `main` triggers a production deploy; pull requests get
deploy previews.

## Current state / known work

`site/index.html` is the export from Claude Design: a self-extracting bundle
that inlines every asset (hero image, IBM Plex woff2 subsets, React 18 UMD,
and the Claude Design runtime) as base64 in a manifest, then unpacks them to
blob URLs on load and swaps the document.

That works, but it means:

- ~1 MB must download before anything paints, on every visit
- no asset is independently cacheable — one byte changes, all 1 MB re-downloads
- the markup is only present after JS runs, so crawlers and link previews see
  an empty page
- there are no `og:`/`twitter:` meta tags, favicon, `robots.txt`, or `sitemap.xml`

Unpacking the bundle into real files under `site/assets/` is the next step.
