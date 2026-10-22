-- Category names are compared exactly; only surrounding spaces are removed.
UPDATE sales SET category = trim(category);
