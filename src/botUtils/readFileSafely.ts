import * as fs from "fs";

export function readFileSafely(filePath: string): any {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } else {
      console.error(`File not found: ${filePath}`);
      return null; // File does not exist
    }
  } catch (error) {
    console.error(`Error reading or parsing file ${filePath}: ${error}`);
    return null; // Error reading or parsing file
  }
}
