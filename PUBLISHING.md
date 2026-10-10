# Publication privacy

Publish under **Tag Maestro**, never under a personal real name, workplace email, computer hostname or home-directory path.

## Contributor identity

Use a repository-local project identity before committing or tagging:

```sh
git config --local user.name "Tag Maestro Project"
git config --local user.email "tag-maestro@project.invalid"
node scripts/check-publication-privacy.mjs
```

Do not change global Git configuration. The reserved `.invalid` address is intentionally nonpersonal. Existing third-party bot attribution and required dependency copyright/license notices must be preserved.

The check audits reachable branches/tags, author/committer/tagger metadata, historical text blobs and current tracked files. It rejects unapproved contributor identities, private-looking home paths, local-machine emails, private keys and known private QA/sample directories. It cannot reliably detect every secret or read identity text inside a screenshot: manually review images, release notes, source archives and package metadata too.

## Before publishing

- Use synthetic demo media in documentation screenshots; never capture a personal library, account, NAS path or credentials.
- Keep user music, app profiles, cache, output videos, local logs, private recovery bundles and cleanup archives out of Git and release artifacts.
- Run the privacy check and app-specific release/packaged tests.
- Publish via the GitHub Actions release workflow so release ownership is the automation bot, not an embedded personal identity.
- Keep release asset names/checksums and existing third-party licenses intact.

The separate Publication privacy workflow checks pushes and pull requests. A failed check is a publication blocker; do not bypass it by adding a private identity to the allowlist. For a newly maintained project, update its neutral policy intentionally.

## After a history cleanup

Re-clone other checkouts rather than merging old history back into the cleaned repository. Rewritten commit/tag IDs differ. Old forks, clones, downloaded source archives and cached commit URLs may retain earlier data; rewriting published refs does not erase every copy. Private backups are for local recovery only and must never be uploaded.
