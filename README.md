Drop this into `README.md` in your `nathanneurotic.github.io` repo:

````md
# NathanNeurotic GitHub Pages Redirect

This repository exists to redirect traffic from:

```text
https://nathanneurotic.github.io
````

to the main NathanNeurotic website:

```text
https://nathanneurotic.com
```

## Purpose

The `nathanneurotic.github.io` address is the default GitHub Pages domain for this account.
Rather than maintaining a separate site here, this repo forwards visitors to the primary website.

## Files

### `index.html`

Main redirect page.

When someone visits:

```text
https://nathanneurotic.github.io
```

they are automatically sent to:

```text
https://nathanneurotic.com
```

### `404.html`

Fallback redirect page.

This catches old or invalid GitHub Pages paths and sends them back to the main site.

Example:

```text
https://nathanneurotic.github.io/old-page
```

redirects to:

```text
https://nathanneurotic.com
```

## Hosting

This repo uses GitHub Pages.

Expected Pages source:

```text
Branch: main
Folder: / root
```

## Main Website

```text
https://nathanneurotic.com
```

## Repo Role

This is not the main website source.

It is only a lightweight redirect layer for GitHub Pages traffic.
