export const SPECIAL_LOCATIONS = ["Казахстан", "Онлайн"] as const;

export function isSpecialLocation(value: string | undefined) {
  return SPECIAL_LOCATIONS.includes(String(value ?? "").trim() as typeof SPECIAL_LOCATIONS[number]);
}

const normalized = (value: string | undefined) => String(value ?? "").trim().toLocaleLowerCase("ru");

/** Kazakhstan and Online are intentionally visible from every city filter. */
export function locationMatchesCityFilter(locations: string[] | undefined, selectedCity: string | undefined) {
  if (!normalized(selectedCity)) return true;
  if (!locations?.length) return true;
  return locations.some((location) => isSpecialLocation(location) || normalized(location) === normalized(selectedCity));
}
