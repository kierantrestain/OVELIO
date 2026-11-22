# Third-party software

OVELIO uses separately deployed upstream engines through their HTTP APIs. The Compose release pins their upstream versions. Keep the engine licence and copyright notices with redistributed copies.

| Engine | Release | License | Corresponding upstream source |
| --- | --- | --- | --- |
| Mautic | 7.2.2 | GPL-3.0-or-later | [Application source](https://github.com/mautic/mautic/tree/7.2.2), [official image recipes](https://github.com/mautic/docker-mautic) |
| Listmonk | 6.2.0 | AGPL-3.0-only | [Application source and image recipe](https://github.com/knadh/listmonk/tree/v6.2.0) |
| Umami | 3.5.0 | MIT | [Application source](https://github.com/umami-software/umami/tree/v3.5.0), deployed from the official `umamisoftware/umami` Docker Hub image |

The [upstream license texts](deploy/licenses) accompany this repository. [Package metadata and the resolution of transitive npm dependencies](package-lock.json) identify the JavaScript dependency inventory. Run `npm sbom --omit=dev --sbom-format spdx` to capture the runtime inventory for a release. Preserve the license notices in the npm packages, base images and runtime images.

| Supporting runtime | Release | Primary license and source |
| --- | --- | --- |
| Caddy | 2.11.2 | [Apache-2.0](https://github.com/caddyserver/caddy/tree/v2.11.2) |
| PostgreSQL | 17.9 | [PostgreSQL License](https://www.postgresql.org/ftp/source/v17.9/) |
| MariaDB Server | 11.8.5 | [GPL-2.0](https://github.com/MariaDB/server/tree/mariadb-11.8.5) |
| Node.js | 22.22.2 | [MIT and bundled notices](https://github.com/nodejs/node/blob/v22.22.2/LICENSE) |
| Mailpit | 1.28.4 | [MIT](https://github.com/axllent/mailpit/tree/v1.28.4) |

| Interface library | Release | License and source |
| --- | --- | --- |
| Astryx design system (`@astryxdesign/core`, `@astryxdesign/theme-neutral`) | 0.7.17 | [MIT, © Meta Platforms, Inc. and affiliates](https://github.com/meta/astryx) |
| StyleX runtime (`@stylexjs/stylex`) | 0.19.2 | [MIT, © Meta Platforms, Inc. and affiliates](https://github.com/facebook/stylex) |
| Figtree typeface (bundled by the Astryx neutral theme) | — | SIL Open Font License 1.1, text in `node_modules/@astryxdesign/theme-neutral/fonts/figtree.LICENSE.txt` |
| Lucide icons (`lucide-react`) | 1.77.0 | [ISC](https://github.com/lucide-icons/lucide) |

OVELIO uses Astryx's components and neutral theme with its own colour tokens and brand mark. It does not reproduce Astryx, Meta, Umami or other upstream branding.

You can charge for hosting or distribution. For distributed GPL or AGPL covered binaries and images, provide corresponding source for the exact distributed versions, including applicable modifications and build scripts, through a mechanism permitted by the licence. A modified AGPL-covered service needs a prominent way for network users to receive the corresponding source. Retain Umami's MIT copyright and permission text. Assess the combined work and any plugins separately before choosing commercial distribution terms. [GPLv3](https://www.gnu.org/licenses/gpl-3.0.html), [AGPLv3](https://www.gnu.org/licenses/agpl-3.0.html), [GNU aggregate guidance](https://www.gnu.org/licenses/gpl-faq.html#MereAggregation).

The upstream marks belong to their respective owners. These notices cover third-party components and do not establish a distribution licence for new OVELIO code.
