import sys


def main():
    accounts = {}
    snapshots = {}
    results = []
    source = iter(sys.stdin.buffer)
    for _ in range(int(next(source))):
        op, key, *args = next(source).split()
        if op == b"S":
            snapshots[key] = accounts
        elif op == b"R" and key in snapshots:
            accounts = snapshots[key]
        elif op == b"P":
            user, t, amount = args
            accounts.setdefault(key, (user, int(t), int(amount)))
        elif op == b"M" and key in accounts:
            user, t = args
            accounts[key] = (user, int(t), accounts[key][2])
        elif op == b"A" and key in accounts:
            user, t, amount = accounts[key]
            accounts[key] = (user, t, amount + int(args[0]))
        elif op == b"D":
            accounts.pop(key, None)
        elif op == b"B":
            end, width, delta = map(int, args)
            for ident, (user, t, amount) in accounts.items():
                if user == key and end - width < t <= end:
                    accounts[ident] = (user, t, amount + delta)
        elif op == b"Q":
            end, width = map(int, args)
            matches = [(t, ident, amount) for ident, (user, t, amount) in accounts.items()
                       if user == key and end - width <= t <= end]
            if not matches:
                results.append("0 0 -\n")
            else:
                results.append(f"{len(matches)} {sum(row[2] for row in matches)} {max(matches)[1].decode()}\n")
    sys.stdout.write("".join(results))


if __name__ == "__main__":
    main()
