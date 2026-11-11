import sys
from bisect import bisect_right


class ActiveTree:
    def __init__(self, size):
        self.size = 1 << max(0, (size - 1).bit_length())
        capacity = self.size * 2
        self.count = [0] * capacity
        self.total = [0] * capacity
        self.last = [-1] * capacity
        self.lazy = [0] * self.size

    def add(self, node, delta):
        if self.count[node]:
            self.total[node] += self.count[node] * delta
            if node < self.size:
                self.lazy[node] += delta

    def push(self, node):
        delta = self.lazy[node]
        if delta:
            self.add(node * 2, delta)
            self.add(node * 2 + 1, delta)
            self.lazy[node] = 0

    def pull(self, node):
        left = node * 2
        self.count[node] = self.count[left] + self.count[left + 1]
        self.total[node] = self.total[left] + self.total[left + 1]
        self.last[node] = max(self.last[left], self.last[left + 1])

    def set(self, position, value):
        node = position + self.size
        for depth in range(self.size.bit_length() - 1, 0, -1):
            self.push(node >> depth)
        previous = self.total[node] if self.count[node] else None
        self.count[node] = int(value is not None)
        self.total[node] = 0 if value is None else value
        self.last[node] = -1 if value is None else position
        while node > 1:
            node //= 2
            self.pull(node)
        return previous

    def range_add(self, left, right, delta):
        def visit(node, lo, hi):
            if right <= lo or hi <= left or not self.count[node]:
                return
            if left <= lo and hi <= right:
                self.add(node, delta)
                return
            self.push(node)
            mid = (lo + hi) // 2
            visit(node * 2, lo, mid)
            visit(node * 2 + 1, mid, hi)
            self.pull(node)
        if left < right:
            visit(1, 0, self.size)

    def query(self, left, right):
        def visit(node, lo, hi, pending):
            if right <= lo or hi <= left or not self.count[node]:
                return 0, 0, -1
            if left <= lo and hi <= right:
                return self.count[node], self.total[node] + pending * self.count[node], self.last[node]
            pending += self.lazy[node]
            mid = (lo + hi) // 2
            a, b, c = visit(node * 2, lo, mid, pending)
            d, e, f = visit(node * 2 + 1, mid, hi, pending)
            return a + d, b + e, max(c, f)
        return visit(1, 0, self.size, 0) if left < right else (0, 0, -1)


def main():
    stdin = iter(sys.stdin.buffer)
    rows = [next(stdin).split() for _ in range(int(next(stdin)))]
    positions = sorted({(row[2], int(row[3]), row[1]) for row in rows if row[0] in (b"P", b"M")})
    ranks = {key: i for i, key in enumerate(positions)}
    tree = ActiveTree(len(positions))

    def interval(user, end, width):
        return (bisect_right(positions, (user, end - width, b"\xff")),
                bisect_right(positions, (user, end, b"\xff")))

    active = {}
    nodes = [(None, [], [])]
    names = {}
    current = 0
    output = []
    for row in rows:
        kind, key, *args = row
        if kind == b"S":
            names[key] = current
        elif kind == b"R":
            current = names.get(key, current)
        elif kind == b"Q":
            nodes[current][2].append((len(output), interval(key, *map(int, args))))
            output.append("")
        else:
            child = len(nodes)
            nodes[current][1].append(child)
            nodes.append((row, [], []))
            current = child

    def apply(row):
        kind, key, *args = row
        if kind == b"B":
            lo, hi = interval(key, int(args[0]), int(args[1]))
            delta = int(args[2])
            tree.range_add(lo, hi, delta)
            return b"B", lo, hi, -delta

        old = active.pop(key, None)
        if old is None and kind != b"P":
            return None
        amount = None if old is None else tree.set(old, None)
        if kind != b"D":
            if kind == b"A":
                position = old
                value = amount + int(args[0])
            else:
                position = ranks[args[0], int(args[1]), key]
                value = int(args[2]) if kind == b"P" else amount
            active[key] = position
            tree.set(position, value)
        return b"I", key, old, amount

    stack = [0]
    while stack:
        step = stack.pop()
        if isinstance(step, tuple):
            kind, x, y, z = step
            if kind == b"B":
                tree.range_add(x, y, z)
            else:
                current_position = active.pop(x, None)
                if current_position is not None:
                    tree.set(current_position, None)
                if y is not None:
                    active[x] = y
                    tree.set(y, z)
            continue
        row, children, queries = nodes[step]
        if row is not None:
            undo = apply(row)
            if undo is not None:
                stack.append(undo)
        for at, bounds in queries:
            count, total, last = tree.query(*bounds)
            output[at] = f"{count} {total} {positions[last][2].decode() if count else '-'}\n"
        stack.extend(reversed(children))
    sys.stdout.write("".join(output))


if __name__ == "__main__":
    main()
