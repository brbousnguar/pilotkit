# Example brand pack: Acme

A brand pack puts your company's name, logo and colour on the desk without forking pilotkit.
Acme is fictional; copy this folder, replace the logo and the fields, and share the folder (or
host it on an internal https server) with your colleagues:

```bash
pilotkit setup --brand ./brand-acme
pilotkit setup --brand https://intranet.example.com/pilotkit/brand.json
```

| Field | Required | What it does |
|---|---|---|
| `name` | yes | Short company name (40 characters at most) |
| `logo` | yes | File name of an `.svg` or `.png` next to `brand.json`, 512 KB at most |
| `product` | no | Name shown in the header; defaults to "`<name>` Copilot desk" |
| `accent` | no | Accent colour, `#rrggbb` |
| `welcome` | no | Line under the title on an empty chat |
| `atlassianSite` | no | Suggested Atlassian site during `pilotkit setup` |
| `links` | no | Up to six `{ "label", "url" }` links (https only) shown on the welcome screen |

Keep your company's logo and name in your own pack, not in a fork of pilotkit: a logo is a
trademark, and the pack can stay private while pilotkit is public.
