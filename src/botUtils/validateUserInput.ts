export function validateUserInput(input: string): boolean {
  const validInputPattern = /^[A-Za-z0-9_-]+$/;
  return validInputPattern.test(input);
}
