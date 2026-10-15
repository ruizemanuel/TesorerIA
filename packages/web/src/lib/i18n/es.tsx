import type { Locale } from "./locales";

/**
 * Everything the web says, in Rioplatense Spanish (spec, 9.3): the texts it always had, moved here word for word.
 * `en` has this same shape (Messages), so a sentence missing in English doesn't compile. A fixed sentence is a
 * string; one with values is a function that takes them already formatted; a value that stands out on screen comes
 * in as a ReactNode, and the sentence is a fragment around it.
 */
export const es = {
  /** The dictionary's own language: what a function that has `m` passes to the formats (formatPesos(x, m.locale)). */
  locale: "es" as Locale,
  meta: {
    description: "La plata del grupo, sin tesorero.",
  },
  language: {
    label: "Idioma",
  },
};

export type Messages = typeof es;
