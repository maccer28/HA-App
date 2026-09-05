#!/usr/bin/env python3
"""Validate YAML syntax and embedded Jinja template syntax in HA config files."""
import sys
import yaml
from jinja2 import Environment


def find_jinja_strings(node):
    if isinstance(node, str):
        if '{{' in node or '{%' in node:
            yield node
    elif isinstance(node, dict):
        for value in node.values():
            yield from find_jinja_strings(value)
    elif isinstance(node, list):
        for item in node:
            yield from find_jinja_strings(item)


def validate_file(path):
    with open(path) as f:
        try:
            data = yaml.safe_load(f)
        except yaml.YAMLError as e:
            return f"{path}: YAML syntax error: {e}"

    env = Environment()
    for template_str in find_jinja_strings(data):
        try:
            env.parse(template_str)
        except Exception as e:
            return f"{path}: Jinja syntax error in template ({template_str[:40]!r}...): {e}"

    return None


def main(argv):
    if not argv:
        print("usage: validate_ha_yaml.py <file>...", file=sys.stderr)
        return 2

    had_error = False
    for path in argv:
        error = validate_file(path)
        if error:
            print(error, file=sys.stderr)
            had_error = True
        else:
            print(f"OK: {path}")

    return 1 if had_error else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
