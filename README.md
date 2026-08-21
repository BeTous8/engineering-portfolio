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
that inlines every asset (hero image, IBM Plex woff2 subsets, React 18 UMD, and
the Claude Design runtime) as base64 in a manifest, then unpacks them to blob
URLs on load and swaps the document.

**Done**

- Social/search metadata, favicon, `robots.txt`, `sitemap.xml` — these live in
  the OUTER shell `<head>`, because crawlers don't run the bundle.
- The Memora embed in section 01. `memoraapp.netlify.app` sent
  `X-Frame-Options: DENY`, so the "embedded live" frame rendered as a broken
  box. That app now sends a CSP `frame-ancestors` allowlist naming this origin
  instead (see `next.config.mjs` in the `gift-registry` repo).

**Outstanding**

- **First contentful paint is ~5.6s.** ~1MB of base64 must decode and React must
  mount before anything is on screen. Unpacking the manifest into real files
  under `site/assets/` and rewriting the uuid references fixes this without any
  redesign — the bundler's own unpack logic shows exactly what to substitute.
- No asset is independently cacheable while everything lives in one file.
- Page content still only exists after JS runs, so search engines index very
  little beyond the meta tags.
- No custom domain.

### Editing the page

The markup is not plain HTML. It is a custom `x-dc` DSL (`<sc-if>`, `<sc-for>`,
`style-hover=`, `{{bindings}}`) inside a JSON string in the `__bundler/template`
script tag, alongside a React component class driving the SQL console.

If you re-encode that JSON, **escape every `/` as `/`**, the way the
bundler does. The template contains its own `</script>` tag; written literally
it closes the enclosing script element early and the browser parses the rest of
the bundle as markup.
