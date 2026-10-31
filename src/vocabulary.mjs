// Versioned fixed registries shared by evaluation and static Block checking.
const signature = (args, method, result) => Object.freeze({ args: Object.freeze(args), method, result });
export const valueFunctions = Object.freeze({
  "bool.not": signature(["Bool2"], (a) => ({ type: "Bool2", value: !a }), "Bool2"),
});
export const legacyPredicates = Object.freeze({
  "int.le": signature(["Int53", "Int53"], (a, b) => a <= b),
  "string.equal": signature(["String", "String"], (a, b) => a === b),
  "bool.equal": signature(["Bool2", "Bool2"], (a, b) => a === b),
  "claim.supported": signature(["String"], null),
});
export const predicates = Object.freeze({
  ...legacyPredicates,
  "claim.supported": signature(["ClaimId"], null),
});
