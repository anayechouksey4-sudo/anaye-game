/**
 * The island's fixed seed and the hash its generation must produce (gen/hash.ts over every array).
 * game/test/world.test.ts pins the same value in Node; loadWorld compares the browser's result
 * with it, so a V8 or generator drift shows up as a console warning and in __WORLD__.info().
 */
export const TESSERA_SEED = 7177;
export const TESSERA_HASH = '57ad65768fba31e1';
