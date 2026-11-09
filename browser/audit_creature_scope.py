"""Audit tracked source for unrelated project references; never modify files."""
import json
import re
import subprocess
import sys
from pathlib import Path

BASE = '093102e3a1fbed01edc317cb9848d5b8f11d836f'
PATTERNS = [r'engine[ _-]*forge', r'forge-agent-session-state', r'livengood', r'douaud', r'chen[ _-]*flynn']

def audit(root, enforce_boundary=True):
    root = Path(root).resolve()
    def git(*args):
        return subprocess.check_output(['git', '-C', str(root), *args])
    names = [x.decode('utf-8') for x in git('ls-files', '-z').split(b'\0') if x]
    rules = [re.compile(p, re.IGNORECASE) for p in PATTERNS]
    report = {'trackedFiles': len(names), 'textFilesScanned': 0, 'binaryOrNonUTF8Files': [], 'ruleDefinitionFiles': [], 'symlinksNotRead': [], 'findings': [], 'outsideBrowserChanges': [], 'scope': 'tracked working tree, not history or downloaded dependencies'}
    own = 'browser/audit_creature_scope.py'
    for name in names:
        path = root / name
        if path.is_symlink():
            report['symlinksNotRead'].append(name)
            continue
        if name == own:
            report['ruleDefinitionFiles'].append(name)
            continue
        data = path.read_bytes()
        if b'\0' in data:
            report['binaryOrNonUTF8Files'].append(name)
            continue
        try:
            text = data.decode('utf-8-sig')
        except UnicodeDecodeError:
            report['binaryOrNonUTF8Files'].append(name)
            continue
        report['textFilesScanned'] += 1
        for line_no, line in enumerate(text.splitlines(), 1):
            if any(rule.search(line) for rule in rules):
                report['findings'].append({'path': name, 'line': line_no})
        if any(rule.search(name) for rule in rules):
            report['findings'].append({'path': name, 'line': 0})
    if enforce_boundary:
        changed = [x.decode('utf-8') for x in git('diff', '--name-only', '-z', BASE, '--').split(b'\0') if x]
        report['outsideBrowserChanges'] = [n for n in changed if not n.startswith('browser/') and n != '.github/workflows/browser-physics-smoke.yml']
    report['passed'] = not (report['findings'] or report['outsideBrowserChanges'] or report['symlinksNotRead'])
    return report

if __name__ == '__main__':
    result = audit(Path(__file__).resolve().parents[1])
    print(json.dumps(result, indent=2))
    sys.exit(0 if result['passed'] else 1)
