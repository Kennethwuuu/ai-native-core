#!/usr/bin/env python3
"""Independent canonical-byte/hash oracle for valid normalized Block JSON.

Not a second Block schema, closure, or runtime checker. --canonical checks
the restricted JSON encoding alone; otherwise hashes a normalized compact Block.
"""
import hashlib
import json
import sys


def canonical(value):
    if value is None or type(value) is bool:
        return json.dumps(value)
    if type(value) is int:
        if abs(value) > 9007199254740991:
            raise ValueError("Int53 overflow")
        return str(value)
    if isinstance(value, str):
        value.encode("utf-8")
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, list):
        return "[" + ",".join(canonical(item) for item in value) + "]"
    if isinstance(value, dict):
        keys = sorted(value, key=lambda key: key.encode("utf-16-be"))
        return "{" + ",".join(canonical(key) + ":" + canonical(value[key]) for key in keys) + "}"
    raise ValueError("not primitive JSON in the supported exact profile")


if __name__ == "__main__":
    value = json.load(sys.stdin)
    if sys.argv[1:] == ["--canonical"]:
        print(json.dumps(canonical(value)))
    elif not sys.argv[1:]:
        semantic = {key: item for key, item in value.items() if key not in ("annotations", "block_content_id")}
        encoded = canonical(semantic)
        digest = hashlib.sha256(b"AI-NATIVE-CORE\x00BLOCK\x00" + encoded.encode("utf-8")).hexdigest()
        print(json.dumps({"canonical_identity_json": encoded, "block_content_id": "aicore-block-sha256:" + digest}))
    else:
        raise SystemExit("Usage: block_oracle.py [--canonical]")
