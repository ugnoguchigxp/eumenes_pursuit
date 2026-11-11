from bisect import bisect_left, bisect_right
import sys


def main():
    lines = iter(sys.stdin.buffer)
    n, operations = map(int, next(lines).split())
    graph = [[] for _ in range(n + 1)]
    for _ in range(n - 1):
        u, v, d = map(int, next(lines).split())
        graph[u].append((v, d))
        graph[v].append((u, d))

    removed = [False] * (n + 1)
    sizes = [0] * (n + 1)
    ancestors = [[] for _ in range(n + 1)]
    coordinates = []
    components = [1]
    while components:
        root = components.pop()
        order = [(root, 0)]
        for u, parent in order:
            sizes[u] = 1
            for v, _ in graph[u]:
                if v != parent and not removed[v]:
                    order.append((v, u))
        for u, parent in reversed(order):
            sizes[parent] += sizes[u]
        half = len(order) // 2
        for u, parent in order:
            if len(order) - sizes[u] <= half and all(
                v == parent or removed[v] or sizes[v] <= half for v, _ in graph[u]
            ):
                centroid = u
                break

        removed[centroid] = True
        all_bucket = len(coordinates)
        coordinates.append(None)
        distances = [0]
        ancestors[centroid].append((all_bucket, -1, 0))
        for child, d in graph[centroid]:
            if removed[child]:
                continue
            components.append(child)
            branch_bucket = len(coordinates)
            branch = [(child, centroid, d)]
            for u, parent, distance in branch:
                ancestors[u].append((all_bucket, branch_bucket, distance))
                for v, weight in graph[u]:
                    if v != parent and not removed[v]:
                        branch.append((v, u, distance + weight))
            branch_distances = {distance for _, _, distance in branch}
            distances.extend(branch_distances)
            coordinates.append(sorted(branch_distances))
        coordinates[all_bucket] = sorted(set(distances))

    children, mutations, queries = [[]], [None], [[]]
    saved = {}
    active = 0
    count = 0
    for _ in range(operations):
        op, a, *args = next(lines).split()
        if op == b"S":
            saved[a] = active
        elif op == b"R":
            active = saved.get(a, active)
        elif op == b"U":
            node = len(children)
            children[active].append(node)
            children.append([])
            mutations.append((int(a), int(args[0]), int(args[1])))
            queries.append([])
            active = node
        else:
            item, lo, hi = map(int, args)
            queries[active].append((count, int(a), item, lo, hi))
            count += 1

    trees = [{} for _ in coordinates]
    # The largest legal stock total fits below base, so one Fenwick sum carries both fields.
    base = 1 << 44

    def apply(u, item, delta):
        for a, b, distance in ancestors[u]:
            for bucket in (a, b):
                if bucket < 0:
                    continue
                coords = coordinates[bucket]
                tree = trees[bucket].get(item)
                if tree is None:
                    tree = trees[bucket][item] = [0] * (len(coords) + 1)
                i = bisect_left(coords, distance) + 1
                while i < len(tree):
                    tree[i] += delta
                    i += i & -i

    def range_sum(bucket, item, lo, hi):
        tree = trees[bucket].get(item)
        if tree is None:
            return 0
        coords = coordinates[bucket]
        r = bisect_right(coords, hi)
        l = bisect_left(coords, lo)
        result = 0
        while r:
            result += tree[r]
            r -= r & -r
        while l:
            result -= tree[l]
            l -= l & -l
        return result

    output = [""] * count
    stock = {}
    before = [0] * len(children)
    change = [0] * len(children)
    # Visit each version with its updates applied, then undo the update before visiting a sibling.
    stack = [0]
    while stack:
        node = stack.pop()
        if node >= 0:
            if node:
                u, item, quantity = mutations[node]
                prior = stock.get((u, item), 0)
                before[node] = prior
                stock[u, item] = quantity
                delta = quantity - prior + (bool(quantity) - bool(prior)) * base
                change[node] = delta
                if delta:
                    apply(u, item, delta)
            for index, u, item, lo, hi in queries[node]:
                result = 0
                for a, b, distance in ancestors[u]:
                    if distance <= hi:
                        result += range_sum(a, item, lo - distance, hi - distance)
                        if b >= 0:
                            # Sites in u's own branch are counted at a lower centroid.
                            result -= range_sum(b, item, lo - distance, hi - distance)
                sites, total = divmod(result, base)
                output[index] = f"{sites} {total}\n"
            stack.append(~node)
            stack.extend(reversed(children[node]))
        elif node != ~0:
            node = ~node
            u, item, _ = mutations[node]
            stock[u, item] = before[node]
            if change[node]:
                apply(u, item, -change[node])
    sys.stdout.write("".join(output))


if __name__ == "__main__":
    main()
