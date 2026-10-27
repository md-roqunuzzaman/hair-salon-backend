import { randomInt } from "node:crypto";

const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const NUMBERS = "23456789";
const CHARACTERS = LETTERS + NUMBERS;

export const generateOrderNumber = (): string => {
  const characters = [
    LETTERS[randomInt(LETTERS.length)],
    NUMBERS[randomInt(NUMBERS.length)],
  ];

  for (let i = 2; i < 6; i++) {
    characters.push(CHARACTERS[randomInt(CHARACTERS.length)]);
  }

  // Shuffle to randomize positions
  for (let i = characters.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [characters[i], characters[j]] = [characters[j], characters[i]];
  }

  return characters.join("");
};
