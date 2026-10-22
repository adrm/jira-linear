/** Resolutions that mean the work was dropped rather than done (English and Spanish workflows). */
export const DROPPED_RESOLUTIONS: readonly string[] = [
  "Won't Do", "Duplicado", "Duplicate", "Declined", "Invalid", "No se arreglará", "Not a Bug", "No Reproducible", "User Error", "Incompleta",
];

export const isDroppedResolution = (resolution: string | null | undefined): boolean => !!resolution && DROPPED_RESOLUTIONS.includes(resolution);
