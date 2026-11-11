import sys


def main():
    lines = iter(sys.stdin.buffer)
    vertices, n = map(int, next(lines).split())
    graph = [[] for _ in range(vertices + 1)]
    for _ in range(vertices - 1):
        u, v, d = map(int, next(lines).split())
        graph[u].append((v, d))
        graph[v].append((u, d))

    stock, saved, output = {}, {}, []
    for _ in range(n):
        op, a, *args = next(lines).split()
        if op == b"U":
            stock[int(a), int(args[0])] = int(args[1])
        elif op == b"S":
            saved[a] = stock
        elif op == b"R":
            stock = saved.get(a, stock)
        else:
            site = int(a)
            item, lo, hi = map(int, args)
            count = total = 0
            stack = [(site, 0, 0)]
            while stack:
                u, parent, distance = stack.pop()
                if lo <= distance:
                    quantity = stock.get((u, item), 0)
                    count += bool(quantity)
                    total += quantity
                for v, d in graph[u]:
                    if v != parent and distance + d <= hi:
                        stack.append((v, u, distance + d))
            output.append(f"{count} {total}\n")
    sys.stdout.write("".join(output))


if __name__ == "__main__":
    main()
