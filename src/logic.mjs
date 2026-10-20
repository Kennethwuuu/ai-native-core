// RFC-0006 algebra. This module never reads the conformance vectors.
export const VALUES = Object.freeze([
  "UNKNOWN", "SUPPORTED_TRUE", "SUPPORTED_FALSE", "CONFLICTING",
]);
export const STATUSES = Object.freeze([
  "UNKNOWN", "SATISFIED", "VIOLATED", "CONFLICTING",
]);
const pairs = [[0, 0], [1, 0], [0, 1], [1, 1]];
const bits = (name) => {
  const index = VALUES.indexOf(name);
  if (index < 0) throw new TypeError(`Unknown information value: ${name}`);
  return pairs[index];
};
const named = (t, f) => VALUES[t + 2 * f];
export const fromSupport = (positive, negative) => {
  if (typeof positive !== "boolean" || typeof negative !== "boolean") throw new TypeError("Support flags must be Bool2");
  return named(Number(positive), Number(negative));
};
export const not = (x) => { const [t, f] = bits(x); return named(f, t); };
export const and = (x, y) => {
  const [t, f] = bits(x), [u, g] = bits(y);
  return named(t & u, f | g);
};
export const or = (x, y) => {
  const [t, f] = bits(x), [u, g] = bits(y);
  return named(t | u, f & g);
};
export const informationMeet = (x, y) => {
  const [t, f] = bits(x), [u, g] = bits(y);
  return named(t & u, f & g);
};
export const informationJoin = (x, y) => {
  const [t, f] = bits(x), [u, g] = bits(y);
  return named(t | u, f | g);
};
export const leInformation = (x, y) => {
  const [t, f] = bits(x), [u, g] = bits(y);
  return t <= u && f <= g;
};
export const leTruth = (x, y) => {
  const [t, f] = bits(x), [u, g] = bits(y);
  return t <= u && g <= f;
};
function status(x) {
  if (!STATUSES.includes(x)) throw new TypeError(`Unknown strict status: ${x}`);
  return x;
}
export const atomicStatus = (value) => { bits(value); return STATUSES[VALUES.indexOf(value)]; };
export const strictNot = (x) => {
  status(x);
  return x === "SATISFIED" ? "VIOLATED" : x === "VIOLATED" ? "SATISFIED" : x;
};
export const strictAll = (x, y) => {
  status(x); status(y);
  return ["VIOLATED", "CONFLICTING", "UNKNOWN", "SATISFIED"].find((s) => x === s || y === s);
};
export const strictAny = (x, y) => {
  status(x); status(y);
  return ["SATISFIED", "CONFLICTING", "UNKNOWN", "VIOLATED"].find((s) => x === s || y === s);
};
export const whenRequire = (activation, requirement) => {
  status(activation); status(requirement);
  if (requirement === "SATISFIED" || activation === "VIOLATED") return "SATISFIED";
  return activation === "SATISFIED" ? requirement : activation;
};
