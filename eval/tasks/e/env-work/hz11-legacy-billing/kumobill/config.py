"""Constants shared by the pricing modules."""
from fractions import Fraction

# Consumption tax (docs/tax.md).
TAX_RATE = Fraction(10, 100)

# Where the plan catalog lives, relative to the package root.
CATALOG_FILE = "data/plans.json"
