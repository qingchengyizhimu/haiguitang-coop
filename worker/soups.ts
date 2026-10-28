import sourceSoups from "../samples/sample_soups.json";

export interface Soup {
  id: string;
  title: string;
  difficulty: string;
  soup_face: string;
  soup_bottom: string;
  key_elements: string[];
  hints: string[];
  distribution: "public";
  tags?: string[];
}

export const soups: Soup[] = sourceSoups
  .filter(
    (soup) =>
    soup.distribution === "public" &&
    typeof soup.id === "string" &&
    typeof soup.soup_bottom === "string" &&
    Array.isArray(soup.hints),
  )
  .map((soup) => ({ ...soup, distribution: "public" as const }));

if (soups.length !== 5) {
  throw new Error("The Sites demo must bundle exactly five public soups");
}

export const soupById = (id: string) => soups.find((soup) => soup.id === id);
