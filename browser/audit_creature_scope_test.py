import subprocess
import tempfile
import unittest
from pathlib import Path
from audit_creature_scope import audit

class ScopeAuditTests(unittest.TestCase):
    def fixture(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        root = Path(temp.name)
        subprocess.run(['git', 'init', '-q', str(root)], check=True)
        return root
    def stage(self, root):
        subprocess.run(['git', '-C', str(root), 'add', '.'], check=True)
    def test_creature_code_allowed(self):
        root = self.fixture()
        (root / 'muscles.js').write_text('const muscleForce = 1500; // PhysX rigid bodies')
        self.stage(root)
        self.assertTrue(audit(root, False)['passed'])
    def test_unrelated_source_rejected(self):
        root = self.fixture()
        (root / 'wrong.js').write_text('// ' + 'Eng' + 'ine' + ' For' + 'ge physics')
        self.stage(root)
        result = audit(root, False)
        self.assertFalse(result['passed'])
        self.assertEqual(result['findings'][0]['path'], 'wrong.js')
    def test_binary_coverage_reported(self):
        root = self.fixture()
        (root / 'asset.bin').write_bytes(bytes([0, 255, 0]))
        self.stage(root)
        result = audit(root, False)
        self.assertEqual(result['binaryOrNonUTF8Files'], ['asset.bin'])
        self.assertEqual(result['textFilesScanned'], 0)
    def test_unity_namespace_allowed(self):
        root = self.fixture()
        (root / 'Creature.cs').write_text('using UnityEngine;')
        self.stage(root)
        self.assertTrue(audit(root, False)['passed'])

if __name__ == '__main__':
    unittest.main()
