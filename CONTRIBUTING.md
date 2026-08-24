# Contributing

AI Native Core is currently an RFC-first design project.

## Before adding syntax

Please ask:

1. Can the use case already be represented by existing primitives?
2. Is the proposed concept semantic, or merely syntactic convenience?
3. Does it reduce ambiguity for both AI and humans?
4. Can it be verified mechanically?
5. Does it remain model-agnostic?

## RFC process

Substantial changes should begin as an RFC under `rfcs/`.

A good RFC should include:

- problem statement,
- proposed semantics,
- examples,
- alternatives considered,
- effect on human readability,
- effect on AI reasoning/context cost,
- verification strategy,
- unresolved questions.

## Current priority

The current priority is to falsify or strengthen RFC-0001 before building a large compiler/runtime stack.
