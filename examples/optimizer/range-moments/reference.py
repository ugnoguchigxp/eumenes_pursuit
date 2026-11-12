import sys

MOD = 1000000007


def main():
    lines = sys.stdin.buffer
    n, count = map(int, lines.readline().split())
    children = [[]]
    mutation = [None]
    queries = [[]]
    saves = {}
    points = {1, n + 1}
    current = answers = 0
    for _ in range(count):
        op, a, *rest = lines.readline().split()
        if op == b"S":
            saves[a] = current
        elif op == b"R":
            current = saves.get(a, current)
        else:
            lo, hi = int(a), int(rest[0]) + 1
            points.update((lo, hi))
            if op == b"Q":
                queries[current].append((answers, lo, hi))
                answers += 1
            else:
                node = len(children)
                children[current].append(node)
                current = node
                children.append([])
                mutation.append((lo, hi, int(rest[1]), int(rest[2])))
                queries.append([])
    points = sorted(points)
    rank = {x: i for i, x in enumerate(points)}
    size = 1 << (len(points) - 2).bit_length()
    length = [0] * (size * 2)
    weight = [0] * (size * 2)
    for i, (a, b) in enumerate(zip(points, points[1:]), size):
        length[i] = b - a
        weight[i] = (a + b - 1) * (b - a) // 2 % MOD
    for i in range(size - 1, 0, -1):
        length[i] = length[i * 2] + length[i * 2 + 1]
        weight[i] = (weight[i * 2] + weight[i * 2 + 1]) % MOD

    empty = (0, 0, 0, 1, 0)
    tree = [empty] * (size * 2)
    changes = []

    def apply(i, m, b):
        old = tree[i]
        x, y, z, p, q = old
        changes.append((i, old))
        tree[i] = (
            (m * x + b * length[i]) % MOD,
            (m * m * y + 2 * m * b * x + b * b * length[i]) % MOD,
            (m * z + b * weight[i]) % MOD,
            m * p % MOD, (m * q + b) % MOD,
        )

    def update(i, lo, hi, left, right, m, b):
        if left <= lo and hi <= right:
            apply(i, m, b)
            return
        old = tree[i]
        p, q = old[3:]
        a = i * 2
        if p != 1 or q:
            apply(a, p, q)
            apply(a + 1, p, q)
        mid = (lo + hi) // 2
        if left < mid:
            update(a, lo, mid, left, right, m, b)
        if right > mid:
            update(a + 1, mid, hi, left, right, m, b)
        x, y = tree[a], tree[a + 1]
        changes.append((i, old))
        tree[i] = ((x[0] + y[0]) % MOD, (x[1] + y[1]) % MOD,
                   (x[2] + y[2]) % MOD, 1, 0)

    def query(i, lo, hi, left, right, m, b):
        x, y, z, p, q = tree[i]
        if left <= lo and hi <= right:
            if m == 1 and b == 0:
                return x, y, z
            return (m * x + b * length[i], m * m * y + 2 * m * b * x + b * b * length[i],
                    m * z + b * weight[i])
        m, b = m * p % MOD, (m * q + b) % MOD
        mid = (lo + hi) // 2
        if right <= mid:
            return query(i * 2, lo, mid, left, right, m, b)
        if left >= mid:
            return query(i * 2 + 1, mid, hi, left, right, m, b)
        x, y, z = query(i * 2, lo, mid, left, right, m, b)
        u, v, w = query(i * 2 + 1, mid, hi, left, right, m, b)
        return x + u, y + v, z + w

    result = [""] * answers
    stack = [(0, 0)]
    while stack:
        node, checkpoint = stack.pop()
        if node < 0:
            while len(changes) > checkpoint:
                i, old = changes.pop()
                tree[i] = old
            continue
        checkpoint = len(changes)
        if node:
            a, b, m, c = mutation[node]
            update(1, 0, size, rank[a], rank[b], m, c)
        for index, a, b in queries[node]:
            x, y, z = query(1, 0, size, rank[a], rank[b], 1, 0)
            result[index] = f"{x % MOD} {y % MOD} {z % MOD}\n"
        stack.append((~node, checkpoint))
        stack.extend((child, 0) for child in reversed(children[node]))
    sys.stdout.write("".join(result))


if __name__ == "__main__":
    main()
