import sys


def version_intervals(lines, n, interval):
    children = [[]]
    mutations = [None]
    at_node = [[]]
    saved = {}
    current = 0
    query_count = 0
    for _ in range(n):
        op, a, *args = next(lines).split()
        if op == b"S":
            saved[a] = current
        elif op == b"R":
            current = saved.get(a, current)
        elif op == b"Q":
            at_node[current].append((query_count, int(a), int(args[0])))
            query_count += 1
        else:
            node = len(children)
            children[current].append(node)
            children.append([])
            mutations.append((op, a, args))
            at_node.append([])
            current = node

    active = {}
    queries = {}
    start = [0] * len(children)
    restore = [None] * len(children)
    stack = [0]
    time = 0
    while stack:
        node = stack.pop()
        if node >= 0:
            start[node] = time
            if node:
                op, a, args = mutations[node]
                if op in (b"P", b"D"):
                    prior = active.pop(a, None)
                    if prior is not None:
                        interval(prior[0], time, prior[1])
                        restore[node] = prior[1]
                    if op == b"P":
                        active[a] = (time, tuple(map(int, args)))
            if at_node[node]:
                queries[time] = at_node[node]
            time += 1
            stack.append(~node)
            stack.extend(reversed(children[node]))
        elif node != ~0:
            node = ~node
            op, a, args = mutations[node]
            if op == b"A":
                interval(start[node], time, (int(a), int(args[0])))
            else:
                current_edge = active.pop(a, None)
                if current_edge is not None:
                    interval(current_edge[0], time, current_edge[1])
                if restore[node] is not None:
                    active[a] = (time, restore[node])
    return time, queries, query_count


def linear_intervals(lines, n, interval):
    queries = {}
    active = {}
    query_count = 0
    for time in range(n):
        op, a, *args = next(lines).split()
        if op in (b"P", b"D"):
            prior = active.pop(a, None)
            if prior is not None:
                interval(prior[0], time, prior[1])
            if op == b"P":
                active[a] = (time, tuple(map(int, args)))
        elif op == b"A":
            interval(time, n, (int(a), int(args[0])))
        else:
            queries[time] = [(query_count, int(a), int(args[0]))]
            query_count += 1
    for start, edge in active.values():
        interval(start, n, edge)
    return n, queries, query_count


def main(versioned=False):
    lines = iter(sys.stdin.buffer)
    vertices, n = map(int, next(lines).split())
    size = 1 << (n if versioned else n - 1).bit_length()
    segments = [[] for _ in range(2 * size)]

    def interval(lo, hi, event):
        lo += size
        hi += size
        while lo < hi:
            if lo & 1:
                segments[lo].append(event)
                lo += 1
            if hi & 1:
                hi -= 1
                segments[hi].append(event)
            lo >>= 1
            hi >>= 1

    times, queries, query_count = (
        version_intervals(lines, n, interval) if versioned
        else linear_intervals(lines, n, interval)
    )

    parent = list(range(vertices + 1))
    colour = [0] * (vertices + 1)
    count = [1] * (vertices + 1)
    total = [0] * (vertices + 1)
    bad = [False] * (vertices + 1)
    changes = []
    output = [""] * query_count

    def find(x):
        p = 0
        while parent[x] != x:
            p ^= colour[x]
            x = parent[x]
        return x, p

    def apply(event):
        if len(event) == 2:
            x, delta = event
            root, _ = find(x)
            changes.append((root, total[root]))
            total[root] += delta
            return
        u, v, p = event
        a, x = find(u)
        b, y = find(v)
        if a == b:
            if x ^ y != p and not bad[a]:
                changes.append((a,))
                bad[a] = True
            return
        if count[a] < count[b]:
            a, b = b, a
        changes.append((a, b, count[a], total[a], bad[a]))
        parent[b] = a
        colour[b] = x ^ y ^ p
        count[a] += count[b]
        total[a] += total[b]
        bad[a] |= bad[b]

    def rollback(before):
        while len(changes) > before:
            event = changes.pop()
            if len(event) == 1:
                bad[event[0]] = False
            elif len(event) == 2:
                total[event[0]] = event[1]
            else:
                a, b, count[a], total[a], bad[a] = event
                parent[b] = b
                colour[b] = 0

    def visit(node, lo, hi):
        if lo >= times:
            return
        before = len(changes)
        for event in segments[node]:
            apply(event)
        if lo + 1 == hi:
            for index, u, v in queries.get(lo, ()):
                a, x = find(u)
                b, y = find(v)
                relation = "unknown" if a != b else "conflict" if bad[a] else "different" if x ^ y else "same"
                output[index] = f"{relation} {count[a]} {total[a]}\n"
        else:
            mid = (lo + hi) // 2
            visit(node * 2, lo, mid)
            visit(node * 2 + 1, mid, hi)
        rollback(before)

    visit(1, 0, size)
    sys.stdout.write("".join(output))


if __name__ == "__main__":
    main()
