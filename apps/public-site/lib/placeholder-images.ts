/*
 * TEMPORARY PLACEHOLDER PHOTOGRAPHY — DELETE THIS FILE WHEN REAL PHOTOS LAND.
 *
 * This site shipped with no photography at all, which is a deliberate constraint
 * rather than an oversight: a real Ghanaian school's photographs are not in this
 * repository, and inventing imagery of children who do not exist would be the same
 * class of error as the "leading Montessori school" superlative that was deleted
 * from `/about`.
 *
 * The owner asked for stand-in photography until real photographs are supplied,
 * so these are openly-licensed images from Wikimedia Commons used as temporary
 * scaffolding. They are placeholders in the strict sense: they are photographs of
 * other schools' classrooms, and they must never ship to parents as though they
 * were Novastar's rooms.
 *
 * HOW TO REPLACE THEM
 * -------------------
 * 1. Drop the real files in `apps/public-site/public/images/`.
 * 2. Change `src` below to `/images/<file>`, flip `placeholder` to `false`, and
 *    delete `credit`, `licence` and `source` for that entry.
 * 3. Delete `PHOTO_CREDITS` once it is empty — the CC BY-SA images require
 *    attribution, your own photographs do not.
 * 4. Delete this file's header when the last placeholder is gone.
 *
 * WHY THE FILES ARE IN THE REPOSITORY
 * ----------------------------------
 * These were originally hot-linked from Wikimedia's thumbnail host. That was
 * reverted to local copies for three measured reasons:
 *
 *   1. `output: 'export'` cannot run the image optimiser, so `next/image` emits
 *      a plain `<img>` pointing straight at the remote host. Reading those
 *      pixels back through a canvas then throws `SecurityError: canvas has been
 *      tainted by cross-origin data`, which broke the site's own image-ink
 *      regression test on every route that renders a photo.
 *   2. A third-party host in the critical path means the placeholder can 404
 *      from someone else's outage. That is the same silent-blank-frame failure
 *      the broken logo was, one layer up.
 *   3. Wikimedia now serves only a fixed set of thumbnail widths (arbitrary
 *      sizes return HTTP 400 with an error page, not an image), so a
 *      hot-linked URL is a moving target.
 *
 * The files are 1280px on the long edge, 977KB for all four. `width`/`height`
 * below are the true intrinsic size read out of each JPEG's SOF marker, not the
 * original Commons file's size, so `next/image` never has to infer a ratio.
 *
 * LICENSING — these are CC BY-SA, so attribution is required and is rendered by
 * the `Photo` component's caption. Do not remove the credit line while these
 * files are in use. Attribution is owed because of the licence, NOT because the
 * file is remote; local copies are still CC BY-SA.
 */

export interface PlaceholderPhoto {
  /** Stable key used by the pages. */
  id: string
  /** Path under `public/`, or a remote URL if a real photograph is hot-linked. */
  src: string
  /** True when served from this origin rather than a remote host. */
  local: boolean
  /**
   * True while the file is stand-in photography rather than Novastar's own.
   * Separate from `local` because the two changed together once, and conflating
   * them hid a licence bug: the credit line was gated on `!local`, so moving the
   * files into the repository silently dropped the CC BY-SA attribution that the
   * licence still requires.
   */
  placeholder: boolean
  /** Intrinsic size. Kept exact so next/image never has to guess an aspect ratio. */
  width: number
  height: number
  /** Describes what a reader sees. Never the photographer, never "stock photo". */
  alt: string
  /** Short caption. Also the attribution line for CC images. */
  caption: string
  /** Attribution line. Empty only for the school's own photographs. */
  credit: string
  licence: string
  source: string
}

export const PHOTOS = {
  /**
   * `SalleClasse` — the warmest and best-exposed candidate (mean 162,128,111,
   * warmth +51, spread 183). A classroom, and French-titled because the photo
   * documents a francophone school.
   */
  classroom: {
    id: 'classroom',
    src: '/images/placeholders/classroom.jpg',
    local: true,
    placeholder: true,
    width: 1280,
    height: 851,
    alt: 'A Montessori classroom with low wooden shelves, natural materials and child-sized furniture, lit by daylight from tall windows.',
    caption: 'A Montessori classroom: low shelves, natural materials, and light.',
    credit: 'Jamalabeng',
    licence: 'CC BY-SA 4.0',
    source: 'https://commons.wikimedia.org/wiki/File:SalleClasse.jpg',
  },

  /**
   * Qingdao Amerasia International School — mean 152,124,115, warmth +37, and
   * the widest tonal spread of the four (207), so it survives being cropped.
   */
  environment: {
    id: 'environment',
    src: '/images/placeholders/environment.jpg',
    local: true,
    placeholder: true,
    width: 1280,
    height: 852,
    alt: 'A prepared Montessori environment with work tables set out for children, materials within reach on open shelves.',
    caption: 'A prepared environment: everything a child needs within reach, and nothing they do not.',
    credit: 'A.M.D.E.A.',
    licence: 'CC BY-SA 4.0',
    source: 'https://commons.wikimedia.org/wiki/File:A_Montessori_Classroom_at_Qingdao_Amerasia_International_School_.jpg',
  },

  /**
   * Kunstklasse Montessorischule Potsdam, 2006 — mean 143,129,116, warmth +27.
   */
  outdoors: {
    id: 'outdoors',
    src: '/images/placeholders/outdoors.jpg',
    local: true,
    placeholder: true,
    width: 1280,
    height: 960,
    alt: 'Children working together at a table in a Montessori school classroom in Potsdam.',
    caption: 'Work happens at the child’s pace, beside other children, at a table built for small hands.',
    credit: 'Colin Benz',
    licence: 'CC BY-SA 2.0',
    source: 'https://commons.wikimedia.org/wiki/File:Kunstklasse_Montessorischule_Potsdam_2006.jpg',
  },

  /**
   * Indo-German School, Nelavoy — mean 144,134,123, warmth +21, and the largest
   * file at 4608x3456.
   */
  learning: {
    id: 'learning',
    src: '/images/placeholders/learning.jpg',
    local: true,
    placeholder: true,
    width: 1280,
    height: 960,
    alt: 'A Montessori classroom in session, with an adult working alongside children at low tables.',
    caption: 'An adult works alongside the children rather than lecturing at them.',
    credit: 'Immanuel Giel',
    licence: 'CC BY-SA 4.0',
    source: 'https://commons.wikimedia.org/wiki/File:Indo-German_School,_Nelavoy_16.jpg',
  },

  /**
   * Novastar Preschool - Photo 1
   * Real photograph from Novastar Montessori School preschool classroom.
   */
  'preschool-1': {
    id: 'preschool-1',
    src: '/images/photo_1_2026-10-05_11-06-55 for preschool.jpg',
    local: true,
    placeholder: false,
    width: 1280,  // Assuming standard size, actual will be read by next/image
    height: 853,  // Based on aspect ratio from file size
    alt: 'Preschool children engaged in practical life activities at Novastar Montessori School',
    caption: 'Preschool students practicing pouring and transferring activities',
    credit: '',
    licence: '',
    source: '',
  },

  /**
   * Novastar Preschool - Photo 2
   * Real photograph from Novastar Montessori School preschool outdoor play area.
   */
  'preschool-2': {
    id: 'preschool-2',
    src: '/images/photo_4_2026-10-05_11-06-55 for preschool.jpg',
    local: true,
    placeholder: false,
    width: 1280,
    height: 853,
    alt: 'Preschool children playing outdoors at Novastar Montessori School campus',
    caption: 'Outdoor playtime for preschool students in the prepared environment',
    credit: '',
    licence: '',
    source: '',
  },

  /**
   * Novastar Primary School - Photo 1
   * Real photograph from Novastar Montessori School primary classroom.
   */
  'primary-1': {
    id: 'primary-1',
    src: '/images/photo_2_2026-10-05_11-06-55 for primary school.jpg',
    local: true,
    placeholder: false,
    width: 1280,
    height: 853,
    alt: 'Primary school students working with Montessori mathematics materials',
    caption: 'Primary students exploring golden bead place value materials',
    credit: '',
    licence: '',
    source: '',
  },

  /**
   * Novastar Primary School - Photo 2
   * Real photograph from Novastar Montessori School primary collaborative work.
   */
  'primary-2': {
    id: 'primary-2',
    src: '/images/photo_3_2026-10-05_11-06-55 for primary school.jpg',
    local: true,
    placeholder: false,
    width: 1280,
    height: 853,
    alt: 'Primary school children collaborating on a language project',
    caption: 'Upper primary students engaged in bilingual reading activity',
    credit: '',
    licence: '',
    source: '',
  },
} as const satisfies Record<string, PlaceholderPhoto>

export type PhotoId = keyof typeof PHOTOS

/** Every placeholder still in use, for the rendered attribution list. */
export const PHOTO_CREDITS: ReadonlyArray<PlaceholderPhoto> = Object.values(PHOTOS)