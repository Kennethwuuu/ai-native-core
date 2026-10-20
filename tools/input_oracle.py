#!/usr/bin/env python3
"""Independent JSON boundary oracle using Python's standard JSON decoder.

Reads a JSON array of source strings; returns acceptance and decoded values.
No evaluator code, JS parser code, or normative tables are imported.
"""
import json
import sys


def integer(token):
    value = int(token)
    if token == "-0" or abs(value) > 9007199254740991:
        raise ValueError("not an exact Int53 token")
    return value


def reject_number(token):
    raise ValueError("fractional, exponent or non-JSON number")


def object_pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON key")
        result[key] = value
    return result


def decode(source):
    try:
        result = json.loads(source, parse_int=integer, parse_float=reject_number,
                            parse_constant=reject_number, object_pairs_hook=object_pairs)
        nodes = 0

        def validate(value, depth):
            nonlocal nodes
            nodes += 1
            if nodes > 50000 or depth > 160:
                raise ValueError("structural bound")
            if isinstance(value, str):
                value.encode("utf-8")  # Reject unpaired surrogates.
            elif isinstance(value, list):
                for child in value:
                    validate(child, depth + 1)
            elif isinstance(value, dict):
                for key, child in value.items():
                    key.encode("utf-8")
                    validate(child, depth + 1)

        validate(result, 0)
        return {"accepted": True, "value": result}
    except (ValueError, UnicodeError, RecursionError):
        return {"accepted": False}


if __name__ == "__main__":
    print(json.dumps([decode(source) for source in json.load(sys.stdin)], ensure_ascii=True))
