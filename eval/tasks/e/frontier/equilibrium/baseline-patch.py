def slow_solve(totals, charges, species, solids, davies):
    """Correct but slow: solve for every set of solids and keep the consistent one."""
    from itertools import combinations

    answer = None
    for size in range(len(solids) + 1):
        for chosen in combinations(range(len(solids)), size):
            try:
                logs, amounts, activity = solve(
                    totals, charges, species, [solids[p] for p in chosen], davies, activities=True
                )
            except ArithmeticError:
                continue  # this set of solids has no regular equilibrium
            if any(n <= 0 for n in amounts):
                continue
            if all(
                k + sum(m * a for m, a in zip(mu, activity)) <= 1e-9
                for p, (k, mu) in enumerate(solids)
                if p not in chosen
            ):
                found = dict(zip(chosen, amounts))
                answer = logs, [found.get(p, 0.0) for p in range(len(solids))]
    return answer


