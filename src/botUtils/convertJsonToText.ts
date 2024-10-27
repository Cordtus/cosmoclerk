export function convertJsonToText(jsonData: any, depth: number = 2): string {
  return JSON.stringify(jsonData, null, depth);
}
