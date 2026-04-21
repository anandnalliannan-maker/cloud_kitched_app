export const AREA_SUBAREA_MAP: Record<string, string[]> = {
  Nanmangalam: [
    "Nanmangalam main",
    "Leela Tower",
    "Antony Flat",
    "Avia Enclave",
    "Abinandan NGR",
    "Hasthinapuram Salai",
    "Perumal Nagar",
  ],
  Medavakkam: [
    "Medavakkam main",
    "Isha Yara",
    "Navins Spring field",
    "Sundarkand",
    "Vadakkupattu",
    "Purva Windermere",
    "Jayachandran Nagar",
    "Urbantree Wow",
    "Casa Grand Zenith",
    "Navins Star wood",
    "Bhel Nagar",
  ],
  Kovilambakkam: [
    "Kovilambakkam main",
    "DRA 90",
    "Jones Blazia",
    "S Kolathur",
    "LIC Nagar",
    "Maxworth NGR",
  ],
  "Santhosh Puram": [
    "Santhosh Puram",
    "Vignarajapuram",
    "Ruby Elite",
  ],
  Perumbakkam: [
    "Perumbakkam",
    "Sowmya Nagar",
    "Sastha Nagar",
  ],
};

export function getSubAreasForArea(area: string) {
  return AREA_SUBAREA_MAP[area] || [];
}

export function isMappedSubArea(area: string, subArea: string) {
  const normalizedSubArea = subArea.trim().toLowerCase();
  if (!normalizedSubArea) return false;
  return getSubAreasForArea(area).some(
    (entry) => entry.trim().toLowerCase() === normalizedSubArea
  );
}
