import sys
from collections import defaultdict, deque


def main():
    lines = iter(sys.stdin.buffer)
    _, n = map(int, next(lines).split())
    links, weights, output = {}, defaultdict(int), []
    saved = {}
    for _ in range(n):
        op, a, *rest = next(lines).split()
        if op == b"P":
            links.setdefault(a, tuple(map(int, rest)))
        elif op == b"D":
            links.pop(a, None)
        elif op == b"A":
            weights[int(a)] += int(rest[0])
        elif op == b"S":
            saved[a] = links, weights
        elif op == b"R":
            links, weights = saved.get(a, (links, weights))
        else:
            u, v = int(a), int(rest[0])
            graph = defaultdict(list)
            for x, y, parity in links.values():
                graph[x].append((y, parity))
                graph[y].append((x, parity))
            colours = {u: 0}
            queue = deque([u])
            conflict = False
            while queue:
                x = queue.popleft()
                for y, parity in graph[x]:
                    expected = colours[x] ^ parity
                    if y in colours:
                        conflict |= colours[y] != expected
                    else:
                        colours[y] = expected
                        queue.append(y)
            relation = "unknown" if v not in colours else "conflict" if conflict else "different" if colours[v] else "same"
            output.append(f"{relation} {len(colours)} {sum(weights[x] for x in colours)}\n")
    sys.stdout.write("".join(output))


if __name__ == "__main__":
    main()
