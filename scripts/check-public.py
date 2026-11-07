"""Check public Git files and publishable history without printing credential values."""

from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent
PUBLIC_HISTORY = ("--branches", "--tags", "--remotes", "HEAD")
PATTERNS = {
    "private key": rb"-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----",
    "GitHub token": rb"\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b",
    "OpenAI key": rb"\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b",
    "AWS access key": rb"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b",
    "Slack token": rb"\bxox[baprs]-[A-Za-z0-9-]{20,}\b",
    "credential URL": rb'''https?://[^\s/"':]+:[^\s/"'@]+@''',
    "credential assignment": rb'''(?i)(?:api[_-]?key|access[_-]?token|client[_-]?secret|password|passwd)\s*[:=]\s*["'][^"'\r\n]{10,}["']''',
    "personal home path": rb'''(?:/home/|/Users/)[A-Za-z0-9._@+-]+/''',
}
PATTERNS = {label: re.compile(pattern) for label, pattern in PATTERNS.items()}


def git(*args, root=ROOT, data=None):
    return subprocess.check_output(["git", "-C", str(root), *args], input=data)


def scan_text(data, location):
    if b"\0" in data[:8192]:
        return []
    findings = []
    for label, pattern in PATTERNS.items():
        for match in pattern.finditer(data):
            line = data[:match.start()].count(b"\n") + 1
            findings.append(f"{location}:{line}: possible {label}")
    # Reject the previously copied vendor geometry in active SVG and HTML files.
    if location.endswith((".svg", ".html")) and b"M13.795" + b" 23.856" in data:
        findings.append(f"{location}: legacy vendor artwork")
    return findings


def ignored(paths, root):
    if not paths:
        return []
    result = subprocess.run(["git", "-C", str(root), "check-ignore", "--no-index", "--stdin", "-z"],
                            input=b"\0".join(paths) + b"\0", capture_output=True, check=False)
    if result.returncode not in (0, 1):
        raise RuntimeError("Cannot verify Git exclusions")
    return [path.decode() for path in result.stdout.split(b"\0") if path]


def check(root=ROOT, release=False):
    findings = []
    tracked = git("ls-files", "-z", root=root).split(b"\0")
    for path in ignored([path for path in tracked if path], root):
        findings.append(f"tracked private/ignored path: {path}")
    current = set(git("ls-files", "--cached", "--others", "--exclude-standard", "-z", root=root).split(b"\0")) - {b""}
    for filename in sorted(current):
        path = root / filename.decode()
        if path.is_file():
            findings.extend(scan_text(path.read_bytes(), filename.decode()))
    commits = git("rev-list", *PUBLIC_HISTORY, root=root).splitlines()
    for commit in commits:
        label = commit[:8].decode()
        paths = git("ls-tree", "-r", "--name-only", "-z", commit.decode(), root=root).split(b"\0")
        for path in ignored([path for path in paths if path], root):
            findings.append(f"history {label}: private/ignored path {path}")
        emails = git("show", "-s", "--format=%ae%x00%ce", commit.decode(), root=root).strip().split(b"\0")
        if any(not (email.endswith(b"@users.noreply.github.com") or email == b"noreply@github.com") for email in emails):
            findings.append(f"history {label}: personal author/committer email; use a GitHub noreply identity")
    blobs = 0
    for entry in git("rev-list", "--objects", *PUBLIC_HISTORY, root=root).splitlines():
        oid, _, filename = entry.partition(b" ")
        if git("cat-file", "-t", oid.decode(), root=root).strip() != b"blob":
            continue
        blobs += 1
        findings.extend(scan_text(git("cat-file", "blob", oid.decode(), root=root),
                                  f"history {oid[:8].decode()}/{filename.decode()}"))
    if release and git("status", "--porcelain", "--untracked-files=all", root=root).strip():
        findings.append("release source has uncommitted changes or untracked public files")
    return sorted(set(findings)), len(current), len(commits), blobs


def main():
    findings, files, commits, blobs = check(release="--release" in sys.argv[1:])
    for finding in findings:
        print(finding)
    if findings:
        print(f"Public-source check failed: {len(findings)} finding(s). Values are intentionally omitted.")
        return 1
    print(f"Public-source check passed: {files} files, {commits} commits, {blobs} historical blobs; private paths excluded and no credential-pattern matches.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
