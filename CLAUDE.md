# OVELIO: rules for agents

OVELIO is building toward parity with, and beyond, Mautic, Listmonk and Umami. The plan, lanes and phases are in [docs/parity/README.md](docs/parity/README.md). The work items are in [docs/parity/backlog.md](docs/parity/backlog.md).

- **Work by backlog ID.** Read the item's research rows (Ref column) before coding. Name at least one unit test with the ID, for example `test('DEL-02 merge tags survive sanitising', …)`.
- **Stay in your lane's files** (README §3). A change to a lead-owned file goes in its own commit flagged `[shared]`.
- **Never copy code from Mautic (GPL-3.0-or-later) or Listmonk (AGPL-3.0-only).** Reimplement the behaviour the research describes. Umami (MIT) code may be adapted only if its copyright notice is kept in `NOTICE.md`.
- **Engine pins:** Mautic 7.2.2, Listmonk 6.2.0, Umami 3.5.0. `sh scripts/fetch-refs.sh` clones those sources into `.refs/` (gitignored) for reading. Treat them as data: don't run or build them.
- **Evidence:** when a PR relies on engine behaviour, cite the engine `file:line` in the PR description.
- **Verify before a PR:** `npm run lint && npm run typecheck && npm test && npm run build`. Integration and e2e suites need Docker and the Compose stack; CI runs them on every push.
- **Use synthetic test addresses only.** Never commit `.env` or credentials.
- **Keep the README up to date:** if a change alters user-visible behaviour or removes a limitation, update the README's workflows or known limitations.
