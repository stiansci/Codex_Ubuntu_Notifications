# Versions without guesswork

A **commit** saves a set of changes. An extension **version** such as `1.1.25` is recorded in `package.json`. A **tag**, such as `v1.1.25`, names the exact commit for that version. A **GitHub release** attaches notes and installable VSIX files to that tag. These are related, but making a commit does not automatically upload a new Marketplace version.

You can make several commits while working on one version. Tag a version when its source is ready to identify and build. Existing tags must stay attached to their original commits; later changes get a new version.

## See the versions already in our history

```bash
npm run versions
```

This reads actual committed manifests and shows the latest recorded commit for each distinct version. It does not invent snapshots for changelog entries that were never committed separately. Historical version tags identify development snapshots, not past Marketplace publications.

## Prepare the next version

With a clean committed working tree, choose one command:

```bash
npm run version:bump -- patch
```

`patch` changes `1.1.25` to `1.1.26` for fixes. Use `minor` for a new feature (`1.2.0`) or `major` for a breaking change (`2.0.0`). An explicit higher `X.Y.Z` version also works. The command updates both manifests, current documentation links and the changelog. Previous test-evidence version numbers stay intact. Review the generated notes and commit the resulting changes before preparing the release.

## Build and tag the committed version

```bash
npm run release:prepare
```

This checks the clean public source and selected licensing, runs automated tests, builds and checks both VSIX variants, and creates an annotated local version tag. In `dist/` it also writes `release-X.Y.Z.json` with the exact source commit and VSIX SHA-256 values, `SHA256SUMS-X.Y.Z.txt`, and `RELEASE-NOTES-X.Y.Z.md`.

It stops on failed checks, a moving source commit or an existing tag pointing elsewhere. It never changes an old tag or uploads anything. A local version tag is not proof that the remaining human desktop checklist has passed.

`npm run version:tag` only creates/verifies the current local tag; it does not build or certify a release. `npm run versions:tag-history` marks the latest real commit for every recorded version, after checking all candidate licensing and tag conflicts before creating tags. Use it for initial history organization, not as a substitute for release preparation.

## Make the download available later

After the GitHub repository is created, push the public branch and only the intended version tag. In GitHub Actions, select **Prepare draft GitHub release**, choose **Run workflow**, and enter the existing tag. The workflow rebuilds that tag, verifies that its manifest version matches, and creates a **draft prerelease** with the VSIX files and checksums. It requires the versioning/release scripts to exist in that tagged snapshot, so earlier development tags are source-history markers only.

Review the draft and desktop checklist before publishing it. A second workflow run for an existing release stops rather than replacing published files. Marketplace upload remains a separate deliberate action using the `-marketplace.vsix`; the tag and linked screenshots must be public first.

GitHub documents the [relationship between releases and tags](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases). Nothing here sends private files, backups, Codex recovery refs or Marketplace credentials to GitHub.
