import sys

MOD = 1000000007


def main():
    n, count = map(int, sys.stdin.buffer.readline().split())
    operations = [sys.stdin.buffer.readline().split() for _ in range(count)]
    bounds = {1, n + 1}
    for op in operations:
        if op[0] in (b"U", b"Q"):
            bounds.update((int(op[1]), int(op[2]) + 1))
    points = sorted(bounds)
    rank = {x: i for i, x in enumerate(points)}
    lengths = [b - a for a, b in zip(points, points[1:])]
    indices = [(a + b - 1) * (b - a) // 2 % MOD for a, b in zip(points, points[1:])]
    values = [0] * len(lengths)
    saved = {}
    output = []
    for op, *args in operations:
        if op == b"S":
            saved[args[0]] = values
        elif op == b"R":
            values = saved.get(args[0], values)
        else:
            left, right = rank[int(args[0])], rank[int(args[1]) + 1]
            if op == b"U":
                m, b = map(int, args[2:])
                for i in range(left, right):
                    values[i] = (m * values[i] + b) % MOD
            else:
                total = squared = weighted = 0
                for i in range(left, right):
                    x = values[i]
                    total += x * lengths[i]
                    squared += x * x * lengths[i]
                    weighted += x * indices[i]
                output.append(f"{total % MOD} {squared % MOD} {weighted % MOD}\n")
    sys.stdout.write("".join(output))


if __name__ == "__main__":
    main()
