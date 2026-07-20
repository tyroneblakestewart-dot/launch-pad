import { HOODLUMS_WELCOME_FINAL_PART_00 } from "./hoodlums-welcome-final/part-00";
import { HOODLUMS_WELCOME_FINAL_PART_01 } from "./hoodlums-welcome-final/part-01";
import { HOODLUMS_WELCOME_FINAL_PART_02 } from "./hoodlums-welcome-final/part-02";
import { HOODLUMS_WELCOME_FINAL_PART_03 } from "./hoodlums-welcome-final/part-03";
import { HOODLUMS_WELCOME_REST_HEX_PART_00 } from "./hoodlums-welcome-rest-hex/part-00";
import { HOODLUMS_WELCOME_REST_HEX_PART_01 } from "./hoodlums-welcome-rest-hex/part-01";
import { HOODLUMS_WELCOME_REST_HEX_PART_02 } from "./hoodlums-welcome-rest-hex/part-02";
import { HOODLUMS_WELCOME_REST_HEX_PART_03 } from "./hoodlums-welcome-rest-hex/part-03";
import { HOODLUMS_WELCOME_REST_HEX_PART_04 } from "./hoodlums-welcome-rest-hex/part-04";

const HOODLUMS_WELCOME_REST_HEX = [
  HOODLUMS_WELCOME_REST_HEX_PART_00,
  HOODLUMS_WELCOME_REST_HEX_PART_01,
  HOODLUMS_WELCOME_REST_HEX_PART_02,
  HOODLUMS_WELCOME_REST_HEX_PART_03,
  HOODLUMS_WELCOME_REST_HEX_PART_04,
].join("");

function hexToAscii(hex: string) {
  let output = "";
  for (let index = 0; index < hex.length; index += 2) {
    output += String.fromCharCode(Number.parseInt(hex.slice(index, index + 2), 16));
  }
  return output;
}

export const HOODLUMS_WELCOME_CREW_IMAGE =
  `data:image/webp;base64,${HOODLUMS_WELCOME_FINAL_PART_00}` +
  HOODLUMS_WELCOME_FINAL_PART_01 +
  HOODLUMS_WELCOME_FINAL_PART_02 +
  HOODLUMS_WELCOME_FINAL_PART_03 +
  hexToAscii(HOODLUMS_WELCOME_REST_HEX);
