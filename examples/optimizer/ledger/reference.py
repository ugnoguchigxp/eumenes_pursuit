import sys
from bisect import bisect_right


def main():
    source = iter(sys.stdin.buffer)
    rows = [next(source).split() for _ in range(int(next(source)))]
    coordinates = {}
    for op, key, *args in rows:
        if op in (b"P", b"M"):
            user, t = args[:2]
            coordinates.setdefault(user, set()).add((int(t), key))
    trees = {}
    indexes = {}
    for user, positions in coordinates.items():
        keys = sorted(positions)
        trees[user] = (keys, [0] * (len(keys) + 1), [0] * (len(keys) + 1))
        indexes[user] = {item: i for i, item in enumerate(keys, 1)}

    def update(user, pos, count, amount):
        _, counts, sums = trees[user]
        while pos < len(counts):
            counts[pos] += count
            sums[pos] += amount
            pos += pos & -pos

    def prefix(counts, sums, pos):
        count = amount = 0
        while pos:
            count += counts[pos]
            amount += sums[pos]
            pos -= pos & -pos
        return count, amount

    active = {}

    def assign(key, entry):
        old = active.get(key)
        if old is not None:
            update(old[0], old[1], -1, -old[2])
        if entry is None:
            active.pop(key, None)
        else:
            active[key] = entry
            update(entry[0], entry[1], 1, entry[2])
        return old

    def apply(row):
        op, key, *args = row
        old = active.get(key)
        if op == b"D":
            entry = None
        elif op == b"A":
            entry = None if old is None else (old[0], old[1], old[2] + int(args[0]))
        elif op == b"M" and old is None:
            entry = None
        else:
            user = args[0]
            i = indexes[user][int(args[1]), key]
            amount = int(args[2]) if op == b"P" else old[2]
            entry = (user, i, amount)
        return key, assign(key, entry)

    def query(row):
        _, user, end, width = row
        if user not in trees:
            return "0 0 -\n"
        keys, counts, sums = trees[user]
        end, width = int(end), int(width)
        hi = bisect_right(keys, (end, b"\xff"))
        lo = bisect_right(keys, (end - width, b"\xff"))
        high_count, high_sum = prefix(counts, sums, hi)
        low_count, low_sum = prefix(counts, sums, lo)
        count = high_count - low_count
        if not count:
            return "0 0 -\n"
        pos = 0
        bit = 1 << (len(keys).bit_length() - 1)
        remaining = high_count
        while bit:
            at = pos + bit
            if at < len(counts) and counts[at] < remaining:
                remaining -= counts[at]
                pos = at
            bit >>= 1
        return f"{count} {high_sum - low_sum} {keys[pos][1].decode()}\n"

    if not any(row[0] in (b"S", b"R") for row in rows):
        output = []
        for row in rows:
            if row[0] == b"Q":
                output.append(query(row))
            else:
                apply(row)
    else:
        nodes = [(None, [], [])]
        names = {}
        node = 0
        output = []
        for row in rows:
            op, key = row[:2]
            if op == b"S":
                names[key] = node
            elif op == b"R":
                node = names.get(key, node)
            elif op == b"Q":
                nodes[node][2].append((len(output), row))
                output.append("")
            else:
                child = len(nodes)
                nodes[node][1].append(child)
                nodes.append((row, [], []))
                node = child
        stack = [0]
        while stack:
            step = stack.pop()
            if isinstance(step, tuple):
                assign(*step)
                continue
            row, children, queries = nodes[step]
            if row is not None:
                stack.append(apply(row))
            for at, query_row in queries:
                output[at] = query(query_row)
            stack.extend(reversed(children))
    sys.stdout.write("".join(output))


if __name__ == "__main__":
    main()
