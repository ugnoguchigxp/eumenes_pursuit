"""One text line per invoice (README.md, "出力")."""


def render_line(inv) -> str:
    return (
        f"{inv.account} {inv.start.isoformat()}..{inv.last_day.isoformat()} plan={inv.plan} "
        f"base={inv.base} overage={inv.overage} discount={inv.discount} tax={inv.tax} "
        f"credit={inv.credit} total={inv.total} carry={inv.carry}"
    )
