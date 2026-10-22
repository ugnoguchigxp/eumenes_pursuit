import json
import subprocess
import sys
import unittest

REQUEST = {
    "run_date": "2025-09-30",
    "accounts": [{"id": "T1", "plan_history": [{"from": "2025-05-10", "plan": "starter-2025"}], "cycles": 2}],
    "usage": [
        {"account": "T1", "date": "2025-05-12", "units": 90},
        {"account": "T1", "date": "2025-06-01", "units": 60},
        {"account": "T1", "date": "2025-06-15", "units": 30},
    ],
}


class EngineTest(unittest.TestCase):
    def test_two_cycles(self):
        out = subprocess.run(
            [sys.executable, "-m", "kumobill"], input=json.dumps(REQUEST), capture_output=True, text=True, check=True
        ).stdout.splitlines()
        self.assertEqual(
            out,
            [
                "T1 2025-05-10..2025-06-09 plan=starter-2025 base=2980 overage=600 discount=0 tax=358 credit=0 total=3938 carry=0",
                "T1 2025-06-10..2025-07-09 plan=starter-2025 base=2980 overage=0 discount=0 tax=298 credit=0 total=3278 carry=0",
            ],
        )


if __name__ == "__main__":
    unittest.main()
