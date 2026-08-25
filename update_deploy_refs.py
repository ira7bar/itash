"""Update the two hardcoded per-week references for a new puzzle deploy.

See CLAUDE.md's "Deploying a new week" section -- this automates the two
manual edits described there (src/main.js's fetch filename, and bumping
service-worker.js's CACHE_NAME) for the scheduled deploy workflow.
"""

import re
import sys


def main() -> None:
    date = sys.argv[1]

    with open("src/main.js") as f:
        main_js = f.read()
    new_main_js, count = re.subn(
        r'const puzzleFile = "puzzle_[\d-]+\.json";',
        f'const puzzleFile = "puzzle_{date}.json";',
        main_js,
    )
    if count != 1:
        sys.exit("src/main.js: puzzleFile line not found (expected exactly 1 match)")
    with open("src/main.js", "w") as f:
        f.write(new_main_js)

    with open("service-worker.js") as f:
        sw_js = f.read()

    def bump(m: re.Match) -> str:
        return f'const CACHE_NAME = "tashbetz-shell-v{int(m.group(1)) + 1}";'

    new_sw_js, count = re.subn(
        r'const CACHE_NAME = "tashbetz-shell-v(\d+)";', bump, sw_js
    )
    if count != 1:
        sys.exit("service-worker.js: CACHE_NAME line not found (expected exactly 1 match)")
    with open("service-worker.js", "w") as f:
        f.write(new_sw_js)

    print(f"Updated src/main.js and service-worker.js for {date}")


if __name__ == "__main__":
    main()
