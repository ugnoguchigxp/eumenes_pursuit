"""Write the hidden checks of the frontier Solver tasks into a secret directory.

    python3 build-secrets.py <secret directory> <seed>

The directory must be outside the repository and outside every workspace. Use a
seed that is not recorded anywhere the solving model can read.
"""

import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def main():
    directory, seed = sys.argv[1], sys.argv[2]
    for task in ("bracelets", "ising-ring", "equilibrium"):
        identifier = "hz13-" + task
        subprocess.run(
            [sys.executable, os.path.join(HERE, "generate.py"), task, seed, os.path.join(directory, identifier)],
            check=True,
        )
        cases = [
            {
                "name": f"t{tier}{part}",
                "command": "python3 solve.py",
                "stdin": f"t{tier}{part}.in",
                "expected": f"t{tier}{part}.out",
                "timeoutMs": 20000,
            }
            for tier in range(1, 7)
            for part in "ab"
        ]
        with open(os.path.join(directory, identifier + ".json"), "w") as handle:
            json.dump({"id": identifier, "kind": "env", "cases": cases}, handle, indent=1)


if __name__ == "__main__":
    main()
