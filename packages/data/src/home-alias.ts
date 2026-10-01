import { randomInt } from "node:crypto";

/** Vetted, non-credential public join words. Never lengthen aliases on collision. */
export const HOME_ALIAS_WORDS = Object.freeze([
  "acorn", "alder", "amber", "apple", "apricot", "arbor", "aspen", "aster",
  "autumn", "azalea", "bamboo", "basil", "bay", "beach", "beacon", "beech",
  "berry", "birch", "bloom", "blossom", "bluejay", "breeze", "brook", "bud",
  "cairn", "canopy", "canyon", "cedar", "cherry", "chive", "cinder",
  "citrus", "clay", "clover", "coast", "cobalt", "comet", "coral", "cosmos",
  "cove", "cricket", "cypress", "dahlia", "daisy", "dawn", "delta", "den",
  "dew", "dove", "drift", "dune", "dusk", "eagle", "echo", "elm",
  "ember", "falcon", "fawn", "feather", "fern", "field", "finch", "firefly",
  "fir", "flax", "flint", "flora", "fog", "forest", "fox", "frost",
  "garden", "garnet", "glade", "glow", "grove", "gull", "harbor", "hazel",
  "heather", "heron", "hill", "hollow", "honey", "iris", "ivy", "jade",
  "jasmine", "juniper", "lagoon", "lake", "larch", "laurel", "leaf", "lemon",
  "lilac", "lily", "lotus", "lumen", "lunar", "mango", "maple", "marble",
  "marsh", "meadow", "mica", "mint", "moon", "moss", "myrtle",
  "nectar", "oasis", "ocean", "olive", "opal", "orchid", "oriole", "otter",
  "owl", "palm", "peach", "pebble", "petal", "pine", "plum", "pond",
  "poppy", "prairie", "prism", "quartz", "quill", "rain", "raven", "reed",
  "ripple", "river", "robin", "rose", "rowan", "ruby", "sage", "shore",
  "silver", "sky", "slate", "snow", "sparrow", "spruce", "star", "stone",
  "stream", "summer", "sunbeam", "sunset", "thistle", "tide", "timber", "topaz",
  "trail", "tulip", "valley", "velvet", "violet", "walnut", "wave", "willow",
  "wind", "winter", "wood", "wren", "yarrow", "yew", "zenith", "zinnia",
]);

export function normalizeHomeReference(reference: string): string {
  return reference.trim().toLowerCase();
}

/** Cryptographic random choice, bounded collision retries, then an available-word fallback. */
export function chooseHomeAlias(occupied: ReadonlySet<string>, pick: (max: number) => number = randomInt): string | null {
  for (let attempt = 0; attempt < 16; attempt++) {
    const word = HOME_ALIAS_WORDS[pick(HOME_ALIAS_WORDS.length)]!;
    if (!occupied.has(word)) return word;
  }
  const remaining = HOME_ALIAS_WORDS.filter(word => !occupied.has(word));
  return remaining.length ? remaining[pick(remaining.length)]! : null;
}
